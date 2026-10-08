import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, choice } from "./workflow.ts";
import { MemoService } from "./memos.ts";
import { id, now, audit, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
type Row = Record<string, any>;
export function reportPeriod(value: unknown, clock = new Date()) {
  const period = field(value, "Completed month or quarter", 7);
  let year: number, month: number, length: number;
  if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) {
    year = +period.slice(0, 4);
    month = +period.slice(5) - 1;
    length = 1;
  } else if (/^20\d{2}-Q[1-4]$/.test(period)) {
    year = +period.slice(0, 4);
    month = (+period.slice(6) - 1) * 3;
    length = 3;
  } else throw new DomainError("Use YYYY-MM or YYYY-Q1 through Q4");
  const start = new Date(Date.UTC(year, month, 1)).toISOString(),
    end = new Date(Date.UTC(year, month + length, 1)).toISOString();
  if (end > clock.toISOString())
    throw new DomainError("Only completed reporting periods can be closed");
  return {
    period,
    start,
    end,
    kind: length === 1 ? "MONTH" : "QUARTER",
    months: Array.from({ length }, (_, i) =>
      new Date(Date.UTC(year, month + i, 1)).toISOString().slice(0, 7),
    ),
  };
}
const usd = (n: number) => "$" + (n / 1e6).toFixed(6);
export class ExecutiveReportService extends HumanWorkflow {
  clock = () => new Date();
  overview() {
    this.authenticate();
    return {
      settings:
        this.db
          .prepare(
            "SELECT * FROM executive_reporting_settings WHERE company_id=?",
          )
          .get(this.p.company_id) ?? null,
      reports: this.db
        .prepare(
          "SELECT period,department_id,kind,memo_id,content_hash,created_at FROM executive_report_closes WHERE company_id=? ORDER BY period DESC,department_id LIMIT 200",
        )
        .all(this.p.company_id),
      evaluations: this.db
        .prepare(
          "SELECT * FROM executive_evaluations WHERE company_id=? ORDER BY created_at DESC LIMIT 200",
        )
        .all(this.p.company_id),
    };
  }
  close(input: Row) {
    return this.mutate(
      "executive.period_closed",
      String(input.period),
      [],
      () => {
        const range = reportPeriod(input.period, this.clock()),
          memos = new MemoService(this.db, this.p),
          catalogue = memos.catalogue(),
          c = this.p.company_id,
          created: Row[] = [];
        for (const department of catalogue.departments) {
          const dep = String(department.id),
            organizationReview =
              range.kind === "QUARTER" && dep === "executive",
            existing = this.db
              .prepare(
                "SELECT memo_id FROM executive_report_closes WHERE company_id=? AND period=? AND department_id=? AND kind=?",
              )
              .get(c, range.period, dep, range.kind);
          if (existing) {
            created.push({ id: existing.memo_id, existing: true });
            continue;
          }
          const author = catalogue.authors.find((a) => a.department === dep);
          if (!author)
            throw new DomainError(
              "Reporting requires a registered department leader: " + dep,
              409,
            );
          const ledger = this.db
            .prepare(
              "SELECT id,agent_id,department_id,task_id,kind,cost_micros,total_tokens,usage_status,outcome,budget_month FROM ai_usage_ledger WHERE company_id=? AND (? OR department_id=?) AND budget_month>=? AND budget_month<=? ORDER BY created_at,id",
            )
            .all(
              c,
              organizationReview ? 1 : 0,
              dep,
              range.months[0],
              range.months.at(-1)!,
            ) as Row[];
          const holds = this.db
            .prepare(
              "SELECT id FROM resource_reservations WHERE company_id=? AND (? OR department_id=?) AND budget_month>=? AND budget_month<=? AND state IN('RESERVED','UNCERTAIN')",
            )
            .all(
              c,
              organizationReview ? 1 : 0,
              dep,
              range.months[0],
              range.months.at(-1)!,
            );
          if (holds.length)
            throw new DomainError(
              "Reconcile outstanding reservations before closing " + dep,
              409,
            );
          const allocations = range.months.map((month) => {
            const r = this.db
              .prepare(
                "SELECT id,body FROM agent_budget_allocations WHERE company_id=? AND budget_month=? ORDER BY rowid DESC LIMIT 1",
              )
              .get(c, month);
            return {
              month,
              snapshotId: r?.id ?? null,
              organizationDepartments:
                organizationReview && r
                  ? JSON.parse(String(r.body)).departments
                  : null,
              department: r
                ? (JSON.parse(String(r.body)).departments.find(
                    (d: Row) => d.id === dep,
                  ) ?? null)
                : null,
            };
          });
          const tasks = this.db
            .prepare(
              "SELECT t.id,t.agent_id,t.status,t.created_at,t.completed_at FROM tasks t JOIN agents a ON a.company_id=t.company_id AND a.id=t.agent_id WHERE t.company_id=? AND (? OR a.department=?) AND ((t.created_at>=? AND t.created_at<?) OR (t.completed_at>=? AND t.completed_at<?)) ORDER BY t.id",
            )
            .all(
              c,
              organizationReview ? 1 : 0,
              dep,
              range.start,
              range.end,
              range.start,
              range.end,
            ) as Row[];
          const agents = this.db
            .prepare(
              "SELECT id,definition FROM agents WHERE company_id=? AND (? OR department=?) ORDER BY id",
            )
            .all(c, organizationReview ? 1 : 0, dep)
            .map((a) => ({
              id: String(a.id),
              ...JSON.parse(String(a.definition)),
            }));
          const rows = agents.map((a) => {
            const work = tasks.filter((t) => t.agent_id === a.id),
              usage = ledger.filter((l) => l.agent_id === a.id),
              completed = work.filter(
                (t) =>
                  t.completed_at >= range.start &&
                  t.completed_at < range.end &&
                  t.status === "COMPLETE",
              ),
              cohort = work.filter(
                (t) => t.created_at >= range.start && t.created_at < range.end,
              ),
              tokens = usage.filter((l) => l.kind === "CHARGE");
            return {
              agentId: a.id,
              name: a.name,
              title: a.title,
              assigned: cohort.length,
              completed: completed.length,
              cohortCompletionRate: cohort.length
                ? cohort.filter((t) => t.status === "COMPLETE").length /
                  cohort.length
                : null,
              failedAtSnapshot: work.filter((t) => t.status === "FAILED")
                .length,
              spentMicros: usage.reduce((n, l) => n + Number(l.cost_micros), 0),
              tokens:
                tokens.length && tokens.every((l) => l.total_tokens !== null)
                  ? tokens.reduce((n, l) => n + Number(l.total_tokens), 0)
                  : null,
              calls: tokens.length,
              evidenceIds: [
                ...work.map((t) => t.id),
                ...usage.map((l) => l.id),
              ],
              rating: "INSUFFICIENT DATA FOR RELIABLE EVALUATION",
              quality:
                "DATA UNAVAILABLE — requires evidenced reviewer assessment",
            };
          });
          const monthly = range.months.map((month) => ({
            month,
            recordedCostMicros: ledger
              .filter((l) => l.budget_month === month)
              .reduce((n, l) => n + Number(l.cost_micros), 0),
          }));
          const evidence = {
            period: range,
            department: dep,
            leader: author.id,
            asOf: now(),
            allocations,
            agents: rows,
            ledger,
            tasks,
            monthly,
            organizationReview,
            costStatistics: {
              averageMonthlyMicros:
                monthly.reduce((n, m) => n + m.recordedCostMicros, 0) /
                monthly.length,
              medianMonthlyMicros: [...monthly].sort(
                (a, b) => a.recordedCostMicros - b.recordedCostMicros,
              )[Math.floor(monthly.length / 2)].recordedCostMicros,
              peakMonthlyMicros: Math.max(
                ...monthly.map((m) => m.recordedCostMicros),
              ),
              lowestMonthlyMicros: Math.min(
                ...monthly.map((m) => m.recordedCostMicros),
              ),
            },
            coverage:
              "Recorded ledger only. Missing usage is not zero provider billing. Agent membership and task status are observed at report generation; historical assignment changes are not reconstructed.",
            temporaryFunding:
              "DATA UNAVAILABLE until funding approvals are recorded through the governed funding service",
            quality: "INSUFFICIENT DATA FOR RELIABLE EVALUATION",
            recommendation:
              "No automatic allocation change. Review measured workload and quality evidence before proposing a change.",
          };
          const amount = ledger.reduce((n, l) => n + Number(l.cost_micros), 0),
            kind =
              range.kind === "MONTH"
                ? "Monthly department report"
                : organizationReview
                  ? "Quarterly organization allocation review"
                  : "Quarterly department head review";
          const sender =
            range.kind === "QUARTER"
              ? catalogue.authors.find((a) => a.id === "boris")
              : author;
          if (!sender) throw new DomainError("Registered COO required", 409);
          const memo = memos.submit({
            authorId: sender.id,
            type:
              range.kind === "MONTH"
                ? "TOK"
                : organizationReview
                  ? "REA"
                  : "DEV",
            subject: `${range.period} ${department.name} ${kind}`,
            priority: "INFORMATION",
            actionRequired: false,
            purpose: `Review the completed period ${range.start.slice(0, 10)} through ${range.end.slice(0, 10)} (exclusive), UTC. Department: ${department.name}.`,
            summary: `Recorded inference expenditure ${usd(amount)} across ${ledger.filter((l) => l.kind === "CHARGE").length} charged requests. This is measured ledger coverage; unavailable provider data is not assumed to be zero.`,
            details: organizationReview
              ? monthly
                  .map(
                    (m) => `${m.month}: ${usd(m.recordedCostMicros)} recorded.`,
                  )
                  .join("\n") +
                `\nAverage: ${usd(evidence.costStatistics.averageMonthlyMicros)}; median: ${usd(evidence.costStatistics.medianMonthlyMicros)}; peak: ${usd(evidence.costStatistics.peakMonthlyMicros)}; low: ${usd(evidence.costStatistics.lowestMonthlyMicros)}. All ${rows.length} agent breakdowns are preserved in supporting evidence and export tables. No budget increase or permanent reallocation is recommended without workload and quality evidence.`
              : rows
                  .map(
                    (a) =>
                      `${a.name}: ${a.assigned} tasks assigned in period; ${a.completed} completions in period; ${a.failedAtSnapshot} failed at snapshot; ${usd(a.spentMicros)} recorded; tokens ${a.tokens ?? "DATA UNAVAILABLE"}.`,
                  )
                  .join("\n") || "No registered agents.",
            analysis:
              "Completion cohorts and period completions are different measures. Current task states do not prove the state at month-end. Quality, causal attribution, rework and leadership effectiveness require reviewer evidence. Low spend alone does not establish efficiency.",
            recommendation: evidence.recommendation,
            ownerAction:
              "Review only. Record evidence-backed evaluations where adequate data exists; otherwise retain INSUFFICIENT DATA FOR RELIABLE EVALUATION.",
            supportingData: `Evidence is preserved in the linked reporting snapshot. ${allocations.filter((a) => a.snapshotId).length}/${range.months.length} months have allocation snapshots. Missing historical allocations: DATA UNAVAILABLE. Temporary reallocations expire each month; permanent changes require separate owner authorization. Default department budget remains $5 USD; tokens are usage, not the budget currency.`,
          });
          this.db
            .prepare(
              "INSERT INTO executive_report_closes VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              c,
              range.period,
              dep,
              range.kind,
              memo.id,
              JSON.stringify(evidence),
              payloadHash(evidence),
              now(),
            );
          created.push({ id: memo.id, existing: false });
        }
        return { period: range.period, memos: created };
      },
    );
  }
  evidence(memoId: unknown): Row {
    this.authenticate();
    const r = this.db
      .prepare(
        "SELECT * FROM executive_report_closes WHERE company_id=? AND memo_id=?",
      )
      .get(this.p.company_id, field(memoId, "Memo", 120));
    if (!r) throw new DomainError("Reporting evidence not found", 404);
    return { ...r, evidence: JSON.parse(String(r.evidence)) };
  }
  evaluate(input: Row) {
    return this.mutate(
      "executive.evaluation_recorded",
      String(input.memoId),
      [],
      () => {
        const report = this.evidence(input.memoId),
          e = report.evidence,
          agent = field(input.agentId, "Agent", 80),
          subject = e.agents.find((a: Row) => a.agentId === agent);
        if (!subject)
          throw new DomainError("Subject must appear in the report", 403);
        if (report.kind === "QUARTER" && agent !== e.leader)
          throw new DomainError(
            "Quarterly head review requires the recorded leader",
          );
        const rating = choice(
            input.rating,
            [
              "Exceptional",
              "Exceeds Expectations",
              "Meets Expectations",
              "Needs Improvement",
              "Unsatisfactory",
            ] as const,
            "rating",
          ),
          rationale = field(input.rationale, "Evidence-based rationale", 3000);
        screenKnowledge(rationale);
        if (input.contentHash !== report.content_hash)
          throw new DomainError("Exact evidence hash required", 409);
        if (
          !Array.isArray(input.evidenceIds) ||
          !input.evidenceIds.length ||
          input.evidenceIds.length > 20 ||
          input.evidenceIds.some(
            (v: unknown) =>
              typeof v !== "string" ||
              !(
                report.kind === "QUARTER"
                  ? e.agents.flatMap((a: Row) => a.evidenceIds)
                  : subject.evidenceIds
              ).includes(v),
          )
        )
          throw new DomainError(
            "Select supporting records belonging to this subject",
          );
        const record = id();
        this.db
          .prepare(
            "INSERT INTO executive_evaluations VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            record,
            this.p.company_id,
            report.memo_id,
            agent,
            rating,
            rationale,
            JSON.stringify([...new Set(input.evidenceIds)]),
            this.p.id,
            now(),
          );
        return { id: record };
      },
    );
  }
  configure(input: Row) {
    return this.mutate(
      "executive.reporting_configured",
      "reporting",
      [],
      () => {
        if (input.confirm !== true || typeof input.enabled !== "boolean")
          throw new DomainError("Owner confirmation required");
        const month = field(input.startMonth, "First month", 7);
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))
          throw new DomainError("Valid start month required");
        this.db
          .prepare(
            "INSERT INTO executive_reporting_settings VALUES(?,?,?,?,NULL,NULL) ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled,start_month=excluded.start_month,authorized_by=excluded.authorized_by,last_error=NULL",
          )
          .run(this.p.company_id, input.enabled ? 1 : 0, month, this.p.id);
        return { ok: true };
      },
    );
  }
}
export function tickExecutiveReports(db: DatabaseSync, clock = new Date()) {
  const settings = db
    .prepare("SELECT * FROM executive_reporting_settings WHERE enabled=1")
    .all();
  for (const s of settings) {
    try {
      const service = new ExecutiveReportService(db, {
        id: String(s.authorized_by),
        company_id: String(s.company_id),
        role: "CEO",
      });
      service.clock = () => clock;
      const previous = new Date(
        Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() - 1, 1),
      )
        .toISOString()
        .slice(0, 7);
      let month = String(s.start_month);
      let processed = false;
      while (month <= previous) {
        const count = Number(
            db
              .prepare(
                "SELECT count(*) n FROM executive_report_closes WHERE company_id=? AND period=? AND kind='MONTH'",
              )
              .get(s.company_id, month)!.n,
          ),
          departments = Number(
            db
              .prepare("SELECT count(*) n FROM departments WHERE company_id=?")
              .get(s.company_id)!.n,
          );
        if (count < departments) {
          service.close({ period: month });
          processed = true;
          break;
        }
        const d = new Date(month + "-01T00:00:00Z");
        d.setUTCMonth(d.getUTCMonth() + 1);
        month = d.toISOString().slice(0, 7);
      }
      if (!processed) {
        const first = new Date(String(s.start_month) + "-01T00:00:00Z");
        first.setUTCMonth(Math.ceil(first.getUTCMonth() / 3) * 3);
        const currentQuarter = Date.UTC(
          clock.getUTCFullYear(),
          Math.floor(clock.getUTCMonth() / 3) * 3,
          1,
        );
        const departments = Number(
          db
            .prepare("SELECT count(*) n FROM departments WHERE company_id=?")
            .get(s.company_id)!.n,
        );
        while (first.getTime() < currentQuarter) {
          const period = `${first.getUTCFullYear()}-Q${Math.floor(first.getUTCMonth() / 3) + 1}`;
          const closed = Number(
            db
              .prepare(
                "SELECT count(*) n FROM executive_report_closes WHERE company_id=? AND period=? AND kind='QUARTER'",
              )
              .get(s.company_id, period)!.n,
          );
          if (closed < departments) {
            service.close({ period });
            break;
          }
          first.setUTCMonth(first.getUTCMonth() + 3);
        }
      }
      transaction(db, () => {
        service.authenticate();
        db.prepare(
          "UPDATE executive_reporting_settings SET last_error=NULL,last_attempt_at=? WHERE company_id=?",
        ).run(now(), s.company_id);
        audit(
          db,
          String(s.company_id),
          String(s.authorized_by),
          "executive.reporting_checked",
          "reporting",
          "SUCCESS",
        );
      });
    } catch {
      transaction(db, () => {
        const previous = db
          .prepare(
            "SELECT last_error FROM executive_reporting_settings WHERE company_id=?",
          )
          .get(s.company_id);
        db.prepare(
          "UPDATE executive_reporting_settings SET last_error=?,last_attempt_at=? WHERE company_id=?",
        ).run(
          "Reporting blocked. Review owner authorization, company controls and unsettled reservations.",
          now(),
          s.company_id,
        );
        if (!previous?.last_error) {
          db.prepare(
            "INSERT INTO notifications(id,company_id,priority,message,created_at) VALUES(?,?,'HIGH',?,?)",
          ).run(
            id(),
            s.company_id,
            "Executive reporting failed safely. No budget or approval was changed. Review reporting settings.",
            now(),
          );
        }
        audit(
          db,
          String(s.company_id),
          String(s.authorized_by),
          "executive.reporting_failed",
          "reporting",
          "FAILURE",
        );
      });
    }
  }
}
