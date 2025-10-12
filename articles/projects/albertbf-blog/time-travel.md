---
title: "Time Travel for Blog Posts: Building Scheduled Publishing Without a Backend"
date: "13-10-2025"
description: "How I added scheduled publishing to a static blog using GitHub Actions and date filtering, enabling future-dated articles to appear automatically without any server-side logic or databases."
tags: ["github-actions", "static-site", "automation", "architecture", "ci-cd"]
---

Picture this: it's Sunday evening, you're in the zone, and you've just written three excellent blog posts. But you don't want to publish them all at once—you'd rather space them out over the week to maintain a steady stream of content. In a traditional CMS like WordPress, this is trivial. You set a future publication date, hit save, and the system handles the rest. But what if your blog is completely static, with no database, no server-side code, and no backend at all?

This was the challenge I faced with albertbf.com. As a fully static site deployed to Cloudflare's edge, there's no server checking publication dates or dynamically rendering content. Everything is pre-built HTML served directly from the CDN. How do you add scheduled publishing to something that, by design, can't "do" anything dynamically?

The answer, as it turns out, is surprisingly elegant: embrace the constraints, rebuild the site daily, and filter by date at build time. Let's explore how this works and why this approach is not only viable but arguably superior to traditional scheduled publishing systems.

## The Static Site Conundrum

Static site generators like Jekyll, Hugo, and my custom Bun-based build system face an interesting challenge: they're incredibly fast and secure because they generate everything ahead of time, but that same characteristic makes time-dependent behavior tricky. You can't just "check if it's time to publish" because there's no process running to do the checking.

Traditional solutions to this problem involve:
- **Build hooks triggered by cron jobs** on external services
- **Serverless functions** that rebuild the site on a schedule
- **Hybrid architectures** where a database tracks publication dates and a server dynamically decides what to show

But each of these introduces complexity. External services add dependencies and potential points of failure. Serverless functions require deployment infrastructure. Hybrid architectures sacrifice the simplicity and performance benefits of being fully static.

I wanted something simpler: scheduled publishing that fits naturally into a static architecture without compromising the zero-maintenance, zero-cost philosophy.

## The Solution: Daily Rebuilds and Date Filtering

The approach I settled on has two components:

1. **A GitHub Actions workflow** that rebuilds and deploys the site once per day
2. **Date filtering in the build script** that excludes articles with future dates

Here's what this looks like in practice. First, the GitHub Actions workflow:

```yaml
name: Scheduled Daily Build

on:
  schedule:
    # Run every day at 00:00 UTC
    - cron: '0 0 * * *'
  workflow_dispatch: # Allow manual triggering

jobs:
  build-and-deploy:
    name: Build and Deploy
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Build static site
        run: bun run build

      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy
```

This workflow runs at midnight UTC every day. It checks out the repository, builds the site, and deploys it to Cloudflare. Simple, reliable, and completely free (GitHub Actions provides generous free tier limits for public repositories).

The second piece is in the build script. When parsing articles, I filter out any with dates in the future:

```javascript
// Filter out articles with future dates
const now = new Date();
now.setHours(0, 0, 0, 0); // Set to start of day for fair comparison

const publishedArticles = articles.filter(article => {
  const articleDate = new Date(article.date);
  articleDate.setHours(0, 0, 0, 0);
  
  if (articleDate > now) {
    console.log(`⏭️  Skipped (scheduled for future): ${article.title} (${formatDateEuro(article.date)})`);
    return false;
  }
  return true;
});

const scheduledCount = articles.length - publishedArticles.length;
console.log(`📖 Found ${articles.length} articles (${publishedArticles.length} published${scheduledCount > 0 ? `, ${scheduledCount} scheduled` : ''})`);
```

The key insight is the `setHours(0, 0, 0, 0)` call on both dates. This normalizes them to midnight, ensuring consistent comparison regardless of when during the day the build runs. An article dated "13-10-2025" will be included starting from October 13th at midnight UTC and will remain visible on all subsequent builds.

## Why This Works Better Than You'd Think

At first glance, rebuilding the entire site every day might seem wasteful. But in practice, this approach has several surprising advantages:

### 1. Simplicity is a Feature

