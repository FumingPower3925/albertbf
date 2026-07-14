import { cp, mkdir, readdir } from "fs/promises";
import { join, basename } from "path";
import { paths } from "./config";
import { renderHeadersFile } from "../worker/security";

/** Maps logical asset names to their content-hashed public URLs. */
export type AssetManifest = Map<string, string>;

/** Ordered stylesheet partials; concatenated into one hashed file. */
const STYLE_ORDER = [
  "tokens.css",
  "fonts.css",
  "base.css",
  "layout.css",
  "components/header.css",
  "components/footer.css",
  "components/cards.css",
  "components/chips.css",
  "components/search.css",
  "components/toc.css",
  "components/callouts.css",
  "components/footnotes.css",
  "components/buttons.css",
  "components/media.css",
  "components/terminal.css",
  "components/charts.css",
  "components/diagram.css",
  "prose.css",
  "code.css",
  "pages/home.css",
  "pages/article.css",
  "pages/projects.css",
  "pages/about.css",
  "print.css",
];

/** Client entrypoints bundled independently; run engines load via dynamic import. */
const CLIENT_ENTRIES = ["main", "search", "toc", "lightbox", "run"];

/**
 * The theme-init snippet inlined into <head> before CSS. Its sha256 goes in
 * the CSP so no 'unsafe-inline' script permission is needed.
 */
export const THEME_SNIPPET = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})();`;

export async function themeSnippetHash(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(THEME_SNIPPET));
  return `sha256-${Buffer.from(digest).toString("base64")}`;
}

function shortHash(content: string | Uint8Array): string {
  return Bun.hash(content).toString(16).slice(0, 8);
}

/**
 * Conservative CSS minifier: safe for nesting, light-dark(), calc(), and
 * container queries. Strips comments, collapses whitespace to single spaces,
 * and trims around structural punctuation only.
 */
function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

async function bundleStyles(manifest: AssetManifest): Promise<string> {
  let css = "";
  for (const partial of STYLE_ORDER) {
    const file = Bun.file(join(paths.styles, partial));
    if (!(await file.exists())) continue;
    css += `${await file.text()}\n`;
  }
  const out = minifyCss(css);
  // Also emit a hashed file (useful for debugging / direct linking), but the
  // stylesheet is inlined into each page to remove a render-blocking request.
  const name = `styles.${shortHash(out)}.css`;
  await Bun.write(join(paths.dist, "assets", name), out);
  manifest.set("styles.css", `/assets/${name}`);
  return out;
}

async function bundleClient(manifest: AssetManifest): Promise<void> {
  const entrypoints: string[] = [];
  for (const entry of CLIENT_ENTRIES) {
    const candidate = join(paths.client, `${entry}.ts`);
    if (await Bun.file(candidate).exists()) entrypoints.push(candidate);
  }
  if (!entrypoints.length) return;

  const result = await Bun.build({
    entrypoints,
    outdir: join(paths.dist, "assets"),
    target: "browser",
    minify: true,
    splitting: true,
    naming: { entry: "[name].[hash].[ext]", chunk: "chunk.[hash].[ext]" },
  });
  if (!result.success) {
    throw new Error(`Client bundle failed:\n${result.logs.join("\n")}`);
  }
  for (const artifact of result.outputs) {
    if (artifact.kind !== "entry-point") continue;
    const file = basename(artifact.path);
    const logical = file.replace(/\.[0-9a-z]+\.js$/, "");
    manifest.set(`${logical}.js`, `/assets/${file}`);
  }
}

const FONT_FILES = [
  ["@fontsource-variable/newsreader", "newsreader-latin-wght-normal.woff2"],
  ["@fontsource-variable/newsreader", "newsreader-latin-wght-italic.woff2"],
  ["@fontsource-variable/inter", "inter-latin-wght-normal.woff2"],
  ["@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"],
];

async function copyFonts(): Promise<void> {
  const outDir = join(paths.dist, "fonts");
  await mkdir(outDir, { recursive: true });
  for (const [pkg, file] of FONT_FILES) {
    const src = join(paths.nodeModules, pkg, "files", file);
    if (await Bun.file(src).exists()) {
      await cp(src, join(outDir, file));
    } else {
      console.warn(`Font file missing: ${pkg}/files/${file}`);
    }
  }
}

async function copyVendor(features: { sql: boolean; katex: boolean }): Promise<void> {
  const vendor = join(paths.dist, "vendor");
  if (features.sql) {
    await mkdir(join(vendor, "sqljs"), { recursive: true });
    await cp(join(paths.nodeModules, "sql.js", "dist", "sql-wasm.js"), join(vendor, "sqljs", "sql-wasm.js"));
    await cp(join(paths.nodeModules, "sql.js", "dist", "sql-wasm.wasm"), join(vendor, "sqljs", "sql-wasm.wasm"));
  }
  if (features.katex) {
    await mkdir(join(vendor, "katex", "fonts"), { recursive: true });
    await cp(join(paths.nodeModules, "katex", "dist", "katex.min.css"), join(vendor, "katex", "katex.min.css"));
    const fontsDir = join(paths.nodeModules, "katex", "dist", "fonts");
    for (const font of await readdir(fontsDir)) {
      if (font.endsWith(".woff2")) {
        await cp(join(fontsDir, font), join(vendor, "katex", "fonts", font));
      }
    }
  }
}

async function copyStatic(): Promise<void> {
  const staticDir = paths.staticDir;
  try {
    await cp(staticDir, paths.dist, { recursive: true });
  } catch {
    // No static dir — fine.
  }
}

export interface BuiltAssets {
  manifest: AssetManifest;
  themeHash: string;
  inlineCss: string;
}

export async function buildAssets(features: {
  sql: boolean;
  katex: boolean;
}): Promise<BuiltAssets> {
  const manifest: AssetManifest = new Map();
  await mkdir(join(paths.dist, "assets"), { recursive: true });
  const [inlineCss] = await Promise.all([
    bundleStyles(manifest),
    bundleClient(manifest),
    copyFonts(),
    copyVendor(features),
    copyStatic(),
  ]);
  const themeHash = await themeSnippetHash();
  await Bun.write(join(paths.dist, "_headers"), renderHeadersFile(themeHash));
  return { manifest, themeHash, inlineCss };
}
