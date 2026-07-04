import type { TocEntry } from "../content";
import { escapeHtml } from "../render/html";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

export interface HeadingContext {
  toc: TocEntry[];
  seen: Map<string, number>;
}

export function newHeadingContext(): HeadingContext {
  return { toc: [], seen: new Map() };
}

export function renderHeading(
  ctx: HeadingContext,
  text: string,
  plain: string,
  depth: number,
): string {
  const base = slugify(plain) || "section";
  const count = ctx.seen.get(base) ?? 0;
  ctx.seen.set(base, count + 1);
  const id = count === 0 ? base : `${base}-${count}`;

  if (depth === 2 || depth === 3) {
    ctx.toc.push({ depth, id, text: plain });
  }

  return `<h${depth} id="${escapeHtml(id)}">${text}<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></h${depth}>\n`;
}
