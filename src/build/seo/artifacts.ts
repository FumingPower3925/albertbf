import { join } from "path";
import { cp } from "fs/promises";
import { paths, site, FEED_LIMIT } from "../config";
import type { Article, SeriesMeta } from "../content";
import { escapeHtml } from "../render/html";
import { feedSafeHtml } from "./feed-html";

const FEED_IMAGE = `${site.url}/images/icon-512.png`;

/** Latest content change across published articles (for feed lastBuildDate). */
function latestChange(articles: Article[]): Date {
  const times = articles.map((a) => (a.fm.updated ?? a.fm.date).getTime());
  return times.length ? new Date(Math.max(...times)) : new Date(0);
}

interface Page {
  path: string;
  lastmod?: Date;
}

export async function writeSitemap(articles: Article[], extraPaths: string[] = []): Promise<void> {
  const pages: Page[] = [
    { path: "/", lastmod: articles[0]?.fm.date },
    { path: "/articles/", lastmod: articles[0]?.fm.date },
    { path: "/projects/" },
    { path: "/about/" },
    ...articles.map((a) => ({ path: a.url, lastmod: a.fm.updated ?? a.fm.date })),
    ...extraPaths.map((path) => ({ path })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
    .map(
      (p) => `  <url>
    <loc>${site.url}${p.path}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}
  </url>`,
    )
    .join("\n")}
</urlset>
`;
  await Bun.write(join(paths.dist, "sitemap.xml"), xml);
}

export async function writeRobots(): Promise<void> {
  const txt = `User-agent: *
Allow: /

Sitemap: ${site.url}/sitemap.xml
`;
  await Bun.write(join(paths.dist, "robots.txt"), txt);
}

export async function writeLlmsTxt(articles: Article[], seriesList: SeriesMeta[]): Promise<void> {
  const lines = [
    `# ${site.fullTitle}`,
    "",
    `> ${site.description}`,
    "",
    "## Articles",
    "",
    ...articles.map(
      (a) => `- [${a.fm.title}](${site.url}${a.url}index.md): ${a.fm.description}`,
    ),
  ];
  if (seriesList.length) {
    lines.push("", "## Projects", "");
    for (const s of seriesList) {
      const url = s.url ?? `${site.url}/projects/#${s.slug}`;
      lines.push(`- [${s.title}](${url}): ${s.description}`);
    }
  }
  lines.push("", "## Pages", "", `- [About](${site.url}/about/): About ${site.author}`, "");
  await Bun.write(join(paths.dist, "llms.txt"), lines.join("\n"));

  // Raw markdown copies for llms.txt consumers.
  for (const article of articles) {
    await cp(join(article.dir, "index.md"), join(paths.dist, article.url.slice(1), "index.md"));
  }
}

function rssItem(article: Article): string {
  const url = site.url + article.url;
  const content = feedSafeHtml(article.html, article.url);
  return `    <item>
      <title>${escapeHtml(article.fm.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${article.fm.date.toUTCString()}</pubDate>
      <description>${escapeHtml(article.fm.description)}</description>
      <content:encoded><![CDATA[${content.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></content:encoded>
    </item>`;
}

export async function writeFeeds(articles: Article[]): Promise<void> {
  const latest = articles.slice(0, FEED_LIMIT);
  const built = latestChange(latest);

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/feed.xsl"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeHtml(site.fullTitle)}</title>
    <link>${site.url}</link>
    <description>${escapeHtml(site.description)}</description>
    <language>${site.locale}</language>
    <lastBuildDate>${built.toUTCString()}</lastBuildDate>
    <image>
      <url>${FEED_IMAGE}</url>
      <title>${escapeHtml(site.fullTitle)}</title>
      <link>${site.url}</link>
    </image>
    <atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>
${latest.map(rssItem).join("\n")}
  </channel>
</rss>
`;
  await Bun.write(join(paths.dist, "feed.xml"), rss);

  const jsonFeed = {
    version: "https://jsonfeed.org/version/1.1",
    title: site.fullTitle,
    home_page_url: site.url,
    feed_url: `${site.url}/feed.json`,
    description: site.description,
    language: site.locale,
    icon: FEED_IMAGE,
    favicon: `${site.url}/images/icon-192.png`,
    authors: [{ name: site.author, url: `${site.url}/about/` }],
    items: latest.map((article) => ({
      id: site.url + article.url,
      url: site.url + article.url,
      title: article.fm.title,
      summary: article.fm.description,
      content_html: feedSafeHtml(article.html, article.url),
      date_published: article.fm.date.toISOString(),
      ...(article.fm.updated ? { date_modified: article.fm.updated.toISOString() } : {}),
      tags: article.fm.tags,
    })),
  };
  await Bun.write(join(paths.dist, "feed.json"), JSON.stringify(jsonFeed, null, 2));
}

export async function writeManifest(): Promise<void> {
  const manifest = {
    name: site.fullTitle,
    short_name: site.title,
    description: site.description,
    start_url: "/",
    display: "browser",
    background_color: "#faf9f7",
    theme_color: "#c22a2a",
    icons: [
      { src: "/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
  await Bun.write(join(paths.dist, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));
}
