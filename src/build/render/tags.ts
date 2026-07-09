import { html, type RawHtml } from "./html";
import type { Article } from "../content";
import { articleCard, slugifyTag } from "./components";

export interface TagGroup {
  slug: string;
  label: string;
  articles: Article[];
}

/** Group every article by tag slug, newest-first within each, most-used tags first. */
export function collectTags(articles: Article[]): TagGroup[] {
  const map = new Map<string, TagGroup>();
  for (const article of articles) {
    for (const tag of article.fm.tags) {
      const slug = slugifyTag(tag);
      if (!slug) continue;
      let group = map.get(slug);
      if (!group) {
        group = { slug, label: tag, articles: [] };
        map.set(slug, group);
      }
      group.articles.push(article);
    }
  }
  return [...map.values()].sort(
    (a, b) => b.articles.length - a.articles.length || a.label.localeCompare(b.label),
  );
}

/** A single tag's landing page: crawlable, indexable, one card per tagged article. */
export function renderTagPage(group: TagGroup): RawHtml {
  const n = group.articles.length;
  return html`<div class="tag-page">
<header class="page-header">
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/articles/">Articles</a> <span aria-hidden="true">/</span> <a href="/tags/">Tags</a></nav>
<h1>Tagged <span class="tag-title">${group.label}</span></h1>
<p class="page-subtitle">${n} article${n === 1 ? "" : "s"} tagged “${group.label}”.</p>
</header>
<div class="card-list">
${group.articles.map((article) => articleCard(article))}
</div>
<p class="article-back"><a href="/tags/">← All tags</a></p>
</div>`;
}

/** The /tags/ index: every tag as a chip with its article count. */
export function renderTagsIndex(groups: TagGroup[]): RawHtml {
  return html`<div class="tags-index">
<header class="page-header">
<h1>Tags</h1>
<p class="page-subtitle">Browse ${groups.length} topic${groups.length === 1 ? "" : "s"}.</p>
</header>
<ul class="tag-list tag-list--index">
${groups.map(
    (group) =>
      html`<li><a class="tag" href="/tags/${group.slug}/"><span class="sr-only">Articles tagged </span>${group.label} <span class="tag-count" aria-hidden="true">${group.articles.length}</span></a></li>`,
  )}
</ul>
</div>`;
}
