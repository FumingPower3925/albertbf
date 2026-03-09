---
title: "The Visual Audit: Ten Tweaks That Polished the Rough Edges"
date: "16-03-2026"
description: "How a Playwright-powered screenshot audit across desktop, mobile, and dark mode revealed ten visual issues — from missing meta tags to a bare footer — and the minimal fixes that resolved them all."
tags: ["css", "ux", "static-site", "accessibility", "open-graph", "design"]
---

There's a difference between a site that works and a site that feels right. The blog had been functional for months — clean layout, good performance, dark mode, article series navigation. But I'd been avoiding something: actually *looking* at it with fresh eyes.

So I wrote a Playwright script that captured screenshots across three viewports — desktop at 1200x800, mobile at 390x844, and desktop in dark mode — and sat down with the results. What I found wasn't broken, exactly. It was a collection of small things: inconsistencies, missing affordances, and gaps where professional polish should have been. Ten issues in total, each one minor on its own, but together they were the difference between "this works" and "this feels finished."

## The Screenshot Approach

The audit script is straightforward — Playwright launches a headless browser, navigates to each page type (index, article, project, archived article), and captures screenshots at each viewport size. The value isn't in the automation itself; it's in forcing yourself to look at every page in every context simultaneously.

When you're building a feature, you check it in the context you're thinking about. You add dark mode and check dark mode. You tweak mobile layout and check mobile. But you rarely open the index page on mobile in dark mode and ask "does the footer look right?" — because there is no footer. That's the kind of thing screenshots catch.

## The Quick Wins

Some issues were embarrassingly simple. The search input used `border-radius: 2px` while every other card and element used `4px`. One line of CSS:

```css
.search-input {
  border-radius: 4px;
}
```

The nav active link had a subtler bug. When viewing an article page, neither "Articles" nor "Projects" appeared active in the floating pill navbar. The logic checked `currentPath.startsWith(linkPath)`, but article URLs start with `/articles/` which doesn't match `/` exactly. The fix was to invert the logic — if you're on a `/projects/` path, highlight Projects; otherwise, highlight Articles:

```javascript
navLinks.forEach(link => {
  const linkPath = link.getAttribute('href');
  if (linkPath === '/projects/' && currentPath.startsWith('/projects/')) {
    link.classList.add('active');
  } else if (linkPath === '/' && !currentPath.startsWith('/projects/')) {
    link.classList.add('active');
  }
});
```

Simple, but the kind of thing you never notice until you see a screenshot where nothing is highlighted.

## Open Graph: The Invisible Improvement

The site had zero social meta tags. Sharing a link on Twitter, Discord, or Slack produced a bare URL with no preview — no title, no description, nothing to entice a click. For a blog that lives and dies by shared links, this was a significant gap.

The fix was adding Open Graph and Twitter Card tags to the layout template:

```html
<meta property="og:title" content="{{title}}">
<meta property="og:description" content="{{description}}">
<meta property="og:url" content="{{pageUrl}}">
<meta property="og:type" content="{{ogType}}">
<meta property="og:site_name" content="Albert BF's Blog">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="{{title}}">
<meta name="twitter:description" content="{{description}}">
```

The build script passes the appropriate values — `article` for article pages, `website` for index and projects. Each page gets its full canonical URL constructed from the site base URL and the page path. Minimal effort, significant impact on how the blog appears when shared.

## The Footer and the Back Link

The site had no footer at all. Articles ended with a plain text "Back to Articles" link that felt like an afterthought. The index and projects pages just... stopped.

The footer is deliberately minimal — RSS link, GitHub link, copyright. Centered, muted text, separated by a `border-top`. It appears on every page through the layout template:

```html
<footer class="site-footer">
  <div class="footer-links">
    <a href="/feed.xml">RSS</a>
    <a href="https://github.com/FumingPower3925" target="_blank" rel="noopener noreferrer">GitHub</a>
  </div>
  <p>&copy; {{year}} Albert BF</p>
</footer>
```

