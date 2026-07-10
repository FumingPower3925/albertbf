import { html, raw, type RawHtml } from "./html";
import { site } from "../config";
import type { Article } from "../content";
import { formatDate, metaRow, tagChips } from "./components";

const SHARE_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>';

/**
 * Article action row at the foot of the piece. The Share control uses the Web
 * Share API where available and falls back to copying the link. It renders
 * up-front (no JS reveal) so it never shifts the layout, and is self-contained —
 * no third-party share endpoints.
 */
function colophon(article: Article): RawHtml {
  const url = site.url + article.url;
  const src = `${site.repo}/blob/main/content/articles/${article.slug}/index.md`;
  const history = `${site.repo}/commits/main/content/articles/${article.slug}/index.md`;
  const discuss = `${site.repo}/issues/new?title=${encodeURIComponent("Re: " + article.fm.title)}`;
  return html`<footer class="article-colophon">
<button type="button" class="share-button" data-share-url="${url}" data-share-title="${article.fm.title}">${raw(SHARE_ICON)}<span>Share</span></button>
<a href="${src}" rel="noopener" target="_blank">View source</a>
<a href="${history}" rel="noopener" target="_blank">History</a>
<a href="${discuss}" rel="noopener" target="_blank">Spotted an issue? Open one</a>
</footer>`;
}

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

function articleListBlock(heading: string, articles: Article[]): RawHtml {
  if (!articles.length) return html``;
  return html`<section class="related" aria-label="${heading}">
<h2>${heading}</h2>
<ul>
${articles.map(
    (other) =>
      html`<li><a href="${other.url}">${other.fm.title}</a><span class="related-meta">${formatDate(other.fm.date)} · ${other.readTime} min read</span></li>`,
  )}
</ul>
</section>`;
}

/** "More in this series" — other entries of the same series. */
function seriesMoreBlock(article: Article): RawHtml {
  const others = article.series?.others ?? [];
  return articleListBlock(`More in ${article.series?.meta.title ?? "this series"}`, others);
}

/** "Related articles" — cross-series recommendations by shared tags. */
function relatedBlock(article: Article): RawHtml {
  return articleListBlock("Related articles", article.related);
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
${seriesMoreBlock(article)}
${relatedBlock(article)}
${colophon(article)}
<p class="article-back"><a href="/articles/">← All articles</a></p>
</article>
${tocBlock(article)}
</div>`;
}
