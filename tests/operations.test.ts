import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  OperationsService,
  receiveOperationsWebhook,
  operationsState,
  normalizeEvent,
} from "../src/operations.ts";
import { API_VERSION } from "../src/shopify/client.ts";
import { createApp } from "../src/server.ts";
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "ops@example.test",
    "operations-test-password",
    "Synthetic operations",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" },
    config = {
      companyId: u.company,
      domain: "fixture.myshopify.com",
      secret: "fixture-signing-secret",
    };
  const o = new OperationsService(db, p);
  o.config = () => config;
  return { db, p, o, config };
}
function envelope(
  f: ReturnType<typeof fixture>,
  overrides = {},
  topic = "inventory_levels/update",
  eventId = "event-1",
) {
  const raw = Buffer.from(
    JSON.stringify({
      inventory_item_id: 1,
      location_id: 2,
      available: 0,
      updated_at: "2026-10-01T00:00:00Z",
      customer: { email: "discard@example.test" },
      ...overrides,
    }),
  );
  const headers = {
    "x-shopify-hmac-sha256": createHmac("sha256", f.config.secret)
      .update(raw)
      .digest("base64"),
    "x-shopify-shop-domain": f.config.domain,
    "x-shopify-api-version": API_VERSION,
    "x-shopify-event-id": eventId,
    "x-shopify-topic": topic,
    "x-shopify-triggered-at": "2026-10-01T00:00:00Z",
  };
  return { raw, headers };
}
const authorize = (f: ReturnType<typeof fixture>) =>
  f.o.authorize({ domain: f.config.domain, confirm: true });
