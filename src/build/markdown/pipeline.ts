import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from "marked";
import markedFootnote from "marked-footnote";
import type { Article, Feature, TocEntry } from "../content";
import { newHeadingContext, renderHeading, type HeadingContext } from "./headings";
import { transformCallouts, renderCallout, type CalloutKind } from "./callouts";
import { initHighlighter, isOutputFence, renderCodeBlock } from "./code";
import { renderMedia, renderYouTube, type MediaContext } from "./media";
import { blockMath, inlineMath } from "./math";

export interface RenderResult {
  html: string;
  toc: TocEntry[];
  features: Set<Feature>;
  plainText: string;
}

/** Per-article mutable state shared with renderer callbacks via closure. */
interface RenderContext {
  headings: HeadingContext;
  media: MediaContext;
  features: Set<Feature>;
}

const youtubeDirective: TokenizerAndRendererExtension = {
  name: "youtube",
  level: "block",
  start(src: string) {
    return src.indexOf("::youtube");
  },
  tokenizer(src: string) {
    const match = src.match(/^::youtube\{([^}]*)\}(?:\n+|$)/);
    if (!match) return;
    const attrs = match[1];
    const id = attrs.match(/id=([\w-]+)/)?.[1] ?? "";
    const title = attrs.match(/title="([^"]*)"/)?.[1] ?? "";
    return { type: "youtube", raw: match[0], id, title };
  },
  renderer(token: any) {
    return renderYouTube(token.id, token.title);
  },
};

/**
 * Moves `output` fences into their preceding runnable code fence so the
 * renderer can show pre-recorded output as a fallback panel.
 */
function attachOutputFences(tokens: Token[]): void {
  for (let i = tokens.length - 1; i > 0; i--) {
    const token = tokens[i];
    if (token.type !== "code" || !isOutputFence((token as Tokens.Code).lang ?? "")) continue;
    // Find the nearest preceding code fence (skip whitespace-only "space" tokens).
    let j = i - 1;
    while (j >= 0 && tokens[j].type === "space") j--;
    const prev = tokens[j];
    if (prev?.type === "code") {
      (prev as Tokens.Code & { attachedOutput?: string }).attachedOutput = (token as Tokens.Code).text;
      tokens.splice(i, 1);
    }
  }
}

/**
 * Recursive pre-parse pass: marked's walkTokens only runs via parse(), and we
 * drive lexer/parser directly — so callout tagging walks the tree here.
 */
function walkAllTokens(tokens: Token[]): void {
  transformCallouts(tokens);
  for (const token of tokens) {
    const children = (token as { tokens?: Token[] }).tokens;
    if (children) walkAllTokens(children);
    const items = (token as { items?: Token[] }).items;
    if (items) walkAllTokens(items);
  }
}

function stripHtml(htmlText: string): string {
  return htmlText
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function createRenderer(): Promise<(article: Article) => RenderResult> {
  await initHighlighter();

  // Context is swapped per render; renders are sequential so this is safe.
  let ctx: RenderContext;

  const marked = new Marked();
  marked.use(markedFootnote({ description: "Footnotes" }));
  marked.use({
    gfm: true,
    extensions: [blockMath, inlineMath, youtubeDirective],
    hooks: {
      // Runs after lexing, before parsing — composes with marked-footnote's
      // own processAllTokens (which moves footnote definitions to the end).
      processAllTokens(tokens: Token[]) {
        attachOutputFences(tokens);
        walkAllTokens(tokens);
        return tokens;
      },
    },
    renderer: {
      heading(token: Tokens.Heading): string {
        const inner = this.parser.parseInline(token.tokens);
        return renderHeading(ctx.headings, inner, token.text, token.depth);
      },
      code(token: Tokens.Code): string {
        const attached = (token as Tokens.Code & { attachedOutput?: string }).attachedOutput;
        const result = renderCodeBlock(token.lang ?? "", token.text, attached);
        for (const f of result.features) ctx.features.add(f);
        return result.html;
      },
      image(token: Tokens.Image): string {
        return renderMedia(ctx.media, token.href, token.title, token.text);
      },
      blockquote(token: Tokens.Blockquote): string {
        const kind = (token as Tokens.Blockquote & { calloutKind?: CalloutKind }).calloutKind;
        const body = this.parser.parse(token.tokens);
        if (kind) return renderCallout(kind, body);
        return `<blockquote>\n${body}</blockquote>\n`;
      },
      paragraph(token: Tokens.Paragraph): string {
        const inner = this.parser.parseInline(token.tokens);
        // A paragraph that is just a figure (image/video) must not be wrapped
        // in <p> — <figure> is block-level and invalid inside <p>.
        if (/^\s*<figure\b/.test(inner)) return `${inner}\n`;
        return `<p>${inner}</p>\n`;
      },
    },
  });

  return (article: Article): RenderResult => {
    ctx = {
      headings: newHeadingContext(),
      media: { dir: article.dir, url: article.url, usedLightbox: false },
      features: new Set<Feature>(),
    };

    const htmlOut = marked.parse(article.markdown) as string;

    if (htmlOut.includes('class="math')) ctx.features.add("math");
    if (ctx.media.usedLightbox) ctx.features.add("lightbox");

    return {
      html: htmlOut,
      toc: ctx.headings.toc,
      features: ctx.features,
      plainText: stripHtml(htmlOut),
    };
  };
}
