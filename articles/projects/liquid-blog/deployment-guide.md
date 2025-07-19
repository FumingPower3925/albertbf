---
title: Deployment Guide for Liquid Blog
date: 2025-01-12
description: Step-by-step guide to deploy your own instance of the Liquid Blog platform.
tags: [deployment, cloudflare, wrangler, guide]
---

# Deployment Guide

Getting your Liquid Blog up and running is straightforward. Follow this comprehensive guide to deploy your own instance.

## Prerequisites

Before starting, make sure you have:

- **Bun** installed (v1.0.0 or later)
- **Wrangler CLI** installed and configured
- **Cloudflare account** with Workers enabled
- **Git** for version control

## Installation Steps

### 1. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd liquid-blog

# Install dependencies
bun install
```

### 2. Configure Wrangler

```bash
# Login to Cloudflare
wrangler login

# Update wrangler.toml with your details
vim wrangler.toml
```

### 3. Add Your Content

Create your articles in the `articles/` directory:

```bash
mkdir -p articles/2025
mkdir -p articles/projects/my-project

# Add your first article
echo "---
title: My First Post
date: 2025-01-15
description: This is my first blog post
---

# Hello World

Welcome to my blog!" > articles/2025/first-post.md
```

### 4. Build and Deploy

```bash
# Build the static site
bun run build

# Deploy to Cloudflare Workers
bun run deploy
```

## Configuration Options

### Custom Domain

To use a custom domain:

1. Add the domain in Cloudflare dashboard
2. Update `wrangler.toml`:

```toml
[env.production]
routes = [
  { pattern = "yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

### Environment Variables

Add any environment-specific configuration:

```toml
[vars]
SITE_NAME = "My Blog"
AUTHOR = "Your Name"
```

## Folder Structure for Articles

Organize your content following this structure:

```
articles/
├── projects/
│   ├── project-alpha/
│   │   ├── introduction.md
│   │   └── deep-dive.md
│   └── project-beta/
│       └── overview.md
├── 2025/
│   ├── january-update.md
│   └── new-year-goals.md
└── 2024/
    └── year-review.md
```

## Continuous Deployment

For automatic deployments, set up GitHub Actions:

```yaml
name: Deploy Blog

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun run build
      - run: wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

## Troubleshooting

### Common Issues

**Build fails**: Check that all Markdown files have valid frontmatter
**Deploy fails**: Verify Wrangler authentication and permissions
**Styles not loading**: Ensure CSS is properly embedded in templates

### Performance Tips

- Optimize images before adding them
- Keep Markdown files reasonably sized
- Use descriptive filenames for SEO

Your blog should now be live and accessible via your Cloudflare Workers URL!