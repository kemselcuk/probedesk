// Minimal streaming HTTP proxy used by the Phase 4 reconnect check.
// Usage: PROXY_PORT=3200 API_URL=http://127.0.0.1:3100 node scripts/sse-proxy.mjs
import http from 'node:http';

const port = Number(process.env.PROXY_PORT ?? 3200);
const target = new URL(process.env.API_URL ?? 'http://127.0.0.1:3100');

const server = http.createServer((request, response) => {
  const headers = { ...request.headers };
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: request.url,
      method: request.method,
      headers,
      // Never reuse a keep-alive socket: an aborted SSE response would
      // otherwise poison the next request with leftover stream bytes.
      agent: false,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
  });

  request.pipe(upstream);

  request.on('aborted', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  upstream.on('close', () => {
    if (!response.writableEnded) response.end();
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`proxy listening on ${port} -> ${target.origin}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
