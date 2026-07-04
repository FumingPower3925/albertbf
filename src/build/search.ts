import { join } from "path";
import { paths } from "./config";
import type { Article } from "./content";

export interface SearchEntry {
  title: string;
  description: string;
  url: string;
  date: string;
  readTime: number;
  tags: string[];
  series: string | null;
  isArchived: boolean;
  content: string;
}

export async function writeSearchIndex(articles: Article[]): Promise<void> {
  const index: SearchEntry[] = articles.map((article) => ({
    title: article.fm.title,
    description: article.fm.description,
    url: article.url,
    date: article.fm.date.toISOString(),
    readTime: article.readTime,
    tags: article.fm.tags,
    series: article.series?.meta.title ?? null,
    isArchived: article.isArchived,
    // Full body text so search matches technical terms anywhere in the article,
    // not just the intro. Collapsed whitespace keeps it compact; the index is
    // lazy-loaded on first keystroke and edge-cached.
    content: article.plainText.replace(/\s+/g, " ").trim(),
  }));
  const json = JSON.stringify(index);
  console.log(`search index: ${index.length} entries, ${(json.length / 1024).toFixed(1)}KB`);
  await Bun.write(join(paths.dist, "search-index.json"), json);
}
