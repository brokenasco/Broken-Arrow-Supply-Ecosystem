import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  CustomerService,
  customerState,
  personaFields,
  classify,
} from "../src/customers.ts";
import { createApp } from "../src/server.ts";
const stamp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "customer-fixture@example.test",
    "customer-fixture-password",
    "Synthetic customer intelligence",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, c: new CustomerService(db, p) };
}
const evidence = (extra = {}) => ({
  requestKey: "evidence-key",
  title: "Synthetic packaging complaint",
  kind: "COMPLAINT",
  simulation: true,
  redacted: true,
  authorized: true,
  excerpt: "The packaging arrived damaged.",
  provenance: "Synthetic fixture; no actual customer data.",
  theme: "packaging",
  observedAt: stamp(-1),
  expiresAt: stamp(10),
  ...extra,
});
function verified(f: ReturnType<typeof fixture>, extra = {}) {
  const e = f.c.capture(evidence(extra));
  f.c.reviewEvidence({
    id: e.id,
    status: "VERIFIED",
    note: "Synthetic human review",
  });
  return e;
}
function persona(sourceId: string, extra = {}) {
  return {
    kind: "PERSONA",
    title: "Evidence-backed example",
    sourceIds: [sourceId],
    confidence: 0.4,
    observed: "Packaging complaint observed",
    inferred: "Durable packaging may matter",
    limitations: "One synthetic observation; no demographic inference",
    ...Object.fromEntries(
      personaFields.map((k) => [k, "Unknown; insufficient evidence"]),
    ),
    ...extra,
  };
}
test("customer evidence requires minimization, deduplicates retries, and respects tenant and audit boundaries", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.c.capture(evidence({ redacted: false })),
      /redaction/,
    );
    assert.throws(
      () => f.c.capture(evidence({ excerpt: "Contact person@example.com" })),
      /contact/,
    );
    assert.throws(
      () => f.c.capture(evidence({ excerpt: "Call 555-123-4567" })),
      /contact/,
    );
    const e = f.c.capture(evidence());
    assert.deepEqual(
      f.c.capture(
        evidence({
          ...evidence(),
          observedAt: JSON.parse(String(f.c.evidenceRow(e.id).body)).observedAt,
          expiresAt: JSON.parse(String(f.c.evidenceRow(e.id).body)).expiresAt,
        }),
      ),
      e,
    );
    assert.throws(() => f.c.capture(evidence({ title: "Changed" })), /reused/);
    const u = provision(
      f.db,
      "other-customer@example.test",
      "other-customer-password",
      "Other",
    );
    const other = new CustomerService(f.db, {
      id: u.user,
      company_id: u.company,
      role: "CEO",
    });
    assert.throws(() => other.withdraw(e), /not found/);
    f.db.exec(
      "CREATE TRIGGER fail_customer_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(
      () =>
        f.c.reviewEvidence({ id: e.id, status: "VERIFIED", note: "Review" }),
      /audit failed/,
    );
    assert.equal(f.c.evidenceRow(e.id).status, "UNVERIFIED");
  } finally {
    f.db.close();
  }
});
test("personas require verified evidence, version linearly, and invalidate on withdrawal", () => {
  const f = fixture();
  try {
    const e = f.c.capture(evidence());
    assert.throws(() => f.c.document(persona(e.id)), /verified/);
    f.c.reviewEvidence({ id: e.id, status: "VERIFIED", note: "Checked" });
    const first = f.c.document(persona(e.id));
    const second = f.c.document(persona(e.id, { parentId: first.id }));
    assert.throws(
      () => f.c.document(persona(e.id, { parentId: first.id })),
      /latest/,
    );
    assert.equal(
      customerState(f.db, f.p.company_id).documents.find(
        (d) => d.id === second.id,
      )!.version,
      2,
    );
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE customer_documents SET title=? WHERE id=?")
          .run("Changed", first.id),
      /version/,
    );
    f.c.withdraw(e);
    const state = customerState(f.db, f.p.company_id);
    assert.equal(state.documents[0].body, null);
    assert.equal(state.evidence[0].body, null);
    assert.throws(
      () =>
        f.c.reviewEvidence({ id: e.id, status: "VERIFIED", note: "Reopen" }),
      /terminal/,
    );
  } finally {
    f.db.close();
  }
});
test("recurring complaints use fresh verified records and never mix simulation groups", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) verified(f, { requestKey: "sim-" + i });
    for (let i = 0; i < 2; i++)
      verified(f, { requestKey: "real-" + i, simulation: false });
    f.c.capture(evidence({ requestKey: "unverified" }));
    const state = customerState(f.db, f.p.company_id);
    assert.deepEqual(state.complaints, [
      { theme: "packaging", simulation: true, count: 3 },
    ]);
    const sim = state.evidence.find((e) => e.fresh && e.body.simulation),
      real = state.evidence.find((e) => e.fresh && !e.body.simulation);
    assert.throws(
      () => f.c.document(persona(sim.id, { sourceIds: [sim.id, real.id] })),
      /mix/,
    );
    f.c.reviewEvidence({
      id: sim.id,
      status: "DISPUTED",
      note: "No longer verified",
    });
    assert.equal(customerState(f.db, f.p.company_id).complaints.length, 0);
  } finally {
    f.db.close();
  }
});
test("support escalation, exact draft review, closure and stop controls remain local", () => {
  const f = fixture();
  try {
    const e = verified(f, { excerpt: "Request a refund for a damaged item." });
    assert.throws(
      () =>
        f.c.support({
          evidenceId: e.id,
          category: "REFUND",
          priority: "NORMAL",
          rationale: "Refund requested",
        }),
      /escalation/,
    );
    const s = f.c.support({
      evidenceId: e.id,
      category: "REFUND",
      priority: "ESCALATE",
      rationale: "Human refund review required",
    });
    const d = f.c.draft({ id: s.id, mode: "TEMPLATE" }),
      row = customerState(f.db, f.p.company_id).drafts.find(
        (r) => r.id === d.id,
      )!;
    assert.match(String(row.body), /DRAFT ONLY/);
    assert.throws(
      () =>
        f.c.reviewDraft({
          id: d.id,
          contentHash: "wrong",
          status: "REVIEWED",
          note: "Checked",
        }),
      /Exact/,
    );
    assert.equal(
      f.c.reviewDraft({
        id: d.id,
        contentHash: row.content_hash,
        status: "REVIEWED",
        note: "Reviewed for internal use",
      }).sent,
      false,
    );
    f.c.close({ id: s.id, note: "Synthetic case closed; no refund processed" });
    assert.throws(() => f.c.draft({ id: s.id, mode: "TEMPLATE" }), /Open/);
    assert.equal(customerState(f.db, f.p.company_id).analytics.closed, 1);
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    assert.throws(
      () => f.c.capture(evidence({ requestKey: "stopped" })),
      /paused/,
    );
    f.c.withdraw(e);
    assert.equal(customerState(f.db, f.p.company_id).drafts[0].body, null);
    assert.equal(classify("unsafe product caused injury").priority, "ESCALATE");
  } finally {
    f.db.close();
  }
});
test("customer HTTP routes enforce auth/CSRF and expose no send or refund action", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1",
    server = createApp(f.db, origin);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
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
    assert.equal(
      (await post("/api/customers/capture", evidence())).status,
      401,
    );
    const login = await post("/api/login", {
      email: "customer-fixture@example.test",
      password: "customer-fixture-password",
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      session = (await login.json()) as { csrf: string };
    assert.equal(
      (await post("/api/customers/capture", evidence(), { Cookie: cookie }))
        .status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    assert.equal(
      (await post("/api/customers/capture", evidence(), headers)).status,
      200,
    );
    for (const action of ["send", "refund"])
      assert.equal(
        (await post("/api/customers/" + action, {}, headers)).status,
        404,
      );
    assert.equal((await fetch(base + "/customers.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});

test("refund keyword escalation cannot be bypassed by choosing another category", () => {
  const f = fixture();
  try {
    const e = verified(f, { excerpt: "I request a refund." });
    assert.throws(
      () =>
        f.c.support({
          evidenceId: e.id,
          category: "OTHER",
          priority: "NORMAL",
          rationale: "Other",
        }),
      /escalation/,
    );
  } finally {
    f.db.close();
  }
});