There's no external scheduler to maintain, no database to query, no API to check. The workflow file is 25 lines of YAML. The filtering logic is 15 lines of JavaScript. That's it. When something is this simple, it rarely breaks, and when it does, it's trivial to debug.

### 2. Consistent Build Artifact

Every deployment is a complete rebuild from scratch. This eliminates entire categories of bugs related to incremental builds, stale caches, or partial updates. The site you see in production is always the result of running `bun run build` on the current commit—no surprises, no drift.

### 3. Free and Reliable

GitHub Actions provides 2,000 free minutes per month for private repositories and unlimited for public ones. A full build of this blog takes about 30 seconds. Even with daily builds, that's 15 minutes per month—well within the free tier. And GitHub's infrastructure is far more reliable than anything I'd host myself.

### 4. Content is Version Controlled

Because articles are just markdown files in the repository, scheduled posts are committed with their future dates. This provides a complete audit trail. You can see when an article was written, when it was scheduled to publish, and when it actually went live. All tracked automatically by Git.

### 5. Preview is Trivial

Want to see what a future article looks like before it's published? Just run `bun run build` locally. The filtering only applies based on the current date, so you can test scheduled articles by temporarily adjusting dates or commenting out the filter.

### 6. Early Detection of Broken Links

Here's an unexpected benefit: daily builds act as a continuous health check for your entire site. My CI pipeline includes a broken link checker that runs after each build, scanning all generated HTML for dead links, missing images, and broken cross-references.

With daily rebuilds, any link that goes dead—whether from link rot, site restructuring, or external resources disappearing—gets caught within 24 hours. I wake up to a GitHub notification if something's broken, rather than discovering it weeks later when a reader complains or search engines penalize the site.

This is particularly valuable for technical blogs that link to documentation, GitHub repositories, and external resources that frequently change or move. The daily rebuild ensures that even if I'm not actively writing, the site is being continuously validated. It's like having a automated site reliability engineer watching over your content.

## The Details Matter: Time Zone Handling

One subtle but important decision is time zone handling. I standardized on UTC across the board:
- Article dates are interpreted as UTC midnight
- The daily build runs at 00:00 UTC
- Date comparisons normalize to midnight UTC

This eliminates ambiguity. An article dated "13-10-2025" will appear starting at midnight UTC on that date, regardless of where the author or readers are located. If you want region-specific publishing times, you'd need a different approach—but for most blogs, UTC midnight is a reasonable compromise.

The alternative would be to respect local time zones, but that introduces complexity. Which time zone? The author's? The reader's? The server's (which doesn't exist in a static site)? UTC is unambiguous and predictable.

## Integration with Existing CI Checks

The daily rebuild workflow complements the existing CI pipeline nicely. On pull requests, the site builds and runs through several checks:
- Build verification to catch syntax errors
- Lighthouse audits for performance metrics
- Broken link checking with Lychee

These same checks run on the daily scheduled builds, ensuring that not only do scheduled articles appear on time, but they're also validated for quality and integrity. If a scheduled article introduces broken links or performance issues, you'll know within 24 hours of it going live.

This layered approach—PR checks for new content, daily checks for the entire site—creates a robust safety net. Nothing slips through unnoticed.

## Edge Cases and Considerations

No system is perfect. Here are some edge cases to be aware of:

**Manual Deployments:** If you push changes and deploy manually before midnight, future-dated articles won't appear until the next scheduled build. The workflow includes `workflow_dispatch` to allow manual triggering when needed.

**Build Failures:** If a daily build fails (perhaps due to a syntax error in a scheduled article), the site won't update. GitHub Actions emails you about failures, but monitoring is your responsibility.

**UTC Timing:** Articles appear at midnight UTC, which might be inconvenient depending on your audience's time zone. For a US-based audience, midnight UTC is 7 PM EST or 4 PM PST the previous day—something to keep in mind when scheduling.

**GitHub Actions Reliability:** While GitHub's infrastructure is excellent, scheduled workflows occasionally experience delays (typically a few minutes). If precise timing is critical, you'd need additional monitoring.

## The Build Output: Visibility Matters

One thing I'm particularly pleased with is the build output. When the script runs, it clearly shows what's happening:

```
📚 Parsing markdown files...
✅ Parsed: Time Travel for Blog Posts (~8 min read)
⏭️  Skipped (scheduled for future): Future Article Title (15-10-2025)
✅ Parsed: Another Current Article (~5 min read)
📖 Found 3 articles (2 published, 1 scheduled)
```