The year is passed dynamically from the build script, so it never goes stale. The footer uses `var(--text-muted)` for colors, ensuring it works in both light and dark mode without any additional styling.

For the back link, I gave it actual visual weight — a bordered button style with hover feedback:

```css
.back-link {
  display: inline-block;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.9rem;
  transition: all 0.2s ease;
  margin-top: 1rem;
}

.back-link:hover {
  border-color: var(--accent-primary);
  color: var(--text-link-hover);
}
```

Combined with a `border-top` separator on `.article-footer`, the end of an article now feels intentional rather than abrupt.

## The h1 Accent Line

The red accent underline beneath `h1` headings used `position: absolute; bottom: -8px`, which worked fine for single-line titles. But on multi-line article titles, the line appeared under the last line with a visually detached gap. The spacing felt inconsistent across different title lengths.

Switching from absolute positioning to a block-level pseudo-element fixed this:

```css
h1::after {
  content: '';
  display: block;
  margin-top: 0.5rem;
  width: 60px;
  height: 2px;
  background: var(--accent-primary);
}
```

The `margin-top` creates consistent spacing regardless of whether the title wraps or not. It also meant removing `position: relative` from `h1`, which is one less positioning context to worry about.

## Mobile Meta and Article Count

On mobile, the article meta line (date, read time, project badge, archived badge) could wrap awkwardly. Adding `flex-wrap: wrap` to `.article-meta` lets badges flow to a second line gracefully instead of getting squeezed.

The index page also lacked any sense of scale. A first-time visitor had no idea whether the blog had 5 articles or 50. A simple count below the subtitle fixes this:

```javascript
const projectCount = new Set(
  articles.filter(a => a.isProject).map(a => a.projectName)
).size;
const articleStats = `${articles.length} articles across ${projectCount} projects`;
```

It renders as muted text — "15 articles across 3 projects" — just enough to orient visitors without drawing attention from the content itself.

## Scroll to Top

Long articles like the zero-cost-blog piece or the time-travel article have no way to quickly return to the top. The nav hides on scroll-down, so there's no persistent navigation. A subtle scroll-to-top button fills this gap.

The button matches the floating nav aesthetic — rounded, backdrop-blurred, with the same border and shadow treatment. It appears after scrolling past 500px and fades in smoothly:

```css
.scroll-to-top {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-nav);
  backdrop-filter: blur(20px);
  border: 1px solid var(--border-nav);
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
  z-index: 999;
}

.scroll-to-top.visible {
  opacity: 1;
  visibility: visible;
}

.scroll-to-top:hover {
  background: var(--accent-primary);
  color: white;
}
```

On hover, it fills with the accent color — the same interaction pattern as the URL pills. Consistency in small details matters.

## Project Descriptions

The projects page listed project names and their articles, but offered no context. A first-time visitor clicking "Projects" would see "albertbf-blog", "libre-utils", and "auto-grade" with no idea what any of them were.

The simplest approach was a `project-description` frontmatter field on the earliest article of each project:

```yaml
project-description: "A zero-cost, high-performance static blog built with Bun and Cloudflare Workers."
```

The build script finds the first article in each project that has this field and renders it as a muted paragraph below the project name. Three lines of frontmatter across three files, and the projects page suddenly makes sense to newcomers.

## The Pattern: Audit, Don't Assume

What strikes me about this batch of fixes is that none of them were technically difficult. The hardest change — Open Graph tags — was mostly template work. The rest were CSS tweaks, small JS fixes, and a few lines of build script logic. The total diff is modest.

The real value was the audit process itself. Taking screenshots forced me to see the site the way a visitor sees it — not as individual features I'd been working on, but as a complete experience across different devices and contexts. Issues that were invisible during development became obvious when laid out side by side.

This is the kind of maintenance work that's easy to skip. It's not a new feature. It won't make the build faster or add functionality. But it's the difference between a project that works and one that feels cared for. And for a personal blog — a thing with your name on it — that difference matters.

The complete implementation is available in the [repository](https://github.com/FumingPower3925/albertbf).
