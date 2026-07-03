/**
 * Single source of truth for security headers. Used by:
 *  - the build (emits dist/_headers so Workers Assets serves headers on static pages)
 *  - the worker (applies the same headers to API responses)
 */

export function buildCsp(themeScriptHash: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' '${themeScriptHash}' 'wasm-unsafe-eval' https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com",
    "worker-src 'self' blob:",
    "frame-src https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function securityHeaders(csp?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
  if (csp) headers["Content-Security-Policy"] = csp;
  return headers;
}

/** Renders the _headers file consumed by Cloudflare Workers Assets. */
export function renderHeadersFile(themeScriptHash: string): string {
  const lines: string[] = ["/*"];
  const all = { ...securityHeaders(buildCsp(themeScriptHash)) };
  for (const [name, value] of Object.entries(all)) {
    lines.push(`  ${name}: ${value}`);
  }
  lines.push("");
  for (const dir of ["/assets/*", "/fonts/*", "/vendor/*"]) {
    lines.push(dir, "  Cache-Control: public, max-age=31536000, immutable", "");
  }
  return lines.join("\n");
}