This makes it immediately obvious which articles are published and which are waiting for their scheduled date. During development, this feedback is invaluable. In CI logs, it provides a quick sanity check that scheduling is working as expected.

## Extending the Pattern

This approach generalizes well to other time-dependent features you might want in a static site:

**Expiring Content:** Flip the comparison to filter out articles *older* than a certain date. Useful for time-sensitive announcements or limited-time offers.

**Seasonal Content:** Combine date filtering with month/day checks to automatically show holiday-specific articles during appropriate windows.

**Scheduled Updates:** Version articles by date and show the most recent version. Write a correction or update with a future date, and it replaces the old version automatically.

The key insight is that any content decision based on "what day is it?" can be handled at build time with daily rebuilds.

## Performance Considerations

You might wonder about the cost of daily rebuilds. For this blog:
- Full build time: ~30 seconds
- Deploy time: ~10 seconds
- Total: ~40 seconds once per day

Even with 50 articles and growing, the build is nearly instantaneous. The vast majority of time is spent in dependency installation and deployment, not actual site generation. Bun's performance and the simplicity of the build process make this approach scale surprisingly well.

If the blog grows to hundreds of articles, I might need to optimize. But static generation is so fast that even a thousand articles would likely build in under a minute. And at that point, the bottleneck is Cloudflare deployment, not local processing.

## The Philosophy: Constraints as Features

What I love most about this solution is how it embraces the constraints of static architecture rather than fighting them. Instead of bolting on complexity to mimic a dynamic backend, it asks: "What's the simplest thing that could possibly work?"

Daily rebuilds aren't a compromise—they're a feature. They ensure the site is always up-to-date, always consistent, always built from a clean state. The scheduled publishing capability is almost a side effect of this approach.

This philosophy extends beyond just publishing dates. Every aspect of this blog prioritizes simplicity:
- No JavaScript frameworks, just vanilla JS
- No build complexity, just a single script
- No external dependencies, just standard tools
- No runtime behavior, just pre-generated HTML

Scheduled publishing fits naturally into this worldview. It's not "publishing at a specific time" so much as "the site reflects the current state of the repository when built." The schedule emerges from the daily build frequency, not from complex logic.

## Looking Forward

This implementation is deliberately minimal, but it's also extensible. Future enhancements could include:

**Multiple builds per day:** Change the cron schedule to `0 */6 * * *` for builds every 6 hours, enabling 4-times-daily publishing windows.

**Webhook triggers:** Set up a webhook that triggers builds when you push scheduled content, combining daily automation with on-demand publishing.

**Build optimization:** Implement smart caching to skip rebuilding unchanged articles, though current performance makes this low priority.

**Timezone-aware scheduling:** Parse article dates with timezone info and compare against the current time in that zone, though this adds significant complexity.

But for now, the simple solution is perfect. It works reliably, costs nothing, requires no maintenance, and handles the 80% case of "publish this article on this date" elegantly.

## Try It Yourself

The implementation is straightforward enough that you can add scheduled publishing to any static site generator in an afternoon. The pattern is:

1. Add a GitHub Actions workflow with a cron schedule
2. Filter content by date during your build process
3. Deploy the built site
4. Let GitHub Actions handle the rest

Whether you're using Jekyll, Hugo, Eleventy, or a custom build system like mine, this approach adapts easily. The specifics of date parsing and filtering will vary, but the core concept—rebuild daily, filter by date at build time—remains the same.

The complete implementation, including the workflow file and updated build script, is available in the [repository](https://github.com/FumingPower3925/albertbf). Feel free to adapt it for your own static sites.

## Closing Thoughts

Scheduled publishing without a backend might sound like an oxymoron, but it's a perfect example of how constraints can lead to better solutions. By embracing the static nature of the site and leveraging existing infrastructure (GitHub Actions, Cloudflare Workers), we get reliable scheduled publishing with zero operational overhead.

No databases to maintain. No servers to monitor. No scheduled jobs to debug. Just a simple workflow that runs once a day and publishes whatever articles have reached their scheduled date.

Sometimes the best solution isn't about adding more complexity—it's about finding the simplest approach that works. And for static sites, daily rebuilds with date filtering might just be perfect.