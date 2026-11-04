import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../../src/auth/auth.constants.js';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const distMainPath = fileURLToPath(new URL('../../dist/main.js', import.meta.url));

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ApiProcess {
  readonly port: number;
  readonly baseUrl: string;
  output(): string;
  waitForReady(timeoutMs?: number): Promise<void>;
  kill(signal?: NodeJS.Signals): Promise<ProcessExit>;
  stop(): Promise<void>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

export interface ApiSession {
  cookie: string;
  csrfToken: string;
  user: { id: string; email: string; role: string };
}

interface StartedProcess extends ApiProcess {
  child: ChildProcess;
}

/**
 * Starts the built API on a free loopback port. Running the deployable artifact
 * is deliberate: the TypeScript source path is not equivalent under loaders
 * that do not emit decorator metadata. `npm run build --workspace apps/api`
 * must run before this suite.
 */
export async function startApiProcess(
  options: { port?: number; label?: string } = {},
): Promise<ApiProcess> {
  if (!existsSync(distMainPath)) {
    throw new Error(
      'The process lifecycle tests require a built API. Run `npm run build --workspace apps/api` first.',
    );
  }

  const port = options.port ?? (await getFreePort());
  const args = [distMainPath];

  const child = spawn(process.execPath, args, {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'test',
      PROBEDESK_SKIP_DOTENV: '1',
      DATABASE_URL: requiredDatabaseUrl(),
      PORT: String(port),
      SESSION_COOKIE_SECURE: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = `[${options.label ?? 'api'}] entry=${distMainPath} port=${port}\n`;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    output += chunk;
  });

  let exit: ProcessExit | null = null;
  const exitPromise = new Promise<ProcessExit>((resolve) => {
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });

  const api: StartedProcess = {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    output: () => output,
    async waitForReady(timeoutMs = 20_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (exit) {
          throw new Error(
            `API process exited before readiness (${JSON.stringify(exit)}).\n${output}`,
          );
        }

        try {
          const response = await fetch(`${api.baseUrl}/api/health/ready`);
          if (response.status === 200) {
            return;
          }
        } catch {
          // The listener may not be open yet; retry until the deadline.
        }

        await delay(50);
      }

      throw new Error(
        `Timed out waiting for ${options.label ?? 'api'} readiness.\n${output}`,
      );
    },
    async kill(signal: NodeJS.Signals = 'SIGKILL'): Promise<ProcessExit> {
      if (!exit) {
        child.kill(signal);
      }
      return withTimeout(exitPromise, 10_000, 'API process exit');
    },
    async stop(): Promise<void> {
      if (!exit) {
        child.kill('SIGKILL');
      }
      await withTimeout(exitPromise, 10_000, 'API process cleanup');
    },
  };

  try {
    await api.waitForReady();
  } catch (error) {
    await api.stop();
    throw error;
  }
  return api;
}

export async function loginToApi(
  api: ApiProcess,
  email: string,
  password: string,
): Promise<ApiSession> {
  const response = await fetch(`${api.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: api.baseUrl,
    },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as {
    id?: string;
    email?: string;
    role?: string;
  };
  if (response.status !== 200 || !body.id || !body.email || !body.role) {
    throw new Error(
      `Login failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  const cookies = response.headers.getSetCookie();
  const sessionToken = readCookie(cookies, SESSION_COOKIE_NAME);
  const csrfToken = readCookie(cookies, CSRF_COOKIE_NAME);

  return {
    cookie: `${SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`,
    csrfToken,
    user: { id: body.id, email: body.email, role: body.role },
  };
}

export async function mutation(
  api: ApiProcess,
  session: ApiSession,
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown> | undefined,
  options: { idempotencyKey?: string; origin?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    Cookie: session.cookie,
    'X-XSRF-TOKEN': session.csrfToken,
    Origin: options.origin ?? api.baseUrl,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${api.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  return {
    status: response.status,
    body: await readJson(response),
    headers: response.headers,
  };
}

export async function readOnly(
  api: ApiProcess,
  session: ApiSession,
  path: string,
): Promise<ApiResponse> {
  const response = await fetch(`${api.baseUrl}${path}`, {
    headers: { Cookie: session.cookie },
  });

  return {
    status: response.status,
    body: await readJson(response),
    headers: response.headers,
  };
}

export async function waitFor<T>(
  predicate: () => Promise<T | null | false | undefined>,
  label: string,
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result !== null && result !== undefined && result !== false) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await delay(intervalMs);
  }

  const detail =
    lastError instanceof Error
      ? `: ${lastError.message}`
      : lastError !== null
        ? `: ${JSON.stringify(lastError)}`
        : '';

  throw new Error(`Timed out waiting for ${label}${detail}`);
}

function requiredDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must point at the isolated test database.');
  }
  return url;
}

function readCookie(cookies: readonly string[], name: string): string {
  for (const raw of cookies) {
    const [pair] = raw.split(';');
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator) !== name) {
      continue;
    }
    return decodeURIComponent(pair.slice(separator + 1));
  }

  throw new Error(`Expected Set-Cookie for ${name}`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not resolve a free loopback port.'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    timer.unref();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
