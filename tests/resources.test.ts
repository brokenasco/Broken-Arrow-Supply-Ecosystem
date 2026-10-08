import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, id, now } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { ResourceService } from "../src/resources.ts";
import { dollars, calculateCost, budgetStatus } from "../src/resource-money.ts";
import { createApp } from "../src/server.ts";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function fixture(path = ":memory:") {
  const db = openDatabase(path),
    u = provision(
      db,
      "resources@example.test",
      "synthetic-resource-password",
      "SIMULATION resources",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" },
    s = new ResourceService(db, p);
  s.clock = () => new Date("2026-10-15T12:00:00Z");
  const project = id(),
    task = id();
  db.prepare(
    "INSERT INTO projects(id,company_id,name,objective,owner,status,created_at) VALUES(?,?,?,?,'boris','ACTIVE',?)",
  ).run(project, u.company, "Synthetic task", "Synthetic evidence", now());
  db.prepare(
    "INSERT INTO tasks(id,company_id,project_id,agent_id,objective,status,expected_output,created_at) VALUES(?,?,?,'mason',?,'QUEUED',?,?)",
  ).run(task, u.company, project, "Budget test", "Synthetic output", now());
  const price = {
    provider: "TEST",
    modelId: "fixture-model",
    displayName: "Synthetic test price",
    inputUsdPerMillion: "1",
    cachedUsdPerMillion: "0.1",
    outputUsdPerMillion: "2",
    source:
      "Synthetic fixture, not market pricing; input includes cache; reasoning separate only if billed separately",
    effectiveAt: "2026-10-01T00:00:00Z",
    active: true,
    confirm: true,
  };
  s.pricing(price);
  s.setTaskLimits({
    taskId: task,
    maxCostUsd: "5",
    maxCalls: 10,
    confirm: true,
  });
  const request = {
    taskId: task,
    agentId: "mason",
    provider: "TEST",
    modelId: "fixture-model",
    estimatedCostUsd: "0.10",
    priority: "P1",
    taskType: "TEST",
    requestKey: id(),
    requestHash: "synthetic-content-hash",
  };
  return { db, p, s, task, price, request };
}

test("two simultaneous database connections cannot reserve the same worker funds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "resource-concurrency-")),
    path = join(dir, "fixture.sqlite"),
    f = fixture(path);
  const workers: Worker[] = [];
  try {
    const available = f.s.snapshot("mason").worker.remainingMicros;
    const estimate = (Math.ceil(available * 0.75) / 1_000_000).toFixed(6);
    const shared = new SharedArrayBuffer(8),
      gate = new Int32Array(shared);
    const results: Promise<string>[] = [];
    const ready: Promise<void>[] = [];
    for (let i = 0; i < 2; i++) {
      const worker = new Worker(
        `const {workerData:d,parentPort}=require('node:worker_threads');
        (async()=>{ const {openDatabase}=await import(d.dbModule);const {ResourceService}=await import(d.serviceModule);
          const db=openDatabase(d.path);const s=new ResourceService(db,d.principal);s.clock=()=>new Date('2026-10-15T12:00:00Z');
          const gate=new Int32Array(d.shared);parentPort.postMessage({ready:true});Atomics.wait(gate,1,0);
          try{parentPort.postMessage({status:s.reserve(d.request).status});}finally{db.close();}
        })().catch(e=>{throw e});`,
        {
          eval: true,
          workerData: {
            path,
            principal: f.p,
            request: {
              ...f.request,
              estimatedCostUsd: estimate,
              requestKey: `concurrent-${i}`,
            },
            shared,
            dbModule: new URL("../src/db.ts", import.meta.url).href,
            serviceModule: new URL("../src/resources.ts", import.meta.url).href,
          },
        },
      );
      workers.push(worker);
      ready.push(
        new Promise((resolve, reject) => {
          worker.on("message", (m) => {
            if (m.ready) resolve();
          });
          worker.on("error", reject);
        }),
      );
      results.push(
        new Promise((resolve, reject) => {
          worker.on("message", (m) => {
            if (m.status) resolve(m.status);
          });
          worker.on("error", reject);
        }),
      );
    }
    await Promise.all(ready);
    Atomics.store(gate, 1, 1);
    Atomics.notify(gate, 1, 2);
    assert.deepEqual((await Promise.all(results)).sort(), [
      "APPROVED",
      "HUMAN_BUDGET_DECISION_REQUIRED",
    ]);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_reservations").get()!.n,
      1,
    );
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resource APIs require human sessions and CSRF; browser cannot fabricate provider usage or dispatch calls", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1:3100",
    app = createApp(f.db, origin);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const post = (
    path: string,
    body: object,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(base + "/api/resources/overview")).status, 401);
    const login = await post("/api/login", {
      email: "resources@example.test",
      password: "synthetic-resource-password",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      { csrf } = (await login.json()) as { csrf: string },
      headers = { Cookie: cookie, "X-CSRF-Token": csrf };
    assert.equal(
      (
        await post(
          "/api/resources/agent-settings",
          { agentId: "mason", nonBillable: true, confirm: true },
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/resources/agent-settings",
          { agentId: "mason", nonBillable: true, confirm: true },
          headers,
        )
      ).status,
      200,
    );
    const view = (await (
      await fetch(base + "/api/resources/overview", { headers })
    ).json()) as any;
    assert.ok(view.departments.every((d: any) => d.budgetMicros === 5_000_000));
    assert.equal(
      (
        await post(
          "/api/resources/reconcile",
          { costUsd: "0", usageStatus: "PROVIDER_REPORTED" },
          headers,
        )
      ).status,
      404,
    );
    assert.equal(
      (await post("/api/resources/reserve", f.request, headers)).status,
      404,
    );
    assert.equal((await fetch(base + "/resources.js")).status, 200);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    f.db.close();
  }
});