test("signed receipts require human authorization and valid raw-body HMAC, discard customer fields, and deduplicate", () => {
  const f = fixture();
  try {
    const e = envelope(f);
    assert.throws(
      () => receiveOperationsWebhook(f.db, e.raw, e.headers, f.config),
      /authorized/,
    );
    authorize(f);
    assert.throws(
      () =>
        receiveOperationsWebhook(f.db, Buffer.from("{}"), e.headers, f.config),
      /signature/,
    );
    assert.throws(
      () =>
        receiveOperationsWebhook(
          f.db,
          e.raw,
          { ...e.headers, "x-shopify-shop-domain": "other.myshopify.com" },
          f.config,
        ),
      /Shop rejected/,
    );
    const r = receiveOperationsWebhook(f.db, e.raw, e.headers, f.config);
    assert.equal(r.duplicate, false);
    assert.equal(
      receiveOperationsWebhook(f.db, e.raw, e.headers, f.config).duplicate,
      true,
    );
    const saved = operationsState(f.db, f.p.company_id).events[0];
    assert.equal(JSON.stringify(saved).includes("discard@example.test"), false);
    const conflict = envelope(f, { available: 9 });
    assert.throws(
      () =>
        receiveOperationsWebhook(
          f.db,
          conflict.raw,
          conflict.headers,
          f.config,
        ),
      /conflicts/,
    );
    assert.equal(f.o.process().processed, 1);
    assert.equal(f.o.process().processed, 0);
    assert.equal(
      operationsState(f.db, f.p.company_id).alerts[0].kind,
      "LOW_INVENTORY",
    );
  } finally {
    f.db.close();
  }
});
test("out-of-order inventory never supersedes a newer event; null is not zero", () => {
  const f = fixture();
  try {
    authorize(f);
    const newer = envelope(
      f,
      { available: 20, updated_at: "2026-10-02T00:00:00Z" },
      undefined,
      "newer",
    );
    receiveOperationsWebhook(f.db, newer.raw, newer.headers, f.config);
    f.o.process();
    const older = envelope(f, {}, undefined, "older");
    receiveOperationsWebhook(f.db, older.raw, older.headers, f.config);
    assert.equal(f.o.process().processed, 0);
    assert.equal(
      operationsState(f.db, f.p.company_id).events.find(
        (e) => e.event_id === "older",
      )!.status,
      "IGNORED_OLDER",
    );
    const unknown = envelope(
      f,
      { available: null, updated_at: "2026-10-03T00:00:00Z" },
      undefined,
      "unknown",
    );
    receiveOperationsWebhook(f.db, unknown.raw, unknown.headers, f.config);
    f.o.process();
    assert.equal(
      operationsState(f.db, f.p.company_id).alerts.some(
        (a) => a.kind === "LOW_INVENTORY",
      ),
      false,
    );
    assert.throws(
      () =>
        normalizeEvent(
          "inventory_levels/update",
          Buffer.from(
            '{"inventory_item_id":9007199254740993,"location_id":2,"available":0}',
          ),
          "2026-10-01T00:00:00Z",
        ),
      /lossless/,
    );
  } finally {
    f.db.close();
  }
});
test("stop permits authorized capture but blocks processing; disconnect rejects new receipts", () => {
  const f = fixture();
  try {
    authorize(f);
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    const e = envelope(f);
    receiveOperationsWebhook(f.db, e.raw, e.headers, f.config);
    assert.throws(() => f.o.process(), /paused/);
    assert.equal(
      operationsState(f.db, f.p.company_id).events[0].status,
      "RECEIVED",
    );
    f.o.disconnect();
    const other = envelope(f, {}, undefined, "event-2");
    assert.throws(
      () => receiveOperationsWebhook(f.db, other.raw, other.headers, f.config),
      /authorized/,
    );
  } finally {
    f.db.close();
  }
});
test("receipt and processing rollback with audit failure, and simulation remains separate", () => {
  const f = fixture();
  try {
    authorize(f);
    f.db.exec(
      "CREATE TRIGGER ops_audit_fail BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    const e = envelope(f);
    assert.throws(
      () => receiveOperationsWebhook(f.db, e.raw, e.headers, f.config),
      /audit failed/,
    );
    assert.equal(operationsState(f.db, f.p.company_id).events.length, 0);
    f.db.exec("DROP TRIGGER ops_audit_fail");
    f.o.simulate({ kind: "LOW_INVENTORY" });
    f.db.exec(
      "CREATE TRIGGER ops_audit_fail BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed'); END",
    );
    assert.throws(() => f.o.process(), /audit failed/);
    assert.equal(operationsState(f.db, f.p.company_id).alerts.length, 0);
    assert.equal(
      operationsState(f.db, f.p.company_id).events[0].status,
      "RECEIVED",
    );
    f.db.exec("DROP TRIGGER ops_audit_fail");
    f.o.process();
    assert.equal(operationsState(f.db, f.p.company_id).alerts[0].simulation, 1);
  } finally {
    f.db.close();
  }
});
test("operations incidents are tenant-scoped, escalate internally and resolve once", () => {
  const f = fixture();
  try {
    f.o.simulate({ kind: "FULFILLMENT_FAILURE" });
    f.o.process();
    const alert = operationsState(f.db, f.p.company_id).alerts[0];
    const i = f.o.incident({ alertId: alert.id, note: "Synthetic triage" });
    assert.throws(
      () => f.o.incident({ alertId: alert.id, note: "Duplicate" }),
      /already/,
    );
    f.o.transition({
      id: i.id,
      status: "ESCALATED",
      owner: "rachel",
      note: "Synthetic escalation only",
    });
    assert.equal(
      operationsState(f.db, f.p.company_id).incidents[0].owner,
      "rachel",
    );
    const other = provision(
      f.db,
      "other-ops@example.test",
      "other-operations-password",
      "Other",
    );
    const o = new OperationsService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(
      () => o.transition({ id: i.id, status: "RESOLVED", note: "Foreign" }),
      /not found/,
    );
    f.o.transition({
      id: i.id,
      status: "RESOLVED",
      note: "Synthetic resolution; no remote change",
    });
    assert.throws(
      () =>
        f.o.transition({
          id: i.id,
          status: "ESCALATED",
          owner: "ceo",
          note: "Replay",
        }),
      /terminal/,
    );
  } finally {
    f.db.close();
  }
});
test("public webhook HTTP uses HMAC instead of CSRF while control routes retain session protections", async () => {
  const f = fixture();
  authorize(f);
  const origin = "http://127.0.0.1",
    server = createApp(f.db, origin, false, {}, {}, {}, f.config);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  try {
    const e = envelope(f);
    const send = (raw: Buffer, headers: Record<string, string>) =>
      fetch(base + "/webhooks/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: raw.toString("utf8"),
      });
    assert.equal((await send(e.raw, e.headers)).status, 200);
    assert.equal((await send(Buffer.from("{}"), e.headers)).status, 401);
    assert.equal(
      (await send(e.raw, { ...e.headers, "x-shopify-api-version": "2020-01" }))
        .status,
      409,
    );
    assert.equal(
      (
        await fetch(base + "/api/operations/process", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      401,
    );
    assert.equal((await fetch(base + "/operations.js")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
    f.db.close();
  }
});
