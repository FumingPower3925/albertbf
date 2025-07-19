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

// Handle 404s with a custom page
app.notFound((c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>404 - Page Not Found</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #333;
        }
        
        .container {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 20px;
          padding: 3rem;
          text-align: center;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
          max-width: 500px;
          width: 90%;
        }
        
        h1 {
          font-size: 4rem;
          font-weight: 700;
          color: #fff;
          margin-bottom: 1rem;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        }
        
        p {
          font-size: 1.2rem;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 2rem;
          line-height: 1.6;
        }
        
        .btn {
          display: inline-block;
          padding: 12px 30px;
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
          text-decoration: none;
          border-radius: 50px;
          border: 1px solid rgba(255, 255, 255, 0.3);
          font-weight: 500;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
        }
        
        .btn:hover {
          background: rgba(255, 255, 255, 0.3);
          transform: translateY(-2px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>404</h1>
        <p>The page you're looking for doesn't exist.</p>
        <a href="/" class="btn">Go Home</a>
      </div>
    </body>
    </html>
  `, 404);
});

export default app;