test("membership changes reallocate only current shares and preserve historical allocation snapshots", () => {
  const f = fixture();
  try {
    const r = f.s.reserve(f.request);
    f.s.reconcile({
      id: r.id,
      usageStatus: "INVOICE_CONFIRMED",
      costUsd: "0.01",
      outcome: "SUCCESS",
      evidence: "Synthetic invoice",
    });
    const october = f.s.balances("2026-10").departments;
    f.s.clock = () => new Date("2026-11-01T00:00:00Z");
    f.db
      .prepare("UPDATE agents SET paused=1 WHERE company_id=? AND id='mason'")
      .run(f.p.company_id);
    const department = f.s.snapshot("mason").department;
    assert.equal(
      department.workers.find((w) => w.id === "mason")!.allocationMicros,
      0,
    );
    assert.equal(
      department.workers.reduce((n, w) => n + w.allocationMicros, 0),
      5_000_000,
    );
    assert.deepEqual(f.s.balances("2026-10").departments, october);
    f.db
      .prepare(
        "UPDATE agents SET paused=0,department='marketing' WHERE company_id=? AND id='mason'",
      )
      .run(f.p.company_id);
    assert.equal(f.s.snapshot("mason").department.id, "marketing");
    assert.equal(f.s.snapshot("mason").department.budgetMicros, 5_000_000);
    assert.equal(
      f.s
        .balances("2026-10")
        .departments.find(
          (d) =>
            d.id ===
            october.find((d) => d.workers.some((w) => w.id === "mason"))!.id,
        )!.spentMicros,
      10_000,
    );
  } finally {
    f.db.close();
  }
});

