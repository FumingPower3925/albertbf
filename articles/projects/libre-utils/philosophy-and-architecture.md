---
title: "LibreUtils: Building a Privacy-First Web Toolkit from Scratch"
date: "16-12-2025"
description: "Exploring the philosophy, architecture, and technical decisions behind LibreUtils — an open-source collection of browser-based utilities where your data never leaves your device."
tags: ["privacy", "web-development", "typescript", "pwa", "architecture", "bun"]
project: "libre-utils"
project_version: "0.2.0"
project_url: "https://libreutils.org"
---

You've been there. We all have. You need to quickly encode something to Base64, convert an image format, compress a file or wahtever. You search for "base64 encoder online" and land on a website plastered with ads, cookie banners, and that nagging feeling: *where exactly is my data going?*

Maybe it works. Maybe it uploads your data to a server in who-knows-where. Maybe that "free" tool is free because *you're* the product. You have no idea — and that uncertainty is the problem.

This bothered me enough to build something different. Welcome to **LibreUtils**.

## The Core Philosophy: Privacy as Architecture

LibreUtils is built on a principle so fundamental it shapes every line of code: **your data never leaves your browser**.

Not "we promise not to look at it." Not "we encrypt it before uploading." Your data *literally cannot leave* because there's no server to send it to. Every tool runs entirely client-side using native browser APIs. This isn't just a privacy feature — it's an architectural constraint that eliminates entire categories of security concerns.

Think about what this means:
- No data breaches (there's no database to breach)
- No server logs (there's no server)
- No privacy policies to read (no data collection means nothing to disclose)
- Works offline (no network required for processing)

When privacy is architecture rather than policy, trust becomes unnecessary. You don't need to believe anyone's promises — you can verify the code yourself.

## Technical Constraints That Became Features

When you commit to client-side-only processing, you inherit limitations. But here's the interesting part: these constraints force better design decisions.

**No server-side processing** — Heavy computations must be optimized for the browser. This pushed us toward Web Workers and efficient algorithms rather than throwing hardware at the problem.

**No external dependencies at runtime** — Third-party libraries could phone home, inject trackers, or include supply chain attacks. By vendoring critical dependencies and auditing every line, we maintain full control.

**File size limits** — Browser memory constraints matter. This led to streaming-based processing for large files instead of loading everything into memory at once.

**Offline capability** — Must work without network access. The result? A robust PWA that's actually useful when you need it most.

These aren't bugs — they're features disguised as limitations.

## The Stack: Deliberately Minimal

After evaluating the landscape of modern web frameworks, I settled on a stack that might seem surprisingly bare:

- **Bun** — Lightning-fast TypeScript runtime for development, testing, and bundling
- **TypeScript** — Strict mode, no exceptions, no `any` types
- **Vanilla CSS** — CSS custom properties for theming, no Tailwind, no CSS-in-JS
- **Web Components** — Native browser APIs, no React or Vue overhead

No Webpack. No Vite. No Next.js. Just Bun compiling TypeScript to browser-compatible JavaScript.

Why this radical simplicity? Because every dependency is a liability. Every build tool is a potential point of failure. Every framework is someone else's opinions about how to build software. For a privacy-focused project, minimizing the supply chain isn't just nice — it's essential.

```
libreutils/
├── src/                 # Main web application
├── shared/              # Shared components and utilities
├── tools/               # Individual tool packages
│   └── text-encoder/    # Each tool is self-contained
├── public/              # Static assets, PWA manifest, service worker
└── scripts/             # Build and development scripts
```

## The Monorepo Structure: Independent but Connected

LibreUtils uses Bun workspaces to organize the codebase into independent packages:

```json
{
  "workspaces": ["shared", "tools/*"]
}
```

Each tool is a fully independent package that can:
- Run standalone with its own dev server for isolated development
- Be embedded in the main application with zero configuration
- Be built and deployed separately if needed

This structure has a profound implication: **adding a new tool doesn't require touching the core application**. Copy the template, implement your logic, register the route. Deploy. Done.

New contributors can focus on just their tool without understanding the entire codebase. That's powerful for open-source sustainability.

## The Design System: CSS That Just Works

All tools share a common design system defined entirely in CSS custom properties:

```css
:root {
    --lu-primary-500: #613E9C;
    --lu-bg-primary: #ffffff;
    --lu-text-primary: #111827;
    --lu-radius-md: 8px;
    --lu-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.lu-theme-dark {
    --lu-bg-primary: #0f0f0f;
    --lu-text-primary: #f9fafb;
}
```

Theme switching? A single class toggle on `<html>`. No JavaScript theme libraries. No runtime calculations. No flash of unstyled content. Just CSS doing what CSS does best.

The color palette — which we call "Japanese Noble Purple" — was chosen deliberately. It's sophisticated enough to feel premium, distinctive enough to be memorable, and accessible enough to work for everyone.

## PWA from Day One

Every tool works offline from the first visit. The service worker uses a stale-while-revalidate strategy that balances freshness with performance:

1. **Serve cached content immediately** — Users see instant results
2. **Fetch fresh content in background** — Stay up-to-date transparently
3. **Update cache for next visit** — Always improving

Version management is automated through a pre-commit hook. Update `package.json`, and `manifest.json` plus `sw.js` synchronize automatically. One source of truth, many consumers.

When a new version is available, users see a non-intrusive toast notification. No forced refreshes. They decide when to update. Respecting user agency extends beyond just their data.

## What's Coming Next

This article establishes the foundation — the "why" behind LibreUtils. But foundations are only valuable when you build on them. In upcoming articles, we'll dive deeper:

- **Part 2**: The testing infrastructure that gives us confidence to ship
- **Part 3**: Building the Text Encoder tool from scratch — anatomy of a LibreUtils tool
- **Part 4**: Reaching v0.2.0 — cryptographic tools and the Privacy Core

The code is open source and contributions are welcome: [github.com/FumingPower3925/libreutils](https://github.com/FumingPower3925/libreutils)

Or just use the tools directly at [libreutils.org](https://libreutils.org). Your data stays yours. That's the whole point.

---

*Next: Part 2 — Testing Infrastructure and Developer Experience*
