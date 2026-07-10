import { join } from "path";
import { mkdir } from "fs/promises";
import { paths, site } from "../config";
import type { Article } from "../content";
import { escapeHtml } from "../render/html";

/**
 * Build-time OG image generation: hand-rolled SVG card rendered to PNG with
 * @resvg/resvg-js. Hash-cached in .cache/og/. If resvg fails (e.g. missing
 * native binary in some environment), pages fall back to the static
 * /images/og-default.png and the build continues.
 */

const WIDTH = 1200;
const HEIGHT = 630;
const FALLBACK = "/images/og-default.png";

function wrapTitle(title: string, maxChars = 26): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 4) {
    lines.length = 4;
    lines[3] = lines[3].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

function ogSvg(title: string, date: string, tags: string[]): string {
  const lines = wrapTitle(title);
  const fontSize = lines.length > 3 ? 56 : lines.length > 2 ? 64 : 72;
  const lineHeight = fontSize * 1.2;
  const titleY = 260 - ((lines.length - 1) * lineHeight) / 2;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#131211"/>
  <rect x="0" y="0" width="${WIDTH}" height="8" fill="#ef6a61"/>
  <text x="80" y="120" font-family="Inter" font-size="28" font-weight="500" fill="#8f8a82">${escapeHtml(site.url.replace("https://", ""))}</text>
  ${lines
    .map(
      (line, i) =>
        `<text x="80" y="${titleY + i * lineHeight}" font-family="Inter" font-size="${fontSize}" font-weight="700" fill="#ece9e4">${escapeHtml(line)}</text>`,
    )
    .join("\n  ")}
  <text x="80" y="540" font-family="Inter" font-size="26" fill="#b8b3ac">${escapeHtml(date)}${tags.length ? escapeHtml("  ·  " + tags.slice(0, 4).join("  ")) : ""}</text>
  <text x="80" y="580" font-family="Inter" font-size="26" font-weight="600" fill="#ef6a61">${escapeHtml(site.author)}</text>
</svg>`;
}

let resvgAvailable: boolean | undefined;

async function renderPng(svg: string): Promise<Uint8Array | null> {
  if (resvgAvailable === false) return null;
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: WIDTH },
      // resvg-js 2.6.2 loads fonts from disk (fontFiles/fontDirs), NOT buffers —
      // an earlier fontBuffers attempt was silently ignored and only rendered on
      // hosts with a system "Inter". Load the bundled static weights and disable
      // system fonts so text renders identically on any build host, including a
      // headless Linux CI (Cloudflare Workers Builds / GitHub Actions).
      font: {
        fontDirs: [paths.fonts],
        loadSystemFonts: false,
        defaultFontFamily: "Inter",
      },
    });
    resvgAvailable = true;
    return resvg.render().asPng();
  } catch (err) {
    if (resvgAvailable === undefined) {
      console.warn(`OG image rendering unavailable (${err}); using static fallback`);
    }
    resvgAvailable = false;
    return null;
  }
}

/** Returns the public og:image path for an article. */
export async function generateOgImage(article: Article): Promise<string> {
  if (article.fm.cover) {
    return article.url + article.fm.cover.replace(/^\.\//, "");
  }

  const date = article.fm.date.toISOString().slice(0, 10);
  const key = Bun.hash(`${article.fm.title}|${date}|v2`).toString(16).slice(0, 8);
  const cachePath = join(paths.cache, "og", `${article.slug}-${key}.png`);
  // Content-hashed public name so editing a title busts the 1-year immutable
  // cache on /assets/og/ (the og:image meta is regenerated each build).
  const fileName = `${article.slug}-${key}.png`;
  const outPath = join(paths.dist, "assets", "og", fileName);
  const publicPath = `/assets/og/${fileName}`;

  await mkdir(join(paths.dist, "assets", "og"), { recursive: true });

  const cached = Bun.file(cachePath);
  if (await cached.exists()) {
    await Bun.write(outPath, cached);
    return publicPath;
  }

  const png = await renderPng(ogSvg(article.fm.title, date, article.fm.tags));
  if (!png) return FALLBACK;

  await mkdir(join(paths.cache, "og"), { recursive: true });
  await Bun.write(cachePath, png);
  await Bun.write(outPath, png);
  return publicPath;
}
