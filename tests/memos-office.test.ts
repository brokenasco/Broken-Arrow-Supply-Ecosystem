import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, id, now } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { MemoService, memoSections } from "../src/memos.ts";
import { OfficeService, officeStatus } from "../src/office.ts";
import { createApp } from "../src/server.ts";
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "memos@example.test",
      "synthetic-memo-password",
      "SIMULATION memos",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, m: new MemoService(db, p), o: new OfficeService(db, p) };
}
function input() {
  return {
    authorId: "boris",
    type: "GEN",
    subject: "Synthetic executive evidence",
    priority: "INFORMATION",
    actionRequired: false,
    ...Object.fromEntries(
      memoSections.map((k) => [
        k,
        k === "summary"
          ? "Synthetic evidence overview"
          : "DATA UNAVAILABLE — fixture record",
      ]),
    ),
  };
}
test("official memo numbering, FTS, revision lineage and immutable history", () => {
  const f = fixture();
  try {
    const a = f.m.submit(input()),
      b = f.m.submit(input());
    assert.match(a.id, /^BA-\d{4}-EXE-GEN-0001$/);
    assert.ok(b.id.endsWith("0002"));
    assert.equal(f.m.list({ query: a.id }).items.length, 1);
    assert.equal(f.m.list({ query: "synthetic evidence" }).items.length, 2);
    const r = f.m.submit({ ...input(), parentId: a.id, relation: "REVISION" }),
      r2 = f.m.submit({ ...input(), parentId: a.id, relation: "REVISION" }),
      add = f.m.submit({ ...input(), parentId: a.id, relation: "ADDENDUM" });
    assert.equal(r.id, a.id + "-R1");
    assert.equal(r2.id, a.id + "-R2");
    assert.equal(add.id, a.id + "-A1");
    assert.equal(f.m.get(a.id).related.length, 3);
    assert.throws(() =>
      f.m.submit({ ...input(), parentId: r.id, relation: "REVISION" }),
    );
    assert.throws(() =>
      f.db
        .prepare("UPDATE executive_memos SET subject=? WHERE id=?")
        .run("tampered", a.id),
    );
    assert.throws(() =>
      f.db.prepare("DELETE FROM executive_memos WHERE id=?").run(a.id),
    );
    assert.throws(() => f.db.exec("DELETE FROM memo_review_events"));
  } finally {
    f.db.close();
  }
});
test("memo tenant, author, validation, secret screening and audit rollback boundaries", () => {
  const f = fixture();
  try {
    const a = f.m.submit(input());
    const u = provision(
        f.db,
        "other@example.test",
        "synthetic-other-password",
        "Other",
      ),
      other = new MemoService(f.db, {
        id: u.user,
        company_id: u.company,
        role: "CEO",
      });
    assert.throws(() => other.get(a.id));
    assert.equal(other.list({ query: "synthetic" }).items.length, 0);
    assert.throws(() =>
      other.submit({ ...input(), parentId: a.id, relation: "ADDENDUM" }),
    );
    assert.throws(() => new MemoService(f.db, { ...f.p, id: "boris" }));
    assert.throws(() => f.m.submit({ ...input(), authorId: "mason" }));
    assert.throws(() => f.m.submit({ ...input(), actionRequired: "false" }));
    assert.throws(() => f.m.submit({ ...input(), type: "BAD" }));
    assert.throws(() =>
      f.m.submit({
        ...input(),
        summary: "password=SuperPrivateCredential123!",
      }),
    );
    f.db.exec(
      "CREATE TRIGGER fail_memo_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit down'); END",
    );
    assert.throws(() => f.m.submit(input()));
    assert.equal(f.m.list().items.length, 1);
    f.db.exec("DROP TRIGGER fail_memo_audit");
    assert.ok(f.m.submit(input()).id.endsWith("0002"));
  } finally {
    f.db.close();
  }
});
test("owner memo review cannot authorize money and is available during stop", () => {
  const f = fixture();
  try {
    const a = f.m.submit({
      ...input(),
      actionRequired: true,
      priority: "ACTION REQUIRED",
    });
    assert.throws(() =>
      f.m.review({ id: a.id, status: "APPROVED", reason: "Grant money" }),
    );
    assert.throws(() =>
      f.m.review({ id: a.id, status: "CLOSED", reason: "Resolved" }),
    );
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    assert.equal(
      f.m.review({ id: a.id, status: "REVIEWED", reason: "Owner read" }).status,
      "REVIEWED",
    );
    assert.throws(() => f.m.submit(input()));
    f.m.review({
      id: a.id,
      status: "CLOSED",
      reason: "No execution authorized",
      confirmNoExecution: true,
    });
    f.m.review({ id: a.id, status: "ARCHIVED", reason: "Retain permanently" });
    assert.equal(f.m.list().items.length, 0);
    assert.equal(f.m.list({ status: "ARCHIVED" }).items.length, 1);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_budget_overrides").get()!.n,
      0,
    );
    assert.throws(() =>
      f.m.review({ id: a.id, status: "REVIEWED", reason: "Reopen" }),
    );
  } finally {
    f.db.close();
  }
});
test("Pixel Office maps status, real registry floors and memo attention", () => {
  const f = fixture();
  try {
    assert.equal(officeStatus(["WORKING"], true), "OFFLINE");
    assert.equal(officeStatus(["FAILED"], false, true), "ERROR");
    assert.equal(officeStatus([], false, true), "NEEDS_APPROVAL");
    assert.equal(officeStatus([], false, false, true), "IN_MEETING");
    assert.equal(officeStatus(["WAITING FOR AGENT"]), "WAITING_FOR_AGENT");
    const a = f.m.submit(input()),
      v = f.o.view();
    assert.equal(v.coo, "boris");
    assert.equal(
      v.floors.length,
      Number(
        f.db
          .prepare("SELECT count(*) n FROM departments WHERE company_id=?")
          .get(f.p.company_id)!.n,
      ),
    );
    assert.ok(v.attention.some((x) => x.id === "memo:" + a.id));
    f.db
      .prepare("INSERT INTO departments(id,company_id,name) VALUES(?,?,?)")
      .run("new-department", f.p.company_id, "New department");
    assert.ok(f.o.view().floors.some((d) => d.id === "new-department"));
    f.m.review({ id: a.id, status: "REVIEWED", reason: "Read" });
    assert.ok(!f.o.view().attention.some((x) => x.id === "memo:" + a.id));
  } finally {
    f.db.close();
  }
});
test("unresolved memo action survives reading until explicit closure", () => {
  const f = fixture();
  try {
    const m = f.m.submit({ ...input(), actionRequired: true });
    f.m.review({ id: m.id, status: "REVIEWED", reason: "Read only" });
    assert.ok(f.o.view().attention.some((a) => a.id === "memo:" + m.id));
    f.m.review({
      id: m.id,
      status: "CLOSED",
      reason: "Closed without execution",
      confirmNoExecution: true,
    });
    assert.ok(!f.o.view().attention.some((a) => a.id === "memo:" + m.id));
  } finally {
    f.db.close();
  }
});

