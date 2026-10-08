import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { MemoGovernanceService } from "../src/memo-governance.ts";
import { ResourceService } from "../src/resources.ts";
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "governance@example.test",
      "synthetic-governance-password",
      "SIMULATION governance",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" };
  const g = new MemoGovernanceService(db, p);
  g.clock = () => new Date("2026-10-07T00:00:00Z");
  return {
    db,
    p,
    g,
    input: {
      departmentId: "product",
      effectiveMonth: "2026-11",
      limitUsd: "6",
      allocations: [],
      reason:
        "Synthetic workload analysis; explicitly increase monthly organization budget by one dollar.",
    },
  };
}
test("financial proposals do not change money until exact single-use owner approval; policy starts in future month", () => {
  const f = fixture();
  try {
    const p = f.g.propose(f.input),
      r = new ResourceService(f.db, f.p);
    assert.equal(r.budget("product", "2026-11"), 5e6);
    assert.throws(
      () =>
        f.g.decide({
          memoId: p.memo_id,
          contentHash: "tampered",
          confirm: true,
          decision: "APPROVED",
          reason: "Reviewed",
        }),
      /exact/,
    );
    f.g.decide({
      memoId: p.memo_id,
      contentHash: p.content_hash,
      confirm: true,
      decision: "APPROVED",
      reason: "Owner approves the exact increase",
    });
    assert.equal(r.budget("product", "2026-10"), 5e6);
    assert.equal(r.budget("product", "2026-11"), 6e6);
    assert.equal(r.budget("product", "2027-01"), 6e6);
    assert.throws(() => f.g.decide({ memoId: p.memo_id }), /pending/);
    assert.throws(
      () => f.db.exec("DELETE FROM memo_budget_decisions"),
      /retained/,
    );
    assert.throws(
      () => new MemoGovernanceService(f.db, { ...f.p, id: "boris" }),
      /CEO/,
    );
  } finally {
    f.db.close();
  }
});
test("expired, stale, denied and modified proposals cannot change budgets; audit failure rolls back decision and policy", () => {
  const f = fixture();
  try {
    const p = f.g.propose(f.input);
    f.g.clock = () => new Date("2026-10-07T00:11:00Z");
    assert.equal(f.g.get(p.memo_id)?.status, "EXPIRED");
    assert.throws(() => f.g.decide({ memoId: p.memo_id }), /pending/);
    const q = f.g.propose(f.input),
      d = {
        memoId: q.memo_id,
        contentHash: q.content_hash,
        confirm: true,
        decision: "APPROVED",
        reason: "Reviewed synthetic decision",
      };
    f.db.exec(
      "CREATE TRIGGER fail_governance_audit BEFORE INSERT ON audit_logs WHEN NEW.action='memo.budget_decided' BEGIN SELECT RAISE(ABORT,'audit failed'); END;",
    );
    assert.throws(() => f.g.decide(d), /audit failed/);
    assert.equal(f.g.get(q.memo_id)?.status, "PENDING");
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_budget_policies").get()?.n,
      0,
    );
    f.db.exec("DROP TRIGGER fail_governance_audit");
    f.db
      .prepare("UPDATE agents SET paused=1 WHERE company_id=? AND id='jack'")
      .run(f.p.company_id);
    assert.throws(() => f.g.decide(d), /changed/);
    f.g.decide({ ...d, decision: "DENIED" });
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM resource_budget_policies").get()?.n,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("explicit permanent worker allocations must match membership and total; membership changes restore equal distribution", () => {
  const f = fixture();
  try {
    const r = new ResourceService(f.db, f.p);
    r.clock = () => new Date("2026-11-01T00:00:00Z");
    const workers = f.g.state("product", "2026-11").members;
    const allocations = workers.map((agentId: string, i: number) => ({
      agentId,
      usd: i === 0 ? "3" : i === 1 ? "1" : "0.50",
    }));
    assert.equal(allocations.length, 6);
    assert.throws(
      () =>
        f.g.propose({
          ...f.input,
          allocations: [{ agentId: "boris", usd: "6" }],
        }),
      /every active/,
    );
    const p = f.g.propose({ ...f.input, allocations });
    f.g.decide({
      memoId: p.memo_id,
      contentHash: p.content_hash,
      confirm: true,
      decision: "APPROVED",
      reason: "Explicit worker allocation accepted",
    });
    assert.equal(r.snapshot(workers[0]).worker.allocationMicros, 3e6);
    f.db
      .prepare("UPDATE agents SET paused=1 WHERE company_id=? AND id=?")
      .run(f.p.company_id, workers[0]);
    assert.equal(r.snapshot(workers[1]).worker.allocationMicros, 1.2e6);
  } finally {
    f.db.close();
  }
});
