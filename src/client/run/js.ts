import type { Engine, OutputEvent } from "./index";

/**
 * JavaScript engine: runs user code in a sandboxed Web Worker built from a
 * Blob (prelude + user source concatenated — no eval, so CSP only needs
 * worker-src blob:). A watchdog terminates runaway code after 5s.
 */

const PRELUDE = `
const __post = (kind, args) => self.postMessage({ kind, text: args.map(a => {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a, null, 2); } catch { return String(a); }
}).join(" ") + "\\n" });
console.log = (...a) => __post("stdout", a);
console.info = console.log;
console.warn = (...a) => __post("stderr", a);
console.error = (...a) => __post("stderr", a);
self.onerror = (e) => { __post("stderr", [String(e)]); };
self.addEventListener("unhandledrejection", (e) => __post("stderr", ["Unhandled rejection: " + e.reason]));
// Signal completion one macrotask after the user code settles, so pending
// microtasks (resolved promises) and zero-delay timers flush their output first.
const __finish = () => setTimeout(() => self.postMessage({ kind: "__done" }), 0);
`;

// The user source runs inside an async wrapper: top-level await works, and
// awaited output is captured because __finish only runs once the body settles.
const wrap = (source: string) =>
  `Promise.resolve().then(async () => {\n${source}\n}).catch((e) => __post("stderr", [(e && e.stack) || String(e)])).finally(__finish);`;

const TIMEOUT_MS = 5000;

export const engine: Engine = {
  async *run(source: string): AsyncIterable<OutputEvent> {
    const blob = new Blob([PRELUDE, "\n", wrap(source)], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const queue: OutputEvent[] = [];
    let done = false;
    let notify: (() => void) | null = null;

    worker.onmessage = (e) => {
      if (e.data.kind === "__done") done = true;
      else queue.push(e.data as OutputEvent);
      notify?.();
    };
    worker.onerror = (e) => {
      queue.push({ kind: "stderr", text: `${e.message ?? "Script error"}\n` });
      done = true;
      notify?.();
    };

    const watchdog = setTimeout(() => {
      queue.push({ kind: "system", text: `\n[terminated after ${TIMEOUT_MS / 1000}s]` });
      done = true;
      notify?.();
    }, TIMEOUT_MS);

    try {
      while (!done || queue.length) {
        if (queue.length) {
          yield queue.shift()!;
        } else {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
      }
    } finally {
      clearTimeout(watchdog);
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  },
};
