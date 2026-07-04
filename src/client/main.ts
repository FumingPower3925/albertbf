/** Global client behavior: theme toggle, code copy, scroll-top, progress bar, 404 path. */

// --- Theme (3-state: system → light → dark) ---
type ThemeMode = "system" | "light" | "dark";
const MODES: ThemeMode[] = ["system", "light", "dark"];

function currentMode(): ThemeMode {
  const stored = localStorage.getItem("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function applyMode(mode: ThemeMode): void {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem("theme");
  } else {
    document.documentElement.dataset.theme = mode;
    localStorage.setItem("theme", mode);
  }
  const toggle = document.getElementById("theme-toggle");
  if (toggle) {
    toggle.dataset.mode = mode;
    toggle.setAttribute("aria-label", `Theme: ${mode}`);
  }
}

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const next = MODES[(MODES.indexOf(currentMode()) + 1) % MODES.length];
  applyMode(next);
  // Re-render mermaid diagrams for the new effective theme, if present.
  document.dispatchEvent(new CustomEvent("themechange"));
});
applyMode(currentMode());

// --- Code copy buttons ---
document.addEventListener("click", async (event) => {
  const btn = (event.target as Element).closest?.(".code-copy") as HTMLButtonElement | null;
  if (!btn) return;
  const pre = btn.closest(".code-block")?.querySelector("pre.shiki");
  if (!pre) return;
  const text = (pre as HTMLElement).innerText.replace(/\n$/, "");
  try {
    await navigator.clipboard.writeText(text);
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
    // Clipboard unavailable (permissions/insecure context) — nothing to do.
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
