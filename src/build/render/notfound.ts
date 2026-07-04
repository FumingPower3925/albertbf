import { html, type RawHtml } from "./html";

export function renderNotFound(): RawHtml {
  return html`<div class="notfound">
<h1 class="sr-only">404 — Page not found</h1>
<div class="terminal" role="presentation">
<div class="terminal-bar"><span></span><span></span><span></span></div>
<pre class="terminal-body"><code><span class="term-prompt">$</span> curl -s https://albertbf.com<span id="term-path"></span>
<span class="term-err">HTTP/2 404 — page not found</span>

<span class="term-prompt">$</span> suggestions --did-you-mean
  → <a href="/">/</a>
  → <a href="/articles/">/articles/</a>
  → <a href="/projects/">/projects/</a>
  → <a href="/about/">/about/</a>

<span class="term-prompt">$</span> <span class="term-cursor" aria-hidden="true">▌</span></code></pre>
</div>
</div>`;
}
