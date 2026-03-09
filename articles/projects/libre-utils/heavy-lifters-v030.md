---
title: "LibreUtils Part 5: The Heavy Lifters — Reaching v0.3.0"
date: "23-03-2026"
description: "LibreUtils v0.3.0 ships three new tools — an Archive Manager, Image Compressor, and expanded Metadata Scrubber — plus the infrastructure that makes WASM-heavy client-side processing actually work."
tags: ["wasm", "privacy", "archive", "image-compression", "metadata", "web-workers", "playwright", "release"]
project: "libre-utils"
project_version: "0.3.0"
project_url: "https://libreutils.org"
---

At the end of the v0.2.0 article I wrote one bullet point about what was coming next: *"v0.3.0: The Heavy Lifters (Files & Media) and Legal Compliance."* A single line. How hard could it be?

Turns out, quite hard. The previous tools — text encoding, password generation, encryption, checksums — worked with strings and buffers. Small, fast, predictable. v0.3.0 is a different beast entirely. We're talking about decompressing RAR archives, stripping GPS coordinates from photos, converting images between formats, and creating password-protected 7z files — all inside a browser tab, with zero server involvement.

Three new tools. Five WASM libraries. Fourteen supported archive formats. Byte-level metadata scrubbing for twelve file types. And a collection of problems I never expected to solve.

Welcome to the heavy lifters.

## The Archive Manager: More Formats Than You'd Expect

The Archive Manager was the flagship feature of v0.3.0, and it needed to do everything: extract archives in every common format, create new ones with compression control, and support password-protected encryption — all client-side.

Here's what we ended up supporting:

| Operation | Formats |
|-----------|---------|
| **Extract** | ZIP, TAR, TAR.GZ, GZ, TAR.BZ2, TAR.XZ, 7Z, RAR |
| **Create** | ZIP, TAR, TAR.GZ, TAR.BZ2, TAR.XZ, 7Z |

RAR is deliberately read-only. It's a proprietary format — creation requires a commercial license. The UI makes this explicit with a disabled dropdown option: *"RAR (read-only)"*. Honesty over illusion.

### The Library Stack

No single library handles all of this. The Archive Manager uses a carefully layered stack:

- **Native JavaScript parsers** — Hand-coded ZIP central directory and TAR/USTAR parsers for the common cases. Fast, zero-dependency, no WASM cold-start.
- **fflate** — Lightweight compression/decompression for ZIP and GZ. Pure JavaScript, blazing fast.
- **libarchive.js** — WASM port of the legendary libarchive C library. Handles RAR, BZ2, XZ, and serves as the fallback for complex formats.
- **@zip.js/zip.js** — AES-256 encrypted ZIP creation and extraction. The only library that does standard-compatible encrypted ZIPs in the browser.
- **7z-wasm** — Emscripten port of the 7-Zip CLI. Full 7z support with AES-256 encryption and encrypted headers.

The routing logic tries native parsers first — they're faster and don't require loading WASM. When that fails (or when the format demands it), it falls back to the heavier libraries:

```typescript
// Simple ZIP? Use native parser + fflate (fast, no WASM)
// Encrypted ZIP? Route to zip.js (AES-256)
// 7Z? Route to 7z-wasm (full 7-Zip CLI via WASM)
// RAR, BZ2, XZ? Route to libarchive.js (WASM fallback)
```

This layered approach means users extracting a simple ZIP never wait for a WASM binary to download. They get instant results.

### Password Protection: Harder Than It Looks

Implementing password-protected archives turned into one of the most educational debugging sessions of the entire project.

The original plan was simple: libarchive.js supports `Archive.write()` with a `passphrase` option. Just pass the password and done, right?

Wrong. libarchive.js's WASM build lacks crypto support. The `passphrase` option silently produces 0-byte files. No error. No warning. Just... nothing. A classic WASM portability trap — the C library supports it, but the WASM build was compiled without the crypto modules.

The fix was to use format-native encryption through dedicated libraries:

```typescript
// ZIP: AES-256 via zip.js — standard-compatible, opens in any unzipper
const zipWriter = new ZipWriter(new BlobWriter("application/zip"), {
    password, encryptionStrength: 3  // AES-256
});

// 7Z: AES-256 via 7z-wasm — encrypted headers hide even filenames
sevenZip.callMain(['a', `-p${password}`, '-mhe=on', '/archive.7z', ...files]);
```

For TAR-based formats (TAR.GZ, TAR.BZ2, TAR.XZ), the password field simply doesn't appear. TAR has no encryption support — that's not a limitation of our implementation, it's a limitation of the format. The UI explains this with a hint: *"TAR formats don't support encryption. Use ZIP or 7z for password protection."*

### The Emscripten stdin Nightmare

Here's a fun one. During testing, clicking on a password-protected 7z file triggered — I kid you not — a native browser `prompt()` dialog asking "Input:". Not our dialog. The *browser's* built-in prompt.

After a deep rabbit hole of web searches and Emscripten source code: when C code compiled to WASM reads from `stdin`, Emscripten's default handler calls `window.prompt()`. The 7-Zip CLI tries to prompt for the password via stdin when it encounters an encrypted archive, and Emscripten dutifully translates that to a browser popup.

The fix is two-fold. First, override Emscripten's stdin with an immediate EOF:

```typescript
const sevenZip = await SevenZip({
    stdin: () => -1,    // EOF — never read from stdin
    print: () => {},     // Suppress stdout noise
    printErr: () => {}   // Suppress stderr noise
});
```

Second, *always* pass the `-p` flag to 7-Zip, even with an empty password. This prevents the CLI from ever attempting to read stdin:

```typescript
const pw = password ?? '';
sevenZip.callMain(['l', `-p${pw}`, archivePath]);
```

Hours of debugging for two lines of code. Classic.

## The Image Compressor: Canvas as a Compression Engine

The Image Compressor takes a radically different approach from the Archive Manager — no WASM libraries at all. Everything runs through the browser's native Canvas API.

Load an image onto a `<canvas>`. Call `canvas.toBlob()` with a target format and quality. The browser's built-in encoders handle the rest. It's elegant, fast, and surprisingly powerful.

### Supported Formats

**Input**: JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF
**Output**: JPEG, PNG, WebP, AVIF (with browser feature detection), GIF, BMP, TIFF

AVIF support is feature-detected at runtime. Chrome and Firefox support it. Safari doesn't (yet). When unavailable, the option simply doesn't appear — no broken functionality, no error messages.

The JPEG/JPG naming confusion is addressed with a combined label: *"JPEG / JPG"*. Small thing, but it eliminates the "where's JPG?" support question before it happens.

### The Size Preservation Problem

Here's something counterintuitive: compressing a PNG to PNG often produces a *larger* file. Why? Because `canvas.toBlob('image/png')` decodes to raw RGBA pixels and re-encodes from scratch. The browser's generic encoder can't match the optimizations that tools like pngquant or oxipng apply.

The solution is straightforward — compare and choose:

```typescript
if (isSameFormat && isSameDimensions && noCrop && blob.size >= file.size) {
    return { blob: file, preservedOriginal: true };
}
```

When the output would be larger than the input, we return the original file with a message: *"Already optimally compressed — original file preserved."* The savings bar turns purple instead of green. Honest feedback beats misleading numbers.

### Custom Encoders for Obscure Formats

Canvas can't natively export BMP, TIFF, or GIF. So we wrote custom encoders:

- **BMP**: 24-bit uncompressed DIB format with BGR pixel ordering, bottom-up row order, and 4-byte row padding. ~100 lines of DataView writes.
- **TIFF**: Little-endian TIFF with IFD (Image File Directory), optional LZW compression with MSB-first bit encoding. Significantly more complex.
- **GIF**: GIF89a format with median-cut color quantization (reducing millions of colors to 256) and variable code size LZW compression. The quantizer samples up to 50,000 pixels for performance.

