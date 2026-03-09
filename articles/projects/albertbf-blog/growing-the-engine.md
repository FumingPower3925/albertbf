---
title: "Growing the Engine: Five Features That Made This Blog Feel Complete"
date: "09-03-2026"
description: "How I added article series navigation, RSS feeds, URL support, content archiving, and polished styling to a static blog — all without breaking the zero-cost, zero-dependency philosophy."
tags: ["static-site", "rss", "architecture", "css", "automation", "ci-cd"]
---

There's a moment in every side project where the foundation stops being the interesting part. The architecture is solid, the performance is dialed in, scheduled publishing works like clockwork — and yet, every time you open the site, small things nag at you. The description text looks indistinguishable from the article body. Project articles feel disconnected from each other. There's no way for readers to subscribe. You know the blog *works*, but it doesn't feel *finished*.

This article covers five features I shipped in a single session to close that gap: article series navigation, RSS feed generation, URL support in article headers, content archiving, and description styling. Each one is small on its own, but together they transformed the reading experience.

## The Description Problem

Let's start with the simplest change, because it illustrates a principle that applies to everything else.

Article descriptions were rendering as plain `<p>` tags — visually identical to the first paragraph of the article body. On the index page, where descriptions appear as previews, this was fine. But on the article page itself, the description should signal "this is a summary" rather than blending into the content.

The fix was a new `.article-lead` wrapper with an accent border:

```css
.article-lead {
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent-primary);
  padding: 1rem 1.25rem;
  border-radius: 0 4px 4px 0;
}

.article-lead p {
  font-style: italic;
  font-size: 1.05rem;
  color: var(--text-secondary);
}
```

The key decision was keeping the index page descriptions unchanged. The index uses `.article-description` as a compact preview — it doesn't need the visual weight. The article page, where you're about to invest several minutes reading, benefits from a clear "here's what you're about to read" signal.

I also added a `border-bottom` on `.article-header` to separate the header block (title, meta, description, tags) from the article body. These two changes — accent border on the description, separator below the header — create a clear visual hierarchy that was missing before.

## URLs in Article Headers

Several of my project articles reference external URLs — GitHub repositories, live demos, project websites. Previously, these lived in the article body, buried somewhere in the prose. LibreUtils articles, for instance, all reference `libreutils.org`, but you had to read the article to find the link.

The solution was adding URL support to the frontmatter schema:

```yaml
project_url: "https://libreutils.org"
```

The build script parses this and generates pill-styled links at both the top and bottom of the article:

```javascript
this.projectUrl = frontmatter['project-url'] || frontmatter['project_url'] || '';
this.urls = frontmatter.urls || [];
if (this.projectUrl && this.urls.length === 0) {
  this.urls.push({ label: 'Project URL', url: this.projectUrl });
}
```

Supporting both `project-url` and `project_url` was intentional — the existing LibreUtils articles already used `project_url` in their frontmatter, and I didn't want to go back and rename things for the sake of consistency. The build script normalizes both forms, which is cleaner than forcing a migration.

The URL pills appear as compact badges with an external link icon, styled to match the project badge aesthetic. On hover, they fill with the accent color and shift up slightly — enough feedback to feel interactive without being distracting.

## Content Archiving

Not every article ages well. Project articles for abandoned or completed projects still have value as reference material, but they shouldn't carry the same visual weight as current content. I needed a way to mark articles as archived without removing them from the site.

The implementation mirrors scheduled publishing: a frontmatter field with a DD-MM-YYYY date:

```yaml
archive-date: "01-03-2026"
```

When the archive date has passed, the build script marks the article as archived:

```javascript
if (article.archiveDate) {
  const archiveDate = new Date(article.archiveDate);
  archiveDate.setHours(0, 0, 0, 0);
  if (archiveDate <= now) {
    article.isArchived = true;
  }
}
```

Archived articles get three visual treatments:
1. **An "Archived" badge** in the article meta, next to the project badge
2. **A banner below the title** stating the content may be outdated
3. **Reduced opacity (0.7)** on the index page card

The decision to keep archived articles visible rather than hiding them was deliberate. Hidden content creates dead links, breaks search engine indexes, and frustrates readers who bookmarked a URL. Visible-but-muted is the right trade-off: readers can still access the content, but the visual signals make it clear they're looking at historical material.

The daily rebuild handles auto-archiving automatically — the same mechanism that powers scheduled publishing now works in reverse. Set a future archive date, and the article will silently transition to archived status when that date arrives.

## Article Series Navigation

