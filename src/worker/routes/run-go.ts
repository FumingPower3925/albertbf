import { API_CSP, securityHeaders } from "../security";

/**
 * Proxy to the Go Playground compile API (it has no CORS, so the browser
 * cannot call it directly). Same-origin only, body-capped, and rate-limited.
 */

const PLAYGROUND_URL = "https://play.golang.org/compile";
const MAX_BODY_BYTES = 16 * 1024;
const RATE_LIMIT = 6; // requests per window
const RATE_WINDOW_S = 60;

/** Hosts allowed to call the proxy (production + workers.dev previews). */
function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const source = origin ?? referer;
  // No Origin/Referer at all → allow (native fetch from same-origin nav, curl
  // during local dev). Cross-site browser requests always carry an Origin.
  if (!source) return true;
  try {
    const host = new URL(source).hostname;
    return host === "albertbf.com" || host.endsWith(".workers.dev") || host === "localhost";
  } catch {
    return false;
  }
}

interface Env {
  RUN_RL?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

interface PlaygroundEvent {
  Message: string;
  Kind: "stdout" | "stderr";
  Delay: number; // nanoseconds
}

interface PlaygroundResponse {
  Errors: string;
  Events: PlaygroundEvent[] | null;
  Status: number;
  VetErrors?: string;
}

// Fallback in-memory limiter (per-isolate; approximate) when the ratelimit
// binding is unavailable.
const memoryHits = new Map<string, { count: number; reset: number }>();

async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  if (env.RUN_RL) {
    const { success } = await env.RUN_RL.limit({ key: ip });
    return !success;
  }
  const now = Date.now();
  // Evict expired entries so the Map can't grow unbounded across many IPs.
  if (memoryHits.size > 5000) {
    for (const [k, v] of memoryHits) if (v.reset < now) memoryHits.delete(k);
  }
  const entry = memoryHits.get(ip);
  if (!entry || entry.reset < now) {
    memoryHits.set(ip, { count: 1, reset: now + RATE_WINDOW_S * 1000 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

function json(body: object, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...securityHeaders(API_CSP),
      ...extra,
    },
  });
}

export async function runGo(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405, { Allow: "POST" });
  }

  if (!isAllowedOrigin(request)) {
    return json({ error: "cross-origin requests are not allowed" }, 403);
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return json({ error: "program too large (16KB max)" }, 413);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (await isRateLimited(env, ip)) {
    return json({ error: "rate limited" }, 429, { "Retry-After": String(RATE_WINDOW_S) });
  }

  let code: string;
  try {
    const body = (await request.json()) as { code?: string };
    code = body.code ?? "";
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!code.trim() || code.length > MAX_BODY_BYTES) {
    return json({ error: "missing or oversized code" }, 400);
  }

  const upstream = await fetch(PLAYGROUND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ version: "2", body: code, withVet: "false" }),
  });

  if (!upstream.ok) {
    return json({ error: `playground returned ${upstream.status}` }, 502);
  }

  const data = (await upstream.json()) as PlaygroundResponse;
  return json({
    errors: data.Errors ?? "",
    events: (data.Events ?? []).map((event) => ({
      text: event.Message,
      kind: event.Kind,
      delayMs: Math.round((event.Delay ?? 0) / 1e6),
    })),
    status: data.Status ?? 0,
  });
}
