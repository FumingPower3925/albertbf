import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");

export const site = {
  title: "Albert BF",
  fullTitle: "Albert BF's Blog",
  author: "Albert Bausili",
  url: "https://albertbf.com",
  description:
    "Personal technical blog of Albert Bausili — systems programming, AI engineering, databases, and the occasional deep dive.",
  locale: "en",
  github: "https://github.com/FumingPower3925",
  githubHandle: "FumingPower3925",
  repo: "https://github.com/FumingPower3925/albertbf",
  // USER ACTION: fill in when available (footer/about render placeholders until then).
  linkedin: "",
  email: "",
  // USER ACTION: Cloudflare Web Analytics token (Dashboard → Analytics → Web Analytics).
  cfAnalyticsToken: "",
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
} as const;

export const buildFlags = {
  includeDrafts: process.argv.includes("--drafts"),
} as const;

export const WORDS_PER_MINUTE = 200;
export const FEED_LIMIT = 20;
