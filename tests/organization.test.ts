import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  OrganizationService,
  organizationMetrics,
  organizationState,
} from "../src/organization.ts";
import { CompanyService } from "../src/service.ts";
import { ComplianceService } from "../src/compliance.ts";
import { createApp } from "../src/server.ts";
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "organization@example.test",
      "organization-fixture-password",
      "Synthetic organization",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  return {
    db,
    p,
    o: new OrganizationService(db, p),
    s: new CompanyService(db, p),
  };
}
test("empty organization metrics report unavailable rates and do not invent usefulness or costs", () => {
  const f = fixture();
  try {
    const m = organizationMetrics(f.db, f.p.company_id);
    assert.equal(m.design[0].current.passRate, null);
    assert.equal(m.costs[0].reportedActualCents, null);
    assert.equal(m.costs[0].costPerSuccessfulOutputCents, null);
    assert.equal(m.automation.failureRate, null);
    assert.equal(m.activity.providerToolCalls, null);
    assert.ok(m.workforce.every((a) => a.autonomousUsefulness === null));
    assert.equal(m.campaign.length, 0);
    assert.equal(m.backlog.total, 0);
    assert.throws(() => organizationMetrics(f.db, f.p.company_id, 1), /window/);
  } finally {
    f.db.close();
  }
});
test("snapshots retain evidence and human assessments cannot mutate organization controls", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 4) });
  const f = fixture();
  try {
    const project = f.s.project({ name: "Synthetic", objective: "Fixture" });
    f.s.task({
      projectId: project.id,
      agentId: "mason",
      objective: "Research fixture",
    });
    t.mock.timers.tick(2 * 86400000);
    const r = f.o.report({ windowDays: 7 }),
      snapshot = organizationState(f.db, f.p.company_id).reports[0];
    assert.equal(snapshot.body.backlog.over24Hours, 1);
    assert.equal(
      snapshot.body.workforce.find((a: any) => a.id === "mason").assigned,
      1,
    );
    const before = f.db
      .prepare("SELECT * FROM agents WHERE company_id=? ORDER BY id")
      .all(f.p.company_id);
    assert.throws(
      () =>
        f.o.review({
          reportId: r.id,
          contentHash: "wrong",
          subjectKind: "AGENT",
          subjectId: "mason",
          verdict: "USEFUL",
          note: "Fixture",
        }),
      /hash/,
    );
    const input = {
      reportId: r.id,
      contentHash: snapshot.content_hash,
      subjectKind: "AGENT",
      subjectId: "mason",
      verdict: "NEEDS_EVIDENCE",
      note: "Assignments are not autonomous usefulness",
    };
    assert.equal(f.o.review(input).configurationChanged, false);
    assert.throws(() => f.o.review(input), /already/);
    f.o.review({
      reportId: r.id,
      contentHash: snapshot.content_hash,
      subjectKind: "RECOMMENDATION",
      subjectId: "workflow-backlog",
      verdict: "ACCEPT_FOR_REVIEW",
      note: "Inspect dependencies, retaining approval rules",
    });
    assert.deepEqual(
      f.db
        .prepare("SELECT * FROM agents WHERE company_id=? ORDER BY id")
        .all(f.p.company_id),
      before,
    );
    assert.throws(
      () => f.o.review({ ...input, subjectId: "missing" }),
      /Subject/,
    );
    assert.throws(
      () => f.db.prepare("UPDATE organization_reports SET body='{}'").run(),
      /immutable/,
    );
    assert.throws(
      () =>
        f.db.prepare("UPDATE organization_reviews SET verdict='USEFUL'").run(),
      /immutable/,
    );
    t.mock.timers.tick(86400000);
    assert.equal(
      organizationState(f.db, f.p.company_id).reports[0].body.asOf,
      snapshot.body.asOf,
    );
  } finally {
    f.db.close();
  }
});
test("company isolation, agent denial, pause/hold and audit rollback apply to reports and assessments", () => {
  const f = fixture();
  try {
    const r = f.o.report({ windowDays: 30 }),
      u = provision(
        f.db,
        "org-other@example.test",
        "org-other-password",
        "Other",
      ),
      other = new OrganizationService(f.db, {
        id: u.user,
        company_id: u.company,
        role: "CEO",
      });
    assert.equal(organizationState(f.db, u.company).reports.length, 0);
    assert.throws(() => other.review({ reportId: r.id }), /not found/);
    assert.throws(
      () => new OrganizationService(f.db, { ...f.p, id: "boris" }),
      /Authenticated/,
    );
    f.s.control("agent", "boris", true);
    assert.throws(() => f.o.report({ windowDays: 30 }), /paused/);
    f.s.control("agent", "boris", false);
    f.db.exec(
      "CREATE TRIGGER org_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action LIKE 'organization.%' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    assert.throws(() => f.o.report({ windowDays: 7 }), /audit failure/);
    assert.equal(organizationState(f.db, f.p.company_id).reports.length, 1);
    const report = organizationState(f.db, f.p.company_id).reports[0];
    assert.throws(
      () =>
        f.o.review({
          reportId: r.id,
          contentHash: report.content_hash,
          subjectKind: "AGENT",
          subjectId: "boris",
          verdict: "NEEDS_EVIDENCE",
          note: "Fixture",
        }),
      /audit failure/,
    );
    assert.equal(organizationState(f.db, f.p.company_id).reviews.length, 0);
    f.db.exec("DROP TRIGGER org_audit_failure");
    new ComplianceService(f.db, f.p).hold({
      category: "SECURITY",
      reason: "Fixture",
    });
    assert.throws(() => f.o.report({ windowDays: 30 }), /hold/);
  } finally {
    f.db.close();
  }
});
test("organization HTTP enforces auth/CSRF and offers no permission or metric editing endpoints", async () => {
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
    assert.equal(
      (await post("/api/organization/report", { windowDays: 30 })).status,
      401,
    );
    const login = await post("/api/login", {
        email: "organization@example.test",
        password: "organization-fixture-password",
      }),
      session = (await login.json()) as { csrf: string },
      cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal(
      (
        await post(
          "/api/organization/report",
          { windowDays: 30 },
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    assert.equal(
      (await post("/api/organization/report", { windowDays: 30 }, headers))
        .status,
      200,
    );
    for (const action of [
      "edit-metrics",
      "change-permissions",
      "auto-optimize",
    ])
      assert.equal(
        (await post("/api/organization/" + action, {}, headers)).status,
        404,
      );
    assert.equal((await fetch(base + "/organization.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
