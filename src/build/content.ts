import { readdir } from "fs/promises";
import { join } from "path";
import { load as parseYaml } from "js-yaml";
import { buildFlags, paths, WORDS_PER_MINUTE } from "./config";

export interface ArticleLink {
  label: string;
  url: string;
}

export interface Frontmatter {
  title: string;
  date: Date;
  updated?: Date;
  description: string;
  tags: string[];
  series?: string;
  featured?: boolean;
  draft?: boolean;
  cover?: string;
  canonical?: string;
  archived?: Date;
  links: ArticleLink[];
}

export interface TocEntry {
  depth: 2 | 3;
  id: string;
  text: string;
}

/** Features detected during rendering; drive per-page conditional assets. */
export type Feature =
  | "math"
  | "mermaid"
  | "lightbox"
  | "run"
  | "run:go"
  | "run:sql"
  | "run:js";

export interface SeriesMeta {
  slug: string;
  title: string;
  description: string;
  /** The project's live website. */
  url?: string;
  /** The project's source repository. */
  repo?: string;
}

export interface Article {
  slug: string;
  url: string;
  dir: string;
  fm: Frontmatter;
  markdown: string;
  html: string;
  plainText: string;
  toc: TocEntry[];
  readTime: number;
  features: Set<Feature>;
  assets: string[];
  series?: {
    meta: SeriesMeta;
    index: number;
    total: number;
    prev?: Article;
    next?: Article;
    others: Article[];
  };
  /** Cross-series recommendations by shared tags (excludes same-series). */
  related: Article[];
  isArchived: boolean;
  isScheduled: boolean;
}

export interface Content {
  articles: Article[];
  seriesList: SeriesMeta[];
  /** Articles grouped by series slug (only series that have articles). */
  bySeries: Map<string, Article[]>;
}

class ContentError extends Error {
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseDate(value: unknown, file: string, field: string): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new ContentError(file, `invalid ${field}: ${JSON.stringify(value)} (expected ISO 8601, e.g. 2026-07-04)`);
}

function parseFrontmatter(rawYaml: string, file: string): Frontmatter {
  let data: Record<string, unknown>;
  try {
    data = parseYaml(rawYaml) as Record<string, unknown>;
  } catch (err) {
    throw new ContentError(file, `frontmatter YAML parse error: ${err}`);
  }
  if (!data || typeof data !== "object") {
    throw new ContentError(file, "frontmatter is empty");
  }

  if (typeof data.title !== "string" || !data.title.trim()) {
    throw new ContentError(file, "missing required field: title");
  }
  if (typeof data.description !== "string" || !data.description.trim()) {
    throw new ContentError(file, "missing required field: description");
  }
  if (data.description.length > 200) {
    console.warn(`${file}: description is ${data.description.length} chars (aim for ≤160 for search snippets)`);
  }
  if (data.date === undefined) {
    throw new ContentError(file, "missing required field: date");
  }

  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const links: ArticleLink[] = Array.isArray(data.links)
    ? data.links.map((l: any, i: number) => {
        if (!l || typeof l.label !== "string" || typeof l.url !== "string") {
          throw new ContentError(file, `links[${i}] must be {label, url}`);
        }
        return { label: l.label, url: l.url };
      })
    : [];

  return {
    title: data.title.trim(),
    date: parseDate(data.date, file, "date"),
    updated: data.updated !== undefined ? parseDate(data.updated, file, "updated") : undefined,
    description: data.description.trim(),
    tags,
    series: typeof data.series === "string" ? data.series : undefined,
    featured: data.featured === true,
    draft: data.draft === true,
    cover: typeof data.cover === "string" ? data.cover : undefined,
    canonical: typeof data.canonical === "string" ? data.canonical : undefined,
    archived: data.archived !== undefined ? parseDate(data.archived, file, "archived") : undefined,
    links,
  };
}

