// Repeatable Phase 2 integration demo against a running API.
// Usage: PROBEDESK_API_URL=http://127.0.0.1:3100 node scripts/phase-2-demo.mjs
const BASE_URL = process.env.PROBEDESK_API_URL ?? 'http://127.0.0.1:3100';

function createJar() {
  const cookies = new Map();

  function store(response) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      if (index > 0) {
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  async function request(method, path, body) {
    const headers = { Origin: BASE_URL, Accept: 'application/json' };
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
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

const STEP_FIELDS = ['logicalStepId', 'name', 'unit', 'minimum', 'maximum', 'sampleCount', 'intervalMs'];
const pickStep = (step) => Object.fromEntries(STEP_FIELDS.map((key) => [key, step[key]]));

function step(logicalStepId, name, unit, minimum, maximum) {
  return { logicalStepId, name, unit, minimum, maximum, sampleCount: 30, intervalMs: 200 };
}

async function main() {
  const planner = createJar();
  const viewer = createJar();

  const plannerLogin = await planner.login('planner@probedesk.local', 'PlannerDemo!2026');
  assert(plannerLogin.status === 200, `planner login ${plannerLogin.status}`);
  const viewerLogin = await viewer.login('viewer@probedesk.local', 'ViewerDemo!2026');
  assert(viewerLogin.status === 200, `viewer login ${viewerLogin.status}`);

  const profiles = await planner.get('/api/device-profiles');
  assert(profiles.status === 200 && profiles.data.length === 1, 'single device profile');
  const profileId = profiles.data[0].id;

  const created = await planner.post('/api/plans', {
    name: 'Power Supply Validation',
    profileId,
  });
  assert(created.status === 201, `create plan ${created.status}`);
  const planId = created.data.id;
  assert(created.data.draft.editRevision === 1, 'new draft revision 1');

  const save = async (steps, expectedRevision) => {
    const response = await planner.put(`/api/plans/${planId}/draft`, {
      name: 'Power Supply Validation',
      expectedRevision,
      steps,
    });
    return response;
  };

  const voltage = step('', 'Output Voltage', 'V', '4.75', '5.25');
  const current = step('', 'Current Draw', 'A', '0.45', '0.55');
  const temperature = step('', 'Case Temperature', '°C', '20', '60');

  const firstSave = await save([voltage, current, temperature], 1);
  assert(firstSave.status === 200, `first save ${firstSave.status}`);
  assert(firstSave.data.editRevision === 2, 'editRevision 2');
  assert(firstSave.data.steps.every((s) => s.logicalStepId.length > 0), 'ids assigned');
  assert(firstSave.data.steps[0].minimum === '4.750000', 'canonical decimal');
  const ids = firstSave.data.steps.map((s) => s.logicalStepId);
  assert(new Set(ids).size === 3, 'unique logical ids');

  // Reorder by sending the authoritative array order.
  const reordered = [temperature, voltage, current].map((s, index) => ({
    ...s,
    logicalStepId: ids[[2, 0, 1][index]],
  }));
  const reorderSave = await save(reordered, 2);
  assert(reorderSave.status === 200, `reorder save ${reorderSave.status}`);
  const detailAfterReorder = await planner.get(`/api/plans/${planId}`);
  assert(
    detailAfterReorder.data.draft.steps.map((s) => s.name).join('|') ===
      'Case Temperature|Output Voltage|Current Draw',
    'order persisted',
  );

  const publishV1 = await planner.post(`/api/plans/${planId}/draft/publish`, {
    expectedRevision: 3,
  });
  assert(publishV1.status === 201, `publish v1 ${publishV1.status}`);
  assert(publishV1.data.versionNumber === 1, 'v1 number');
  const v1Id = publishV1.data.id;
  const v1LogicalIds = publishV1.data.steps.map((s) => s.logicalStepId);

  const detailAfterPublish = await planner.get(`/api/plans/${planId}`);
  assert(detailAfterPublish.data.draft == null, 'no open draft after publish');

  const newDraft = await planner.post(`/api/plans/${planId}/drafts`);
  assert(newDraft.status === 201, `new draft ${newDraft.status}`);
  assert(newDraft.data.editRevision === 1, 'new draft revision 1');
  assert(newDraft.data.baseVersionId === v1Id, 'new draft base version');
  assert(
    newDraft.data.steps.map((s) => s.logicalStepId).join(',') === v1LogicalIds.join(','),
    'logical ids preserved in clone',
  );

  const editedSteps = newDraft.data.steps.map((s) =>
    s.name === 'Current Draw' ? { ...pickStep(s), maximum: '0.6' } : pickStep(s),
  );
  const secondSave = await save(editedSteps, 1);
  assert(secondSave.status === 200 && secondSave.data.editRevision === 2, 'edit new draft');

  // Stale revision: an older expectedRevision must not overwrite anything.
  const stale = await save(editedSteps, 1);
  assert(stale.status === 409, `stale save ${stale.status}`);
  const afterStale = await planner.get(`/api/plans/${planId}`);
  assert(afterStale.data.draft.editRevision === 2, 'stale save changed nothing');

  const publishV2 = await planner.post(`/api/plans/${planId}/draft/publish`, {
    expectedRevision: 2,
  });
  assert(publishV2.status === 201 && publishV2.data.versionNumber === 2, 'publish v2');
  const v2Id = publishV2.data.id;

  const v1 = await viewer.get(`/api/plan-versions/${v1Id}`);
  const v2 = await viewer.get(`/api/plan-versions/${v2Id}`);
  const v1Current = v1.data.steps.find((s) => s.name === 'Current Draw');
  const v2Current = v2.data.steps.find((s) => s.name === 'Current Draw');
  assert(v1.status === 200 && v1.data.versionNumber === 1, 'v1 readable');
  assert(v1Current.maximum === '0.550000', 'v1 keeps its own tolerance');
  assert(v2Current.maximum === '0.600000', 'v2 has the edited tolerance');
  assert(
    v1.data.steps.map((s) => s.name).join('|') === 'Case Temperature|Output Voltage|Current Draw',
    'v1 order unchanged',
  );

  const versions = await planner.get(`/api/plans/${planId}/versions`);
  assert(
    versions.data.map((v) => v.versionNumber).join(',') === '2,1',
    'versions newest first',
  );

  // Role enforcement and draft leakage.
  const viewerSave = await viewer.put(`/api/plans/${planId}/draft`, {
    name: 'Nope',
    expectedRevision: 1,
    steps: [],
  });
  const viewerCreate = await viewer.post('/api/plans', { name: 'Nope', profileId });
  const viewerPublish = await viewer.post(`/api/plans/${planId}/draft/publish`, {
    expectedRevision: 1,
  });
  const viewerDetail = await viewer.get(`/api/plans/${planId}`);
  assert(viewerSave.status === 403, `viewer save ${viewerSave.status}`);
  assert(viewerCreate.status === 403, `viewer create ${viewerCreate.status}`);
  assert(viewerPublish.status === 403, `viewer publish ${viewerPublish.status}`);
  assert(viewerDetail.status === 200, 'viewer reads published plan');
  assert(!('draft' in viewerDetail.data) || viewerDetail.data.draft === null, 'no draft leakage');

  console.log(
    JSON.stringify(
      {
        planId,
        planName: 'Power Supply Validation',
        v1Id,
        v2Id,
        steps: v1.data.steps.map((s) => ({
          name: s.name,
          unit: s.unit,
          min: s.minimum,
          max: s.maximum,
          samples: s.sampleCount,
          intervalMs: s.intervalMs,
        })),
        checks: {
          reorderPersisted: true,
          staleRejected: stale.data.code,
          viewerSave: viewerSave.data.code,
          viewerPublish: viewerPublish.data.code,
          v1Tolerance: v1Current.maximum,
          v2Tolerance: v2Current.maximum,
        },
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
