import { site } from "../config";

/**
 * Removes elements (and their entire subtree) whose opening tag carries one of
 * the given class tokens, optionally replacing them. Depth-tracked so nested
 * same-name tags (e.g. spans inside .katex-html) are handled correctly.
 */
function stripByClass(
  htmlIn: string,
  classNames: string[],
  replace?: (cls: string) => string,
): string {
  const tag = /<(\/?)([a-z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/gi;
  let out = "";
  let last = 0;
  let skipping = false;
  let skipName = "";
  let depth = 0;
  let replacement = "";
  let m: RegExpExecArray | null;

  while ((m = tag.exec(htmlIn)) !== null) {
    const [, closing, name, attrs, selfClose] = m;
    if (skipping) {
      if (!closing && name === skipName && !selfClose) depth++;
      else if (closing && name === skipName) {
        depth--;
        if (depth === 0) {
          skipping = false;
          last = tag.lastIndex;
          out += replacement;
          replacement = "";
        }
      }
      continue;
    }
    if (!closing && !selfClose) {
      const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const tokens = cls.split(/\s+/);
      const hit = classNames.find((c) => tokens.includes(c));
      if (hit) {
        out += htmlIn.slice(last, m.index);
        skipping = true;
        skipName = name;
        depth = 1;
        replacement = replace ? replace(hit) : "";
      }
    }
  }
  out += htmlIn.slice(last);
  return out;
}

/**
 * Turns rendered article HTML into feed-safe HTML: removes interactive chrome
 * that is dead without the site's JS/CSS, and rewrites relative URLs to
 * absolute so images and links resolve in any feed reader.
 */
export function feedSafeHtml(html: string, articleUrl: string): string {
  const base = site.url + articleUrl; // e.g. https://albertbf.com/articles/slug/
  let out = html;

  // Diagrams are inline SVG; some feed readers drop SVG, so link to the site.
  out = stripByClass(out, ["diagram"], () =>
    `<p><em>[Diagram: <a href="${base}">view on the site</a>]</em></p>`);

  // Strip UI chrome: code header (filename/copy/run buttons), heading anchors,
  // the empty live run-output panel, and KaTeX's visual span-soup (the
  // accessible MathML twin is kept so readers still render the math).
  out = stripByClass(out, ["code-head", "heading-anchor", "code-output", "katex-html"]);

  // Absolutize URLs: root-relative and fragment-only links/images.
  out = out
    .replace(/\b(href|src)="\/(?!\/)/g, `$1="${site.url}/`)
    .replace(/\bhref="#/g, `href="${base}#`);

  return out;
}
