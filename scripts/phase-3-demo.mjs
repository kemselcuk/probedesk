// Phase 3 demo: NORMAL, FORCED_FAILURE, cancel and run-again against a real API.
// Usage: RUN_VERSION_ID=<published revision uuid> node scripts/phase-3-demo.mjs
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

  async function request(method, path, body, extraHeaders = {}) {
    const headers = { Origin: BASE_URL, Accept: 'application/json', ...extraHeaders };
    if (cookies.size > 0) {
      headers.Cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const csrf = cookies.get('XSRF-TOKEN');
    if (csrf) headers['X-XSRF-TOKEN'] = csrf;

    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    store(response);
    const text = await response.text();
    let data = null;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, data };
  }

  return {
    login: (email, password) => request('POST', '/api/auth/login', { email, password }),
    get: (path) => request('GET', path),
    post: (path, body, headers) => request('POST', path, body, headers),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTerminal(api, runId, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await api.get(`/api/runs/${runId}`);
    assert(snapshot.status === 200, `snapshot ${snapshot.status}`);
    if (snapshot.data.status !== 'RUNNING') return snapshot.data;
    await delay(400);
  }
  throw new Error(`Run ${runId} did not finish in time`);
}

async function startRun(api, body, key) {
  const response = await api.post('/api/runs', body, { 'Idempotency-Key': key });
  return response;
}

function makeKey(label) {
  return `phase3-${label}-${crypto.randomUUID()}`;
}

