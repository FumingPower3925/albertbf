import { html, type RawHtml } from "./html";
import type { Article, SeriesMeta } from "../content";
import { formatDate } from "./components";

export function renderProjects(
  seriesList: SeriesMeta[],
  bySeries: Map<string, Article[]>,
): RawHtml {
  const withArticles = seriesList.filter((s) => bySeries.has(s.slug));

  return html`<div class="projects-page">
<header class="page-header">
<h1>Projects</h1>
<p class="page-subtitle">Things I build, written up as article series.</p>
</header>
${withArticles.length
    ? withArticles.map((s) => {
        const group = [...bySeries.get(s.slug)!].reverse(); // newest first
        const allArchived = group.every((a) => a.isArchived);
        return html`<section class="project" id="${s.slug}">
<div class="project-head">
<h2>${s.title}${allArchived ? html` <span class="badge badge--archived">Archived</span>` : null}</h2>
${s.url ? html`<a class="project-link" href="${s.url}" rel="noopener" target="_blank">Visit ↗</a>` : null}
</div>
<p class="project-description">${s.description}</p>
<ul class="project-articles">
${group.map(
          (article) => html`<li>
<a href="${article.url}">${article.fm.title}</a>
<span class="project-article-meta">${formatDate(article.fm.date)} · ${article.readTime} min read${article.isArchived && !allArchived ? " · archived" : ""}</span>
</li>`,
        )}
</ul>
</section>`;
      })
    : html`<p class="empty-state">No projects yet — check back soon.</p>`}
</div>`;
}
