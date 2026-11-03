import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const mainPath = fileURLToPath(new URL('../src/main.ts', import.meta.url));

function startWithoutConfiguration(environment: Record<string, string>): {
  output: string;
  status: number | null;
} {
  const result = spawnSync(process.execPath, [tsxCli, mainPath], {
    cwd: apiRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PROBEDESK_SKIP_DOTENV: '1',
      NODE_ENV: 'test',
      ...environment,
    },
    encoding: 'utf8',
    timeout: 30_000,
  });

  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status,
  };
}

describe('application startup (e2e)', () => {
  it('stops with a clear English message when critical configuration is missing', () => {
    const { output, status } = startWithoutConfiguration({
      PORT: 'not-a-port',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('Invalid environment configuration');
    expect(output).toContain('DATABASE_URL');
    expect(output).toContain('PORT');
    expect(output).not.toContain('not-a-port');
    expect(output).not.toContain('at bootstrap');
  });

  it('does not echo secret values while refusing to start', () => {
    const { output, status } = startWithoutConfiguration({
      PORT: 'not-a-port',
      DATABASE_URL:
        'mysql://probedesk:supersecret@127.0.0.1:3306/probedesk?schema=public',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('DATABASE_URL');
    expect(output).not.toContain('supersecret');
    expect(output).not.toContain('not-a-port');
  });

  it('refuses to start production with an insecure session cookie', () => {
    const { output, status } = startWithoutConfiguration({
      NODE_ENV: 'production',
      PORT: '3999',
      DATABASE_URL:
        'postgresql://probedesk:supersecret@127.0.0.1:5432/probedesk?schema=public',
      SESSION_COOKIE_SECURE: 'false',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('Invalid environment configuration');
    expect(output).toContain('SESSION_COOKIE_SECURE');
    expect(output).toContain('production');
    expect(output).not.toContain('supersecret');
    expect(output).not.toContain('Listening');
  });
});
