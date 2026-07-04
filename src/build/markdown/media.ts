import { join } from "path";
import { statSync } from "fs";
import { imageSize } from "image-size";
import { readFileSync } from "fs";
import { escapeAttr, escapeHtml } from "../render/html";

const VIDEO_EXTS = /\.(mp4|webm|mov)$/i;
const LARGE_IMAGE_BYTES = 500 * 1024;

export interface MediaContext {
  /** Article content directory (for resolving relative asset paths). */
  dir: string;
  /** Public URL prefix of the article (e.g. /articles/hello-world/). */
  url: string;
  usedLightbox: boolean;
}

function resolveAsset(ctx: MediaContext, href: string): { publicUrl: string; filePath?: string } {
  if (/^(https?:)?\/\//.test(href) || href.startsWith("/")) {
    return { publicUrl: href };
  }
  const clean = href.replace(/^\.\//, "");
  return { publicUrl: ctx.url + clean, filePath: join(ctx.dir, clean) };
}

export function renderMedia(
  ctx: MediaContext,
  href: string,
  title: string | null,
  alt: string,
): string {
  const { publicUrl, filePath } = resolveAsset(ctx, href);
  const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";

  if (VIDEO_EXTS.test(publicUrl)) {
    return `<figure class="media media--video"><video controls preload="metadata" playsinline src="${escapeAttr(publicUrl)}"${alt ? ` aria-label="${escapeAttr(alt)}"` : ""}></video>${caption}</figure>`;
  }

  let dimensions = "";
  if (filePath) {
    try {
      const buf = readFileSync(filePath);
      const size = imageSize(buf);
      if (size.width && size.height) {
        dimensions = ` width="${size.width}" height="${size.height}"`;
      }
      const bytes = statSync(filePath).size;
      if (bytes > LARGE_IMAGE_BYTES) {
        console.warn(`Large image (${Math.round(bytes / 1024)}KB): ${filePath} — consider compressing to <200KB`);
      }
    } catch {
      console.warn(`Image not found: ${filePath}`);
    }
  }

  ctx.usedLightbox = true;
  // The image lives inside a real <button> so zoom is keyboard-operable and
  // <dialog> restores focus to it on close.
  return `<figure class="media"><button type="button" class="lightbox-trigger" aria-label="Zoom image${alt ? ": " + escapeAttr(alt) : ""}"><img src="${escapeAttr(publicUrl)}" alt="${escapeAttr(alt)}"${dimensions} loading="lazy" decoding="async" data-lightbox></button>${caption}</figure>`;
}

const PLAY_ICON =
  '<svg width="68" height="48" viewBox="0 0 68 48" aria-hidden="true"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="currentColor"/><path d="M45 24 27 14v20" fill="#fff"/></svg>';

/** Renders the ::youtube{id=... title="..."} directive as a click-to-load facade. */
export function renderYouTube(id: string, title: string): string {
  const safeId = id.replace(/[^\w-]/g, "");
  return `<figure class="media media--youtube">
<button type="button" class="youtube-facade" data-youtube-id="${escapeAttr(safeId)}" aria-label="Play video: ${escapeAttr(title || "YouTube video")}">
<img src="https://i.ytimg.com/vi/${escapeAttr(safeId)}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy" decoding="async">
<span class="youtube-play">${PLAY_ICON}</span>
</button>${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ""}</figure>\n`;
}
