import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, id } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { ExecutionControl } from "../src/execution-control.ts";
import { QuarantineService } from "../src/quarantine.ts";
import {
  outstandingOperations,
  quarantinePending,
} from "../src/quarantine-gates.ts";
import { fork } from "node:child_process";
import { once } from "node:events";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
test("simultaneous processes cannot create two active holds", async () => {
  const path = join(process.cwd(), "data", `quarantine-race-${id()}.sqlite`),
    db = openDatabase(path);
  const u = provision(
    db,
    "race@example.test",
    "synthetic-race-password",
    "SIMULATION race",
  );
  const children = [0, 1].map(() =>
    fork(
      new URL("./quarantine-race-worker.ts", import.meta.url),
      [path, u.company, u.user],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    ),
  );
  try {
    await Promise.all(children.map((child) => once(child, "message")));
    const results = children.map((child) => once(child, "message"));
    const exits = children.map((child) => once(child, "exit"));
    children.forEach((child) => child.send("GO"));
    assert.deepEqual((await Promise.all(results)).map((r) => r[0]).sort(), [
      "DENIED",
      "HELD",
    ]);
    await Promise.all(exits);
    assert.equal(
      db.prepare("SELECT count(*) n FROM agent_quarantine_holds").get()?.n,
      1,
    );
  } finally {
    children.forEach((child) => {
      if (child.exitCode === null) child.kill();
    });
    db.close();
    for (const suffix of ["", "-wal", "-shm"])
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
  }
});
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "execution@example.test",
      "synthetic-execution-password",
      "SIMULATION execution",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  return {
    db,
    p,
    e: new ExecutionControl(db, p),
    q: new QuarantineService(db, p),
  };
}
test("receipt bookkeeping is immutable, tenant scoped and atomic with audit", () => {
  const f = fixture();
  try {
    const op = f.e.begin({
      kind: "IMAGE",
      resourceId: id(),
      agents: ["jack"],
      requestKey: id(),
      effect: "PAID",
      timeoutMs: 10000,
    });
    f.db.exec(
      "CREATE TRIGGER deny_receipt_audit BEFORE INSERT ON audit_logs WHEN NEW.action='execution.receipt_recorded' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;",
    );
    assert.throws(
      () => f.e.receipt(op, "mock-reference", { total_tokens: 13 }),
      /audit failure/,
    );
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM execution_receipts").get()?.n,
      0,
    );
    f.db.exec("DROP TRIGGER deny_receipt_audit");
    f.e.receipt(op, "mock-reference", { total_tokens: 13, unsafe: "omitted" });
    f.e.receipt(op, "mock-reference", { total_tokens: 13 });
    assert.throws(
      () => f.e.receipt(op, "changed-reference", { total_tokens: 13 }),
      /conflicts/,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM audit_logs WHERE action='execution.receipt_recorded'",
        )
        .get()?.n,
      1,
    );
    const other = provision(
      f.db,
      "receipt-other@example.test",
      "synthetic-other-password",
      "Other fixture",
    );
    assert.throws(
      () =>
        new ExecutionControl(f.db, {
          id: other.user,
          company_id: other.company,
          role: "CEO",
        }).receipt(op, "mock-reference", {}),
      /not found/,
    );
  } finally {
    f.db.close();
  }
});
test("execution ownership is exact, duplicate requests deny, and hold generation fences old continuations", () => {
  const f = fixture();
  try {
    const input = {
        kind: "MOCK",
        resourceId: id(),
        agents: ["anna"],
        requestKey: id(),
        effect: "READ" as const,
        timeoutMs: 10000,
      },
      op = f.e.begin(input);
    assert.equal(outstandingOperations(f.db, f.p.company_id, "anna").length, 1);
    assert.equal(quarantinePending(f.db, f.p.company_id, "boris"), false);
    assert.throws(() => f.e.begin(input), /already recorded/);
    const hold = id();
    f.q.hold({
      agent: "anna",
      requestId: hold,
      reason: "Owner isolation",
      confirm: true,
    });
    assert.throws(() => f.e.checkpoint(op), /quarantined/);
    assert.throws(
      () => f.q.release({ holdId: hold, reason: "Premature", confirm: true }),
      /pending/,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM audit_logs WHERE action='quarantine.denied'",
        )
        .get()?.n,
      1,
    );
    f.e.finish(op, "STOPPED", "CANCEL_CONFIRMED");
    f.q.release({ holdId: hold, reason: "Stopped", confirm: true });
    assert.throws(() => f.e.checkpoint(op), /stopped/);
    assert.equal(f.e.row(op).state, "STOPPED");
  } finally {
    f.db.close();
  }
});
test("expired read is fenced; paid or write timeout remains unknown and cannot release", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const f = fixture();
  try {
    const read = f.e.begin({
      kind: "READ_TEST",
      resourceId: id(),
      agents: ["anna"],
      requestKey: id(),
      effect: "READ",
      timeoutMs: 1000,
    });
    const paid = f.e.begin({
      kind: "PAID_TEST",
      resourceId: id(),
      agents: ["jack"],
      requestKey: id(),
      effect: "PAID",
      timeoutMs: 1000,
    });
    assert.throws(() => f.e.recover(read), /expired/);
    t.mock.timers.tick(1001);
    assert.equal(f.e.recover(read).state, "STOPPED");
    assert.equal(f.e.recover(paid).state, "UNKNOWN");
    const hold = id();
    f.q.hold({
      agent: "jack",
      requestId: hold,
      reason: "Unknown billing",
      confirm: true,
    });
    assert.throws(
      () =>
        f.q.release({
          holdId: hold,
          reason: "Cannot infer safety",
          confirm: true,
        }),
      /pending/,
    );
    assert.throws(() => f.e.checkpoint(read), /stopped/);
    assert.throws(() => f.e.checkpoint(paid), /stopped/);
  } finally {
    f.db.close();
  }
});
test("cooperative signal aborts on hold without authorizing release", async () => {
  const f = fixture();
  try {
    const op = f.e.begin({
        kind: "MOCK",
        resourceId: id(),
        agents: ["anna"],
        requestKey: id(),
        effect: "READ",
        timeoutMs: 10000,
      }),
      watch = f.e.watch(op);
    try {
      const aborted = new Promise<void>((resolve, reject) => {
        const limit = setTimeout(
          () => reject(new Error("Abort not delivered")),
          2000,
        );
        watch.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(limit);
            resolve();
          },
          { once: true },
        );
      });
      f.q.hold({
        agent: "anna",
        requestId: id(),
        reason: "Owner cancellation",
        confirm: true,
      });
      await aborted;
      assert.equal(watch.signal.aborted, true);
      assert.equal(f.e.row(op).state, "RUNNING");
    } finally {
      watch.dispose();
    }
  } finally {
    f.db.close();
  }
});
test("execution APIs reject cross-company records and invalid participant identities", () => {
  const f = fixture();
  try {
    const op = f.e.begin({
      kind: "MOCK",
      resourceId: id(),
      agents: ["anna"],
      requestKey: id(),
      effect: "READ",
      timeoutMs: 10000,
    });
    const u = provision(
        f.db,
        "other-execution@example.test",
        "synthetic-execution-password",
        "Other simulation",
      ),
      other = new ExecutionControl(f.db, {
        id: u.user,
        company_id: u.company,
        role: "CEO",
      });
    assert.throws(() => other.row(op), /not found/);
    assert.throws(
      () =>
        f.e.begin({
          kind: "MOCK",
          resourceId: id(),
          agents: ["invented"],
          requestKey: id(),
          effect: "READ",
          timeoutMs: 10000,
        }),
      /paused/,
    );
    assert.throws(
      () => new ExecutionControl(f.db, { ...f.p, id: "viktor" }),
      /Authenticated/,
    );
  } finally {
    f.db.close();
  }
});
