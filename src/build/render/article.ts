import { html, raw, type RawHtml } from "./html";
import type { Article } from "../content";
import { formatDate, metaRow, tagChips } from "./components";

function tocBlock(article: Article): RawHtml {
  if (article.toc.length < 2) return html``;
  const items = html`<ol>
${article.toc.map(
    (entry) =>
      html`<li class="toc-depth-${entry.depth}"><a href="#${entry.id}">${entry.text}</a></li>`,
  )}
</ol>`;
  return html`<nav class="toc" aria-label="Table of contents">
<details class="toc-mobile">
<summary>On this page</summary>
${items}
</details>
<div class="toc-desktop">
<p class="toc-heading">On this page</p>
${items}
</div>
</nav>`;
}

function seriesNav(article: Article): RawHtml {
  const s = article.series;
  if (!s) return html``;
  return html`<nav class="series-nav" aria-label="Series navigation">
<p class="series-title">Part ${s.index} of ${s.total} in <strong>${s.meta.title}</strong></p>
<div class="series-links">
${s.prev ? html`<a class="series-prev" href="${s.prev.url}"><span>← Previous</span><span class="series-link-title">${s.prev.fm.title}</span></a>` : html`<span></span>`}
${s.next ? html`<a class="series-next" href="${s.next.url}"><span>Next →</span><span class="series-link-title">${s.next.fm.title}</span></a>` : html`<span></span>`}
</div>
</nav>`;
}

function relatedBlock(article: Article): RawHtml {
  const others = article.series?.others ?? [];
  if (!others.length) return html``;
  return html`<section class="related" aria-label="Related articles">
<h2>More in ${article.series!.meta.title}</h2>
<ul>
${others.map(
    (other) =>
      html`<li><a href="${other.url}">${other.fm.title}</a><span class="related-meta">${formatDate(other.fm.date)} · ${other.readTime} min read</span></li>`,
  )}
</ul>
</section>`;
}

export function renderArticlePage(article: Article): RawHtml {
  return html`<div class="article-layout${article.toc.length >= 2 ? " has-toc" : ""}">
<article class="article">
<header class="article-header">
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="/articles/">Articles</a>${article.series ? html` <span aria-hidden="true">/</span> <a href="/projects/#${article.series.meta.slug}">${article.series.meta.title}</a>` : null}</nav>
<h1>${article.fm.title}</h1>
${metaRow(article)}
${tagChips(article.fm.tags)}
${article.isArchived ? html`<div class="archived-banner">This article has been archived. The content may be outdated.</div>` : null}
<p class="article-lead">${article.fm.description}</p>
${article.fm.links.length ? html`<p class="article-links">${article.fm.links.map((l) => html`<a href="${l.url}" rel="noopener" target="_blank">${l.label} ↗</a>`)}</p>` : null}
${article.fm.updated ? html`<p class="article-updated">Last updated <time datetime="${article.fm.updated.toISOString()}">${formatDate(article.fm.updated)}</time></p>` : null}
</header>
<div class="prose">
${raw(article.html)}
</div>
${seriesNav(article)}
${relatedBlock(article)}
<p class="article-back"><a href="/articles/">← All articles</a></p>
</article>
${tocBlock(article)}
</div>`;
}
