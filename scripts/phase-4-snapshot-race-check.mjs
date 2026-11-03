// P4-06 snapshot/event race check against a real API and PostgreSQL.
//
// For each iteration the script starts a NORMAL run, waits until the run is
// still RUNNING but has already recorded enough samples, reads a REST snapshot
// with cursor N, and immediately opens GET /api/runs/:id/events?after=N. It
// then proves that the stream starts at N+1, has no gap through the terminal
// event, and that the final REST snapshot agrees with the terminal event.
//
// Usage:
//   RUN_VERSION_ID=<published-plan-version-uuid> \
//     node scripts/phase-4-snapshot-race-check.mjs
//
// Environment:
//   PROBEDESK_API_URL  API origin (default http://127.0.0.1:3100)
//   RUN_VERSION_ID     Published plan version to execute (required)
//   RACE_ITERATIONS    Number of independent runs (default 3)
//   RACE_TARGETS       Comma-separated recorded-sample fractions, one per
//                      iteration (default 0.20,0.45,0.70)
//   RACE_SEED_BASE     First seed; iteration i uses base+i (default 31)
//   DATABASE_URL       Dev/test PostgreSQL URL used to remove the runs this
//                      script created (default: the documented dev database)
//   KEEP_RUNS=1        Keep the created runs and their rows instead of
//                      deleting them after the check
//
// The operator demo account is required. The script creates no sessions other
// than its own login and revokes that session at the end. It imports the
// workspace-hoisted `pg` package (apps/api dependency).
import { createHash } from 'node:crypto';
import pg from 'pg';

const BASE_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';
const VERSION_ID = process.env.RUN_VERSION_ID;
const ITERATIONS = Number(process.env.RACE_ITERATIONS ?? 3);
const TARGETS = (process.env.RACE_TARGETS ?? '0.20,0.45,0.70')
  .split(',')
  .map((value) => Number(value.trim()));
const SEED_BASE = Number(process.env.RACE_SEED_BASE ?? 31);
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://probedesk:probedesk@127.0.0.1:5434/probedesk?schema=public';
const KEEP_RUNS = process.env.KEEP_RUNS === '1';

if (!VERSION_ID) throw new Error('RUN_VERSION_ID is required');
if (!Number.isSafeInteger(ITERATIONS) || ITERATIONS < 1) {
  throw new Error('RACE_ITERATIONS must be a positive integer');
}
if (
  TARGETS.length < ITERATIONS ||
  TARGETS.some((value) => !(value > 0 && value < 1))
) {
  throw new Error(
    'RACE_TARGETS must contain one fraction between 0 and 1 per iteration',
  );
}

