// Phase 4 SSE integration check against a real API.
// Usage: node scripts/phase-4-sse-check.mjs
const BASE_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';
const VERSION_ID = process.env.RUN_VERSION_ID;

if (!VERSION_ID) throw new Error('RUN_VERSION_ID is required');

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
    if (cookies.size) headers.Cookie = [...cookies].map(([n, v]) => `${n}=${v}`).join('; ');
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
    return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  }
  return {
    request,
    json,
    login: (email, password) => json('POST', '/api/auth/login', { email, password }),
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
    else if (line.startsWith('data:')) event.data = JSON.parse(line.slice(5).trim());
  }
  return event.event ? event : null;
}

async function readStream(api, runId, { after, lastEventId, stopAfterTerminal = true, maxMs = 90000 }) {
  const headers = {
    Accept: 'text/event-stream',
    Origin: BASE_URL,
    Cookie: api.cookieHeader(),
  };
  const query = after === undefined ? '' : `?after=${after}`;
  if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  const response = await fetch(`${BASE_URL}/api/runs/${runId}/events${query}`, {
    headers,
    signal: controller.signal,
  });

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
      if (terminal && stopAfterTerminal) {
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

async function main() {
  const api = createJar();
  const login = await api.login('operator@probedesk.local', 'OperatorDemo!2026');
  assert(login.status === 200, 'operator login');

  const start = await api.json(
    'POST',
    '/api/runs',
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 11 },
    { 'Idempotency-Key': `sse-check-${crypto.randomUUID()}` },
  );
  assert(start.status === 202, `start ${start.status}`);
  const runId = start.data.runId;

  const live = await readStream(api, runId, { after: 0 });
  assert(live.status === 200, 'stream status');
  assert(live.events.length > 0, 'events received');
  const sequences = live.events.map((event) => event.id);
  assert(
    sequences.every((value, index) => index === 0 || value === sequences[index - 1] + 1),
    'gap-free live sequence',
  );
  assert(live.events[0].event === 'run.started', 'first event run.started');
  assert(live.events.at(-1).event === 'run.completed', 'last event run.completed');
  const terminalEvent = live.events.at(-1);

  const snapshot = await api.json('GET', `/api/runs/${runId}`);
  assert(snapshot.data.status === 'COMPLETED', 'run completed');
  assert(snapshot.data.outcome === 'PASSED', 'run passed');
  assert(snapshot.data.lastEventSequence === terminalEvent.id, 'snapshot cursor matches stream');
  assert(snapshot.data.recordedSampleCount === 90, '90 samples');

  // Replay from the middle.
  const mid = Math.floor(terminalEvent.id / 2);
  const replay = await readStream(api, runId, { after: mid });
  assert(replay.status === 200, 'replay status');
  assert(replay.events[0].id === mid + 1, 'replay starts after cursor');
  assert(replay.events.at(-1).id === terminalEvent.id, 'replay reaches terminal');

  // Last-Event-ID takes precedence over after.
  const headerReplay = await readStream(api, runId, { after: 0, lastEventId: 5 });
  assert(headerReplay.events[0].id === 6, 'Last-Event-ID precedence');

  // Terminal run with no backlog returns 204.
  const empty = await readStream(api, runId, { after: terminalEvent.id });
  assert(empty.status === 204, `terminal no backlog ${empty.status}`);

  // Invalid cursor is rejected before the stream opens.
  const invalid = await api.request('GET', `/api/runs/${runId}/events?after=-1`);
  assert(invalid.status === 400, `invalid cursor ${invalid.status}`);
  const future = await api.request('GET', `/api/runs/${runId}/events?after=99999`);
  assert(future.status === 400, `future cursor ${future.status}`);

  console.log(
    JSON.stringify(
      {
        runId,
        eventCount: live.events.length,
        firstEvent: live.events[0].event,
        lastEvent: terminalEvent.event,
        lastSequence: terminalEvent.id,
        snapshotSequence: snapshot.data.lastEventSequence,
        recordedSampleCount: snapshot.data.recordedSampleCount,
        replayFrom: mid,
        replayEventCount: replay.events.length,
        lastEventIdPrecedence: headerReplay.events[0].id,
        terminalNoBacklogStatus: empty.status,
        invalidCursorStatus: invalid.status,
        futureCursorStatus: future.status,
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
