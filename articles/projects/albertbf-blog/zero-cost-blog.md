---
title: "Building a Zero-Cost Blog: The Architecture Behind albertbf.com"
date: "19-06-2025"
description: "How I built a high-performance blog with zero maintenance costs using Cloudflare Workers, static site generation, and modern web technologies."
tags: ["cloudflare", "static-site", "web-development", "architecture", "bun"]
---

When I set out to build my personal blog, I had four non-negotiable requirements:
- **Zero maintenance costs** - No monthly hosting fees
- **Lightning-fast load times** - Sub-second page loads globally
- **Rock-solid security** - No vulnerabilities or attack surfaces
- **Dead simple** - Easy to maintain and extend

This article walks through how I achieved all four goals using modern web technologies and clever architectural decisions.

## The Stack: Simple but Powerful

The entire blog runs on:
- **Bun** - Lightning-fast JavaScript runtime for build tooling
- **Cloudflare Workers** - Edge computing for zero-cost hosting
- **Static Site Generation** - Pre-built HTML for maximum performance
- **Vanilla JavaScript** - No framework bloat, just what's needed

Here's why each piece matters:

### Bun: The Speed Demon

```javascript
#!/usr/bin/env bun

// All the build time dependencies needed
import { marked } from 'marked';
import hljs from 'highlight.js';
import yaml from 'js-yaml';
```

Bun's incredible speed makes the build process nearly instantaneous. What would take Node.js seconds to process, Bun handles in milliseconds. This matters when you're iterating on content and want immediate feedback.

### Static Site Generation: The Performance Foundation

Instead of server-side rendering or client-side frameworks, I chose static generation:

```javascript
async function generateArticleHTML(article, templates, styles) {
  const htmlContent = marked.parse(article.content);
  
  return renderTemplate(templates.layout, {
    title: article.title,
    description: article.description,
    content: articleContent,
    styles: styles // Inline CSS for zero additional requests
  });
}
```

Every article is pre-rendered to HTML at build time. This means:
- No server processing on each request
- No database queries
- No API calls
- Just pure, static HTML served from the edge

### Cloudflare Workers: The Zero-Cost Magic

The deployment configuration is remarkably simple:

```toml
name = "albertbf-blog"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[build]
command = "bun run build"

[assets]
directory = "./dist"

[vars]
ENVIRONMENT = "production"

[env.production]
routes = [
  { pattern = "albertbf.com/*", custom_domain = true }
]

# For local development
[env.development]
vars = { ENVIRONMENT = "development" }
```

Cloudflare's free tier includes:
- 100,000 requests per day (Does not include static Assets)
- Unlimited bandwidth
- Global CDN distribution
- Automatic SSL certificates

For a personal blog, this is more than sufficient—and it costs exactly $0.

## The Build Process: Optimized for Simplicity

The entire build system is a single JavaScript file that:

1. **Parses Markdown files** with frontmatter support
2. **Generates optimized HTML** with syntax highlighting
3. **Creates a search index** for client-side search
4. **Inlines critical CSS** to eliminate render-blocking resources

```javascript
async function build() {
  const styles = await readFile(STYLES_PATH, 'utf-8');
  const templates = await loadTemplates();
  
  const markdownFiles = await findMarkdownFiles(ARTICLES_DIR);
  const articles = await Promise.all(
    markdownFiles.map(file => parseMarkdownFile(file))
  );
  
  // Generate individual article pages
  for (const article of articles) {
    const html = generateArticleHTML(article, templates, styles);
    await writeFile(outputPath, html);
  }
  
  // Generate index, projects, and search index
  await generateIndexPage(articles, templates, styles);
  await generateSearchIndex(articles);
}
```

## Security Through Simplicity

Static sites are inherently secure because:
- **No server-side code execution** - Nothing to exploit
- **No database** - No SQL injection possible
- **No user input processing** - No XSS vulnerabilities
- **No authentication** - No sessions to hijack

I still implement security headers for defense in depth:

```javascript
app.use('*', async (c, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
  
  c.header('Content-Security-Policy', csp);
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=63072000');
});
```

## Zero Dependencies Philosophy

The blog runs with minimal runtime dependencies:
- No React, Vue, or Angular
- No jQuery or lodash
- No CSS frameworks
- Just vanilla JavaScript and CSS

This results in:
- Tiny bundle sizes
- No security vulnerabilities from dependencies
- No breaking changes from framework updates
- Complete control over every line of code

## The Result: Blazing Fast, Completely Free

The architecture delivers:
- **Page loads under 200ms** globally
- **Perfect Lighthouse scores** across all metrics
- **Zero monthly costs** regardless of traffic
- **Minimal maintenance** - just write and deploy

## Conclusion

Building a zero-cost blog doesn't mean compromising on performance or features. By embracing simplicity, leveraging modern edge computing, and focusing on static generation, you can create a blog that's faster than most commercial solutions—for free.

The entire source code is open source and available on [GitHub](https://github.com/FumingPower3925/albertbf). Feel free to fork it and create your own zero-cost blog!