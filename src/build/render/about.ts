import { existsSync } from "fs";
import { join } from "path";
import { html, raw, type RawHtml } from "./html";
import { site, paths } from "../config";

/**
 * Looks for a portrait at src/static/images/avatar.{jpg,jpeg,png,webp,avif}
 * (copied to /images/ at build time). Drop a file there and it replaces the
 * initials automatically — no code change needed.
 */
function findAvatar(): string | null {
  for (const ext of ["jpg", "jpeg", "png", "webp", "avif"]) {
    if (existsSync(join(paths.staticDir, "images", `avatar.${ext}`))) {
      return `/images/avatar.${ext}`;
    }
  }
  return null;
}

export function renderAbout(): RawHtml {
  const avatar = findAvatar();
  const photo = avatar
    ? html`<img class="about-photo about-photo--img" src="${avatar}" alt="${site.author}" width="88" height="88" decoding="async">`
    : html`<div class="about-photo" aria-hidden="true"><span>AB</span></div>`;

  return html`<div class="about-page">
<header class="about-header">
${photo}
<div>
<h1>${site.author}</h1>
<p class="about-tagline">Software &amp; systems engineer in Barcelona. I care about performance, privacy, and understanding systems all the way down.</p>
</div>
</header>

<section class="prose">
<h2>Hi</h2>
<p>I'm Albert — a software and systems engineer who likes working close to the metal and close to the problem. I earned both my Bachelor's and Master's in Informatics Engineering at the <a href="https://www.upc.edu/" rel="noopener" target="_blank">Universitat Politècnica de Catalunya (UPC)</a>. My Master's thesis was <strong><a href="https://goceleris.dev/" rel="noopener" target="_blank">Celeris</a></strong> — a high-performance Go HTTP engine built directly on low-level Linux kernel primitives (<code>io_uring</code> and <code>epoll</code>). It's the project I'm proudest of: on a self-built bare-metal benchmark cluster spanning x86-64 and Arm, it reaches the highest HTTP/1.1 and h2c throughput I'm aware of — ahead of the fastest servers in C, C++, and Rust (H2O, Lithium, and the rest).</p>
<p>Most of what I build ends up written about here — the reasoning, the dead ends, and the parts that actually worked. I work mainly in Go and other systems languages, with regular detours into databases, algorithms, and the occasional bout of LLM tinkering.</p>

<h2>What I do</h2>
<ul>
<li><strong>High-performance systems</strong> — HTTP engines, event loops, and kernel-level I/O (<code>io_uring</code>, <code>epoll</code>), zero-allocation hot paths, and the benchmarking rigor to prove it.</li>
<li><strong>Systems &amp; web platform</strong> — servers, edge-deployed services, and performance-first web engineering (this blog included).</li>
<li><strong>Privacy-first tooling</strong> — software that runs locally and keeps your data on your machine.</li>
<li><strong>AI tinkering</strong> — LLM tooling and security experiments, whenever something piques my interest.</li>
</ul>

<h2>Projects</h2>
<ul class="about-projects">
<li><strong><a href="https://goceleris.dev/" rel="noopener" target="_blank">Celeris</a></strong> — a high-throughput, load-bearing Go HTTP engine on a dual <code>io_uring</code> / <code>epoll</code> architecture, with first-party event-loop database drivers. My Master's thesis, and the best thing I've built yet.</li>
<li><strong><a href="https://github.com/FumingPower3925/stdocs" rel="noopener" target="_blank">stdocs</a></strong> — a zero-dependency Go library that turns a standard-library <code>net/http.ServeMux</code> into a self-documenting API: the route patterns you already write become an OpenAPI 3.x spec and a <code>/docs</code> console, no code generation.</li>
<li><strong><a href="https://github.com/FumingPower3925/htmx-dynamic-url" rel="noopener" target="_blank">htmx-dynamic-url</a></strong> — an <a href="https://htmx.org/extensions/" rel="noopener" target="_blank">official community HTMX extension</a> that resolves <code>{placeholder}</code> variables in <code>hx-*</code> request URLs from your app's JavaScript state: declarative dynamic URLs, CSP-compliant, no per-request glue.</li>
<li><strong><a href="${site.repo}" rel="noopener" target="_blank">This blog</a></strong> — a zero-cost, framework-free static site on Cloudflare Workers. Source is public.</li>
</ul>

<h2>Get in touch</h2>
<p>
Find me on <a href="${site.github}" rel="me noopener" target="_blank">GitHub</a>${site.linkedin ? html`, <a href="${site.linkedin}" rel="me noopener" target="_blank">LinkedIn</a>` : null}${site.x ? html`, and <a href="${site.x}" rel="me noopener" target="_blank">X</a>` : null}. Or subscribe to the <a href="/feed.xml">RSS feed</a>.
</p>
</section>
</div>`;
}
