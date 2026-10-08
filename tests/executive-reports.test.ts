import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import {
  ExecutiveReportService,
  reportPeriod,
  tickExecutiveReports,
} from "../src/executive-reports.ts";
import { MemoService } from "../src/memos.ts";
import { exportMemo } from "../src/memo-export.ts";
import { ResourceService } from "../src/resources.ts";
function fixture() {
  const db = openDatabase(":memory:");
  const u = provision(
    db,
    "reports@example.test",
    "synthetic-report-password",
    "SIMULATION reporting",
  );
  const p = { id: u.user, company_id: u.company, role: "CEO" };
  const service = new ExecutiveReportService(db, p);
  service.clock = () => new Date("2026-10-07T12:00:00Z");
  return { db, p, service };
}
test("reporting locks completed calendar periods and retains idempotent evidence without invented ratings", () => {
  const f = fixture();
  try {
    assert.throws(() => f.service.close({ period: "2026-10" }), /completed/);
    assert.deepEqual(reportPeriod("2026-Q3", f.service.clock()).months, [
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const first = f.service.close({ period: "2026-09" });
    assert.equal(first.memos.length, 9);
    assert.ok(
      f.service.close({ period: "2026-09" }).memos.every((m) => m.existing),
    );
    const report = f.service.evidence(first.memos[0].id);
    assert.equal(report.evidence.allocations[0].snapshotId, null);
    assert.ok(
      report.evidence.agents.every(
        (a: any) => a.rating.includes("INSUFFICIENT") && a.tokens === null,
      ),
    );
    assert.throws(
      () => f.db.exec("DELETE FROM executive_report_closes"),
      /retained/,
    );
    assert.throws(
      () =>
        f.service.evaluate({
          memoId: report.memo_id,
          agentId: report.evidence.agents[0].agentId,
          rating: "Exceptional",
          rationale: "Unsupported assessment",
          contentHash: report.content_hash,
          evidenceIds: ["invented"],
        }),
      /supporting/,
    );
    const other = provision(
      f.db,
      "other-report@example.test",
      "synthetic-other-password",
      "Other simulation",
    );
    assert.throws(
      () =>
        new ExecutiveReportService(f.db, {
          id: other.user,
          company_id: other.company,
          role: "CEO",
        }).evidence(report.memo_id),
      /not found/,
    );
  } finally {
    f.db.close();
  }
});
test("scheduled reports require owner opt-in, backfill monthly closes and complete the prior quarter", () => {
  const f = fixture();
  try {
    tickExecutiveReports(f.db, f.service.clock());
    assert.equal(f.service.overview().reports.length, 0);
    f.service.configure({
      enabled: true,
      startMonth: "2026-07",
      confirm: true,
    });
    for (let i = 0; i < 5; i++) tickExecutiveReports(f.db, f.service.clock());
    assert.equal(f.service.overview().reports.length, 36);
    tickExecutiveReports(f.db, new Date("2026-11-07T00:00:00Z"));
    tickExecutiveReports(f.db, new Date("2026-11-07T00:00:00Z"));
    assert.equal(
      f.service.overview().reports.filter((r: any) => r.period === "2026-Q3")
        .length,
      9,
    );
    f.db
      .prepare("UPDATE companies SET stopped=1 WHERE id=?")
      .run(f.p.company_id);
    tickExecutiveReports(f.db, new Date("2026-12-07T00:00:00Z"));
    assert.ok(f.service.overview().settings?.last_error);
    assert.equal(
      f.service.overview().reports.filter((r: any) => r.period === "2026-11")
        .length,
      0,
    );
  } finally {
    f.db.close();
  }
});
test("finalized reports export real Word/PDF containers and audit each download", async () => {
  const f = fixture();
  try {
    const record = f.service.close({ period: "2026-09" }).memos[0];
    const service = new MemoService(f.db, f.p);
    const word = await exportMemo(service, { id: record.id, format: "docx" });
    const pdf = await exportMemo(service, { id: record.id, format: "pdf" });
    assert.equal(word.bytes.subarray(0, 2).toString(), "PK");
    assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(
      (pdf.bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
      2,
    );
    assert.ok(word.bytes.length > 5000 && pdf.bytes.length > 5000);
    assert.match(word.filename, /\.docx$/);
    await assert.rejects(
      exportMemo(service, { id: record.id, format: "html" }),
      /Choose/,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT count(*) n FROM audit_logs WHERE company_id=? AND action='memo.exported'",
        )
        .get(f.p.company_id)?.n,
      2,
    );
  } finally {
    f.db.close();
  }
});
test("scheduler catches up multiple missed quarters rather than skipping older reviews", () => {
  const f = fixture();
  try {
    f.service.configure({
      enabled: true,
      startMonth: "2026-07",
      confirm: true,
    });
    for (let i = 0; i < 9; i++)
      tickExecutiveReports(f.db, new Date("2027-02-01T00:00:00Z"));
    const quarters = f.service
      .overview()
      .reports.filter((r: any) => r.kind === "QUARTER");
    assert.equal(quarters.length, 18);
    assert.ok(quarters.some((r: any) => r.period === "2026-Q3"));
    assert.ok(quarters.some((r: any) => r.period === "2026-Q4"));
  } finally {
    f.db.close();
  }
});
test("financial close blocks unresolved calls atomically, captures actual ledger costs and binds human assessments to evidence", () => {
  const f = fixture();
  try {
    const r = new ResourceService(f.db, f.p);
    r.clock = () => new Date("2026-09-20T00:00:00Z");
    f.db
      .prepare(
        "INSERT INTO projects(id,company_id,name,objective,owner,status,created_at) VALUES('report-project',?,'SIMULATION','Synthetic','boris','ACTIVE','2026-09-01T00:00:00Z')",
      )
      .run(f.p.company_id);
    f.db
      .prepare(
        "INSERT INTO tasks(id,company_id,project_id,agent_id,objective,status,expected_output,created_at) VALUES('report-task',?,'report-project','jack','Synthetic work','QUEUED','Fixture','2026-09-02T00:00:00Z')",
      )
      .run(f.p.company_id);
    r.pricing({
      provider: "TEST",
      modelId: "report-model",
      displayName: "Synthetic",
      inputUsdPerMillion: "1",
      cachedUsdPerMillion: "0",
      outputUsdPerMillion: "1",
      source: "Synthetic fixture",
      effectiveAt: "2026-09-01T00:00:00Z",
      active: true,
      confirm: true,
    });
    r.setTaskLimits({
      taskId: "report-task",
      maxCostUsd: "0.20",
      maxCalls: 1,
      confirm: true,
    });
    const call = r.reserve({
      taskId: "report-task",
      agentId: "jack",
      provider: "TEST",
      modelId: "report-model",
      estimatedCostUsd: "0.10",
      requestKey: "report-call",
      requestHash: "synthetic-content",
      priority: "P1",
      taskType: "TEST",
    });
    assert.throws(() => f.service.close({ period: "2026-09" }), /Reconcile/);
    assert.equal(f.service.overview().reports.length, 0);
    r.reconcile({
      id: call.id,
      usageStatus: "ESTIMATED",
      costUsd: "0.08",
      outcome: "SUCCESS",
      evidence: "Synthetic provider bill",
    });
    const reports = f.service.close({ period: "2026-09" });
    const report = reports.memos
      .map((m) => f.service.evidence(m.id))
      .find((e) => e.department_id === "product")!;
    assert.equal(
      report.evidence.agents.find((a: any) => a.agentId === "jack").spentMicros,
      80000,
    );
    assert.ok(report.evidence.allocations[0].snapshotId);
    f.service.evaluate({
      memoId: report.memo_id,
      agentId: "jack",
      contentHash: report.content_hash,
      rating: "Meets Expectations",
      rationale:
        "Human reviewed the synthetic deliverable. No claim about unobserved output quality.",
      evidenceIds: ["report-task"],
    });
    assert.equal(f.service.overview().evaluations.length, 1);
    assert.throws(
      () => f.db.exec("UPDATE executive_evaluations SET rating='Exceptional'"),
      /retained/,
    );
  } finally {
    f.db.close();
  }
});
