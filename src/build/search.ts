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
    content: article.plainText.slice(0, 300),
  }));
  await Bun.write(join(paths.dist, "search-index.json"), JSON.stringify(index));
}
