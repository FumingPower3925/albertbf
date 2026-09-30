import { describe, expect, test } from "bun:test";
import {
  type Article,
  compareArticlesNewestFirst,
  compareArticlesOldestFirst,
} from "./content";

function stub(slug: string, date: string): Article {
  return { slug, fm: { date: new Date(date) } } as Article;
}

describe("compareArticlesNewestFirst", () => {
  test("orders newer dates first", () => {
    const a = stub("go-1-2", "2026-09-30");
    const b = stub("go-1-2-1", "2026-10-01");
    expect([a, b].sort(compareArticlesNewestFirst).map((x) => x.slug)).toEqual([
      "go-1-2-1",
      "go-1-2",
    ]);
  });

  test("same-day ties list the later slug first", () => {
    const a = stub("go-1-2", "2026-09-30");
    const b = stub("go-1-2-1", "2026-09-30");
    expect([a, b].sort(compareArticlesNewestFirst).map((x) => x.slug)).toEqual([
      "go-1-2-1",
      "go-1-2",
    ]);
  });

  test("is reflexive on identical inputs", () => {
    const a = stub("go-1-2", "2026-09-30");
    expect(compareArticlesNewestFirst(a, a)).toBe(0);
  });
});

describe("compareArticlesOldestFirst", () => {
  test("orders older dates first", () => {
    const a = stub("go-1-2", "2026-09-30");
    const b = stub("go-1-2-1", "2026-10-01");
    expect([b, a].sort(compareArticlesOldestFirst).map((x) => x.slug)).toEqual([
      "go-1-2",
      "go-1-2-1",
    ]);
  });

  test("same-day ties keep slug order", () => {
    const a = stub("go-1-2", "2026-09-30");
    const b = stub("go-1-2-1", "2026-09-30");
    expect([b, a].sort(compareArticlesOldestFirst).map((x) => x.slug)).toEqual([
      "go-1-2",
      "go-1-2-1",
    ]);
  });
});
