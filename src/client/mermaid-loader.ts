/** Lazy Mermaid rendering, theme-aware, re-renders on theme toggle. */

declare global {
  interface Window {
    mermaid?: {
      initialize(config: object): void;
      run(options?: { nodes?: Iterable<Element> }): Promise<void>;
    };
  }
}

const diagrams = [...document.querySelectorAll<HTMLElement>("pre.mermaid")];

if (diagrams.length) {
  // Keep original sources so we can re-render when the theme changes.
  const sources = new Map(diagrams.map((el) => [el, el.textContent ?? ""]));

  function effectiveDark(): boolean {
    const forced = document.documentElement.dataset.theme;
    if (forced) return forced === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function loadScript(): Promise<void> {
    if (window.mermaid) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/vendor/mermaid/mermaid.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("mermaid failed to load"));
      document.head.appendChild(script);
    });
  }

  async function renderAll(): Promise<void> {
    await loadScript();
    window.mermaid!.initialize({
      startOnLoad: false,
      theme: effectiveDark() ? "dark" : "neutral",
      securityLevel: "strict",
    });
    for (const el of diagrams) {
      el.textContent = sources.get(el) ?? "";
      el.removeAttribute("data-processed");
    }
    await window.mermaid!.run({ nodes: diagrams });
  }

  // Render when the first diagram approaches the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void renderAll();
        document.addEventListener("themechange", () => void renderAll());
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void renderAll());
      }
    },
    { rootMargin: "200px" },
  );
  observer.observe(diagrams[0]);
}

export {};
