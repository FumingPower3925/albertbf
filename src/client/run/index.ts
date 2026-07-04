/**
 * Runnable code blocks dispatcher. Binds Run buttons; the engine module for
 * a language is dynamically imported on first use.
 */

export interface OutputEvent {
  kind: "stdout" | "stderr" | "system";
  text: string;
}

export interface Engine {
  run(source: string, opts: { db?: string; baseUrl: string }): AsyncIterable<OutputEvent>;
}

const engines = new Map<string, Promise<Engine>>();

function loadEngine(name: string): Promise<Engine> {
  let engine = engines.get(name);
  if (!engine) {
    engine =
      name === "go"
        ? import("./go").then((m) => m.engine)
        : name === "sql"
          ? import("./sql").then((m) => m.engine)
          : name === "js"
            ? import("./js").then((m) => m.engine)
            : Promise.reject(new Error(`No engine for ${name}`));
    engines.set(name, engine);
  }
  return engine;
}

function outputPanel(block: Element): HTMLElement {
  let panel = block.querySelector<HTMLElement>(".code-output:not(details)");
  const recorded = block.querySelector<HTMLElement>("details.code-output--recorded");
  if (recorded) {
    // Replace the pre-recorded panel with a live one on first run.
    panel = document.createElement("div");
    panel.className = "code-output";
    panel.innerHTML = `<pre aria-live="polite"></pre>`;
    recorded.replaceWith(panel);
  }
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "code-output";
    panel.innerHTML = `<pre aria-live="polite"></pre>`;
    block.appendChild(panel);
  }
  panel.hidden = false;
  return panel;
}

function announce(message: string): void {
  const region = document.getElementById("a11y-status");
  if (region) region.textContent = message;
}

document.addEventListener("click", async (event) => {
  const btn = (event.target as Element).closest?.(".code-run") as HTMLButtonElement | null;
  // aria-disabled (not the disabled property) so keyboard focus stays on the button.
  if (!btn || btn.getAttribute("aria-disabled") === "true") return;

  const block = btn.closest(".code-block")!;
  const pre = block.querySelector("pre.shiki") as HTMLElement | null;
  if (!pre) return;
  const source = pre.innerText.replace(/\n$/, "");

  const panel = outputPanel(block);
  const out = panel.querySelector("pre")!;
  out.textContent = "";
  panel.classList.add("running");
  btn.setAttribute("aria-disabled", "true");
  const label = btn.querySelector("span");
  const originalLabel = label?.textContent ?? "Run";
  if (label) label.textContent = "Running…";
  announce("Running code");

  const append = (event: OutputEvent) => {
    const span = document.createElement("span");
    span.className = `out-${event.kind}`;
    span.textContent = event.text;
    out.appendChild(span);
  };

  try {
    const engine = await loadEngine(btn.dataset.engine!);
    for await (const evt of engine.run(source, {
      db: btn.dataset.db,
      baseUrl: block.closest("[data-article-url]")?.getAttribute("data-article-url") ?? location.pathname,
    })) {
      append(evt);
    }
    if (!out.childNodes.length) {
      append({ kind: "system", text: "(no output)" });
    }
  } catch (err) {
    append({ kind: "stderr", text: `\n${err instanceof Error ? err.message : String(err)}` });
  } finally {
    panel.classList.remove("running");
    btn.removeAttribute("aria-disabled");
    if (label) label.textContent = originalLabel;
    announce("Run finished");
  }
});
