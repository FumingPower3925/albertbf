import { html, raw, type RawHtml } from "./html";
import { site } from "../config";
import { THEME_SNIPPET } from "../assets";
import type { AssetManifest } from "../assets";

export interface PageMeta {
  /** Page <title> (site suffix added automatically unless isHome). */
  title: string;
  description: string;
  /** Path starting with /, e.g. /articles/hello-world/ */
  path: string;
  ogType?: "website" | "article";
  /** Absolute or site-relative URL of the social sharing image. */
  ogImage?: string;
  /** Overrides the canonical URL (frontmatter escape hatch). */
  canonicalOverride?: string;
  /** JSON-LD objects rendered into <head>. */
  jsonLd?: object[];
  /** Extra <head> content (article OG tags etc). */
  extraHead?: RawHtml;
  /** Logical script names from the manifest to load (deferred). */
  scripts?: string[];
  /** Load KaTeX stylesheet. */
  math?: boolean;
  bodyClass?: string;
  /** Nav item to mark as current. */
  activeNav?: "articles" | "projects" | "about";
  /** Show the reading progress bar (article pages). */
  progressBar?: boolean;
}

const THEME_ICONS = {
  system:
    '<svg class="theme-icon theme-icon--system" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
  light:
    '<svg class="theme-icon theme-icon--light" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>',
  dark:
    '<svg class="theme-icon theme-icon--dark" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
};

const NAV_ITEMS = [
  { key: "articles", label: "Articles", href: "/articles/" },
  { key: "projects", label: "Projects", href: "/projects/" },
  { key: "about", label: "About", href: "/about/" },
] as const;

export function page(
  meta: PageMeta,
  body: RawHtml,
  assets: AssetManifest,
  inlineCss: string,
): string {
  const canonical = meta.canonicalOverride ?? site.url + meta.path;
  const fullTitle = meta.path === "/" ? `${site.title} — ${site.author}` : `${meta.title} · ${site.title}`;
  const ogImage = meta.ogImage
    ? meta.ogImage.startsWith("http")
      ? meta.ogImage
      : site.url + meta.ogImage
    : undefined;

  const scripts = (meta.scripts ?? []).map((s) => assets.get(s)).filter(Boolean) as string[];

  const doc = html`<!DOCTYPE html>
<html lang="${site.locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${fullTitle}</title>
<meta name="description" content="${meta.description}">
<meta name="author" content="${site.author}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="${meta.ogType ?? "website"}">
<meta property="og:site_name" content="${site.fullTitle}">
${ogImage ? html`<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ogImage}">` : html`<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${meta.title}">
<meta name="twitter:description" content="${meta.description}">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#faf9f7">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#131211">
<link rel="icon" href="/images/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="application/rss+xml" title="${site.fullTitle}" href="/feed.xml">
<link rel="alternate" type="application/feed+json" title="${site.fullTitle}" href="/feed.json">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/newsreader-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<script>${raw(THEME_SNIPPET)}</script>
<style>${raw(inlineCss)}</style>
${meta.math ? html`<link id="katex-css" rel="preload" href="/vendor/katex/katex.min.css" as="style"><noscript><link rel="stylesheet" href="/vendor/katex/katex.min.css"></noscript>` : null}
${meta.extraHead ?? null}
${(meta.jsonLd ?? []).map(
  (obj) => html`<script type="application/ld+json">${raw(JSON.stringify(obj))}</script>`,
)}
</head>
<body${meta.bodyClass ? html` class="${meta.bodyClass}"` : null}>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
<div class="site-header-inner">
<a class="wordmark" href="/">${site.title}</a>
<nav aria-label="Main">
<ul>
${NAV_ITEMS.map(
  (item) => html`<li><a href="${item.href}"${meta.activeNav === item.key ? html` aria-current="page"` : null}>${item.label}</a></li>`,
)}
</ul>
</nav>
<button type="button" id="theme-toggle" class="theme-toggle" aria-label="Theme: system" data-mode="system">
${raw(THEME_ICONS.system)}${raw(THEME_ICONS.light)}${raw(THEME_ICONS.dark)}
</button>
</div>
${meta.progressBar ? html`<div class="progress-bar" aria-hidden="true"></div>` : null}
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
<div class="site-footer-inner">
<div class="footer-brand">
<span class="wordmark">${site.title}</span>
<p>${site.description.split("—")[1]?.trim() ?? "Systems, AI, and the occasional deep dive."}</p>
</div>
<nav class="footer-nav" aria-label="Footer">
<ul>
${NAV_ITEMS.map((item) => html`<li><a href="${item.href}">${item.label}</a></li>`)}
</ul>
</nav>
<div class="footer-social">
<a href="${site.github}" rel="me noopener" target="_blank">GitHub</a>
${site.linkedin ? html`<a href="${site.linkedin}" rel="me noopener" target="_blank">LinkedIn</a>` : null}
${site.email ? html`<a href="mailto:${site.email}">Email</a>` : null}
<a href="/feed.xml">RSS</a>
</div>
</div>
<p class="footer-legal">&copy; ${new Date().getFullYear()} ${site.author} · <a href="${site.repo}/blob/main/LICENSE" rel="noopener" target="_blank">AGPL-3.0</a> · Built with Bun on Cloudflare Workers</p>
</footer>
<button type="button" class="scroll-top" id="scroll-top" aria-label="Scroll to top" hidden>
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>
</button>
${assets.get("main.js") ? html`<script type="module" src="${assets.get("main.js")}"></script>` : null}
${scripts.map((src) => html`<script type="module" src="${src}"></script>`)}
${site.cfAnalyticsToken ? html`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${site.cfAnalyticsToken}"}'></script>` : null}
</body>
</html>`;

  return doc.value;
}
