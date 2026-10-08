import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  TechnologyService,
  technologyState,
  uxChecks,
  uxFields,
} from "../src/technology.ts";
import { host, publicAddress, signals } from "../src/site-probe.ts";
import { createApp } from "../src/server.ts";
const stamp = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "ux@example.test",
    "ux-fixture-password",
    "Synthetic UX",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, t: new TechnologyService(db, p) };
}
const observation = (extra = {}) => ({
  title: "Synthetic mobile review",
  mode: "SIMULATION",
  page: "https://example.test/product",
  device: "Synthetic mobile 390x844",
  observedAt: stamp(-1),
  expiresAt: stamp(10),
  method: "Synthetic manual inspection",
  findings: "Fixture only; not actual storefront evidence",
  checks: Object.fromEntries(uxChecks.map((k) => [k, "NOT_TESTED"])),
  ...extra,
});
const report = (sourceId: string, extra = {}) => ({
  title: "Synthetic UX recommendation",
  sourceIds: [sourceId],
  priority: "HIGH",
  confidence: 0.5,
  ...Object.fromEntries(uxFields.map((k) => [k, "Synthetic " + k])),
  ...extra,
});
const approve = (f: ReturnType<typeof fixture>, r: { id: string }) =>
  f.t.approve({
    id: r.id,
    contentHash: f.t.row(r.id).content_hash,
    confirm: true,
  });
test("UX observations/reports are scoped, immutable and explicitly simulation", () => {
  const f = fixture();
  try {
    const o = f.t.observation(observation());
    const r = f.t.report(report(o.id));
    assert.equal(
      technologyState(f.db, f.p.company_id).reports[0].body.simulation,
      true,
    );
    assert.throws(
      () =>
        f.db.prepare("UPDATE ux_reports SET body=? WHERE id=?").run("{}", r.id),
      /revision/,
    );
    assert.throws(
      () =>
        f.t.observation(
          observation({ page: "https://example.test/?token=secret" }),
        ),
      /without/,
    );
    assert.throws(
      () => f.t.observation(observation({ checks: {} })),
      /Invalid/,
    );
    const other = provision(
      f.db,
      "other-ux@example.test",
      "other-ux-password",
      "Other",
    );
    const t = new TechnologyService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(() => t.report(report(o.id)), /not found/);
    assert.throws(() => t.cancel(r), /not found/);
  } finally {
    f.db.close();
  }
});
test("approval binds exact content, expires, consumes once and gates Sarah assignment", () => {
  const f = fixture();
  try {
    const o = f.t.observation(observation()),
      r = f.t.report(report(o.id));
    assert.throws(() => f.t.assign(r), /approval/);
    assert.throws(
      () => f.t.approve({ id: r.id, contentHash: "wrong", confirm: true }),
      /Exact/,
    );
    approve(f, r);
    f.db.prepare("UPDATE ux_reports SET expires_at=0 WHERE id=?").run(r.id);
    assert.throws(() => f.t.assign(r), /approval/);
    approve(f, r);
    assert.equal(f.t.assign(r).externalAction, false);
    assert.throws(() => f.t.assign(r), /approval/);
    const live = f.t.observation(observation({ mode: "HUMAN" }));
    assert.throws(
      () => f.t.validate({ id: r.id, sourceIds: [live.id] }),
      /simulation/,
    );
    f.t.validate({
      id: r.id,
      sourceIds: [o.id],
      verdict: "REWORK",
      changeReference: "Synthetic branch",
      testEvidence: "Synthetic check failed",
      rollbackEvidence: "Synthetic rollback recorded",
      outcome: "Unknown actual improvement",
    });
    assert.equal(f.t.row(r.id).status, "REWORK");
    assert.throws(() => f.t.validate({ id: r.id }), /Assigned/);
  } finally {
    f.db.close();
  }
});
test("audit rollback and stop gates preserve report state", () => {
  const f = fixture();
  try {
    const o = f.t.observation(observation()),
      r = f.t.report(report(o.id));
    f.db.exec(
      "CREATE TRIGGER fail_ux_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(() => approve(f, r), /audit failed/);
    assert.equal(f.t.row(r.id).status, "PROPOSED");
    f.db.exec("DROP TRIGGER fail_ux_audit");
    approve(f, r);
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    assert.throws(() => f.t.assign(r), /paused/);
    f.t.cancel(r);
    assert.equal(f.t.row(r.id).status, "CANCELLED");
  } finally {
    f.db.close();
  }
});
test("public homepage boundary blocks private hosts/addresses and markup heuristics stay limited", () => {
  for (const h of [
    "localhost",
    "127.0.0.1",
    "https://example.com",
    "example.com/path",
    "store.local",
  ])
    assert.throws(() => host(h));
  assert.equal(host("store.example.com"), "store.example.com");
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "198.18.0.1",
  ])
    assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress("8.8.8.8"), true);
  assert.deepEqual(
    signals(
      '<html lang="en"><title>Test</title><meta name="viewport"><img src="a"><img alt="" src="b">',
    ),
    { title: true, language: true, viewport: true, imagesWithoutAlt: 1 },
  );
});
test("monitor is company-pinned, rate-limited and cannot commit after stop", async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.t.monitor({ hostname: "example.com", confirm: true }),
      /INTEGRATION/,
    );
    let calls = 0;
    const t = new TechnologyService(f.db, f.p, {
      config: () => ({ companyId: f.p.company_id, hostname: "example.com" }),
      probe: async () => {
        calls++;
        return {
          status: 200,
          durationMs: 100,
          bytes: 1000,
          html: true,
          signals: signals(""),
          label: "Fixture only",
        };
      },
    });
    await assert.rejects(
      t.monitor({ hostname: "evil.example", confirm: true }),
      /exact/,
    );
    await t.monitor({ hostname: "example.com", confirm: true });
    assert.equal(calls, 1);
    assert.equal(
      technologyState(f.db, f.p.company_id).observations[0].body.mode,
      "HTTP",
    );
    await assert.rejects(
      t.monitor({ hostname: "example.com", confirm: true }),
      /minute/,
    );
    f.db.prepare("UPDATE ux_monitor_runs SET started_at=0").run();
    t.deps.probe = async () => {
      f.db
        .prepare("UPDATE companies SET stopped=1 WHERE id=?")
        .run(f.p.company_id);
      throw new Error("Fixture interrupted");
    };
    await assert.rejects(
      t.monitor({ hostname: "example.com", confirm: true }),
      /failed/,
    );
    assert.equal(technologyState(f.db, f.p.company_id).observations.length, 1);
    assert.equal(
      technologyState(f.db, f.p.company_id).monitor!.status,
      "FAILED",
    );
  } finally {
    f.db.close();
  }
});
test("technology HTTP endpoints require CSRF and do not expose deployment", async () => {
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
      (await post("/api/technology/observation", observation())).status,
      401,
    );
    const login = await post("/api/login", {
        email: "ux@example.test",
        password: "ux-fixture-password",
      }),
      cookie = login.headers.get("set-cookie")!.split(";")[0],
      session = (await login.json()) as { csrf: string };
    assert.equal(
      (
        await post("/api/technology/observation", observation(), {
          Cookie: cookie,
        })
      ).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": session.csrf };
    assert.equal(
      (await post("/api/technology/observation", observation(), headers))
        .status,
      200,
    );
    assert.equal(
      (await post("/api/technology/deploy", {}, headers)).status,
      404,
    );
    assert.equal((await fetch(base + "/technology.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
