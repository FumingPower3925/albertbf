import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';

type Bindings = {
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Security headers
app.use('*', async (c, next) => {

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ');

  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Content-Security-Policy', csp);
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
});

// Conditional Cache headers
app.use('*', async (c, next) => {
  await next();
  const url = new URL(c.req.url);

  if (c.env.ENVIRONMENT === 'development') {
    if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
      c.header('Cache-Control', 'no-cache');
    }
  } else {
    if (url.pathname.endsWith('.html') || url.pathname === '/' || !url.pathname.includes('.')) {
      c.header('Cache-Control', 'public, max-age=3600');
    } else if (url.pathname.endsWith('.json')) {
      c.header('Cache-Control', 'public, max-age=600');
    }
  }
});

// Development-only static file serving
app.use('*', (c, next) => {
  if (c.env.ENVIRONMENT === 'development') {
    return serveStatic({
      root: './',
      rewriteRequestPath: (path) => {
        if (path === '/') return '/index.html';
        if (!path.includes('.') && !path.endsWith('/')) return `${path}/index.html`;
        if (path.endsWith('/')) return `${path}index.html`;
        return path;
      }
    })(c, next);
  }
  return next();
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env?.ENVIRONMENT || 'unknown'
  });
});

export default app;