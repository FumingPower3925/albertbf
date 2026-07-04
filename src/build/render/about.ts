import { html, type RawHtml } from "./html";
import { site } from "../config";

/**
 * About page. USER ACTION: replace the initials circle with a real photo
 * (drop it in src/static/images/ and swap the markup).
 */
export function renderAbout(): RawHtml {
  return html`<div class="about-page">
<header class="about-header">
<div class="about-photo" aria-hidden="true"><span>AB</span></div>
<div>
<h1>Albert Bausili</h1>
<p class="about-tagline">Software engineer in Barcelona. I care about performance, privacy, and understanding systems all the way down.</p>
</div>
</header>

<section class="prose">
<h2>Hi</h2>
<p>I'm Albert — a software engineer who likes working close to the metal and close to the problem. I hold a Master's in Informatics Engineering from the <a href="https://www.upc.edu/" rel="noopener" target="_blank">Universitat Politècnica de Catalunya (UPC)</a>, where my thesis was <strong><a href="https://goceleris.dev/" rel="noopener" target="_blank">Celeris</a></strong> — a high-performance Go HTTP engine built directly on low-level Linux kernel primitives (<code>io_uring</code> and <code>epoll</code>). It's the project I'm proudest of: on a self-built bare-metal benchmark cluster spanning x86-64 and Arm, it reaches the highest HTTP/1.1 and h2c throughput I'm aware of — ahead of the fastest servers in C, C++, and Rust (H2O, Lithium, and the rest).</p>
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
<li><strong><a href="https://goceleris.dev/" rel="noopener" target="_blank">Celeris</a></strong> — a high-throughput, load-bearing Go HTTP engine on a dual <code>io_uring</code> / <code>epoll</code> architecture, with first-party event-loop database drivers. My Master's thesis, and the best thing I've built.</li>
<li><strong><a href="https://github.com/FumingPower3925/libreutils" rel="noopener" target="_blank">LibreUtils</a></strong> — a privacy-first collection of web tools (compression, encryption, image editing, and more) that run entirely in your browser. No uploads, no ads.</li>
<li><strong><a href="https://github.com/FumingPower3925/ttrpg-session-manager" rel="noopener" target="_blank">TTRPG Session Manager</a></strong> — a web app for running tabletop RPG campaigns as a GM: plans, images, audio, NPCs, monsters, and more.</li>
<li><strong><a href="${site.repo}" rel="noopener" target="_blank">This blog</a></strong> — a zero-cost, framework-free static site on Cloudflare Workers. Source is public.</li>
</ul>

<h2>Get in touch</h2>
<p>
Find me on <a href="${site.github}" rel="me noopener" target="_blank">GitHub</a>${site.linkedin ? html`, <a href="${site.linkedin}" rel="me noopener" target="_blank">LinkedIn</a>` : null}${site.x ? html`, and <a href="${site.x}" rel="me noopener" target="_blank">X</a>` : null}. Or subscribe to the <a href="/feed.xml">RSS feed</a>.
</p>
</section>
</div>`;
}