function createJar() {
  const cookies = new Map();
  function store(response) {
    for (const value of response.headers.getSetCookie?.() ?? []) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  async function request(method, path, body, extra = {}) {
    const headers = { Origin: BASE_URL, Accept: 'application/json', ...extra };
    if (cookies.size)
      headers.Cookie = [...cookies].map(([n, v]) => `${n}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = cookies.get('XSRF-TOKEN');
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    store(response);
    return response;
  }
  async function json(method, path, body, extra) {
    const response = await request(method, path, body, extra);
    const text = await response.text();
    return {
      status: response.status,
      data: text ? JSON.parse(text) : null,
      headers: response.headers,
    };
  }
  return {
    request,
    json,
    login: (email, password) =>
      json('POST', '/api/auth/login', { email, password }),
    cookieHeader: () => [...cookies].map(([n, v]) => `${n}=${v}`).join('; '),
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function parseFrames(buffer) {
  const frames = buffer.split('\n\n');
  const rest = frames.pop() ?? '';
  return {
    events: frames.map(parseFrame).filter(Boolean),
    rest,
  };
}

function parseFrame(raw) {
  const lines = raw.split('\n');
  const event = { id: null, event: null, data: null };
  for (const line of lines) {
    if (line.startsWith('id:')) event.id = Number(line.slice(3).trim());
    else if (line.startsWith('event:')) event.event = line.slice(6).trim();
    else if (line.startsWith('data:'))
      event.data = JSON.parse(line.slice(5).trim());
  }
  return event.event ? event : null;
}

async function readStream(api, runId, { after, maxMs = 90000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  const response = await fetch(
    `${BASE_URL}/api/runs/${runId}/events?after=${after}`,
    {
      headers: {
        Accept: 'text/event-stream',
        Origin: BASE_URL,
        Cookie: api.cookieHeader(),
      },
      signal: controller.signal,
    },
  );

  if (response.status !== 200) {
    clearTimeout(timer);
    return { status: response.status, body: await response.text(), events: [] };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseFrames(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        events.push(event);
        if (event.event.startsWith('run.') && event.event !== 'run.started') {
          terminal = true;
        }
      }
      if (terminal) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  return { status: response.status, events };
}

/**
 * Removes exactly the runs created by this script and their dependent rows.
 * The schema uses RESTRICT, so children are deleted explicitly in order.
 */
async function cleanupRuns(runIds) {
  if (runIds.length === 0) return { deleted: 0 };
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM measurements WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    await client.query(
      'DELETE FROM run_events WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    await client.query(
      'DELETE FROM run_steps WHERE "runId" = ANY($1::uuid[])',
      [runIds],
    );
    const deleted = await client.query(
      'DELETE FROM test_runs WHERE id = ANY($1::uuid[])',
      [runIds],
    );
    await client.query('COMMIT');
    return { deleted: deleted.rowCount ?? 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** Revokes only the session token this script received at login. */
async function revokeSessionToken(cookieHeader) {
  const match = /(?:^|;\s*)probedesk_session=([^;]+)/.exec(cookieHeader ?? '');
  if (!match) return 0;
  const tokenHash = createHash('sha256').update(match[1], 'utf8').digest('hex');
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      'UPDATE sessions SET "revokedAt" = now() WHERE "tokenHash" = $1 AND "revokedAt" IS NULL',
      [tokenHash],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

async function waitForSnapshot(api, runId, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const snapshot = await api.json('GET', `/api/runs/${runId}`);
    assert(snapshot.status === 200, `snapshot status ${snapshot.status}`);
    last = snapshot.data;
    if (predicate(last)) return last;
    await delay(40);
  }
  throw new Error(
    `Timed out waiting for a run snapshot state; last=${JSON.stringify({
      status: last?.status,
      recorded: last?.recordedSampleCount,
    })}`,
  );
}

async function waitForTerminalSnapshot(api, runId, timeoutMs = 30000) {
  return waitForSnapshot(
    api,
    runId,
    (snapshot) => snapshot.status !== 'RUNNING',
    timeoutMs,
  );
}

/**
 * Starts a run after the API's single-active-run slot is free. Other local
 * checks may be running against the same dev database, so a 409 is retried
 * instead of being reported as a product failure.
 */
async function startRun(api, body, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await api.json('GET', '/api/runs/active');
    assert(active.status === 200, `active-run status ${active.status}`);
    if (active.data === null) {
      const started = await api.json('POST', '/api/runs', body, {
        'Idempotency-Key': `snapshot-race-${crypto.randomUUID()}`,
      });
      if (started.status === 202) return started.data;
      if (started.status !== 409) {
        throw new Error(
          `start status ${started.status}: ${JSON.stringify(started.data)}`,
        );
      }
    }
    await delay(250);
  }
  throw new Error('The API never reported a free active-run slot');
}

async function raceIteration(api, index) {
  const target = TARGETS[index];
  const seed = SEED_BASE + index;
  const started = await startRun(api, {
    planVersionId: VERSION_ID,
    scenario: 'NORMAL',
    seed,
  });
  const runId = started.runId;

  const firstSnapshot = await waitForSnapshot(api, runId, () => true);
  const targetSamples = Math.max(
    1,
    Math.ceil(firstSnapshot.expectedSampleCount * target),
  );

  // Take the snapshot while the run is still executing. Polling is deliberate:
  // the cursor must be a real committed checkpoint, not a guessed sequence.
  const snapshot = await waitForSnapshot(
    api,
    runId,
    (candidate) =>
      candidate.status === 'RUNNING' &&
      candidate.recordedSampleCount >= targetSamples,
  );
  const cursor = snapshot.lastEventSequence;
  assert(
    snapshot.status === 'RUNNING',
    'snapshot was taken while the run was executing',
  );
  assert(cursor > 0, 'snapshot cursor is a committed sequence');

  // Immediately open the stream at the snapshot cursor. Any event that commits
  // between the snapshot transaction and this request must be replayed.
  const stream = await readStream(api, runId, { after: cursor });
  assert(stream.status === 200, `stream status ${stream.status}`);
  assert(stream.events.length > 0, 'stream delivered events');

  const first = stream.events[0];
  const terminal = stream.events.at(-1);
  assert(
    first.id === cursor + 1,
    `first stream event is ${cursor + 1} (got ${first.id})`,
  );
  assert(
    stream.events.every(
      (event, position) => event.id === cursor + 1 + position,
    ),
    'stream sequences are contiguous from the snapshot cursor',
  );
  assert(
    terminal.event.startsWith('run.') && terminal.event !== 'run.started',
    'stream ends with a terminal run event',
  );
  assert(
    stream.events.filter(
      (event) =>
        event.event.startsWith('run.') && event.event !== 'run.started',
    ).length === 1,
    'exactly one terminal run event',
  );

  const final = await waitForTerminalSnapshot(api, runId);
  const payload = terminal.data.payload;

  assert(
    final.status === payload.status,
    'final snapshot status matches terminal event',
  );
  assert(
    final.outcome === payload.outcome,
    'final snapshot outcome matches terminal event',
  );
  assert(
    final.recordedSampleCount === payload.recordedSampleCount,
    'final snapshot recorded count matches terminal event',
  );
  assert(
    final.expectedSampleCount === payload.expectedSampleCount,
    'final snapshot expected count matches terminal event',
  );
  assert(
    final.lastEventSequence === terminal.id,
    'final snapshot cursor matches terminal event',
  );
  assert(
    stream.events.length === terminal.id - cursor,
    'stream replay covers every sequence after the snapshot cursor',
  );

  const result = {
    iteration: index + 1,
    seed,
    runId,
    targetFraction: target,
    snapshotStatus: snapshot.status,
    snapshotRecordedSampleCount: snapshot.recordedSampleCount,
    snapshotSequence: cursor,
    streamFirstEvent: first.event,
    streamFirstSequence: first.id,
    streamEventCount: stream.events.length,
    terminalEvent: terminal.event,
    terminalSequence: terminal.id,
    finalStatus: final.status,
    finalOutcome: final.outcome,
    finalRecordedSampleCount: final.recordedSampleCount,
    finalExpectedSampleCount: final.expectedSampleCount,
    finalSequence: final.lastEventSequence,
    matchedTerminalEvent: true,
  };
  return result;
}

async function main() {
  const api = createJar();
  const login = await api.login(
    'operator@probedesk.local',
    'OperatorDemo!2026',
  );
  assert(login.status === 200, 'operator login');

  const createdRunIds = [];
  const results = [];
  try {
    for (let index = 0; index < ITERATIONS; index += 1) {
      const result = await raceIteration(api, index);
      createdRunIds.push(result.runId);
      results.push(result);
      console.log(`RACE_ITERATION ${JSON.stringify(result)}`);
    }
  } finally {
    if (!KEEP_RUNS) {
      const cleanup = await cleanupRuns(createdRunIds);
      console.log(
        `CLEANUP ${JSON.stringify({ runs: createdRunIds.length, deleted: cleanup.deleted })}`,
      );
    } else {
      console.log(`CLEANUP skipped; created runs: ${createdRunIds.join(', ')}`);
    }
    const revoked = await revokeSessionToken(api.cookieHeader());
    console.log(`SESSION_REVOKED ${revoked}`);
  }

  console.log(
    JSON.stringify(
      {
        iterations: results.length,
        targets: TARGETS.slice(0, results.length),
        allFirstEventsAfterCursor: results.every(
          (result) =>
            result.streamFirstSequence === result.snapshotSequence + 1,
        ),
        allStreamsContiguous: true,
        allTerminalEventsMatchedFinalSnapshot: results.every(
          (result) => result.matchedTerminalEvent,
        ),
        results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
