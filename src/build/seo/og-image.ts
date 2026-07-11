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

/**
 * "Terminal" card — a shell prompt, a monospace title in JetBrains Mono, and a
 * blinking coral cursor (the blog's terminal-cursor mascot). The `kicker` is the
 * thing being `cat`-ed (the series, or the article file).
 */
function ogSvg(title: string, kicker: string, dateLabel: string, tags: string[]): string {
  const size = title.length > 26 ? 52 : 68;
  const maxChars = Math.floor(1040 / (size * 0.6)); // JetBrains Mono ≈ 0.6em advance
  const lines = wrapTitle(title, maxChars);
  const lineHeight = size * 1.24;
  const startY = 300 - ((lines.length - 1) * lineHeight) / 2;

  const last = lines[lines.length - 1];
  const curW = size * 0.6;
  const curH = size * 0.74;
  const curX = 80 + last.length * size * 0.6 + 8;
  const curY = startY + (lines.length - 1) * lineHeight;

  const tagLine = tags.length ? tags.slice(0, 4).join("  ") : "";
  const footRight = `${site.author} · ${dateLabel}`;

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0f0d0c"/>
  <rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" fill="none" stroke="#221d1a" stroke-width="2"/>
  <g font-family="JetBrains Mono">
    <circle cx="94" cy="86" r="7" fill="#3a3430"/><circle cx="118" cy="86" r="7" fill="#3a3430"/><circle cx="142" cy="86" r="7" fill="#3a3430"/>
    <text x="1120" y="92" text-anchor="end" font-size="22" font-weight="500" fill="#6f665d">${escapeHtml(site.url.replace(/^https?:\/\//, ""))}</text>
    <text x="80" y="164" font-size="24" font-weight="500"><tspan fill="#ef6a61">$</tspan><tspan fill="#6f665d"> cat </tspan><tspan fill="#b8b3ac">${escapeHtml(kicker)}</tspan></text>
    ${lines
      .map(
        (line, i) =>
          `<text x="80" y="${startY + i * lineHeight}" font-size="${size}" font-weight="700" fill="#f2efea">${escapeHtml(line)}</text>`,
      )
      .join("\n    ")}
    <rect x="${curX.toFixed(1)}" y="${(curY - curH + size * 0.06).toFixed(1)}" width="${curW.toFixed(1)}" height="${curH.toFixed(1)}" fill="#ef6a61"/>
    ${tagLine ? `<text x="80" y="560" font-size="23" font-weight="500"><tspan fill="#5f574f"># </tspan><tspan fill="#8f8a82">${escapeHtml(tagLine)}</tspan></text>` : ""}
    <text x="1120" y="560" text-anchor="end" font-size="23" font-weight="500" fill="#6f665d">${escapeHtml(footRight)}</text>
  </g>
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
        defaultFontFamily: "JetBrains Mono",
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
  const dateLabel = article.fm.date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const kicker = article.series?.meta.title ?? `${article.slug}.md`;
  const key = Bun.hash(`${article.fm.title}|${date}|v3`).toString(16).slice(0, 8);
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

  const png = await renderPng(ogSvg(article.fm.title, kicker, dateLabel, article.fm.tags));
  if (!png) return FALLBACK;

  await mkdir(join(paths.cache, "og"), { recursive: true });
  await Bun.write(cachePath, png);
  await Bun.write(outPath, png);
  return publicPath;
}
