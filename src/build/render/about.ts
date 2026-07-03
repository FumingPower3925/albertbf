import { html, type RawHtml } from "./html";
import { site } from "../config";

/**
 * About page. Bio drafted from repository context — placeholders are marked
 * with USER ACTION comments and visible [TODO] text where user input is needed.
 */
export function renderAbout(): RawHtml {
  return html`<div class="about-page">
<header class="about-header">
<!-- USER ACTION: replace the initials circle with a real photo (drop it in src/static/images/ and swap the markup) -->
<div class="about-photo" aria-hidden="true"><span>AB</span></div>
<div>
<h1>Albert Bausili</h1>
<p class="about-tagline">Software engineer in Barcelona. I like systems that are fast, private, and understandable.</p>
</div>
</header>

<section class="prose">
<h2>Hi</h2>
<p>I'm Albert — a software engineer who enjoys working close to the metal and close to the problem. I recently completed my Master's at the <a href="https://www.upc.edu/" rel="noopener" target="_blank">Universitat Politècnica de Catalunya (UPC)</a>, where my thesis project, <strong>Auto-Grade</strong>, explored AI-powered bulk assignment grading with LLMs.</p>
<p>Most of what I build ends up written about here: the reasoning, the dead ends, and the parts that actually worked. I work mainly in Go and other systems languages, with regular detours into databases, algorithms, and LLM security.</p>

<h2>What I do</h2>
<ul>
<li><strong>AI &amp; LLM engineering</strong> — agentic tooling, document intelligence, and poking at LLM defenses (see Mini-Gandalf).</li>
<li><strong>Systems &amp; web platform</strong> — edge-deployed services, static generators, performance-first web engineering.</li>
<li><strong>Privacy-first tooling</strong> — software that runs locally and keeps data where it belongs.</li>
</ul>

<h2>Projects</h2>
<ul class="about-projects">
<li><strong><a href="/projects/">Auto-Grade</a></strong> — AI-powered assignment grading platform (Master's thesis at UPC).</li>
<li><strong><a href="/projects/">LibreUtils</a></strong> — a privacy-first web toolkit: every tool runs entirely in your browser.</li>
<li><strong><a href="/projects/">TTRPG Session Manager</a></strong> — a browser-based game-master companion.</li>
<li><strong>Mini-Gandalf</strong> — a puzzle sandbox for exploring LLM prompt-injection defenses.</li>
<li><strong><a href="${site.repo}" rel="noopener" target="_blank">This blog</a></strong> — a zero-cost, framework-free static site on Cloudflare Workers. Source is public.</li>
</ul>

<h2>Get in touch</h2>
<p>
Find me on <a href="${site.github}" rel="me noopener" target="_blank">GitHub</a>${site.linkedin ? html`, <a href="${site.linkedin}" rel="me noopener" target="_blank">LinkedIn</a>` : html` <em>[TODO: add LinkedIn]</em>`}${site.email ? html`, or email me at <a href="mailto:${site.email}">${site.email}</a>` : html` <em>[TODO: add public email]</em>`}.
Or just subscribe to the <a href="/feed.xml">RSS feed</a>.
</p>
</section>
</div>`;
}
