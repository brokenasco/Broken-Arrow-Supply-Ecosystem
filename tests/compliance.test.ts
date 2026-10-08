import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  ComplianceService,
  complianceState,
  complianceChecks,
} from "../src/compliance.ts";
import {
  artifact,
  assertComplianceClear,
  enforceComplianceReview,
} from "../src/compliance-gates.ts";
import { TechnologyService, uxChecks, uxFields } from "../src/technology.ts";
import { CompanyService } from "../src/service.ts";
import { CustomerService, customerState } from "../src/customers.ts";
import { createApp } from "../src/server.ts";
const stamp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "compliance@example.test",
    "compliance-test-password",
    "Synthetic compliance",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  return {
    db,
    p,
    c: new ComplianceService(db, p),
    t: new TechnologyService(db, p),
    s: new CompanyService(db, p),
  };
}
function report(f: ReturnType<typeof fixture>) {
  const o = f.t.observation({
    title: "Synthetic observation",
    mode: "SIMULATION",
    page: "https://example.test/",
    device: "Fixture",
    observedAt: stamp(-1),
    expiresAt: stamp(10),
    method: "Fixture",
    findings: "Synthetic evidence only",
    checks: Object.fromEntries(uxChecks.map((k) => [k, "NOT_TESTED"])),
  });
  return f.t.report({
    title: "Synthetic report",
    sourceIds: [o.id],
    priority: "HIGH",
    confidence: 0.5,
    ...Object.fromEntries(uxFields.map((k) => [k, "Synthetic " + k])),
  });
}
const configure = (f: ReturnType<typeof fixture>, terms: string[] = []) =>
  f.c.configure({
    confirm: true,
    requireReviews: true,
    terms,
    brandGuidelines: "Synthetic guidelines",
    reason: "Fixture review policy",
  });
const approve = (f: ReturnType<typeof fixture>, r: { id: string }) =>
  f.t.approve({ ...r, contentHash: f.t.row(r.id).content_hash, confirm: true });
const review = (f: ReturnType<typeof fixture>, r: { id: string }, extra = {}) =>
  f.c.review({
    kind: "UX",
    ...r,
    contentHash: artifact(f.db, f.p.company_id, "UX", r.id).hash,
    verdict: "PASS",
    checks: Object.fromEntries(complianceChecks.map((k) => [k, true])),
    note: "Synthetic human review, not legal clearance",
    ...extra,
  });
