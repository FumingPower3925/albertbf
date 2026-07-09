import { html, raw, type RawHtml } from "./html";
import type { Article } from "../content";

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function metaRow(article: Article): RawHtml {
  return html`<p class="meta-row">
<time datetime="${article.fm.date.toISOString()}">${formatDate(article.fm.date)}</time>
<span aria-hidden="true">·</span>
<span>${article.readTime} min read</span>
${article.series ? html`<span aria-hidden="true">·</span><span class="badge badge--series">${article.series.meta.title}</span>` : null}
${article.isArchived ? html`<span aria-hidden="true">·</span><span class="badge badge--archived">Archived</span>` : null}
</p>`;
}

/** URL-safe slug for a tag, e.g. "Go 1.22" -> "go-1-22". Shared by chips and page routing. */
export function slugifyTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function tagChips(tags: string[]): RawHtml {
  if (!tags.length) return html``;
  // The sr-only prefix makes the link text descriptive ("Articles tagged go")
  // — a bare one-word tag like "go" otherwise trips Lighthouse's
  // non-descriptive-link-text audit — while the chip still shows just the tag.
  // Chips point at the crawlable static tag page, not the JS-only ?tag= filter.
  return html`<ul class="tag-list">
${tags.map(
    (tag) =>
      html`<li><a class="tag" href="/tags/${slugifyTag(tag)}/"><span class="sr-only">Articles tagged </span>${tag}</a></li>`,
  )}
</ul>`;
}

export function articleCard(article: Article, headingLevel: 2 | 3 = 2): RawHtml {
  const tag = raw(`h${headingLevel}`);
  return html`<article class="article-card"${article.fm.tags.length ? html` data-tags="${article.fm.tags.join(",")}"` : null}>
<${tag} class="card-title"><a href="${article.url}">${article.fm.title}</a></${tag}>
${metaRow(article)}
<p class="card-description">${article.fm.description}</p>
${tagChips(article.fm.tags)}
</article>`;
}