Are these the most optimized encoders in existence? No. But they produce valid files that open in every image viewer, and they run entirely in the browser. That's the tradeoff.

### The Crop Tool

A late addition that turned out to be surprisingly useful: interactive cropping. Eight drag handles (corners and edges), a center move handle, real-time dimension display, and touch support. All rendered on a canvas overlay.

Combined with format conversion and quality control, the Image Compressor handles the workflow I actually use daily: screenshot → crop → convert to JPEG at 80% → share. No Photoshop required.

## The Metadata Scrubber: From PDFs to Everything

v0.2.0's Metadata Scrubber only handled PDFs. v0.3.0 expands it to twelve file types across four categories, all scrubbed at the binary level.

### Image Metadata Scrubbing

Each image format stores metadata differently, so each needs its own parser:

- **JPEG**: Strip APP1 segments (EXIF, XMP) and APP13 segments (IPTC). Walk the segment chain, skip the ones containing metadata, keep everything else.
- **PNG**: Remove tEXt, iTXt, zTXt, and eXIf chunks. Validate the 8-byte PNG signature, iterate chunks by length + CRC, drop the metadata ones.
- **WebP**: RIFF container format. Strip EXIF and XMP FourCC chunks, recalculate the RIFF file size header.
- **GIF**: Skip Comment Extension (0xFE) and Application Extension (0xFF) blocks while preserving Graphics Control and image data.
- **TIFF**: Remove IFD entries for EXIF IFD (0x8769), GPS IFD (0x8825), IPTC (0x83BB), and XMP (0x02BC). Compact remaining entries while preserving image data offsets.
- **SVG**: Regex-based removal of `<metadata>`, RDF, Dublin Core, Sodipodi, and Inkscape namespace elements. No DOM parsing required.

The key insight: **scrub at the binary level, don't re-encode**. Re-encoding an image through Canvas would strip metadata but also degrade quality. By operating directly on bytes, we remove metadata while preserving the original image data bit-for-bit.

### Audio Metadata Scrubbing

- **MP3**: Remove ID3v2 headers (syncsafe integer size encoding) and ID3v1 footers (last 128 bytes starting with 'TAG'). Audio frames untouched.
- **FLAC**: Remove VORBIS_COMMENT and PICTURE metadata blocks. Preserve STREAMINFO and structural blocks. Reconstruct last-block flags.
- **WAV**: RIFF/WAVE container. Keep structural chunks (fmt, data, fact), drop metadata chunks (LIST, DISP, ID3).

### Video and Complex Audio: The FFmpeg Escape Hatch

For containers like MP4, MKV, AVI, MOV, and WebM, byte-level parsing would be impractical — these formats are enormously complex. Instead, we lazy-load FFmpeg WASM (~25 MB) from a CDN and run:

```
ffmpeg -i input -map_metadata -1 -c copy -y output
```

Stream copy (`-c copy`) preserves quality. `-map_metadata -1` strips all metadata. The WASM binary only downloads when the user actually needs it — loading a JPEG never triggers the 25 MB download.

## Infrastructure: The Invisible Work

### Web Worker Orchestrator

With three WASM-heavy tools, worker management became critical. The `WorkerOrchestrator` in `shared/src/utils/` handles:

- **Lifecycle management** — Create, track, and terminate workers by name
- **Idle timeout** — Auto-terminate workers after 5 minutes of inactivity (configurable)
- **WASM loading** — Lazy-load WASM modules via Blob URLs
- **Progress reporting** — Standardized `WorkerProgress` interface for long-running operations

The goal was making it trivially easy to add new WASM-based tools without reinventing worker management every time.

### E2E Tests with Playwright

v0.2.0 had "E2E tests" that were really just file structure checks. v0.3.0 replaces them with real Playwright tests running against a live dev server:

