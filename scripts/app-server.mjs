// Serves the built Angular app and proxies /api to the streaming proxy.
//
// This replaces the Vite dev server for the Phase 4 reconnect check. Vite can
// keep a downstream SSE socket open after the upstream proxy dies, which makes
// the "network outage" evidence depend on a synthetic browser error. This
// server owns both sides: it serves the SPA itself and destroys the client
// response when the upstream stream errors or closes, so the browser sees the
// real outage when the streaming proxy is killed.
//
// Usage: APP_PORT=4300 PROXY_URL=http://127.0.0.1:3200 node scripts/app-server.mjs
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.APP_PORT ?? 4300);
const target = new URL(process.env.PROXY_URL ?? 'http://127.0.0.1:3200');

const configuredDist =
  process.env.WEB_DIST ?? join(here, '..', 'apps', 'web', 'dist', 'web');
const staticRoot = [configuredDist, join(configuredDist, 'browser')].find(
  (candidate) => existsSync(join(candidate, 'index.html')),
);
if (staticRoot === undefined) {
  console.error(
    `No built web app found under ${configuredDist}. Run: npm run build --workspace apps/web`,
  );
  process.exit(1);
}
const indexFile = join(staticRoot, 'index.html');

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function sendFile(request, response, filePath, cacheControl) {
  const extension = extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': MIME_TYPES.get(extension) ?? 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
    'Cache-Control': cacheControl,
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

function serveStatic(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://app').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const candidate = join(staticRoot, relative);
  const insideRoot =
    candidate === staticRoot || candidate.startsWith(staticRoot + sep);

  if (
    insideRoot &&
    relative.length > 0 &&
    existsSync(candidate) &&
    statSync(candidate).isFile()
  ) {
    sendFile(request, response, candidate, 'public, max-age=60');
    return;
  }

  // SPA route: every unknown path is the Angular shell. Hashed assets above
  // are served directly; a missing asset falls back here and will fail to
  // parse, which is visible in the browser instead of being masked.
  sendFile(request, response, indexFile, 'no-store');
}

function proxyApi(request, response) {
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers: request.headers,
      // Never reuse a keep-alive socket: an aborted SSE response would
      // otherwise poison the next request with leftover stream bytes.
      agent: false,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);

      upstreamResponse.on('error', () => response.destroy());
      upstreamResponse.on('aborted', () => response.destroy());
    },
  );

  upstream.on('error', () => {
    if (response.headersSent) {
      // The SSE headers already reached the browser. Destroying the socket is
      // the honest signal that the live stream is gone; a silent keep-open
      // would leave the screen showing "Connected" forever.
      response.destroy();
      return;
    }

    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(
      JSON.stringify({
        code: 'UPSTREAM_UNAVAILABLE',
        message: 'The streaming proxy is not reachable.',
      }),
    );
  });

  request.pipe(upstream);

  request.on('aborted', () => upstream.destroy());
  request.on('error', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  upstream.on('close', () => {
    if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  });
}

const server = http.createServer((request, response) => {
  const pathname = request.url ?? '/';

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    proxyApi(request, response);
    return;
  }

  serveStatic(request, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(
    `app server listening on ${port}; static=${staticRoot}; api=${target.origin}`,
  );
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
