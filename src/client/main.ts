/** Global client behavior: theme toggle, code copy, scroll-top, progress bar, 404 path. */

// --- Theme (light ↔ dark; defaults to the system preference) ---
function effectiveTheme(): "light" | "dark" {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function labelFor(theme: "light" | "dark"): string {
  return theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
}

const themeToggle = document.getElementById("theme-toggle");
themeToggle?.setAttribute("aria-label", labelFor(effectiveTheme()));

themeToggle?.addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  // Icons follow :root[data-theme] in CSS, so this updates the button too.
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  themeToggle.setAttribute("aria-label", labelFor(next));
  // Re-render mermaid diagrams for the new effective theme, if present.
  document.dispatchEvent(new CustomEvent("themechange"));
});

/** Announce a message to assistive tech via the shared live region. */
function announce(message: string): void {
  const region = document.getElementById("a11y-status");
  if (region) region.textContent = message;
}

// --- Code copy buttons ---
document.addEventListener("click", async (event) => {
  const btn = (event.target as Element).closest?.(".code-copy") as HTMLButtonElement | null;
  if (!btn) return;
  const pre = btn.closest(".code-block")?.querySelector("pre.shiki");
  if (!pre) return;
  const text = (pre as HTMLElement).innerText.replace(/\n$/, "");
  const label = btn.querySelector("span");
  try {
    await navigator.clipboard.writeText(text);
    announce("Code copied to clipboard");
    if (label) {
      const original = label.textContent;
      label.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        label.textContent = original;
        btn.classList.remove("copied");
      }, 2000);
    }
  } catch {
    announce("Copy failed");
  }
});

// --- Share button (rendered up-front; Web Share with a clipboard fallback) ---
document.addEventListener("click", async (event) => {
  const btn = (event.target as Element).closest?.(".share-button") as HTMLButtonElement | null;
  if (!btn) return;
  const url = btn.dataset.shareUrl || location.href;
  const title = btn.dataset.shareTitle || document.title;
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    announce("Link copied to clipboard");
    const label = btn.querySelector("span");
    if (label) {
      const original = label.textContent;
      label.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        label.textContent = original;
        btn.classList.remove("copied");
      }, 2000);
    }
  } catch {
    announce("Copy failed");
  }
});

// --- Scroll to top ---
const scrollTop = document.getElementById("scroll-top");
if (scrollTop) {
  const onScroll = () => {
    scrollTop.hidden = window.scrollY < 500;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  scrollTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
}

// --- Header hairline after scroll ---
const header = document.querySelector(".site-header");
if (header) {
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

// --- Reading progress bar (article pages) ---
const progress = document.querySelector(".progress-bar") as HTMLElement | null;
if (progress) {
  let ticking = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

// --- Activate preloaded KaTeX stylesheet (kept off the critical path) ---
const katexCss = document.getElementById("katex-css") as HTMLLinkElement | null;
if (katexCss && katexCss.rel === "preload") {
  katexCss.rel = "stylesheet";
}

// --- 404 terminal: print the missed path ---
const termPath = document.getElementById("term-path");
if (termPath) {
  termPath.textContent = location.pathname.replace(/[^\w/.-]/g, "");
}

// --- YouTube facade: swap thumbnail for the real embed on click ---
document.addEventListener("click", (event) => {
  const facade = (event.target as Element).closest?.(".youtube-facade") as HTMLElement | null;
  if (!facade) return;
  const id = facade.dataset.youtubeId;
  if (!id) return;
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
  iframe.title = facade.getAttribute("aria-label") ?? "YouTube video";
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.className = "youtube-embed";
  facade.replaceWith(iframe);
});
