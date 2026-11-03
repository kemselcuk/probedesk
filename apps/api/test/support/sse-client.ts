import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';

export interface SseFrame {
  readonly id: string | null;
  readonly event: string | null;
  readonly data: string | null;
  readonly comments: readonly string[];
  readonly raw: string;
}

export interface OpenSseOptions {
  readonly cookie?: string;
  readonly lastEventId?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Minimal real-HTTP SSE client for integration tests. Supertest buffers until
 * the response ends, so it cannot observe replay/live frames or heartbeats.
 */
export class SseConnection {
  readonly frames: SseFrame[] = [];
  readonly comments: string[] = [];
  readonly closed: Promise<void>;
  statusCode = 0;
  headers: IncomingHttpHeaders = {};
  streamError: Error | null = null;

  private buffer = '';
  private closedFlag = false;
  private resolveClosed!: () => void;
  private readonly request: http.ClientRequest;

  constructor(
    request: http.ClientRequest,
    response: http.IncomingMessage,
  ) {
    this.request = request;
    this.statusCode = response.statusCode ?? 0;
    this.headers = response.headers;

    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });

    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      this.consume(chunk);
    });
    response.on('end', () => {
      this.flushPendingFrame();
      this.finish();
    });
    response.on('close', () => {
      this.flushPendingFrame();
      this.finish();
    });
    response.on('error', (error: Error) => {
      this.streamError = error;
      this.finish();
    });
  }

  abort(): void {
    this.request.destroy();
  }

  async waitForFrameCount(count: number, timeoutMs = 5_000): Promise<void> {
    await waitUntil(
      () => this.frames.length >= count,
      `SSE stream to receive ${count} frames`,
      timeoutMs,
    );
  }

  async waitForEventCount(count: number, timeoutMs = 5_000): Promise<void> {
    await waitUntil(
      () => this.frames.filter((frame) => frame.id !== null).length >= count,
      `SSE stream to receive ${count} domain events`,
      timeoutMs,
    );
  }

  async waitForComment(comment: string, timeoutMs = 5_000): Promise<void> {
    await waitUntil(
      () => this.comments.some((value) => value.includes(comment)),
      `SSE heartbeat comment "${comment}"`,
      timeoutMs,
    );
  }

  async waitForClose(timeoutMs = 5_000): Promise<void> {
    await waitUntil(
      () => this.closedFlag,
      'the SSE stream to close',
      timeoutMs,
    );
  }

  get isClosed(): boolean {
    return this.closedFlag;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;

    for (;;) {
      const separator = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!separator) {
        return;
      }

      const raw = this.buffer.slice(0, separator.index);
      this.buffer = this.buffer.slice(separator.index + separator[0].length);
      this.pushFrame(raw);
    }
  }

  private flushPendingFrame(): void {
    if (this.buffer.trim().length > 0) {
      const raw = this.buffer;
      this.buffer = '';
      this.pushFrame(raw);
    }
    this.buffer = '';
  }

  private pushFrame(raw: string): void {
    if (raw.trim().length === 0) {
      return;
    }

    let id: string | null = null;
    let event: string | null = null;
    const dataLines: string[] = [];
    const comments: string[] = [];

    for (const line of raw.split(/\r\n|\n|\r/)) {
      if (line.length === 0) {
        continue;
      }

      if (line.startsWith(':')) {
        const comment = line.slice(1).trimStart();
        comments.push(comment);
        this.comments.push(comment);
        continue;
      }

      const separator = line.indexOf(':');
      const field = separator === -1 ? line : line.slice(0, separator);
      let value = separator === -1 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }

      switch (field) {
        case 'id':
          id = value;
          break;
        case 'event':
          event = value;
          break;
        case 'data':
          dataLines.push(value);
          break;
        default:
          break;
      }
    }

    this.frames.push({
      id,
      event,
      data: dataLines.length > 0 ? dataLines.join('\n') : null,
      comments,
      raw,
    });
  }

  private finish(): void {
    if (this.closedFlag) {
      return;
    }

    this.closedFlag = true;
    this.resolveClosed();
  }
}

/** Opens a streaming response and resolves as soon as its headers arrive. */
export function openSse(
  url: string,
  options: OpenSseOptions = {},
): Promise<SseConnection> {
  const target = new URL(url);
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    ...options.headers,
  };

  if (options.cookie) {
    headers.Cookie = options.cookie;
  }
  if (options.lastEventId !== undefined) {
    headers['Last-Event-ID'] = options.lastEventId;
  }

  return new Promise<SseConnection>((resolve, reject) => {
    let settled = false;
    const headerTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        request.destroy();
        reject(new Error('Timed out waiting for SSE response headers.'));
      }
    }, 5_000);

    const request = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers,
        agent: false,
      },
      (response) => {
        if (settled) {
          response.resume();
          return;
        }

        settled = true;
        clearTimeout(headerTimer);
        resolve(new SseConnection(request, response));
      },
    );

    request.on('error', (error: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(headerTimer);
        reject(error);
      }
    });
    request.end();
  });
}

async function waitUntil(
  predicate: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (predicate()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