test("meeting context is preserved, tasks are scoped and meetings invoke no models", () => {
  const f = fixture();
  try {
    const meeting = f.o.start({
      topic: "Review synthetic task evidence",
      participants: ["boris", "mason"],
    });
    assert.equal(meeting.context.mode, "HUMAN_LED_CONTEXT_REVIEW");
    assert.equal(
      f.o.view().agents.find((a) => a.id === "boris")!.status,
      "IN_MEETING",
    );
    assert.throws(() =>
      f.o.start({ topic: "Invalid", participants: ["unknown"] }),
    );
    const project = id();
    f.db
      .prepare(
        "INSERT INTO projects(id,company_id,name,objective,owner,status,created_at) VALUES(?,?,?,?,'boris','ACTIVE',?)",
      )
      .run(project, f.p.company_id, "Test", "Test objective", now());
    const args = {
        id: meeting.id,
        projectId: project,
        agentId: "mason",
        objective: "Review evidence without external action",
      },
      task = f.o.createTask(args);
    assert.equal(f.o.createTask(args).id, task.id);
    assert.equal(f.o.meeting(meeting.id).tasks.length, 1);
    assert.throws(() => f.o.createTask({ ...args, agentId: "viktor" }));
    assert.throws(() =>
      f.db
        .prepare("UPDATE office_meetings SET context=? WHERE id=?")
        .run("{}", meeting.id),
    );
    f.o.close({
      id: meeting.id,
      summary: "Human reviewed evidence",
      decisions: "No external action authorized",
    });
    assert.throws(() =>
      f.o.close({
        id: meeting.id,
        summary: "Overwrite",
        decisions: "Overwrite",
      }),
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM ai_usage_ledger").get()!.n,
      0,
    );
    const u = provision(
      f.db,
      "meeting-other@example.test",
      "synthetic-other-password",
      "Other",
    );
    assert.throws(() =>
      new OfficeService(f.db, {
        id: u.user,
        company_id: u.company,
        role: "CEO",
      }).meeting(meeting.id),
    );
  } finally {
    f.db.close();
  }
});
test("Memo and Office HTTP routes require sessions and CSRF; approval endpoint absent", async () => {
  const f = fixture(),
    server = createApp(f.db, "http://localhost");
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address() as { port: number },
      base = `http://127.0.0.1:${addr.port}`;
    assert.equal((await fetch(base + "/api/memos/list")).status, 401);
    const login = await fetch(base + "/api/login", {
      method: "POST",
      headers: {
        Origin: "http://localhost",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "memos@example.test",
        password: "synthetic-memo-password",
      }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0],
      { csrf } = (await login.json()) as { csrf: string };
    assert.equal(
      (
        await fetch(base + "/api/memos/submit", {
          method: "POST",
          headers: {
            Origin: "http://localhost",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input()),
        })
      ).status,
      403,
    );
    const headers = {
      Origin: "http://localhost",
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    };
    const response = await fetch(base + "/api/memos/submit", {
      method: "POST",
      headers,
      body: JSON.stringify(input()),
    });
    assert.equal(response.status, 200);
    const submitted = (await response.json()) as { id: string };
    const exported = await fetch(base + "/api/memos/export", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: submitted.id, format: "pdf" }),
    });
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("content-type"), "application/pdf");
    assert.equal(
      Buffer.from(await exported.arrayBuffer())
        .subarray(0, 5)
        .toString(),
      "%PDF-",
    );
    assert.equal(
      (
        await fetch(base + "/api/memos/budget-decision", {
          method: "POST",
          headers: {
            Origin: "http://localhost",
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/office/state", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/api/memos/approve", {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      404,
    );
    for (const path of ["/office.css", "/office.js", "/memos.js"])
      assert.equal((await fetch(base + path)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.db.close();
  }
});
