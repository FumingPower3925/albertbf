#!/usr/bin/env bun
import { rm, mkdir, cp } from "fs/promises";
import { join } from "path";
import { paths, site } from "./config";
import { loadContent, type Article } from "./content";
import { createRenderer } from "./markdown/pipeline";
import { buildAssets } from "./assets";
import { page } from "./render/layout";
import { html, raw } from "./render/html";
import { renderArticlePage } from "./render/article";
import { renderHome } from "./render/home";
import { renderArticlesList } from "./render/articles-list";
import { renderProjects } from "./render/projects";
import { renderAbout } from "./render/about";
import { renderNotFound } from "./render/notfound";
import { writeSearchIndex } from "./search";
import { websiteJsonLd, personJsonLd, blogPostingJsonLd, breadcrumbJsonLd } from "./seo/jsonld";
import { writeSitemap, writeRobots, writeLlmsTxt, writeFeeds, writeManifest } from "./seo/artifacts";
import { generateOgImage } from "./seo/og-image";

function articleExtraHead(article: Article) {
  return html`<meta property="article:published_time" content="${article.fm.date.toISOString()}">
${article.fm.updated ? html`<meta property="article:modified_time" content="${article.fm.updated.toISOString()}">` : null}
<meta property="article:author" content="${site.author}">
${article.fm.tags.map((tag) => html`<meta property="article:tag" content="${tag}">`)}`;
}

async function main() {
  const started = performance.now();
  console.log("Building albertbf.com…");

  await rm(paths.dist, { recursive: true, force: true });
  await mkdir(paths.dist, { recursive: true });

  // 1. Content
  const { articles, seriesList, bySeries } = await loadContent();
  console.log(`${articles.length} article(s), ${seriesList.length} series`);

  // 2. Markdown rendering
  const render = await createRenderer();
  const usedFeatures = new Set<string>();
  for (const article of articles) {
    const result = render(article);
    article.html = result.html;
    article.toc = result.toc;
    article.features = result.features;
    article.plainText = result.plainText;
    for (const f of result.features) usedFeatures.add(f);
    console.log(`${article.fm.title}${result.features.size ? ` (${[...result.features].join(", ")})` : ""}`);
  }

  // 3. Assets (styles, client bundles, fonts, vendor, _headers, static files)
  const { manifest, inlineCss } = await buildAssets({
    sql: usedFeatures.has("run:sql"),
    mermaid: usedFeatures.has("mermaid"),
    katex: usedFeatures.has("math"),
  });

  // 4. Article pages (+ colocated assets + OG images)
  for (const article of articles) {
    const ogImage = await generateOgImage(article);
    const scripts: string[] = [];
    if (article.toc.length >= 2) scripts.push("toc.js");
    if (article.features.has("lightbox")) scripts.push("lightbox.js");
    if (article.features.has("mermaid")) scripts.push("mermaid-loader.js");
    if (article.features.has("run")) scripts.push("run.js");

    const doc = page(
      {
        title: article.fm.title,
        description: article.fm.description,
        path: article.url,
        ogType: "article",
        ogImage,
        canonicalOverride: article.fm.canonical,
        jsonLd: [blogPostingJsonLd(article, ogImage), breadcrumbJsonLd(article)],
        extraHead: articleExtraHead(article),
        scripts,
        math: article.features.has("math"),
        bodyClass: "page-article",
        activeNav: "articles",
        progressBar: true,
      },
      renderArticlePage(article),
      manifest,
      inlineCss,
    );
    const outDir = join(paths.dist, article.url.slice(1));
    await mkdir(outDir, { recursive: true });
    await Bun.write(join(outDir, "index.html"), doc);

    for (const asset of article.assets) {
      await cp(join(article.dir, asset), join(outDir, asset), { recursive: true });
    }
  }

  // 5. Site pages
  await Bun.write(
    join(paths.dist, "index.html"),
    page(
      {
        title: site.fullTitle,
        description: site.description,
        path: "/",
        jsonLd: [websiteJsonLd(), personJsonLd()],
        bodyClass: "page-home",
      },
      renderHome(articles, seriesList, bySeries),
      manifest,
      inlineCss,
    ),
  );

  await mkdir(join(paths.dist, "articles"), { recursive: true });
  await Bun.write(
    join(paths.dist, "articles", "index.html"),
    page(
      {
        title: "Articles",
        description: `All articles by ${site.author} — systems programming, AI engineering, databases, and more.`,
        path: "/articles/",
        scripts: ["search.js"],
        bodyClass: "page-articles",
        activeNav: "articles",
      },
      renderArticlesList(articles),
      manifest,
      inlineCss,
    ),
  );

  await mkdir(join(paths.dist, "projects"), { recursive: true });
  await Bun.write(
    join(paths.dist, "projects", "index.html"),
    page(
      {
        title: "Projects",
        description: `Projects by ${site.author}, written up as article series.`,
        path: "/projects/",
        bodyClass: "page-projects",
        activeNav: "projects",
      },
      renderProjects(seriesList, bySeries),
      manifest,
      inlineCss,
    ),
  );

  await mkdir(join(paths.dist, "about"), { recursive: true });
  await Bun.write(
    join(paths.dist, "about", "index.html"),
    page(
      {
        title: "About",
        description: `About ${site.author} — software engineer in Barcelona.`,
        path: "/about/",
        jsonLd: [personJsonLd()],
        bodyClass: "page-about",
        activeNav: "about",
      },
      renderAbout(),
      manifest,
      inlineCss,
    ),
  );

  await Bun.write(
    join(paths.dist, "404.html"),
    page(
      {
        title: "404 — Page not found",
        description: "This page does not exist.",
        path: "/404.html",
        bodyClass: "page-404",
      },
      renderNotFound(),
      manifest,
      inlineCss,
    ),
  );

  // 6. SEO artifacts + search index
  await Promise.all([
    writeSitemap(articles),
    writeRobots(),
    writeLlmsTxt(articles, seriesList),
    writeFeeds(articles),
    writeManifest(),
    writeSearchIndex(articles),
  ]);

  console.log(`Build completed in ${Math.round(performance.now() - started)}ms`);
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message ?? err}`);
  process.exit(1);
});
