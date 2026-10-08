import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, transaction } from "../src/db.ts";
import { provision, login, session } from "../src/auth.ts";
import { CompanyService } from "../src/service.ts";
import { checkPolicy, payloadHash } from "../src/policy.ts";
import { agents } from "../src/registry.ts";
import { UnconfiguredProvider } from "../src/providers.ts";
import { receiveWebhook } from "../src/webhooks.ts";
import { createApp } from "../src/server.ts";

test("approval proposal content and history cannot be rewritten", () => {
  const f = fixture();
  try {
    const proposal = f.service.requestApproval({
      agentId: "tyler",
      tool: "product.publish",
      summary: "Exact draft v1",
      risk: "YELLOW",
    });
    assert.throws(
      () =>
        f.db
          .prepare("UPDATE approvals SET payload=? WHERE id=?")
          .run('{"summary":"different"}', proposal.id),
      /immutable/,
    );
    assert.throws(
      () => f.db.prepare("DELETE FROM approvals WHERE id=?").run(proposal.id),
      /immutable/,
    );
    f.service.decide(proposal.id, "REJECTED");
    assert.equal(f.service.state().approvals[0].state, "REJECTED");
  } finally {
    f.db.close();
  }
});

test("HTTP login preserves password whitespace exactly", async () => {
  const db = openDatabase(":memory:");
  const password = "  exact password whitespace  ";
  provision(db, "space@example.test", password, "Whitespace test");
  const origin = "http://127.0.0.1:3100",
    app = createApp(db, origin);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const port = (app.address() as { port: number }).port;
  try {
    const request = (value: string) =>
      fetch(`http://127.0.0.1:${port}/api/login`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: "space@example.test", password: value }),
      });
    assert.equal((await request(password)).status, 200);
    assert.equal((await request(password.trim())).status, 401);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    db.close();
  }
});
function fixture() {
  const db = openDatabase(":memory:");
  const account = provision(
    db,
    "ceo@example.test",
    "long-test-password-123",
    "Test company",
  );
  const p = { id: account.user, company_id: account.company, role: "CEO" };
  return { db, ...account, p, service: new CompanyService(db, p) };
}
test("registry preserves every named employee and independent compliance", () => {
  assert.equal(agents.length, 24);
  assert.equal(new Set(agents.map((a) => a.id)).size, 24);
  assert.equal(agents.find((a) => a.id === "victoria")?.manager, "ceo");
  for (const a of agents) {
    assert.equal(a.allowedIntegrations.length, 0);
    assert.equal(a.costLimits.dailyCents, 0);
  }
});
test("CEO credentials and sessions have no plaintext password or stored bearer token", () => {
  const f = fixture();
  try {
    assert.equal(login(f.db, "ceo@example.test", "wrong"), null);
    const result = login(f.db, "ceo@example.test", "long-test-password-123")!;
    assert.ok(result);
    assert.equal(session(f.db, result.token)?.id, f.user);
    assert.notEqual(
      f.db.prepare("SELECT token_hash FROM sessions").get()?.token_hash,
      result.token,
    );
    assert.notEqual(
      f.db.prepare("SELECT password_hash FROM users").get()?.password_hash,
      "long-test-password-123",
    );
  } finally {
    f.db.close();
  }
});
test("policy denies unknown, ungranted, paused and externally executed actions", () => {
  const f = fixture();
  try {
    const a = {
      company: f.company,
      agent: "mason",
      tool: "research.draft",
      payload: {},
      external: false,
      risk: "GREEN" as const,
    };
    checkPolicy(f.db, a);
    assert.throws(
      () => checkPolicy(f.db, { ...a, tool: "product.delete" }),
      /permission/,
    );
    assert.throws(
      () => checkPolicy(f.db, { ...a, external: true }),
      /disabled/,
    );
    f.service.control("agent", "mason", true);
    assert.throws(() => checkPolicy(f.db, a), /paused/);
    f.service.control("agent", "mason", false);
    f.service.control("department", "marketing", true);
    assert.throws(() => checkPolicy(f.db, a), /paused/);
    f.service.control("department", "marketing", false);
    f.service.control("company", "company", true);
    assert.throws(() => checkPolicy(f.db, a), /paused/);
    assert.throws(
      () => checkPolicy(f.db, { ...a, company: "other" }),
      /Unknown/,
    );
  } finally {
    f.db.close();
  }
});
test("agents cannot approve; matching, unexpired CEO approval is required", () => {
  const f = fixture();
  try {
    assert.throws(
      () => new CompanyService(f.db, { ...f.p, id: "mason", role: "AGENT" }),
      /CEO/,
    );
    const { id } = f.service.requestApproval({
      agentId: "mason",
      tool: "research.draft",
      summary: "Specific proposal",
      risk: "YELLOW",
    });
    const a = {
      company: f.company,
      agent: "mason",
      tool: "research.draft",
      payload: { summary: "Specific proposal" },
      external: false,
      risk: "YELLOW" as const,
      approvalId: id,
    };
    assert.throws(() => checkPolicy(f.db, a), /approval/);
    f.service.decide(id, "APPROVED");
    checkPolicy(f.db, a);
    assert.throws(() => f.service.decide(id, "APPROVED"), /already/);
    assert.throws(
      () => checkPolicy(f.db, { ...a, payload: { summary: "Changed" } }),
      /approval/,
    );
    f.db.prepare("UPDATE approvals SET state='CONSUMED' WHERE id=?").run(id);
    assert.throws(() => checkPolicy(f.db, a), /approval/);
    f.db
      .prepare("UPDATE approvals SET state='APPROVED',expires_at=0 WHERE id=?")
      .run(id);
    assert.throws(() => checkPolicy(f.db, a), /approval/);
  } finally {
    f.db.close();
  }
});
test("self-approval and cross-company approval access denied", () => {
  const f = fixture();
  try {
    const { id } = f.service.requestApproval({
      agentId: "mason",
      tool: "research.draft",
      summary: "Review",
      risk: "RED",
    });
    assert.throws(
      () => new CompanyService(f.db, { ...f.p, id: "mason" }),
      /Authenticated company CEO/,
    );
    const other = provision(
      f.db,
      "other@example.test",
      "another-long-password",
      "Other",
    );
    const svc = new CompanyService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(() => svc.decide(id, "APPROVED"), /not found/);
    assert.equal(svc.state().approvals.length, 0);
  } finally {
    f.db.close();
  }
});
test("canonical hashes are stable across key order and change with content", () => {
  assert.equal(payloadHash({ b: 2, a: 1 }), payloadHash({ a: 1, b: 2 }));
  assert.notEqual(payloadHash({ a: 1 }), payloadHash({ a: 2 }));
});
test("tasks dedupe, preserve lineage, start blocked, and cannot cross tenant boundary", () => {
  const f = fixture();
  try {
    const project = f.service.state().projects[0];
    const task = {
      projectId: project.id,
      agentId: "mason",
      objective: "Research an opportunity",
    };
    const first = f.service.task(task);
    const second = f.service.task(task);
    assert.equal(first.id, second.id);
    assert.equal(f.service.state().tasks[0].status, "BLOCKED");
    const other = provision(
      f.db,
      "other@example.test",
      "another-long-password",
      "Other",
    );
    const svc = new CompanyService(f.db, {
      id: other.user,
      company_id: other.company,
      role: "CEO",
    });
    assert.throws(() => svc.task(task), /not found/);
    f.service.cancel(String(first.id));
    assert.throws(() => f.service.cancel(String(first.id)), /terminal/);
    assert.equal(f.service.state().tasks[0].objective, task.objective);
  } finally {
    f.db.close();
  }
});
test("audit records resist update/delete and mutation rolls back with audit failure", () => {
  const f = fixture();
  try {
    assert.throws(() => f.db.exec("DELETE FROM audit_logs"), /immutable/);
    assert.throws(
      () => f.db.exec("UPDATE audit_logs SET result='bad'"),
      /immutable/,
    );
    assert.throws(() =>
      transaction(f.db, () => {
        f.db
          .prepare("UPDATE companies SET stopped=1 WHERE id=?")
          .run(f.company);
        throw new Error("failure");
      }),
    );
    assert.equal(f.service.state().company?.stopped, 0);
    f.db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;",
    );
    assert.throws(
      () => f.service.control("company", "company", true),
      /unavailable/,
    );
    assert.equal(f.service.state().company?.stopped, 0);
  } finally {
    f.db.close();
  }
});
test("knowledge requires evidence, separates claims from verified status, and sanitizes source protocols", () => {
  const f = fixture();
  try {
    const item = {
      title: "Finding",
      body: "A hypothesis",
      classification: "HYPOTHESIS",
      category: "market",
      evidence: "Survey notes",
      confidence: 0.5,
      reviewAt: "2026-12-01",
      research: true,
    };
    assert.throws(
      () => f.service.memory({ ...item, sourceUrl: "javascript:alert(1)" }),
      /HTTP/,
    );
    assert.throws(
      () => f.service.memory({ ...item, confidence: 2 }),
      /Confidence/,
    );
    f.service.memory(item);
    assert.equal(f.service.state().research.length, 1);
    assert.equal(f.service.state().memory[0].status, "NEEDS VERIFICATION");
  } finally {
    f.db.close();
  }
});
test("unconfigured providers never report success", async () => {
  const p = new UnconfiguredProvider();
  const result = await p.execute({}, new AbortController().signal);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INTEGRATION REQUIRED");
});
test("authenticated webhook receipts are deduplicated and invalid signatures fail", () => {
  const f = fixture();
  try {
    const raw = Buffer.from('{"id":123}'),
      secret = "test-secret",
      store = String(f.service.state().stores[0].id);
    const input = {
      company: f.company,
      store,
      eventId: "event-1",
      raw,
      secret,
      signature: createHmac("sha256", secret).update(raw).digest("base64"),
    };
    assert.equal(receiveWebhook(f.db, input).duplicate, false);
    assert.equal(receiveWebhook(f.db, input).duplicate, true);
    assert.equal(
      f.db.prepare("SELECT count(*) count FROM webhook_events").get()?.count,
      1,
    );
    assert.throws(
      () => receiveWebhook(f.db, { ...input, raw: Buffer.from("{}") }),
      /signature/,
    );
    assert.throws(
      () => receiveWebhook(f.db, { ...input, store: "foreign" }),
      /store/,
    );
  } finally {
    f.db.close();
  }
});
test("persistent company state survives database reopen and migrations do not reseed", () => {
  const dir = mkdtempSync(join(tmpdir(), "company-os-"));
  try {
    const path = join(dir, "test.sqlite");
    let db = openDatabase(path);
    const p = provision(
      db,
      "persist@example.test",
      "long-persistence-password",
      "Persistent company",
    );
    new CompanyService(db, {
      id: p.user,
      company_id: p.company,
      role: "CEO",
    }).control("agent", "jack", true);
    db.close();
    db = openDatabase(path);
    assert.equal(
      db.prepare("SELECT paused FROM agents WHERE id='jack'").get()?.paused,
      1,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM agents").get()?.n, 24);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("HTTP enforces authentication, origin, CSRF, method and durable controls", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1:3100",
    app = createApp(f.db, origin);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const address = app.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const post = (
      path: string,
      body: object,
      extra: Record<string, string> = {},
    ) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...extra,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(base + "/api/state")).status, 401);
    assert.equal(
      (
        await post(
          "/api/login",
          { email: "ceo@example.test", password: "long-test-password-123" },
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    const logged = await post("/api/login", {
      email: "ceo@example.test",
      password: "long-test-password-123",
    });
    assert.equal(logged.status, 200);
    const cookie = logged.headers.get("set-cookie")!.split(";")[0],
      { csrf } = (await logged.json()) as { csrf: string };
    assert.match(logged.headers.get("set-cookie")!, /HttpOnly/);
    assert.equal(
      (
        await post(
          "/api/control",
          { kind: "company", paused: true },
          { Cookie: cookie },
        )
      ).status,
      403,
    );
    const headers = { Cookie: cookie, "X-CSRF-Token": csrf };
    assert.equal(
      (await post("/api/control", { kind: "company", paused: true }, headers))
        .status,
      200,
    );
    const state = (await (
      await fetch(base + "/api/state", { headers: { Cookie: cookie } })
    ).json()) as any;
    assert.equal(state.company.stopped, 1);
    assert.equal(state.agents.length, 24);
    assert.equal(state.metrics.revenue, null);
    assert.equal(
      (
        await post(
          "/api/control",
          { kind: "agent", target: "jack", paused: "true" },
          headers,
        )
      ).status,
      400,
    );
    const chat = (await (
      await post("/api/chat", { message: "Generate five products" }, headers)
    ).json()) as any;
    assert.match(chat.reply, /INTEGRATION REQUIRED/);
    assert.equal(
      (
        await fetch(base + "/api/state", {
          method: "DELETE",
          headers: { Cookie: cookie },
        })
      ).status,
      405,
    );
    await post("/api/logout", {}, headers);
    assert.equal(
      (await fetch(base + "/api/state", { headers: { Cookie: cookie } }))
        .status,
      401,
    );
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    f.db.close();
  }
});