function computeReadTime(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[.*?\]\(.*?\)/g, " ")
    .replace(/[#>*_`~\[\]()]/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

async function loadSeries(): Promise<SeriesMeta[]> {
  const file = Bun.file(paths.seriesFile);
  if (!(await file.exists())) return [];
  const data = parseYaml(await file.text()) as Record<string, any> | null;
  if (!data) return [];
  return Object.entries(data).map(([slug, meta]) => {
    if (!meta || typeof meta.title !== "string" || typeof meta.description !== "string") {
      throw new ContentError(paths.seriesFile, `series "${slug}" must have title and description`);
    }
    return {
      slug,
      title: meta.title,
      description: meta.description,
      url: typeof meta.url === "string" ? meta.url : undefined,
      repo: typeof meta.repo === "string" ? meta.repo : undefined,
    };
  });
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Loads and validates all articles. Rendering (html/toc/features) is filled
 * in later by the markdown pipeline; fields start empty here.
 */
export async function loadContent(): Promise<Content> {
  const seriesList = await loadSeries();
  const seriesBySlug = new Map(seriesList.map((s) => [s.slug, s]));
  const articles: Article[] = [];
  const now = new Date();

  let dirs: string[] = [];
  try {
    dirs = (await readdir(paths.articles, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No articles directory yet — valid empty site.
  }

  for (const slug of dirs.sort()) {
    const dir = join(paths.articles, slug);
    const mdPath = join(dir, "index.md");
    const mdFile = Bun.file(mdPath);
    if (!(await mdFile.exists())) {
      throw new ContentError(dir, "article directory has no index.md");
    }
    if (!SLUG_RE.test(slug)) {
      throw new ContentError(mdPath, `invalid slug "${slug}" (lowercase alphanumerics and dashes only)`);
    }

    const sourceText = await mdFile.text();
    const match = sourceText.match(FRONTMATTER_RE);
    if (!match) throw new ContentError(mdPath, "missing frontmatter block");

    const fm = parseFrontmatter(match[1], mdPath);
    if (fm.series && !seriesBySlug.has(fm.series)) {
      throw new ContentError(mdPath, `unknown series "${fm.series}" (declare it in content/series.yaml)`);
    }
    if (fm.cover && !(await Bun.file(join(dir, fm.cover)).exists())) {
      throw new ContentError(mdPath, `cover image not found: ${fm.cover}`);
    }

    const markdown = sourceText.slice(match[0].length);
    // Date-granular: the article's intended date (UTC components of the
    // frontmatter date) vs the build machine's local date — an article dated
    // today publishes today, wherever the build runs.
    const today = new Intl.DateTimeFormat("en-CA", { dateStyle: "short" }).format(now);
    const isScheduled = fm.date.toISOString().slice(0, 10) > today;
    const isDraft = fm.draft === true;

    if (isDraft && !buildFlags.includeDrafts) {
      console.log(`Skipped (draft): ${fm.title}`);
      continue;
    }
    if (isScheduled) {
      console.log(`Skipped (scheduled for ${fm.date.toISOString().slice(0, 10)}): ${fm.title}`);
      continue;
    }

    const assets = (await readdir(dir)).filter((f) => f !== "index.md" && !f.startsWith("."));

    articles.push({
      slug,
      url: `/articles/${slug}/`,
      dir,
      fm,
      markdown,
      html: "",
      plainText: "",
      toc: [],
      readTime: computeReadTime(markdown),
      features: new Set(),
      assets,
      related: [],
      isArchived: fm.archived !== undefined && fm.archived.getTime() <= now.getTime(),
      isScheduled,
    });
  }

  articles.sort((a, b) => b.fm.date.getTime() - a.fm.date.getTime());

  // Series relationships (chronological order within a series).
  const bySeries = new Map<string, Article[]>();
  for (const article of articles) {
    if (!article.fm.series) continue;
    const group = bySeries.get(article.fm.series) ?? [];
    group.push(article);
    bySeries.set(article.fm.series, group);
  }
  for (const [slug, group] of bySeries) {
    group.sort((a, b) => a.fm.date.getTime() - b.fm.date.getTime());
    const meta = seriesBySlug.get(slug)!;
    group.forEach((article, i) => {
      article.series = {
        meta,
        index: i + 1,
        total: group.length,
        prev: group[i - 1],
        next: group[i + 1],
        others: group.filter((other) => other !== article),
      };
    });
  }

  // Related articles: cross-series discovery by shared tags. Same-series
  // articles are excluded (the series navigation already surfaces those).
  const RELATED_LIMIT = 3;
  for (const article of articles) {
    const tags = new Set(article.fm.tags);
    if (!tags.size) continue;
    article.related = articles
      .filter(
        (other) =>
          other !== article &&
          !(article.fm.series && other.fm.series === article.fm.series),
      )
      .map((other) => ({
        article: other,
        shared: other.fm.tags.filter((t) => tags.has(t)).length,
      }))
      .filter((entry) => entry.shared > 0)
      .sort(
        (a, b) =>
          b.shared - a.shared || b.article.fm.date.getTime() - a.article.fm.date.getTime(),
      )
      .slice(0, RELATED_LIMIT)
      .map((entry) => entry.article);
  }

  return { articles, seriesList, bySeries };
}
