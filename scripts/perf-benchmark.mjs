// Repeatable HTTP latency probe for the ProbeDesk read endpoints.
//
// This is a smoke guard, not a capacity or SLA claim. It logs in with a demo
// account, reads one plan and two runs from the target database, and reports
// p50/p95 latency for the endpoints the UI waits on. It exits non-zero when a
// p95 exceeds the reviewed smoke budget so a regression is visible in CI or a
// local check.
//
// Usage:
//   node scripts/perf-benchmark.mjs
//   PROBEDESK_BENCH_URL=http://127.0.0.1:3100/api \
//   PROBEDESK_BENCH_EMAIL=planner@probedesk.local \
//   PROBEDESK_BENCH_PASSWORD='PlannerDemo!2026' \
//   PROBEDESK_BENCH_ITERATIONS=50 node scripts/perf-benchmark.mjs
//
// The target must be a seeded database. Fewer than two runs in one plan skips
// the comparison case; an empty database fails the plan/run discovery step.
const baseUrl = (
  process.env.PROBEDESK_BENCH_URL ??
  process.argv[2] ??
  "http://127.0.0.1:8080/api"
).replace(/\/$/, "");
const email = process.env.PROBEDESK_BENCH_EMAIL ?? "planner@probedesk.local";
const password = process.env.PROBEDESK_BENCH_PASSWORD ?? "PlannerDemo!2026";
const iterations = Number(
  process.env.PROBEDESK_BENCH_ITERATIONS ?? process.argv[3] ?? 20,
);
const checkBudget = process.env.PROBEDESK_BENCH_ENFORCE === "1";

if (!Number.isInteger(iterations) || iterations < 1) {
  console.error("PROBEDESK_BENCH_ITERATIONS must be a positive integer.");
  process.exit(1);
}

let cookie = "";

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: {
      ...(cookie === "" ? {} : { cookie }),
      ...(init.body === undefined
        ? {}
        : { "content-type": "application/json" }),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${path} -> ${response.status} ${body.slice(0, 200).replace(/\s+/g, " ")}`,
    );
  }

  return response;
}

/** Timed GET; the body must be fully consumed so the measurement includes I/O. */
async function timed(path) {
  const started = process.hrtime.bigint();
  const response = await request(path);
  const body = await response.text();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, bytes: Buffer.byteLength(body) };
}

function percentile(sorted, p) {
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

async function measure(name, path, budgetMs) {
  // One untimed request warms the connection and the database cache before the
  // sample, matching the way a returning user hits the page.
  await timed(path);

  const samples = [];
  let bytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const result = await timed(path);
    samples.push(result.ms);
    bytes = result.bytes;
  }
  samples.sort((left, right) => left - right);

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const mean =
    samples.reduce((total, value) => total + value, 0) / samples.length;
  const verdict = p95 > budgetMs ? "OVER BUDGET" : "ok";

  console.log(
    `${name.padEnd(24)} p50=${p50.toFixed(1).padStart(7)}ms  ` +
      `p95=${p95.toFixed(1).padStart(7)}ms  mean=${mean.toFixed(1).padStart(7)}ms  ` +
      `size=${(bytes / 1024).toFixed(1).padStart(8)}kB  ` +
      `budget=${String(budgetMs).padStart(3)}ms  ${verdict}`,
  );

  return p95 > budgetMs;
}

async function login() {
  const response = await request("auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const session = setCookies
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("probedesk_session="));

  if (session === undefined) {
    throw new Error("Login succeeded without a session cookie.");
  }

  cookie = session;
  await response.text();
}

async function discoverFixture() {
  const plansResponse = await request("plans");
  const plans = await plansResponse.json();
  const plan = Array.isArray(plans) ? plans[0] : plans.items?.[0];

  if (plan === undefined || typeof plan.id !== "string") {
    throw new Error("No plan found. Seed the target database first.");
  }

  const runsResponse = await request(
    `runs?planId=${encodeURIComponent(plan.id)}&limit=2`,
  );
  const runs = await runsResponse.json();
  const items = Array.isArray(runs) ? runs : (runs.items ?? []);
  const runIds = items
    .map((run) => run.id)
    .filter((id) => typeof id === "string");

  return { planId: plan.id, runIds };
}

function overviewQuery(days) {
  const to = new Date(
    Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
    ),
  );
  const from = new Date(to.getTime() - days * 86_400_000);
  return new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  }).toString();
}

try {
  console.log(
    `ProbeDesk read benchmark: ${baseUrl}, ${iterations} requests per case, ` +
      `budget enforcement ${checkBudget ? "on" : "off"}.`,
  );
  await login();
  const { planId, runIds } = await discoverFixture();
  console.log(
    `Fixture: plan ${planId}, runs ${runIds.length === 0 ? "none" : runIds.join(", ")}.\n`,
  );

  const failures = [];
  const check = async (name, path, budgetMs) => {
    if (await measure(name, path, budgetMs)) {
      failures.push(name);
    }
  };

  await check("history default", "runs?limit=20", 200);
  await check("history 100", "runs?limit=100", 200);
  await check("history deep page", "runs?limit=20&page=50", 200);
  await check(
    "history plan filter",
    `runs?planId=${encodeURIComponent(planId)}&limit=20`,
    200,
  );
  await check("analytics 30d", `analytics/overview?${overviewQuery(30)}`, 200);
  await check(
    "analytics 365d",
    `analytics/overview?${overviewQuery(365)}`,
    250,
  );
  await check("plans list", "plans", 200);

  if (runIds[0] !== undefined) {
    await check("run snapshot", `runs/${runIds[0]}`, 200);
    await check("run report", `runs/${runIds[0]}/report`, 300);
  }

  if (runIds[0] !== undefined && runIds[1] !== undefined) {
    await check(
      "comparison",
      `comparisons?leftRunId=${runIds[0]}&rightRunId=${runIds[1]}`,
      400,
    );
  } else {
    console.log(
      "comparison               skipped (needs two runs in one plan)",
    );
  }

  if (checkBudget && failures.length > 0) {
    console.error(`\nBudget exceeded: ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll measured cases are within the smoke budget.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
