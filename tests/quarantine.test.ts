import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, id } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { QuarantineService } from "../src/quarantine.ts";
import { HumanWorkflow } from "../src/workflow.ts";
import { CompanyService } from "../src/service.ts";
import { OfficeService } from "../src/office.ts";
import { checkPolicy } from "../src/policy.ts";
import { AutomationService } from "../src/automation.ts";
import { TechnologyService } from "../src/technology.ts";
import { signals } from "../src/site-probe.ts";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
test("holds survive restart, duplicate connections cannot double-hold, and audit failure rolls back", () => {
  const path = join(process.cwd(), "data", `quarantine-test-${id()}.sqlite`);
  let db = openDatabase(path);
  try {
    const u = provision(
        db,
        "restart@example.test",
        "synthetic-restart-password",
        "SIMULATION restart",
      ),
      p = { id: u.user, company_id: u.company, role: "CEO" };
    const input = {
      agent: "anna",
      requestId: id(),
      reason: "Persisted owner hold",
      confirm: true,
    };
    new QuarantineService(db, p).hold(input);
    const second = openDatabase(path);
    try {
      assert.throws(
        () =>
          new QuarantineService(second, p).hold({ ...input, requestId: id() }),
        /already held/,
      );
    } finally {
      second.close();
    }
    db.close();
    db = openDatabase(path);
    assert.throws(
      () => new HumanWorkflow(db, p).guard(["anna"]),
      /quarantined/,
    );
    db.exec(
      "CREATE TRIGGER quarantine_test_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    assert.throws(
      () =>
        new QuarantineService(db, p).release({
          holdId: input.requestId,
          reason: "Review complete",
          confirm: true,
        }),
      /audit unavailable/,
    );
    assert.throws(
      () => new HumanWorkflow(db, p).guard(["anna"]),
      /quarantined/,
    );
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
  }
});
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "hold@example.test",
      "synthetic-hold-password",
      "SIMULATION hold",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  return { db, p, q: new QuarantineService(db, p) };
}
test("in-flight probe shows stopping, cannot release early, and cannot commit agent output", async () => {
  const { db, p, q } = fixture();
  try {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const t = new TechnologyService(db, p, {
      config: () => ({ companyId: p.company_id, hostname: "example.com" }),
      probe: async () => {
        await pending;
        return {
          status: 200,
          durationMs: 1,
          bytes: 1,
          html: true,
          signals: signals(""),
          label: "Mock",
        };
      },
    });
    const run = t.monitor({ hostname: "example.com", confirm: true });
    const holdId = id();
    q.hold({
      agent: "dmitry",
      requestId: holdId,
      reason: "Owner stop during probe",
      confirm: true,
    });
    assert.equal(
      new OfficeService(db, p).view().agents.find((a) => a.id === "dmitry")
        ?.status,
      "QUARANTINE_PENDING",
    );
    assert.throws(
      () => q.release({ holdId, reason: "Too early", confirm: true }),
      /pending/,
    );
    finish();
    await assert.rejects(run, /stopped/);
    assert.equal(
      db.prepare("SELECT count(*) n FROM ux_observations").get()?.n,
      0,
    );
    q.release({ holdId, reason: "Stopped and reviewed", confirm: true });
    assert.doesNotThrow(() => new HumanWorkflow(db, p).guard(["dmitry"]));
  } finally {
    db.close();
  }
});
test("quarantine survives ordinary resume, is scoped, retains incoming messages and exact immutable release", () => {
  const { db, p, q } = fixture();
  try {
    const input = {
      agent: "anna",
      requestId: id(),
      reason: "Owner requested isolation",
      confirm: true,
    };
    q.hold(input);
    q.hold(input);
    new CompanyService(db, p).control("agent", "anna", false);
    assert.throws(
      () => new HumanWorkflow(db, p).guard(["anna"]),
      /quarantined/,
    );
    assert.doesNotThrow(() => new HumanWorkflow(db, p).guard(["boris"]));
    assert.throws(
      () =>
        checkPolicy(db, {
          company: p.company_id,
          agent: "anna",
          tool: "read",
          payload: {},
          external: false,
          risk: "GREEN",
        }),
      /quarantined/,
    );
    new CompanyService(db, p).chat({
      agentId: "anna",
      message: "Please review the pending work",
    });
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM messages WHERE agent_id='anna' AND role='ASSISTANT'",
        )
        .get()?.n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM messages WHERE agent_id='anna' AND role='CEO'",
        )
        .get()?.n,
      1,
    );
    assert.throws(
      () => new QuarantineService(db, { ...p, id: "viktor" }),
      /Authenticated/,
    );
    new CompanyService(db, p).control("agent", "anna", true);
    q.release({
      holdId: input.requestId,
      reason: "Owner reviewed evidence",
      confirm: true,
    });
    assert.throws(() => new HumanWorkflow(db, p).guard(["anna"]), /paused/);
    q.hold({ ...input, requestId: id(), previousHoldId: input.requestId });
    assert.throws(
      () =>
        q.release({ holdId: input.requestId, reason: "stale", confirm: true }),
      /Stale/,
    );
    assert.throws(
      () => db.exec("DELETE FROM agent_quarantine_holds"),
      /retained/,
    );
    assert.equal(
      new OfficeService(db, p).view().agents.find((a) => a.id === "anna")
        ?.status,
      "QUARANTINED",
    );
  } finally {
    db.close();
  }
});
test("quarantine does not consume due schedules or create execution attempts", () => {
  const { db, p, q } = fixture();
  try {
    const a = new AutomationService(db, p),
      r = a.create({
        title: "Synthetic review",
        kind: "RESEARCH_REVIEW",
        payload: {},
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
        intervalHours: 1,
        dailyLimit: 2,
        maxRuns: 3,
        budgetCents: 0,
        acknowledgeLimits: true,
        valueMetric: "Evidence checked",
        successCriterion: "List records needing review",
      });
    const exact = {
      ...r,
      contentHash: a.row(r.id).content_hash,
      confirm: true,
    };
    a.approve(exact);
    a.enable(exact);
    const before = a.row(r.id);
    q.hold({
      agent: "anna",
      requestId: id(),
      reason: "Owner review",
      confirm: true,
    });
    assert.deepEqual(a.runDue(r.id), { ran: false, reason: "QUARANTINED" });
    assert.deepEqual(a.row(r.id), before);
    assert.equal(
      db.prepare("SELECT count(*) n FROM automation_runs").get()?.n,
      0,
    );
  } finally {
    db.close();
  }
});
