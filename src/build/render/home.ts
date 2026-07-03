import { html, type RawHtml } from "./html";
import { site } from "../config";
import type { Article, SeriesMeta } from "../content";
import { articleCard, formatDate } from "./components";

export function renderHome(
  articles: Article[],
  seriesList: SeriesMeta[],
  bySeries: Map<string, Article[]>,
): RawHtml {
  const featured = articles.find((a) => a.fm.featured);
  const recent = articles.filter((a) => a !== featured).slice(0, 5);
  const seriesWithArticles = seriesList.filter((s) => bySeries.has(s.slug)).slice(0, 3);

  return html`<div class="home">
<section class="hero">
<h1>${site.author}</h1>
<!-- USER ACTION: confirm the role line below -->
<p class="hero-role">Software engineer · Barcelona · Master's @ UPC</p>
<p class="hero-intro">I build systems software, AI tooling, and privacy-first web things. This is where I write about what I learn along the way.</p>
<p class="hero-links">
<a href="${site.github}" rel="me noopener" target="_blank">GitHub</a>
<a href="/about/">About me →</a>
<a href="/feed.xml">RSS</a>
</p>
</section>
${featured ? html`<section class="featured" aria-label="Featured article">
<p class="section-label">Featured</p>
${articleCard(featured)}
</section>` : null}
<section class="recent" aria-label="Recent articles">
<div class="section-head">
<h2>Recent writing</h2>
<a class="section-more" href="/articles/">All articles →</a>
</div>
<div class="card-list">
${recent.map((article) => articleCard(article, 3))}
</div>
</section>
${seriesWithArticles.length ? html`<section class="home-projects" aria-label="Projects">
<div class="section-head">
<h2>Projects</h2>
<a class="section-more" href="/projects/">All projects →</a>
</div>
<div class="project-tiles">
${seriesWithArticles.map((s) => {
    const group = bySeries.get(s.slug)!;
    const latest = group[group.length - 1];
    return html`<a class="project-tile" href="/projects/#${s.slug}">
<h3>${s.title}</h3>
<p>${s.description}</p>
<p class="project-tile-meta">${group.length} article${group.length === 1 ? "" : "s"} · updated ${formatDate(latest.fm.date)}</p>
</a>`;
  })}
</div>
</section>` : null}
</div>`;
}
