import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  AutomationService,
  automationState,
  tickAutomation,
  inventoryProjection,
  startAutomationWorker,
} from "../src/automation.ts";
import { ComplianceService } from "../src/compliance.ts";
import { CompanyService } from "../src/service.ts";
import { OperationsService } from "../src/operations.ts";
import { createApp } from "../src/server.ts";
function fixture(path = ":memory:") {
  const db = openDatabase(path),
    u = provision(
      db,
      "automation@example.test",
      "automation-fixture-password",
      "Synthetic automation",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, a: new AutomationService(db, p) };
}
const input = (extra = {}) => ({
  title: "Synthetic research review",
  kind: "RESEARCH_REVIEW",
  payload: {},
  startsAt: new Date(Date.now() - 1000).toISOString(),
  endsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  intervalHours: 1,
  dailyLimit: 2,
  maxRuns: 3,
  budgetCents: 0,
  acknowledgeLimits: true,
  valueMetric: "Evidence records checked",
  successCriterion: "List records needing review",
  ...extra,
});
function enable(f: ReturnType<typeof fixture>, extra = {}) {
  const r = f.a.create(input(extra)),
    exact = { ...r, contentHash: f.a.row(r.id).content_hash, confirm: true };
  f.a.approve(exact);
  f.a.enable(exact);
  return exact;
}
test("schedules bind exact expiring single-use human approval and cannot widen authority", () => {
  const f = fixture();
  try {
    assert.throws(() => f.a.create(input({ kind: "PUBLISH" })), /kind/);
    assert.throws(() => f.a.create(input({ budgetCents: 1 })), /zero/);
    assert.throws(
      () => f.a.create(input({ payload: { confirm: true } })),
      /payload/,
    );
    const r = f.a.create(input());
    assert.throws(() => f.a.enable({ ...r, confirm: true }), /approval/);
    assert.throws(
      () => f.a.approve({ ...r, contentHash: "wrong", confirm: true }),
      /Exact/,
    );
    const exact = {
      ...r,
      contentHash: f.a.row(r.id).content_hash,
      confirm: true,
    };
    f.a.approve(exact);
    f.db
      .prepare(
        "UPDATE automation_schedules SET approval_expires_at=0 WHERE id=?",
      )
      .run(r.id);
    assert.throws(() => f.a.enable(exact), /unexpired/);
    f.a.approve(exact);
    f.a.enable(exact);
    assert.throws(() => f.a.enable(exact), /single-use/);
    assert.throws(
      () => f.db.prepare("UPDATE automation_schedules SET body='{}'").run(),
      /immutable/,
    );
    assert.throws(
      () => new AutomationService(f.db, { ...f.p, id: "boris" }),
      /Authenticated/,
    );
  } finally {
    f.db.close();
  }
});
test("due runs deduplicate, skip downtime bursts, obey daily/total caps and expiry", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 3, 2) });
  const f = fixture();
  try {
    const r = enable(f);
    assert.equal(tickAutomation(f.db).processed, 1);
    assert.equal(tickAutomation(f.db).processed, 0);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 1);
    t.mock.timers.tick(5 * 3600000);
    tickAutomation(f.db);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 2);
    t.mock.timers.tick(3600000);
    tickAutomation(f.db);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 2);
    t.mock.timers.tick(24 * 3600000);
    tickAutomation(f.db);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 3);
    assert.equal(f.a.row(r.id).status, "EXHAUSTED");
    const exp = enable(f, {
      endsAt: new Date(Date.now() + 3600000).toISOString(),
    });
    t.mock.timers.tick(3600001);
    tickAutomation(f.db);
    assert.equal(f.a.row(exp.id).status, "EXPIRED");
  } finally {
    f.db.close();
  }
});
test("stop and agent pause block runs; compliance changes revoke schedule activation", () => {
  const f = fixture();
  try {
    const r = enable(f);
    new CompanyService(f.db, f.p).control("company", f.p.company_id, true);
    tickAutomation(f.db);
    assert.equal(f.a.row(r.id).status, "PAUSED");
    assert.equal(
      automationState(f.db, f.p.company_id).runs[0].status,
      "BLOCKED",
    );
    f.a.pause(r);
    new CompanyService(f.db, f.p).control("company", f.p.company_id, false);
    const s = enable(f);
    new CompanyService(f.db, f.p).control("agent", "mason", true);
    tickAutomation(f.db);
    assert.equal(f.a.row(s.id).status, "PAUSED");
    new CompanyService(f.db, f.p).control("agent", "mason", false);
    const h = enable(f);
    new ComplianceService(f.db, f.p).hold({
      category: "SECURITY",
      reason: "Synthetic incident",
    });
    assert.equal(f.a.row(h.id).status, "PAUSED");
    assert.equal(tickAutomation(f.db).processed, 0);
    assert.throws(() => f.a.approve(h), /hold/);
  } finally {
    f.db.close();
  }
});
test("company isolation and persisted authorizer revocation prevent execution", () => {
  const f = fixture();
  try {
    const r = enable(f),
      u = provision(
        f.db,
        "other-auto@example.test",
        "other-automation-password",
        "Other",
      ),
      p = { id: u.user, company_id: u.company, role: "CEO" },
      a = new AutomationService(f.db, p);
    assert.throws(() => a.pause(r), /not found/);
    assert.equal(tickAutomation(f.db, u.company).processed, 0);
    assert.equal(automationState(f.db, u.company).schedules.length, 0);
    // Test identity revalidation without changing immutable schedule content.
    f.db
      .prepare("UPDATE users SET company_id=? WHERE id=?")
      .run(u.company, f.p.id);
    assert.equal(tickAutomation(f.db).errors, 1);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 0);
  } finally {
    f.db.close();
  }
});
test("nested workflow output and audit roll back atomically; failed inputs pause without retry", () => {
  const f = fixture();
  try {
    const payload = {
      title: "Synthetic experiment",
      hypothesis: "Fixture",
      variant: "Control vs variant",
      metric: "orders",
      target: "Measure orders",
      startsOn: "2026-10-05",
      endsOn: "2026-10-10",
    };
    const r = enable(f, { kind: "EXPERIMENT_PLAN", payload });
    f.db.exec(
      "CREATE TRIGGER break_run_audit BEFORE INSERT ON audit_logs WHEN NEW.action='automation.run_recorded' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    assert.throws(() => f.a.runDue(r.id), /audit failure/);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM experiments").get()!.n,
      0,
    );
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 0);
    f.db.exec("DROP TRIGGER break_run_audit");
    f.a.runDue(r.id);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM experiments").get()!.n,
      1,
    );
    const bad = enable(f, { kind: "EXPERIMENT_PLAN", payload: {} });
    tickAutomation(f.db);
    assert.equal(f.a.row(bad.id).status, "PAUSED");
    const count = automationState(f.db, f.p.company_id).runs.length;
    tickAutomation(f.db);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, count);
    const report = enable(f, { kind: "REPORT" });
    tickAutomation(f.db);
    assert.equal(f.a.row(report.id).status, "PAUSED");
    assert.match(
      JSON.stringify(automationState(f.db, f.p.company_id).runs[0].output),
      /Fresh Shopify/,
    );
  } finally {
    f.db.close();
  }
});
test("durable schedules survive restart and duplicate worker handles cannot duplicate a due slot", () => {
  const dir = mkdtempSync(join(tmpdir(), "company-auto-")),
    path = join(dir, "fixture.sqlite");
  const f = fixture(path);
  const company = f.p.company_id;
  enable(f);
  f.db.close();
  const db = openDatabase(path);
  try {
    tickAutomation(db);
    tickAutomation(db);
    assert.equal(automationState(db, company).runs.length, 1);
    const stop = startAutomationWorker(db);
    stop();
  } finally {
    db.close();
    rmSync(path);
    rmdirSync(dir);
  }
});
test("inventory projection separates simulation and refuses sparse or stale history", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 1) });
  const f = fixture();
  try {
    assert.equal(inventoryProjection(f.db, f.p.company_id).items.length, 0);
    const o = new OperationsService(f.db, f.p);
    o.simulate({ kind: "LOW_INVENTORY" });
    o.process();
    assert.equal(
      inventoryProjection(f.db, f.p.company_id).items[0].netUnitsPerDay,
      null,
    );
    for (let n = 0; n < 2; n++) {
      t.mock.timers.tick(86400000);
      o.simulate({ kind: "LOW_INVENTORY" });
      o.process();
    }
    const result = inventoryProjection(f.db, f.p.company_id);
    assert.equal(result.items[0].simulation, true);
    assert.equal(result.items[0].netUnitsPerDay, 0);
    assert.equal(result.items[0].daysToZero, null);
    t.mock.timers.tick(3 * 86400000);
    assert.equal(
      inventoryProjection(f.db, f.p.company_id).items[0].netUnitsPerDay,
      null,
    );
  } finally {
    f.db.close();
  }
});
test("automation HTTP requires session and CSRF; due processing is company scoped", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1",
    server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const post = (path: string, body: unknown, headers = {}) =>
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
    assert.equal((await post("/api/automation/create", input())).status, 401);
    const login = await post("/api/login", {
        email: "automation@example.test",
        password: "automation-fixture-password",
      }),
      session = (await login.json()) as { csrf: string },
      cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (await post("/api/automation/tick", {}, { Cookie: cookie })).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    const created = await post("/api/automation/create", input(), headers);
    assert.equal(created.status, 200);
    const r = (await created.json()) as { id: string },
      exact = { ...r, contentHash: f.a.row(r.id).content_hash, confirm: true };
    assert.equal(
      (await post("/api/automation/approve", exact, headers)).status,
      200,
    );
    assert.equal(
      (await post("/api/automation/enable", exact, headers)).status,
      200,
    );
    assert.equal((await post("/api/automation/tick", {}, headers)).status, 200);
    assert.equal(automationState(f.db, f.p.company_id).runs.length, 1);
    assert.equal(
      (await post("/api/automation/dispatch", {}, headers)).status,
      404,
    );
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
