import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';

type Bindings = {
  ENVIRONMENT: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Cache headers
app.use('*', async (c, next) => {
  await next();
  const url = new URL(c.req.url);
  
  if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$/)) {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (url.pathname.endsWith('.html') || url.pathname === '/' || !url.pathname.includes('.')) {
    c.header('Cache-Control', 'public, max-age=3600');
  } else if (url.pathname.endsWith('.json')) {
    c.header('Cache-Control', 'public, max-age=600');
  }
});

// Serve static files
app.use('*', serveStatic({
  root: './',
  rewriteRequestPath: (path) => {
    // Handle root path
    if (path === '/') {
      return '/index.html';
    }
    
    // Handle directory paths without trailing slash
    if (!path.includes('.') && !path.endsWith('/')) {
      return `${path}/index.html`;
    }
    
    // Handle directory paths with trailing slash
    if (path.endsWith('/')) {
      return `${path}index.html`;
    }
    
    return path;
  }
}));

// Health check endpoint
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: c.env?.ENVIRONMENT || 'development'
  });
});

export default app;