This was the largest feature and the one I'm most satisfied with. Project articles naturally form series — the albertbf-blog articles trace an architectural evolution, the LibreUtils articles follow a development journey — but there was no way for readers to navigate between them.

The `buildArticleSeries` function groups published articles by project name, sorts them chronologically, and links them:

```javascript
function buildArticleSeries(articles) {
  const projectGroups = new Map();
  for (const article of articles) {
    if (article.isProject && article.projectName) {
      if (!projectGroups.has(article.projectName)) {
        projectGroups.set(article.projectName, []);
      }
      projectGroups.get(article.projectName).push(article);
    }
  }

  for (const [, group] of projectGroups) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.date - b.date);

    for (let i = 0; i < group.length; i++) {
      group[i].seriesIndex = i + 1;
      group[i].seriesTotal = group.length;
      group[i].prevArticle = i > 0 ? group[i - 1] : null;
      group[i].nextArticle = i < group.length - 1 ? group[i + 1] : null;
      group[i].related = group.filter((_, j) => j !== i);
    }
  }
}
```

The function runs after filtering published articles but before generating HTML, so scheduled and unpublished articles never appear in series navigation. Single-article projects (standalone articles) skip series generation entirely — no empty navigation boxes.

Each article in a series gets two navigation elements:

**Series navigation** — a "Part X of Y" indicator with previous/next links. The links show directional labels ("Previous" / "Next") above the article title, giving readers clear orientation without having to parse the full title to figure out which direction they're going.

**Related articles** — a compact list of all other articles in the same project, with dates and read times. This gives readers the full picture of the series at a glance.

The CSS uses flexbox rather than a rigid grid. When an article is first or last in the series, there's simply no link on that side — no empty placeholder divs, no awkward blank spaces. On mobile, the links stack vertically.

## RSS Feed

RSS is one of those features that seems archaic until you need it. For a personal blog with no social media presence and no email newsletter, RSS is the only practical way for readers to subscribe to updates.

The implementation generates standard RSS 2.0 XML with the 20 most recent articles:

```javascript
function generateRSSFeed(articles) {
  const siteUrl = 'https://albertbf.com';
  const sortedArticles = [...articles]
    .sort((a, b) => b.date - a.date)
    .slice(0, 20);

  const items = sortedArticles.map(article => `    <item>
      <title>${escapeXml(article.title)}</title>
      <link>${siteUrl}${article.url}</link>
      <guid>${siteUrl}${article.url}</guid>
      <pubDate>${article.date.toUTCString()}</pubDate>
      <description>${escapeXml(article.description)}</description>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Albert BF's Blog</title>
    <link>${siteUrl}</link>
    <description>My personal minimalist technical blog</description>
${items}
  </channel>
</rss>`;
}
```

The feed is written to `dist/feed.xml` and autodiscovered via a `<link>` tag in the HTML head. Any RSS reader that finds the blog will automatically detect the feed.

I also added new article detection to the daily deploy workflow. Before deploying, the workflow fetches the current production `search-index.json`. After building, it compares the new index against the old one to identify newly published articles. This outputs `has_new` and `articles` as step outputs, enabling future integrations — a Discord webhook, a Slack notification, or any other channel that can be triggered by a conditional workflow step.

## The Pattern: Small Changes, Large Impact

What strikes me about this batch of features is how little code each one required. The description styling is 15 lines of CSS. URL support is 10 lines of JavaScript. Archiving is a date comparison. The RSS feed is a string template. Series navigation — the most complex feature — is a single function that groups, sorts, and links.

None of these features required new dependencies, new build tools, or architectural changes. They all slot into the existing build pipeline: parse frontmatter, generate HTML, write files. The static site approach scales naturally because every feature is just "more data in, more HTML out."

This is the payoff of the zero-cost, zero-dependency philosophy from the earlier articles. When your build system is a single JavaScript file and your deployment is a Cloudflare Worker, adding features is fast because there's nothing to fight against. No framework opinions, no plugin ecosystems, no configuration files — just code that transforms markdown into HTML.

## What's Next

The blog is in a good place. The reading experience is polished, articles connect to each other naturally, and readers can subscribe via RSS. Future improvements will likely focus on:

- **Search improvements** — the client-side search works, but could benefit from fuzzy matching and keyboard navigation
- **Analytics** — privacy-respecting visitor insights without third-party scripts
- **Visual polish** — a thorough visual audit to catch inconsistencies and rough edges across desktop, mobile, and dark mode

But for now, the engine is running smoothly. Sometimes the best thing you can do for a project is ship the small things that make it feel complete.

The complete implementation is available in the [repository](https://github.com/FumingPower3925/albertbf).