async function main() {
  const operator = createJar();
  const login = await operator.login('operator@probedesk.local', 'OperatorDemo!2026');
  assert(login.status === 200, `operator login ${login.status}`);

  const versionResponse = await operator.get(`/api/plan-versions/${VERSION_ID}`);
  assert(versionResponse.status === 200, `version ${versionResponse.status}`);
  const version = versionResponse.data;
  const currentDraw = version.steps.find((step) => step.name === 'Current Draw');
  assert(currentDraw, 'Current Draw step exists');

  // 1. NORMAL run -> PASSED, all 90 samples.
  const normalBody = { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 20261103 };
  const normalKey = makeKey('normal');
  const normalStart = await startRun(operator, normalBody, normalKey);
  assert(normalStart.status === 202, `normal start ${normalStart.status}`);
  const normal = await waitForTerminal(operator, normalStart.data.runId);
  assert(normal.status === 'COMPLETED' && normal.outcome === 'PASSED', `normal outcome ${normal.status}/${normal.outcome}`);
  assert(normal.expectedSampleCount === 90 && normal.recordedSampleCount === 90, 'normal counts');
  assert(normal.steps.every((step) => step.status === 'COMPLETED' && step.outcome === 'PASSED'), 'all steps passed');
  assert(normal.steps.every((step) => step.measurements.length === step.sampleCount), 'all measurements stored');
  assert(normal.lastEventSequence === 98, `normal event count ${normal.lastEventSequence}`);

  // Idempotent replay returns the same run.
  const replay = await startRun(operator, normalBody, normalKey);
  assert(replay.status === 200 && replay.data.runId === normal.id, 'idempotent replay');

  // 2. FORCED_FAILURE on Current Draw -> exactly sample 14 = 0.600000, later step continues.
  const forcedBody = {
    planVersionId: VERSION_ID,
    scenario: 'FORCED_FAILURE',
    seed: 20261103,
    failureStepId: currentDraw.logicalStepId,
  };
  const forcedStart = await startRun(operator, forcedBody, makeKey('forced'));
  assert(forcedStart.status === 202, `forced start ${forcedStart.status}`);
  const forced = await waitForTerminal(operator, forcedStart.data.runId);
  assert(forced.status === 'COMPLETED' && forced.outcome === 'FAILED', `forced outcome ${forced.outcome}`);
  const forcedCurrent = forced.steps.find((step) => step.name === 'Current Draw');
  assert(forcedCurrent.outcome === 'FAILED', 'current draw failed');
  assert(forcedCurrent.firstFailureSampleIndex === 14, 'first failure index');
  assert(forcedCurrent.measurements[14].value === '0.600000', '0.600000 failure value');
  assert(forcedCurrent.measurements[14].isWithinTolerance === false, 'failure flagged');
  assert(forcedCurrent.measurements.filter((m) => m.isWithinTolerance === false).length === 1, 'single violation');
  const laterStep = forced.steps.find((step) => step.name === 'Output Voltage');
  assert(laterStep.status === 'COMPLETED', 'next step still ran');
  assert(forced.steps.filter((step) => step.status === 'COMPLETED').length === 3, 'all steps completed');

  // 3. Cancel a RUNNING run: partial samples preserved, pending steps NOT_RUN.
  const cancelStart = await startRun(
    operator,
    { planVersionId: VERSION_ID, scenario: 'NORMAL', seed: 7 },
    makeKey('cancel'),
  );
  assert(cancelStart.status === 202, `cancel start ${cancelStart.status}`);
  let partial;
  for (let i = 0; i < 200; i += 1) {
    partial = await operator.get(`/api/runs/${cancelStart.data.runId}`);
    if (partial.data.recordedSampleCount > 0) break;
    await delay(100);
  }
  assert(partial.data.recordedSampleCount > 0, 'at least one sample before cancel');
  const cancelResponse = await operator.post(`/api/runs/${cancelStart.data.runId}/cancel`, undefined);
  assert(cancelResponse.status === 200, `cancel ${cancelResponse.status}`);
  const cancelled = cancelResponse.data;
  assert(cancelled.status === 'CANCELLED' && cancelled.outcome === null, 'cancelled status');
  assert(cancelled.recordedSampleCount > 0 && cancelled.recordedSampleCount < 90, 'partial samples kept');
  const cancelledSteps = cancelled.steps.filter((step) => step.status === 'CANCELLED').length;
  const notRunSteps = cancelled.steps.filter((step) => step.status === 'NOT_RUN').length;
  assert(cancelledSteps === 1 && notRunSteps === 2, `cancelled/not-run ${cancelledSteps}/${notRunSteps}`);
  const repeatedCancel = await operator.post(`/api/runs/${cancelStart.data.runId}/cancel`, undefined);
  assert(repeatedCancel.status === 200 && repeatedCancel.data.status === 'CANCELLED', 'repeated cancel idempotent');

  // 4. Run Again: new key -> new run, original record unchanged.
  const rerun = await startRun(operator, normalBody, makeKey('rerun'));
  assert(rerun.status === 202 && rerun.data.runId !== normal.id, 'run again creates a new run');
  const original = await operator.get(`/api/runs/${normal.id}`);
  assert(original.data.status === 'COMPLETED' && original.data.recordedSampleCount === 90, 'original preserved');
  await operator.post(`/api/runs/${rerun.data.runId}/cancel`, undefined);

  console.log(
    JSON.stringify(
      {
        versionId: VERSION_ID,
        normal: {
          runId: normal.id,
          status: normal.status,
          outcome: normal.outcome,
          samples: normal.recordedSampleCount,
          lastEventSequence: normal.lastEventSequence,
        },
        forcedFailure: {
          runId: forced.id,
          outcome: forced.outcome,
          failureStep: forcedCurrent.name,
          failureSampleIndex: forcedCurrent.firstFailureSampleIndex,
          failureValue: forcedCurrent.measurements[14].value,
          completedSteps: forced.steps.map((step) => `${step.name}:${step.status}/${step.outcome}`),
        },
        cancelled: {
          runId: cancelled.id,
          recorded: cancelled.recordedSampleCount,
          steps: cancelled.steps.map((step) => `${step.name}:${step.status}`),
        },
        rerunRunId: rerun.data.runId,
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
