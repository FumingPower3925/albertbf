import { describe, expect, test } from "bun:test";
import { load as parseYaml } from "js-yaml";
import { join } from "node:path";
import type { Roadmap } from "./roadmap";

const dataPath = join(import.meta.dir, "..", "..", "..", "content", "data", "ai-roadmap.yml");

async function loadRoadmap(): Promise<Roadmap> {
  return parseYaml(await Bun.file(dataPath).text()) as Roadmap;
}

describe("ai-roadmap.yml identifiers", () => {
  test("course slugs are unique", async () => {
    const roadmap = await loadRoadmap();
    const slugs = roadmap.tiers.flatMap((t) => t.domains.flatMap((d) => d.courses.map((c) => c.slug)));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("alt_of and builds_on_course resolve to existing slugs", async () => {
    const roadmap = await loadRoadmap();
    const slugs = new Set(
      roadmap.tiers.flatMap((t) => t.domains.flatMap((d) => d.courses.map((c) => c.slug))),
    );
    const dangling: string[] = [];
    for (const t of roadmap.tiers) {
      for (const d of t.domains) {
        for (const c of d.courses) {
          for (const ref of [c.alt_of, c.builds_on_course]) {
            if (ref && !slugs.has(ref)) dangling.push(`${c.slug} -> ${ref}`);
          }
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  test("the ML Theory course slug matches its CS229M code, not the inactive CS229T", async () => {
    const roadmap = await loadRoadmap();
    const courses = roadmap.tiers.flatMap((t) => t.domains.flatMap((d) => d.courses));
    const theory = courses.find((c) => c.code === "CS229M / STATS214");
    expect(theory?.slug).toBe("stanford-cs229m");
  });
});
