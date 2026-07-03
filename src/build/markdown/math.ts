import katex from "katex";
import type { TokenizerAndRendererExtension } from "marked";

/**
 * KaTeX rendered at build time. Client ships CSS + fonts only (no JS).
 * Block math: $$...$$ on its own lines. Inline math: $...$ (no spaces
 * hugging the delimiters, no newlines inside — avoids clobbering dollar
 * amounts in prose).
 */

function renderKatex(src: string, displayMode: boolean): string {
  return katex.renderToString(src, {
    displayMode,
    throwOnError: false,
    output: "html",
  });
}

export const blockMath: TokenizerAndRendererExtension = {
  name: "blockMath",
  level: "block",
  start(src: string) {
    return src.indexOf("$$");
  },
  tokenizer(src: string) {
    const match = src.match(/^\$\$([\s\S]+?)\$\$(?:\n+|$)/);
    if (match) {
      return { type: "blockMath", raw: match[0], text: match[1].trim() };
    }
  },
  renderer(token: any) {
    return `<div class="math math--block">${renderKatex(token.text, true)}</div>\n`;
  },
};

export const inlineMath: TokenizerAndRendererExtension = {
  name: "inlineMath",
  level: "inline",
  start(src: string) {
    return src.indexOf("$");
  },
  tokenizer(src: string) {
    // $...$ where the content does not start/end with whitespace and has no newlines.
    const match = src.match(/^\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$/);
    if (match) {
      return { type: "inlineMath", raw: match[0], text: match[1] };
    }
  },
  renderer(token: any) {
    return `<span class="math math--inline">${renderKatex(token.text, false)}</span>`;
  },
};
