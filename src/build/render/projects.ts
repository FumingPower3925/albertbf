import { html, raw, type RawHtml } from "./html";
import type { Article, SeriesMeta } from "../content";
import { formatDate } from "./components";

const GITHUB_ICON = raw(
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.03.08-2.13 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.13.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
);

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
<div class="project-actions">
${s.url ? html`<a class="project-link" href="${s.url}" rel="noopener" target="_blank">Visit ↗</a>` : null}
${s.repo ? html`<a class="project-repo" href="${s.repo}" rel="noopener" target="_blank" aria-label="${s.title} source on GitHub" title="Source on GitHub">${GITHUB_ICON}</a>` : null}
</div>
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