```typescript
// playwright.config.ts
export default defineConfig({
    webServer: {
        command: 'bun run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

Four test suites covering home page rendering, navigation, dark mode persistence, and tool-specific interactions. Not exhaustive yet, but a solid foundation that actually tests the application as users experience it.

### Code Splitting and Lazy Loading

Every tool is now a separate chunk loaded on demand:

```typescript
const lazyTool = (loader: () => Promise<{ renderPage: () => HTMLElement }>) => {
    return async () => {
        const mod = await loader();
        return mod.renderPage();
    };
};

// Only loads when user navigates to the tool
{ path: '/tools/archive-manager', render: lazyTool(() => import('./tools/archive-manager')) }
```

Combined with `--splitting --format=esm` in the build config, this means users visiting the home page don't download any tool code. Navigate to the Image Compressor? Only then does that bundle load. The Archive Manager's WASM dependencies? Only fetched when you actually try to extract a RAR file.

### The Legal Page

With five new third-party libraries, proper attribution became non-negotiable. The legal page now lists every dependency with:

- Library name linked to its homepage
- License type (MIT, BSD-3-Clause, LGPL-2.1, Apache-2.0)
- Direct link to the license file on GitHub
- What it's used for in LibreUtils

The LGPL-2.1 license for 7z-wasm deserves a note — it requires that users can replace the library with a modified version. Since we load it as an external module (not bundled into our code), this requirement is naturally satisfied. Architecture decisions have legal consequences.

## The 7z-wasm Bundling Saga

Of all the problems in v0.3.0, this one was the most time-consuming and instructive.

7z-wasm is an Emscripten build. Emscripten generates JavaScript that conditionally imports Node.js built-ins (like `"module"`) for environment detection. Bun's bundler sees that import, tries to resolve it, and fails:

```
error: Browser build cannot import() Node.js builtin: "module"
```

The import is dead code in the browser — it's inside an environment check that never executes. But the bundler doesn't know that. It sees `import("module")` and rightfully complains.

The solution: mark 7z-wasm as external in all build configurations, serve it as a vendor file, and use an import map to resolve the bare specifier at runtime:

```html
<!-- In index.html -->
<script type="importmap">
{ "imports": { "7z-wasm": "/vendor/7z-wasm/7zz.es6.js" } }
</script>
```

```typescript
// In build config
Bun.build({ external: ['7z-wasm'], splitting: true, format: 'esm' });
```

The WASM binary and its JavaScript wrapper live in `/vendor/7z-wasm/` — copied there during the build. In development, the dev server proxies requests to `node_modules/7z-wasm/`. In production, the files are static assets in the dist folder.

This pattern — external + import map + vendor directory — is now our standard approach for any WASM library that Bun can't bundle. It's ugly but reliable.

## The Numbers

- **7 tools** total (4 from v0.2.0, 3 new)
- **12 file types** supported for metadata scrubbing
- **14 archive format operations** (8 extract + 6 create)
- **5 WASM/JS libraries** integrated (fflate, zip.js, libarchive.js, 7z-wasm, FFmpeg)
- **3 custom binary encoders** (BMP, TIFF, GIF)
- **13 issues** closed for the release
- **Real E2E tests** with Playwright replacing the old file-check stubs

The bundle stays reasonable because WASM loads on demand. Visit the home page and you're looking at kilobytes, not megabytes. The heavy lifters only wake up when you need them.

## Closing Thoughts

v0.3.0 tested the "client-side only" constraint harder than anything before it. Every feature request that would be trivial with a server — "just shell out to 7-Zip," "just call FFmpeg," "just use ImageMagick" — had to be reimagined for the browser.

But that's the point. The constraint *is* the product. When your archive encryption runs in a browser tab, there's no server to breach. When your GPS scrubbing operates on raw bytes in JavaScript, those coordinates never touch a network. When your image compression uses Canvas, the pixels never leave your device.

Privacy isn't a feature we bolt on. It's the architecture we build within.

The code is open source: [github.com/FumingPower3925/libreutils](https://github.com/FumingPower3925/libreutils)

Try the new tools at [libreutils.org](https://libreutils.org). Compress an archive. Strip metadata from a photo. Convert an image. Your files stay yours. That's still the whole point.
