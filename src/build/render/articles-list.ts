import { html, type RawHtml } from "./html";
import type { Article } from "../content";
import { articleCard } from "./components";

export function renderArticlesList(articles: Article[]): RawHtml {
  const tagCounts = new Map<string, number>();
  for (const article of articles) {
    for (const tag of article.fm.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag);

  return html`<div class="articles-page">
<header class="page-header">
<h1>Articles</h1>
<p class="page-subtitle">${articles.length} article${articles.length === 1 ? "" : "s"} on systems, AI, and whatever else I'm building.</p>
</header>
<div class="article-controls">
<div class="search-wrap">
<input type="search" id="search-input" placeholder="Search articles…" aria-label="Search articles" autocomplete="off">
<kbd class="search-kbd" aria-hidden="true">/</kbd>
</div>
${topTags.length ? html`<div class="tag-filter" role="group" aria-label="Filter by tag">
${topTags.map((tag) => html`<button type="button" class="tag tag--filter" data-tag="${tag}" aria-pressed="false">${tag}</button>`)}
</div>` : null}
</div>
<div class="card-list" id="article-list">
${articles.map((article) => articleCard(article))}
</div>
<p class="no-results" id="no-results" hidden>No articles match. <button type="button" id="clear-filters" class="link-button">Clear filters</button></p>
</div>`;
}
