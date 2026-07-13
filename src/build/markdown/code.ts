import { createHighlighter, type Highlighter } from "shiki";
import {
  transformerNotationDiff,
  transformerNotationHighlight,
} from "@shikijs/transformers";
import { escapeAttr, escapeHtml } from "../render/html";
import { renderChartFence } from "./charts";
import type { Feature } from "../content";

/** Languages (and common aliases) preloaded into the highlighter. Others
 *  fall back to plaintext. Aliases must be listed so the fence-info guard
 *  below accepts them before Shiki resolves them to a grammar. */
const LANGS = [
  "go", "rust", "c", "cpp", "zig", "python", "py", "javascript", "js",
  "typescript", "ts", "jsx", "tsx", "sql", "bash", "shell", "sh", "yaml",
  "yml", "toml", "json", "jsonc", "html", "css", "diff", "dockerfile",
  "makefile", "markdown", "md", "mermaid", "text",
] as const;

const RUNNABLE = new Set(["go", "sql", "js", "javascript"]);

export interface FenceMeta {
  lang: string;
  run: boolean;
  nocopy: boolean;
  title?: string;
  /** 1-based line numbers to highlight. */
  highlights: number[];
  /** Colocated seed file for SQL runs. */
  db?: string;
}

/** Parses a fence info string: `go run title="main.go" hl={1,4-6} nocopy db=seed.sql` */
export function parseFenceMeta(info: string): FenceMeta {
  const parts = info.trim().split(/\s+/);
  const lang = (parts.shift() ?? "").toLowerCase();
  const meta: FenceMeta = { lang, run: false, nocopy: false, highlights: [] };
  const rest = info.trim().slice(lang.length);

  if (/(^|\s)run(\s|$)/.test(rest)) meta.run = true;
  if (/(^|\s)nocopy(\s|$)/.test(rest)) meta.nocopy = true;

  const title = rest.match(/title="([^"]*)"/);
  if (title) meta.title = title[1];

  // db=seed.sql | db=data/seed.sqlite | db=@shared | db=@shared:seed.sql
  const db = rest.match(/db=(@shared(?::[\w./-]+)?|[\w./-]+)/);
  if (db) meta.db = db[1];

  const hl = rest.match(/hl=\{([\d,\s-]+)\}/);
  if (hl) {
    for (const range of hl[1].split(",")) {
      const [from, to] = range.split("-").map((n) => parseInt(n.trim(), 10));
      if (Number.isNaN(from)) continue;
      const end = Number.isNaN(to as number) || to === undefined ? from : to;
      for (let i = from; i <= end; i++) meta.highlights.push(i);
    }
  }
  return meta;
}

// High-contrast GitHub themes: same look, but token colors meet WCAG AA
// against the code-block background (plain github-light fails on red/orange).
const LIGHT_THEME = "github-light-high-contrast";
const DARK_THEME = "github-dark-high-contrast";

let highlighter: Highlighter | undefined;

export async function initHighlighter(): Promise<void> {
  highlighter = await createHighlighter({
    themes: [LIGHT_THEME, DARK_THEME],
    langs: [...LANGS],
  });
}

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const RUN_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';

export interface CodeBlockResult {
  html: string;
  features: Feature[];
}

/** True when a fence is the `output` attachment for a preceding runnable block. */
export function isOutputFence(info: string): boolean {
  return info.trim().toLowerCase() === "output";
}

export function renderCodeBlock(
  info: string,
  code: string,
  attachedOutput?: string,
): CodeBlockResult {
  if (!highlighter) throw new Error("highlighter not initialised — call initHighlighter() first");
  const meta = parseFenceMeta(info);
  const features: Feature[] = [];

  // Mermaid fences become client-rendered diagram containers, not code blocks.
  if (meta.lang === "mermaid") {
    features.push("mermaid");
    return {
      html: `<div class="mermaid-diagram"><pre class="mermaid">${escapeHtml(code)}</pre></div>\n`,
      features,
    };
  }

  // Chart/matrix fences become static SVG/HTML rendered at build time (no JS).
  const chart = renderChartFence(meta.lang, code);
  if (chart !== null) {
    return { html: chart, features };
  }

  const lang = (LANGS as readonly string[]).includes(meta.lang) ? meta.lang : "text";
  const highlighted = highlighter.codeToHtml(code, {
    lang,
    themes: { light: LIGHT_THEME, dark: DARK_THEME },
    defaultColor: false,
    transformers: [
      transformerNotationDiff(),
      transformerNotationHighlight(),
      {
        line(node, line) {
          if (meta.highlights.includes(line)) {
            this.addClassToHast(node, "highlighted");
          }
        },
      },
    ],
  });

  const runnable = meta.run && RUNNABLE.has(meta.lang);
  const engine = meta.lang === "javascript" ? "js" : meta.lang;
  if (runnable) {
    features.push("run", `run:${engine}` as Feature);
  }

  const head: string[] = [];
  head.push(
    `<span class="code-title">${meta.title ? escapeHtml(meta.title) : ""}</span>`,
    `<span class="code-lang">${escapeHtml(meta.lang)}</span>`,
  );
  if (!meta.nocopy) {
    head.push(
      `<button type="button" class="code-copy">${COPY_ICON}<span>Copy</span></button>`,
    );
  }
  if (runnable) {
    head.push(
      `<button type="button" class="code-run" data-engine="${escapeAttr(engine)}"${meta.db ? ` data-db="${escapeAttr(meta.db)}"` : ""}>${RUN_ICON}<span>Run</span></button>`,
    );
  }

  let outputPanel = "";
  if (runnable) {
    if (attachedOutput !== undefined) {
      outputPanel = `<details class="code-output code-output--recorded"><summary>Example output</summary><pre>${escapeHtml(attachedOutput)}</pre></details>`;
    } else {
      outputPanel = `<div class="code-output" hidden><pre aria-live="polite"></pre></div>`;
    }
  }

  return {
    html: `<div class="code-block" data-lang="${escapeAttr(meta.lang)}">
<div class="code-head">${head.join("")}</div>
${highlighted}
${outputPanel}</div>\n`,
    features,
  };
}
