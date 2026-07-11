import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

export const site = {
  title: "Albert BF",
  fullTitle: "Albert BF's Blog",
  author: "Albert Bausili Fernández",
  url: "https://albertbf.com",
  description:
    "Personal technical blog of Albert Bausili — systems programming, AI engineering, databases, and the occasional deep dive.",
  locale: "en",
  github: "https://github.com/FumingPower3925",
  githubHandle: "FumingPower3925",
  repo: "https://github.com/FumingPower3925/albertbf",
  linkedin: "https://www.linkedin.com/in/albert-bausili",
  x: "https://x.com/FumingPower",
  // Kept private by choice — no public email link.
  email: "",
  // Cloudflare Web Analytics token, injected from the CF_ANALYTICS_TOKEN build
  // env var (set in Workers Builds → Settings → Variables). Kept out of the repo
  // so public forks don't report to this site's analytics. Empty in local builds.
  cfAnalyticsToken: process.env.CF_ANALYTICS_TOKEN ?? "",
} as const;

export const paths = {
  root: ROOT,
  content: join(ROOT, "content"),
  articles: join(ROOT, "content", "articles"),
  seriesFile: join(ROOT, "content", "series.yaml"),
  dist: join(ROOT, "dist"),
  styles: join(ROOT, "src", "styles"),
  client: join(ROOT, "src", "client"),
  staticDir: join(ROOT, "src", "static"),
  nodeModules: join(ROOT, "node_modules"),
  cache: join(ROOT, ".cache"),
  // Static Inter weights bundled for OG-image text rendering (resvg reads fonts
  // from disk, not the browser's variable woff2).
  fonts: join(ROOT, "src", "build", "fonts"),
} as const;

export const buildFlags = {
  includeDrafts: process.argv.includes("--drafts"),
} as const;

export const WORDS_PER_MINUTE = 200;
export const FEED_LIMIT = 20;
