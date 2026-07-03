import type { Engine, OutputEvent } from "./index";

/**
 * Go engine: sends the program to /api/run/go (a Worker proxy in front of
 * the Go Playground) and plays back the returned events, honoring the
 * playground's timing hints (capped so nothing feels stuck).
 */

interface PlaygroundResponse {
  errors: string;
  events: { text: string; kind: "stdout" | "stderr"; delayMs: number }[] | null;
  status?: number;
}

const MAX_DELAY_MS = 1000;

export const engine: Engine = {
  async *run(source: string): AsyncIterable<OutputEvent> {
    const res = await fetch("/api/run/go", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: source }),
    });

    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw new Error(`Rate limited — try again in ${retry ?? "a few"} seconds.`);
    }
    if (!res.ok) {
      throw new Error(`Run failed (${res.status}). The Go Playground may be unavailable.`);
    }

    const data = (await res.json()) as PlaygroundResponse;
    if (data.errors) {
      yield { kind: "stderr", text: data.errors };
      return;
    }
    for (const event of data.events ?? []) {
      if (event.delayMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(event.delayMs, MAX_DELAY_MS)));
      }
      yield { kind: event.kind, text: event.text };
    }
    if (data.status !== undefined && data.status !== 0) {
      yield { kind: "system", text: `\n[exit status ${data.status}]` };
    }
  },
};