const release = (f: ReturnType<typeof fixture>, h: { id: string }) => {
  const plan = f.c.releaseRequest({
    ...h,
    confirm: true,
    remediation: "Synthetic remediation verified",
  });
  return f.c.release({ ...plan, confirm: true });
};
test("holds survive resume, expire approvals, and require exact single-use human release", () => {
  const f = fixture();
  try {
    const r = report(f);
    approve(f, r);
    const h = f.c.hold({ category: "SECURITY", reason: "Synthetic incident" });
    assert.equal(f.t.row(r.id).expires_at, 0);
    f.s.control("company", f.p.company_id, false);
    assert.throws(() => f.t.assign(r), /Compliance hold/);
    assert.throws(
      () => f.s.project({ name: "Blocked", objective: "Blocked" }),
      /Compliance hold/,
    );
    const plan = f.c.releaseRequest({
      ...h,
      confirm: true,
      remediation: "Investigated fixture",
    });
    assert.throws(
      () => f.c.release({ ...plan, contentHash: "changed", confirm: true }),
      /Exact/,
    );
    f.c.release({ ...plan, confirm: true });
    assert.throws(() => f.c.release({ ...plan, confirm: true }), /single-use/);
    assert.throws(() => f.t.assign(r), /single-use/);
    approve(f, r);
    f.t.assign(r);
    const first = f.c.hold({ category: "BRAND", reason: "First" }),
      second = f.c.hold({ category: "PRIVACY", reason: "Second" });
    release(f, first);
    assert.throws(() => assertComplianceClear(f.db, f.p.company_id), /hold/);
    release(f, second);
    assert.doesNotThrow(() => assertComplianceClear(f.db, f.p.company_id));
  } finally {
    f.db.close();
  }
});
test("content checks bind current policy and latest verdict, never replace execution approval", () => {
  const f = fixture();
  try {
    const r = report(f);
    configure(f);
    approve(f, r);
    assert.throws(() => f.t.assign(r), /compliance PASS/);
    assert.throws(() => review(f, r, { contentHash: "wrong" }), /hash/);
    assert.throws(() => review(f, r, { checks: {} }), /all checks/);
    configure(f, ["Synthetic"]);
    assert.throws(() => review(f, r), /flags/);
    configure(f);
    review(f, r);
    review(f, r, { verdict: "BLOCK" });
    release(
      f,
      complianceState(f.db, f.p.company_id).holds[0] as { id: string },
    );
    assert.throws(() => f.t.assign(r), /compliance PASS/);
    review(f, r);
    assert.throws(() => f.t.assign(r), /single-use/);
    configure(f);
    approve(f, r);
    assert.throws(() => f.t.assign(r), /compliance PASS/);
    review(f, r);
    assert.equal(f.t.assign(r).externalAction, false);
    assert.throws(
      () => f.db.prepare("UPDATE compliance_reviews SET verdict='PASS'").run(),
      /immutable/,
    );
  } finally {
    f.db.close();
  }
});
test("release expiry and review expiry fail closed", () => {
  const f = fixture();
  const original = Date.now;
  try {
    const r = report(f);
    configure(f);
    review(f, r);
    const h = f.c.hold({ category: "AUTHORITY", reason: "Fixture" });
    const plan = f.c.releaseRequest({
      ...h,
      confirm: true,
      remediation: "Fixture",
    });
    const time = original();
    Date.now = () => time + 600001;
    assert.throws(() => f.c.release({ ...plan, confirm: true }), /unexpired/);
    Date.now = () => time + 8 * 86400000;
    assert.throws(
      () =>
        enforceComplianceReview(
          f.db,
          f.p.company_id,
          "technology.assigned_to_sarah",
          r.id,
        ),
      /PASS/,
    );
  } finally {
    Date.now = original;
    f.db.close();
  }
});
test("company-scoped audit review and remediation remain available during stop and holds", () => {
  const f = fixture();
  try {
    f.s.control("company", f.p.company_id, true);
    const other = provision(
      f.db,
      "other-compliance@example.test",
      "other-fixture-password",
      "Other",
    );
    const foreign = new ComplianceService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    const h = f.c.hold({ category: "SECURITY", reason: "Investigate" });
    assert.throws(
      () =>
        foreign.releaseRequest({
          ...h,
          confirm: true,
          remediation: "Wrong tenant",
        }),
      /Open hold/,
    );
    const rows = complianceState(f.db, f.p.company_id).auditRows;
    f.c.auditReview({
      start: rows.at(-1)!.sequence,
      end: rows[0].sequence,
      verdict: "ESCALATE",
      note: "Synthetic finding",
    });
    const state = complianceState(f.db, f.p.company_id);
    assert.equal(state.auditReviews[0].row_count, rows.length);
    assert.equal(state.holds.length, 2);
    const foreignSequence = complianceState(f.db, other.company).auditRows[0]
      .sequence;
    assert.throws(
      () =>
        f.c.auditReview({
          start: foreignSequence,
          end: foreignSequence,
          verdict: "NO_FINDINGS",
          note: "Foreign",
        }),
      /range endpoints/,
    );
    release(f, h);
    assert.equal(f.s.state().company!.stopped, 1);
    assert.throws(
      () => new ComplianceService(f.db, { ...f.p, id: "victoria" }),
      /Authenticated/,
    );
  } finally {
    f.db.close();
  }
});
test("audit failure rolls back holds, approval expiry and release consumption together", () => {
  const f = fixture();
  try {
    const r = report(f);
    approve(f, r);
    const expiry = f.t.row(r.id).expires_at;
    f.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    assert.throws(
      () => f.c.hold({ category: "SECURITY", reason: "Rollback" }),
      /audit failure/,
    );
    assert.equal(complianceState(f.db, f.p.company_id).holds.length, 0);
    assert.equal(f.t.row(r.id).expires_at, expiry);
    f.db.exec("DROP TRIGGER fail_audit");
    const h = f.c.hold({ category: "SECURITY", reason: "Fixture" });
    const plan = f.c.releaseRequest({
      ...h,
      confirm: true,
      remediation: "Fixture",
    });
    f.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
    );
    assert.throws(
      () => f.c.release({ ...plan, confirm: true }),
      /audit failure/,
    );
    assert.equal(complianceState(f.db, f.p.company_id).holds[0].status, "OPEN");
    assert.equal(
      complianceState(f.db, f.p.company_id).releases[0].consumed_at,
      null,
    );
  } finally {
    f.db.close();
  }
});
test("withdrawn support evidence stays hidden and review rejection needs no PASS", () => {
  const f = fixture();
  try {
    const c = new CustomerService(f.db, f.p);
    const e = c.capture({
      requestKey: "fixture",
      title: "Synthetic complaint",
      kind: "COMPLAINT",
      simulation: true,
      redacted: true,
      authorized: true,
      excerpt: "Packaging arrived damaged",
      provenance: "Synthetic fixture",
      theme: "packaging",
      observedAt: stamp(-1),
      expiresAt: stamp(10),
    });
    c.reviewEvidence({ ...e, status: "VERIFIED", note: "Fixture" });
    const s = c.support({
      evidenceId: e.id,
      category: "QUALITY",
      priority: "NORMAL",
      rationale: "Fixture",
    });
    const d = c.draft({ ...s, mode: "TEMPLATE" });
    configure(f);
    const row = customerState(f.db, f.p.company_id).drafts[0];
    assert.throws(
      () =>
        c.reviewDraft({
          ...d,
          contentHash: row.content_hash,
          status: "REVIEWED",
          note: "Fixture",
        }),
      /PASS/,
    );
    f.c.hold({ category: "PRIVACY", reason: "Fixture" });
    c.reviewDraft({
      ...d,
      contentHash: row.content_hash,
      status: "REJECTED",
      note: "Rejected for remediation",
    });
    c.withdraw(e);
    assert.equal(
      complianceState(f.db, f.p.company_id).artifacts.filter(
        (a) => a.kind === "SUPPORT",
      ).length,
      0,
    );
    assert.throws(
      () => artifact(f.db, f.p.company_id, "SUPPORT", d.id),
      /verified/,
    );
  } finally {
    f.db.close();
  }
});
test("compliance HTTP routes require authentication and CSRF; destructive endpoints remain absent", async () => {
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
    const body = { category: "SECURITY", reason: "HTTP fixture" };
    assert.equal((await post("/api/compliance/hold", body)).status, 401);
    const login = await post("/api/login", {
      email: "compliance@example.test",
      password: "compliance-test-password",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      session = (await login.json()) as { csrf: string };
    assert.equal(
      (await post("/api/compliance/hold", body, { Cookie: cookie })).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    assert.equal(
      (await post("/api/compliance/hold", body, headers)).status,
      200,
    );
    for (const path of [
      "/api/compliance/delete",
      "/api/customers/refund",
      "/api/technology/deploy",
      "/api/products/publish",
    ])
      assert.equal((await post(path, {}, headers)).status, 404);
    assert.equal((await fetch(base + "/compliance.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
