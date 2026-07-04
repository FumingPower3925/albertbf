import { runGo } from "./routes/run-go";
import { API_CSP, securityHeaders } from "./security";

/**
 * Thin worker: a couple of API routes, everything else falls through to
 * Workers Assets (which serves dist/ with headers from dist/_headers).
 */

interface Env {
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  RUN_RL?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", environment: env.ENVIRONMENT }),
        { headers: { "Content-Type": "application/json", ...securityHeaders(API_CSP) } },
      );
    }

    if (pathname === "/api/run/go") {
      return runGo(request, env);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
