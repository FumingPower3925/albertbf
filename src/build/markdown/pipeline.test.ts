import { describe, expect, test } from "bun:test";
import { collapseFootnotes, createRenderer } from "./pipeline";

const OPEN = '<section class="footnotes" data-footnotes>\n<h2 id="footnote-label" class="sr-only">Footnotes</h2>';

function withFootnotes(n: number): string {
  const items = Array.from({ length: n }, (_, i) => `<li id="footnote-${i}">\n<p>note ${i}</p>\n</li>`).join("\n");
  return `<p>body<a href="#footnote-0" data-footnote-ref>1</a></p>\n${OPEN}\n<ol>\n${items}\n</ol>\n</section>\n`;
}

describe("collapseFootnotes", () => {
  test("wraps the footnote list in a closed details with a References summary", () => {
    const out = collapseFootnotes(withFootnotes(3));
    expect(out).toContain('<details class="footnotes" data-footnotes>\n<summary>References (3)</summary>');
    expect(out).toContain("</details>");
    expect(out).not.toContain("<section");
    expect(out).not.toContain("footnote-label");
  });

  test("keeps every footnote item and ref link intact", () => {
    const out = collapseFootnotes(withFootnotes(2));
    expect(out).toContain('<li id="footnote-0">');
    expect(out).toContain('<li id="footnote-1">');
    expect(out).toContain('data-footnote-ref');
  });

  test("leaves pages without footnotes untouched", () => {
    const html = "<p>no notes here</p>\n";
    expect(collapseFootnotes(html)).toBe(html);
  });

  test("leaves malformed footnote sections untouched", () => {
    const html = `${OPEN}\n<ol>\n<li id="footnote-0"><p>unterminated`;
    expect(collapseFootnotes(html)).toBe(html);
  });

  test("matches marked-footnote's real output shape", async () => {
    const render = await createRenderer();
    const out = render({ markdown: "hi[^a]\n\n[^a]: note\n", dir: "", url: "/x/" } as any);
    expect(out.html).toContain('<details class="footnotes"');
    expect(out.html).toContain("<summary>References (1)</summary>");
    expect(out.html).not.toContain("<section");
  });
});
