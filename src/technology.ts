import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, choice, ids, iso, integer } from "./workflow.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { id, now, transaction, audit } from "./db.ts";
import { host, probe, type ProbeResult } from "./site-probe.ts";
export const uxChecks = [
  "keyboardNavigation",
  "focusVisibility",
  "formLabels",
  "imageAlternatives",
  "contrast",
  "mobileOverflow",
  "mobileNavigation",
  "touchTargets",
  "checkoutJourney",
] as const;
export const uxFields = [
  "problem",
  "evidence",
  "customerImpact",
  "proposedChange",
  "expectedImpact",
  "measurementPlan",
  "implementationPlan",
  "rollbackPlan",
] as const;
export type TechnologyDependencies = {
  config?: () => { companyId: string; hostname: string } | null;
  probe?: (hostname: string, signal: AbortSignal) => Promise<ProbeResult>;
};
const config = () =>
  process.env.UX_MONITOR_COMPANY_ID && process.env.UX_MONITOR_HOST
    ? {
        companyId: process.env.UX_MONITOR_COMPANY_ID,
        hostname: host(process.env.UX_MONITOR_HOST),
      }
    : null;
const parsed = (r: any) => ({ ...r, body: JSON.parse(String(r.body)) });
export function technologyState(db: DatabaseSync, company: string) {
  const observations = db
    .prepare(
      "SELECT * FROM ux_observations WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company)
    .map((r) => ({
      ...parsed(r),
      fresh: Date.parse(parsed(r).body.expiresAt) > Date.now(),
    }));
  const reports = db
    .prepare(
      "SELECT * FROM ux_reports WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company)
    .map((r) => ({
      ...parsed(r),
      sourceIds: db
        .prepare(
          "SELECT observation_id FROM ux_report_sources WHERE company_id=? AND report_id=?",
        )
        .all(company, String(r.id))
        .map((s) => String(s.observation_id)),
      approvalExpired:
        r.status === "APPROVED" && Number(r.expires_at) <= Date.now(),
    }));
  return {
    checks: uxChecks,
    fields: uxFields,
    observations,
    reports,
    validations: db
      .prepare(
        "SELECT * FROM ux_validations WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map(parsed),
    monitor:
      db
        .prepare(
          "SELECT started_at,status FROM ux_monitor_runs WHERE company_id=?",
        )
        .get(company) ?? null,
    label:
      "Human-triggered checks and human-entered UX evidence. No scheduler, browser audit or production deployment.",
  };
}
export class TechnologyService extends HumanWorkflow {
  deps: TechnologyDependencies;
  constructor(
    db: DatabaseSync,
    p: ConstructorParameters<typeof HumanWorkflow>[1],
    deps: TechnologyDependencies = {},
  ) {
    super(db, p);
    this.deps = deps;
  }
  observation(input: Record<string, unknown>) {
    return this.mutate(
      "technology.observation_recorded",
      "observation",
      ["wilhelm", "dmitry"],
      () => {
        const mode = choice(input.mode, ["SIMULATION", "HUMAN"], "Mode");
        const page = field(input.page, "Page URL", 1000);
        let url: URL;
        try {
          url = new URL(page);
        } catch {
          throw new DomainError("Valid HTTPS page URL required");
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new DomainError(
            "Use HTTPS URL without credentials, query or fragment; it is recorded only",
          );
        const observedAt = iso(input.observedAt, "Observed at"),
          expiresAt = iso(input.expiresAt, "Review due");
        if (
          Date.parse(observedAt) > Date.now() ||
          Date.parse(expiresAt) <= Date.now() ||
          Date.parse(expiresAt) - Date.now() > 31 * 86400000
        )
          throw new DomainError(
            "Observation must be past; review due within 31 days",
          );
        const checks = input.checks as Record<string, unknown>;
        if (!checks || typeof checks !== "object")
          throw new DomainError("UX checks required");
        const results = Object.fromEntries(
          uxChecks.map((k) => [
            k,
            choice(checks[k], ["PASS", "FAIL", "NOT_TESTED"], k),
          ]),
        );
        const body = {
          mode,
          page: url.href,
          observedAt,
          expiresAt,
          device: field(input.device, "Device/browser/viewport", 300),
          method: field(input.method, "Method and evidence", 4000),
          findings: field(input.findings, "Findings and limitations", 4000),
          checks: results,
        };
        return this.save(field(input.title, "Title", 160), body);
      },
    );
  }
  save(title: string, body: Record<string, unknown>) {
    const record = id();
    this.db
      .prepare("INSERT INTO ux_observations VALUES(?,?,?,?,?)")
      .run(record, this.p.company_id, title, JSON.stringify(body), now());
    return { id: record };
  }
  async monitor(input: Record<string, unknown>) {
    this.guard(["dmitry", "sarah"]);
    const c = (this.deps.config ?? config)();
    if (!c || c.companyId !== this.p.company_id)
      throw new DomainError(
        "INTEGRATION REQUIRED: server-configured company and storefront host",
        409,
      );
    let hostname: string;
    try {
      hostname = host(c.hostname);
    } catch {
      throw new DomainError("Invalid configured public hostname");
    }
    if (input.confirm !== true || input.hostname !== hostname)
      throw new DomainError("Confirm the exact configured storefront hostname");
    const token = id();
    const execution = new ExecutionControl(this.db, this.p);
    let operation = "";
    this.mutate(
      "technology.monitor_started",
      hostname,
      ["dmitry", "sarah"],
      () => {
        const old = this.db
          .prepare("SELECT * FROM ux_monitor_runs WHERE company_id=?")
          .get(this.p.company_id);
        if (old && Date.now() - Number(old.started_at) < 60000)
          throw new DomainError("Wait one minute between checks", 409);
        operation = execution.begin({
          kind: "MONITOR",
          resourceId: token,
          agents: ["dmitry", "sarah"],
          requestKey: "monitor:" + token,
          effect: "READ",
          timeoutMs: 30000,
        });
        this.db
          .prepare(
            "INSERT INTO ux_monitor_runs VALUES(?,?,?,'RUNNING') ON CONFLICT(company_id) DO UPDATE SET started_at=excluded.started_at,token=excluded.token,status='RUNNING'",
          )
          .run(this.p.company_id, Date.now(), token);
      },
    );
    const watch = execution.watch(operation);
    try {
      execution.checkpoint(operation);
      const result = await (this.deps.probe ?? probe)(
        hostname,
        AbortSignal.any([watch.signal, AbortSignal.timeout(20000)]),
      );
      execution.checkpoint(operation);
      return this.mutate(
        "technology.monitor_recorded",
        hostname,
        ["dmitry", "sarah"],
        () => {
          const active = this.db
            .prepare("SELECT token FROM ux_monitor_runs WHERE company_id=?")
            .get(this.p.company_id);
          if (active?.token !== token)
            throw new DomainError("Monitor run superseded", 409);
          const record = this.save("HTTP check · " + hostname, {
            mode: "HTTP",
            page: "https://" + hostname + "/",
            observedAt: now(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            result,
          });
          this.db
            .prepare(
              "UPDATE ux_monitor_runs SET status='COMPLETE' WHERE company_id=? AND token=?",
            )
            .run(this.p.company_id, token);
          execution.finish(operation, "COMPLETE", "OBSERVATION_RECORDED");
          return record;
        },
      );
    } catch {
      transaction(this.db, () => {
        this.authenticate();
        execution.finish(operation, "STOPPED", "MONITOR_STOPPED");
        this.db
          .prepare(
            "UPDATE ux_monitor_runs SET status='FAILED' WHERE company_id=? AND token=?",
          )
          .run(this.p.company_id, token);
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "technology.monitor_failed",
          hostname,
          "FAILED",
        );
      });
      throw new DomainError(
        "Monitor failed or stopped. No successful observation recorded; inspect configuration and retry after the cooldown.",
        502,
      );
    } finally {
      watch.dispose();
    }
  }
  sources(value: unknown) {
    const list = ids(value, "Observations");
    const rows = list.map((s) => {
      const r = this.db
        .prepare("SELECT * FROM ux_observations WHERE company_id=? AND id=?")
        .get(this.p.company_id, s);
      if (!r) throw new DomainError("Observation not found", 404);
      const body = parsed(r).body;
      if (Date.parse(body.expiresAt) <= Date.now())
        throw new DomainError("Fresh observations required", 409);
      return body;
    });
    const simulation = rows[0].mode === "SIMULATION";
    if (rows.some((r) => (r.mode === "SIMULATION") !== simulation))
      throw new DomainError("Do not mix simulation and real observations");
    return { list, simulation };
  }
  report(input: Record<string, unknown>) {
    return this.mutate(
      "technology.report_created",
      "report",
      ["wilhelm", "dmitry"],
      () => {
        const sources = this.sources(input.sourceIds),
          parent = input.parentId ? String(this.row(input.parentId).id) : null;
        const confidence = input.confidence;
        if (
          typeof confidence !== "number" ||
          !Number.isFinite(confidence) ||
          confidence < 0 ||
          confidence > 1
        )
          throw new DomainError("Confidence must be 0–1");
        const body = {
          ...Object.fromEntries(
            uxFields.map((k) => [k, field(input[k], k, 2000)]),
          ),
          priority: choice(
            input.priority,
            ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            "Priority",
          ),
          confidence,
          simulation: sources.simulation,
          assignee: "sarah",
          scope: "Internal implementation plan; no deployment authority",
        };
        const record = id();
        this.db
          .prepare(
            "INSERT INTO ux_reports VALUES(?,?,?,?,?,?,'PROPOSED',NULL,NULL,NULL,?)",
          )
          .run(
            record,
            this.p.company_id,
            parent,
            field(input.title, "Title", 160),
            JSON.stringify(body),
            payloadHash(body),
            now(),
          );
        for (const source of sources.list)
          this.db
            .prepare("INSERT INTO ux_report_sources VALUES(?,?,?)")
            .run(this.p.company_id, record, source);
        return { id: record };
      },
    );
  }
  row(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM ux_reports WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Report", 80));
    if (!r) throw new DomainError("Report not found", 404);
    return r;
  }
  validateSources(report: string) {
    return this.sources(
      this.db
        .prepare(
          "SELECT observation_id FROM ux_report_sources WHERE company_id=? AND report_id=?",
        )
        .all(this.p.company_id, report)
        .map((s) => String(s.observation_id)),
    );
  }
  approve(input: Record<string, unknown>) {
    return this.mutate(
      "technology.report_approved",
      String(input.id),
      ["dmitry", "garry"],
      () => {
        const r = this.row(input.id);
        if (
          r.status !== "PROPOSED" &&
          !(r.status === "APPROVED" && Number(r.expires_at) <= Date.now())
        )
          throw new DomainError("Report not awaiting approval", 409);
        if (
          input.confirm !== true ||
          input.contentHash !== r.content_hash ||
          payloadHash(parsed(r).body) !== r.content_hash
        )
          throw new DomainError("Exact report approval required", 409);
        this.validateSources(String(r.id));
        this.db
          .prepare(
            "UPDATE ux_reports SET status='APPROVED',approved_by=?,expires_at=? WHERE company_id=? AND id=?",
          )
          .run(this.p.id, Date.now() + 600000, this.p.company_id, String(r.id));
        return { ok: true };
      },
    );
  }
  assign(input: Record<string, unknown>) {
    return this.mutate(
      "technology.assigned_to_sarah",
      String(input.id),
      ["dmitry", "sarah"],
      () => {
        const r = this.row(input.id);
        if (
          r.status !== "APPROVED" ||
          r.consumed_at ||
          Number(r.expires_at) <= Date.now()
        )
          throw new DomainError("Unexpired single-use approval required", 409);
        this.validateSources(String(r.id));
        this.db
          .prepare(
            "UPDATE ux_reports SET status='IN_PROGRESS',consumed_at=? WHERE company_id=? AND id=?",
          )
          .run(now(), this.p.company_id, String(r.id));
        return { assignee: "sarah", externalAction: false };
      },
    );
  }
  validate(input: Record<string, unknown>) {
    return this.mutate(
      "technology.validation_recorded",
      String(input.id),
      ["sarah", "wilhelm", "dmitry"],
      () => {
        const r = this.row(input.id);
        if (r.status !== "IN_PROGRESS")
          throw new DomainError("Assigned report required", 409);
        const sources = this.sources(input.sourceIds);
        if (sources.simulation !== parsed(r).body.simulation)
          throw new DomainError("Validation simulation mode must match report");
        const body = {
          verdict: choice(input.verdict, ["VALIDATED", "REWORK"], "Verdict"),
          sourceIds: sources.list,
          changeReference: field(
            input.changeReference,
            "Local branch/PR/change reference",
            1000,
          ),
          testEvidence: field(
            input.testEvidence,
            "Test results and limitations",
            4000,
          ),
          rollbackEvidence: field(
            input.rollbackEvidence,
            "Rollback verification",
            2000,
          ),
          outcome: field(input.outcome, "Measured outcome", 2000),
          label:
            "Human-reported validation; not proof of deployment or causal conversion improvement",
        };
        this.db
          .prepare("INSERT INTO ux_validations VALUES(?,?,?,?,?)")
          .run(
            id(),
            this.p.company_id,
            String(r.id),
            JSON.stringify(body),
            now(),
          );
        this.db
          .prepare("UPDATE ux_reports SET status=? WHERE company_id=? AND id=?")
          .run(body.verdict, this.p.company_id, String(r.id));
        return { ok: true };
      },
    );
  }
  cancel(input: Record<string, unknown>) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(input.id);
      if (["CANCELLED", "VALIDATED", "REWORK"].includes(String(r.status)))
        throw new DomainError("Report is terminal", 409);
      this.db
        .prepare(
          "UPDATE ux_reports SET status='CANCELLED' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, String(r.id));
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "technology.report_cancelled",
        String(r.id),
      );
      return { ok: true };
    });
  }
}
import { ExecutionControl } from "./execution-control.ts";