test("warnings are deduplicated, conservation blocks low priority, and unforeseen actual overruns require billing review", () => {
  const f = fixture();
  try {
    const share = f.s.snapshot("mason").worker.allocationMicros;
    const spend = Math.ceil(share * 0.9);
    const r = f.s.reserve({
      ...f.request,
      estimatedCostUsd: (spend / 1_000_000).toFixed(6),
    });
    f.s.reconcile({
      id: r.id,
      usageStatus: "INVOICE_CONFIRMED",
      costUsd: (spend / 1_000_000).toFixed(6),
      outcome: "FAILURE",
      evidence: "Synthetic failed request invoice",
    });
    assert.equal(f.s.snapshot("mason").worker.status, "RED");
    assert.equal(
      f.s.reserve({
        ...f.request,
        requestKey: id(),
        estimatedCostUsd: "0.001",
        priority: "P3",
      }).status,
      "CONSERVATION_MODE",
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM resource_alerts WHERE subject='agent:mason'",
        )
        .get()!.n,
      2,
    );
    const extra = f.s.reserve({
      ...f.request,
      requestKey: id(),
      estimatedCostUsd: "0.001",
    });
    f.s.reconcile({
      id: extra.id,
      usageStatus: "INVOICE_CONFIRMED",
      costUsd: "0.002",
      outcome: "SUCCESS",
      evidence: "Synthetic invoice over estimate",
    });
    assert.equal(
      f.s.reserve({ ...f.request, requestKey: id(), estimatedCostUsd: "0.001" })
        .status,
      "BILLING_REVIEW_REQUIRED",
    );
    assert.equal(f.s.overview().incidents.length, 1);
  } finally {
    f.db.close();
  }
});
test("exact USD pricing avoids cached-input and reasoning double billing", () => {
  assert.equal(dollars("5.00"), 5_000_000);
  for (const v of [5, "1e3", "-1", "0.0000001", "NaN"])
    assert.throws(() => dollars(v));
  const price = {
    input_micros_per_million: 1_000_000,
    cached_micros_per_million: 100_000,
    output_micros_per_million: 2_000_000,
    reasoning_micros_per_million: 3_000_000,
    request_micros: 10,
    tool_micros: 5,
  };
  assert.equal(
    calculateCost(price, {
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 20,
      toolCalls: 2,
    }),
    1100,
  );
  assert.throws(() =>
    calculateCost(price, {
      inputTokens: 1,
      cachedInputTokens: 2,
      outputTokens: 0,
      reasoningTokens: 0,
      toolCalls: 0,
    }),
  );
  assert.deepEqual(
    [0, 60, 80, 90, 100].map((n) => budgetStatus(n, 100)),
    ["GREEN", "YELLOW", "ORANGE", "RED", "EXHAUSTED"],
  );
});
test("departments default to five dollars, active billable equal shares recalculate, monthly overrides expire", () => {
  const f = fixture();
  try {
    let d = f.s.snapshot("mason").department;
    assert.equal(d.budgetMicros, 5_000_000);
    assert.equal(
      d.workers.reduce((n, w) => n + w.allocationMicros, 0),
      5_000_000,
    );
    const shares = d.workers.map((w) => w.allocationMicros);
    assert.ok(Math.max(...shares) - Math.min(...shares) <= 1);
    f.s.configureAgent({ agentId: "mason", nonBillable: true, confirm: true });
    d = f.s.snapshot("mason").department;
    assert.equal(d.workers.find((w) => w.id === "mason")!.allocationMicros, 0);
    assert.equal(
      d.workers.reduce((n, w) => n + w.allocationMicros, 0),
      5_000_000,
    );
    f.s.override({
      departmentId: d.id,
      limitUsd: "10",
      month: "2026-10",
      reason: "Synthetic owner override",
      confirm: true,
    });
    assert.equal(f.s.snapshot("mason").department.budgetMicros, 10_000_000);
    f.s.clock = () => new Date("2026-11-01T00:00:00Z");
    assert.equal(f.s.snapshot("mason").department.budgetMicros, 5_000_000);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM resource_budget_overrides").get()!.n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("reservations serialize commitments, bind idempotency, pin pricing and reconcile immutable actual usage", () => {
  const f = fixture();
  try {
    const r = f.s.reserve(f.request);
    assert.equal(r.status, "APPROVED");
    assert.equal(f.s.reserve(f.request).status, "EXISTING");
    assert.throws(() => f.s.reserve({ ...f.request, estimatedCostUsd: "0.2" }));
    f.s.pricing({ ...f.price, inputUsdPerMillion: "100" });
    const result = f.s.reconcile({
      id: r.id,
      usageStatus: "PROVIDER_REPORTED",
      usage: { inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 0 },
      outcome: "SUCCESS",
      evidence: "Synthetic provider usage envelope",
    });
    assert.equal(result.costMicros, 10_000);
    assert.equal(result.differenceMicros, -90_000);
    assert.throws(() => f.s.reconcile({ id: r.id }));
    assert.throws(() => f.db.exec("UPDATE ai_usage_ledger SET cost_micros=0"));
    assert.throws(() => f.db.exec("DELETE FROM ai_usage_ledger"));
    assert.throws(() => f.db.exec("UPDATE model_pricing SET active=0"));
    assert.equal(f.s.snapshot("mason").worker.spentMicros, 10_000);
  } finally {
    f.db.close();
  }
});
test("insufficient funds require a human decision without moving money; uncertain calls survive month rollover", () => {
  const f = fixture();
  try {
    const allowance = f.s.snapshot("mason").worker.allocationMicros;
    const first = f.s.reserve({
      ...f.request,
      estimatedCostUsd: (allowance / 1_000_000).toFixed(6),
    });
    assert.equal(first.status, "APPROVED");
    const second = f.s.reserve({
      ...f.request,
      requestKey: id(),
      estimatedCostUsd: "0.01",
    });
    assert.equal(second.status, "HUMAN_BUDGET_DECISION_REQUIRED");
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_reservations").get()!.n,
      1,
    );
    f.s.uncertain({ id: first.id });
    f.s.clock = () => new Date("2026-11-01T00:00:00Z");
    assert.equal(
      f.s.reserve({ ...f.request, requestKey: id() }).status,
      "RECONCILIATION_REQUIRED",
    );
    f.s.reconcile({
      id: first.id,
      usageStatus: "INVOICE_CONFIRMED",
      costUsd: "0.005",
      outcome: "FAILURE",
      evidence: "Synthetic invoice confirmation",
    });
    assert.equal(f.s.snapshot("mason").worker.spentMicros, 0);
    assert.equal(f.s.overview().historicalMonths[0].budget_month, "2026-10");
  } finally {
    f.db.close();
  }
});
test("task limits, tenant authentication and failed audit block reservations atomically", () => {
  const f = fixture();
  try {
    f.s.setTaskLimits({
      taskId: f.task,
      maxCostUsd: "0.01",
      maxCalls: 1,
      confirm: true,
    });
    assert.equal(f.s.reserve(f.request).status, "TASK_LIMIT_REACHED");
    assert.equal(f.s.overview().incidents.length, 1);
    assert.throws(() => new ResourceService(f.db, { ...f.p, id: "mason" }));
    f.s.setTaskLimits({
      taskId: f.task,
      maxCostUsd: "1",
      maxCalls: 1,
      confirm: true,
    });
    f.db.exec(
      "CREATE TRIGGER fail_resource_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit down'); END",
    );
    assert.throws(() => f.s.reserve(f.request));
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_reservations").get()!.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
