import type { DatabaseSync } from "node:sqlite";
import { activeQuarantine } from "./quarantine-gates.ts";
import { HumanWorkflow, field, choice, integer, iso } from "./workflow.ts";
import { id, now, audit, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { AnalyticsService, analyticsState } from "./analytics.ts";
import { DesignService } from "./design.ts";
import { ProductService } from "./products.ts";
import { MarketingService } from "./marketing.ts";
import { sourceRows } from "./research.ts";
export const automationKinds = [
  "RESEARCH_REVIEW",
  "GENERATION_QUEUE",
  "PRODUCT_PROPOSAL",
  "REPORT",
  "CAMPAIGN_DRAFT",
  "EXPERIMENT_PLAN",
  "INVENTORY_PROJECTION",
  "UX_REVIEW",
] as const;
type Kind = (typeof automationKinds)[number];
const owners: Record<Kind, string[]> = {
  RESEARCH_REVIEW: ["anna", "mason"],
  GENERATION_QUEUE: ["mark", "jack"],
  PRODUCT_PROPOSAL: ["alex", "garry"],
  REPORT: ["sofia", "benjamin", "maria"],
  CAMPAIGN_DRAFT: ["katerina", "anna"],
  EXPERIMENT_PLAN: ["sofia", "maria"],
  INVENTORY_PROJECTION: ["rachel", "sergey"],
  UX_REVIEW: ["dmitry", "sarah"],
};
export const automationDescriptions: Record<Kind, string> = {
  RESEARCH_REVIEW: "Review stored research freshness; no web search",
  GENERATION_QUEUE: "Queue an image proposal; no generation or paid dispatch",
  PRODUCT_PROPOSAL: "Create a local product proposal; no Shopify write",
  REPORT: "Save a report from available Shopify snapshots",
  CAMPAIGN_DRAFT: "Create internal campaign copy; no sending or spending",
  EXPERIMENT_PLAN: "Create an experiment plan; no automatic launch or results",
  INVENTORY_PROJECTION: "Project recent net inventory change; no purchasing",
  UX_REVIEW: "Review stored UX observation freshness; no website request",
};
export function automationState(db: DatabaseSync, company: string) {
  return {
    kinds: automationKinds,
    descriptions: automationDescriptions,
    workerEnabled: process.env.AUTOMATION_ENABLED === "true",
    schedules: db
      .prepare(
        "SELECT * FROM automation_schedules WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({ ...r, body: JSON.parse(String(r.body)) })),
    runs: db
      .prepare(
        "SELECT * FROM automation_runs WHERE company_id=? ORDER BY rowid DESC LIMIT 100",
      )
      .all(company)
      .map((r) => ({
        ...r,
        id: String(r.id),
        status: String(r.status),
        output: JSON.parse(String(r.output)),
      })),
  };
}
export function inventoryProjection(db: DatabaseSync, company: string) {
  const rows = db
    .prepare(
      "SELECT domain,simulation,body FROM operations_events WHERE company_id=? AND topic='inventory_levels/update' AND status='PROCESSED' AND created_at>=? ORDER BY created_at LIMIT 2000",
    )
    .all(company, new Date(Date.now() - 30 * 86400000).toISOString());
  const groups = new Map<
    string,
    { simulation: boolean; points: { available: number; time: number }[] }
  >();
  for (const r of rows) {
    const b = JSON.parse(String(r.body));
    if (typeof b.available !== "number") continue;
    const time = Date.parse(b.observedAt);
    if (
      !Number.isFinite(time) ||
      time > Date.now() ||
      time < Date.now() - 30 * 86400000
    )
      continue;
    const key = JSON.stringify([r.domain, r.simulation, b.entity]);
    const g = groups.get(key) ?? { simulation: !!r.simulation, points: [] };
    g.points.push({ available: b.available, time });
    groups.set(key, g);
  }
  return {
    method:
      "Net-change linear projection; not demand forecasting. Restocks, missing events and adjustments confound the estimate. No automatic replenishment.",
    truncated: rows.length === 2000,
    items: [...groups].map(([entity, g]) => {
      const points = [
          ...new Map(g.points.map((p) => [p.time, p])).values(),
        ].sort((a, b) => a.time - b.time),
        first = points[0],
        last = points.at(-1)!;
      const days = (last.time - first.time) / 86400000;
      const eligible =
        rows.length < 2000 &&
        points.length >= 3 &&
        new Set(points.map((p) => Math.floor(p.time / 86400000))).size >= 3 &&
        days >= 2 &&
        Date.now() - last.time <= 2 * 86400000;
      const rate = eligible ? (last.available - first.available) / days : null;
      return {
        entity,
        simulation: g.simulation,
        observations: points.length,
        asOf: new Date(last.time).toISOString(),
        available: last.available,
        netUnitsPerDay: rate,
        daysToZero:
          rate !== null && rate < 0
            ? Math.max(0, last.available / -rate)
            : null,
        label: eligible
          ? "DESCRIPTIVE PROJECTION"
          : "UNAVAILABLE — need three distinct observed days and a recent snapshot",
      };
    }),
  };
}
export class AutomationService extends HumanWorkflow {
  row(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM automation_schedules WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Schedule", 80));
    if (!r) throw new DomainError("Schedule not found", 404);
    return r;
  }
  create(input: Record<string, unknown>) {
    return this.mutate("automation.created", "automation", [], () => {
      const kind = choice(input.kind, automationKinds, "Automation kind");
      this.guard(owners[kind]);
      if (input.acknowledgeLimits !== true)
        throw new DomainError("Confirm internal-only automation limits");
      const payload = input.payload ?? {};
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        JSON.stringify(payload).length > 20000
      )
        throw new DomainError(
          "Payload must be an object up to 20000 characters",
        );
      if (
        [
          "RESEARCH_REVIEW",
          "REPORT",
          "INVENTORY_PROJECTION",
          "UX_REVIEW",
        ].includes(kind) &&
        Object.keys(payload).length
      )
        throw new DomainError("This review takes no payload");
      // Proposals have independent downstream validation. Schedules never approve or dispatch them.
      if (
        ["confirm", "acknowledgeBilling", "approved_by", "company_id"].some(
          (k) => k in payload,
        )
      )
        throw new DomainError("Payload cannot grant authority");
      const startsAt = iso(input.startsAt, "First run"),
        endsAt = iso(input.endsAt, "Authorization end");
      if (
        Date.parse(startsAt) < Date.now() - 60000 ||
        Date.parse(endsAt) <= Date.parse(startsAt) ||
        Date.parse(endsAt) > Date.now() + 30 * 86400000
      )
        throw new DomainError(
          "First run must be current/future and authorization must end within 30 days",
        );
      if (input.budgetCents !== 0)
        throw new DomainError(
          "Only zero external-spend automation is supported",
        );
      if (
        Number(
          this.db
            .prepare(
              "SELECT COUNT(*) n FROM automation_schedules WHERE company_id=? AND status NOT IN('EXPIRED','EXHAUSTED')",
            )
            .get(this.p.company_id)!.n,
        ) >= 20
      )
        throw new DomainError(
          "Maximum 20 pending or active schedules per company",
          409,
        );
      const body = {
        kind,
        payload,
        startsAt,
        endsAt,
        intervalHours: integer(input.intervalHours, "Interval hours", 1, 168),
        dailyLimit: integer(input.dailyLimit, "Daily run limit", 1, 24),
        maxRuns: integer(input.maxRuns, "Total run limit", 1, 100),
        budgetCents: 0,
        valueMetric: field(input.valueMetric, "Measurable value", 1000),
        successCriterion: field(
          input.successCriterion,
          "Success criterion",
          1000,
        ),
        limits: automationDescriptions[kind],
      };
      const record = id();
      this.db
        .prepare(
          "INSERT INTO automation_schedules VALUES(?,?,?,?,?,?,?,'DRAFT',NULL,NULL,NULL,?,?)",
        )
        .run(
          record,
          this.p.company_id,
          field(input.title, "Title", 160),
          kind,
          JSON.stringify(body),
          payloadHash(body),
          this.p.id,
          Date.parse(startsAt),
          now(),
        );
      return { id: record };
    });
  }
  approve(input: Record<string, unknown>) {
    return this.mutate("automation.approved", String(input.id), [], () => {
      const r = this.row(input.id),
        body = JSON.parse(String(r.body));
      this.guard(owners[r.kind as Kind]);
      if (
        !["DRAFT", "PAUSED", "APPROVED"].includes(String(r.status)) ||
        (r.status === "APPROVED" && Number(r.approval_expires_at) > Date.now())
      )
        throw new DomainError("Schedule not awaiting approval", 409);
      if (
        input.confirm !== true ||
        input.contentHash !== r.content_hash ||
        payloadHash(body) !== r.content_hash ||
        Date.parse(body.endsAt) <= Date.now()
      )
        throw new DomainError("Exact current schedule approval required", 409);
      this.db
        .prepare(
          "UPDATE automation_schedules SET status='APPROVED',approved_by=?,approval_expires_at=?,approval_consumed_at=NULL WHERE company_id=? AND id=?",
        )
        .run(this.p.id, Date.now() + 600000, this.p.company_id, String(r.id));
      return { ok: true };
    });
  }
  enable(input: Record<string, unknown>) {
    return this.mutate("automation.enabled", String(input.id), [], () => {
      const r = this.row(input.id),
        body = JSON.parse(String(r.body));
      this.guard(owners[r.kind as Kind]);
      if (
        r.status !== "APPROVED" ||
        r.approval_consumed_at ||
        Number(r.approval_expires_at) <= Date.now() ||
        input.confirm !== true ||
        input.contentHash !== r.content_hash ||
        payloadHash(body) !== r.content_hash ||
        Date.parse(body.endsAt) <= Date.now()
      )
        throw new DomainError(
          "Exact unexpired single-use schedule approval required",
          409,
        );
      this.db
        .prepare(
          "UPDATE automation_schedules SET status='ENABLED',approval_consumed_at=?,next_run_at=? WHERE company_id=? AND id=?",
        )
        .run(
          now(),
          Math.max(Date.now(), Number(r.next_run_at)),
          this.p.company_id,
          String(r.id),
        );
      return { ok: true };
    });
  }
  pause(input: Record<string, unknown>) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(input.id);
      if (["EXPIRED", "EXHAUSTED"].includes(String(r.status)))
        throw new DomainError("Schedule already terminal", 409);
      this.db
        .prepare(
          "UPDATE automation_schedules SET status='PAUSED',approval_expires_at=0 WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, String(r.id));
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "automation.paused",
        String(r.id),
      );
      return { ok: true };
    });
  }
  execute(kind: Kind, payload: Record<string, unknown>, key: string): unknown {
    const db = this.db,
      c = this.p.company_id;
    switch (kind) {
      case "GENERATION_QUEUE":
        return {
          label: "PROPOSAL ONLY — human approval and dispatch required",
          ...new DesignService(db, this.p).enqueue({
            ...payload,
            requestKey: key,
          }),
        };
      case "PRODUCT_PROPOSAL":
        return {
          label: "PROPOSAL ONLY — no Shopify write",
          ...new ProductService(db, this.p).proposal({
            ...payload,
            requestKey: key,
          }),
        };
      case "CAMPAIGN_DRAFT":
        return {
          label: "DRAFT ONLY — no send or spend",
          ...new MarketingService(db, this.p).create({
            ...payload,
            requestKey: key,
          }),
        };
      case "EXPERIMENT_PLAN":
        return {
          label: "PLAN ONLY — human launch and evidence required",
          ...new AnalyticsService(db, this.p).create(payload),
        };
      case "REPORT": {
        const state = analyticsState(db, c);
        if (!state.data || state.data.stale)
          throw new DomainError("Fresh Shopify analytics required", 409);
        return {
          label: "Saved deterministic analytics report",
          ...new AnalyticsService(db, this.p).report(),
        };
      }
      case "RESEARCH_REVIEW": {
        const sources = sourceRows(db, c);
        return {
          label: "Stored evidence review only; no new research performed",
          total: sources.length,
          freshVerified: sources.filter(
            (s) => s.fresh && s.status === "VERIFIED",
          ).length,
          reviewRequired: sources
            .filter((s) => !s.fresh || s.status !== "VERIFIED")
            .map((s) => ({ id: s.id, status: s.status, fresh: s.fresh }))
            .slice(0, 100),
        };
      }
      case "INVENTORY_PROJECTION":
        return inventoryProjection(db, c);
      case "UX_REVIEW": {
        const rows = db
          .prepare(
            "SELECT id,body FROM ux_observations WHERE company_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .all(c);
        return {
          label:
            "Stored UX evidence review; no fresh website monitoring request",
          observations: rows.map((r) => {
            const b = JSON.parse(String(r.body));
            return {
              id: r.id,
              simulation: b.mode === "SIMULATION",
              expiresAt: b.expiresAt,
              fresh: Date.parse(b.expiresAt) > Date.now(),
            };
          }),
        };
      }
    }
  }
  runDue(scheduleId: string) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(scheduleId),
        time = Date.now();
      if (r.status !== "ENABLED" || Number(r.next_run_at) > time)
        return { ran: false };
      if (
        owners[r.kind as Kind].some((agent) =>
          activeQuarantine(this.db, this.p.company_id, agent),
        )
      )
        return { ran: false, reason: "QUARANTINED" };
      const body = JSON.parse(String(r.body));
      if (payloadHash(body) !== r.content_hash)
        throw new DomainError("Schedule integrity mismatch", 409);
      if (Date.parse(body.endsAt) <= time) {
        this.db
          .prepare(
            "UPDATE automation_schedules SET status='EXPIRED' WHERE company_id=? AND id=?",
          )
          .run(this.p.company_id, scheduleId);
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "automation.expired",
          scheduleId,
        );
        return { ran: false };
      }
      const total = Number(
        this.db
          .prepare(
            "SELECT COUNT(*) n FROM automation_runs WHERE company_id=? AND schedule_id=?",
          )
          .get(this.p.company_id, scheduleId)!.n,
      );
      if (total >= body.maxRuns) {
        this.db
          .prepare(
            "UPDATE automation_schedules SET status='EXHAUSTED' WHERE company_id=? AND id=?",
          )
          .run(this.p.company_id, scheduleId);
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "automation.exhausted",
          scheduleId,
        );
        return { ran: false };
      }
      const day = new Date(time).toISOString().slice(0, 10),
        daily = Number(
          this.db
            .prepare(
              "SELECT COUNT(*) n FROM automation_runs WHERE company_id=? AND schedule_id=? AND created_at>=?",
            )
            .get(this.p.company_id, scheduleId, day + "T00:00:00.000Z")!.n,
        );
      if (daily >= body.dailyLimit) {
        this.db
          .prepare(
            "UPDATE automation_schedules SET next_run_at=? WHERE company_id=? AND id=?",
          )
          .run(
            Date.parse(day + "T00:00:00Z") + 86400000,
            this.p.company_id,
            scheduleId,
          );
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "automation.daily_limit",
          scheduleId,
        );
        return { ran: false };
      }
      const record = id();
      let status = "SUCCEEDED",
        output: unknown;
      try {
        output = transaction(this.db, () => {
          this.guard(owners[r.kind as Kind]);
          if (r.approved_by !== this.p.id)
            throw new DomainError("Schedule authorizing human mismatch", 403);
          return this.execute(
            r.kind as Kind,
            body.payload,
            "automation:" + record,
          );
        });
      } catch (error) {
        status = error instanceof DomainError ? "BLOCKED" : "FAILED";
        output = {
          message:
            error instanceof DomainError
              ? error.message
              : "Internal failure; action rolled back. Human review required.",
        };
      }
      this.db
        .prepare("INSERT INTO automation_runs VALUES(?,?,?,?,?,?,?)")
        .run(
          record,
          this.p.company_id,
          scheduleId,
          Number(r.next_run_at),
          status,
          JSON.stringify(output),
          now(),
        );
      this.db
        .prepare(
          "UPDATE automation_schedules SET next_run_at=?,status=? WHERE company_id=? AND id=?",
        )
        .run(
          time + body.intervalHours * 3600000,
          status !== "SUCCEEDED"
            ? "PAUSED"
            : total + 1 >= body.maxRuns
              ? "EXHAUSTED"
              : "ENABLED",
          this.p.company_id,
          scheduleId,
        );
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "automation.run_recorded",
        scheduleId,
        status,
        {
          runId: record,
          kind: r.kind,
          dueAt: r.next_run_at,
          externalSpendCents: 0,
        },
      );
      return { ran: true, id: record, status };
    });
  }
}
export function tickAutomation(db: DatabaseSync, company?: string) {
  const due = db
    .prepare(
      "SELECT id,company_id,approved_by FROM automation_schedules WHERE status='ENABLED' AND next_run_at<=?" +
        (company ? " AND company_id=?" : "") +
        " ORDER BY next_run_at LIMIT 10",
    )
    .all(...(company ? [Date.now(), company] : [Date.now()]));
  let processed = 0,
    errors = 0;
  for (const r of due) {
    try {
      const p = {
        id: String(r.approved_by),
        company_id: String(r.company_id),
        role: "CEO",
      };
      new AutomationService(db, p).runDue(String(r.id));
      processed++;
    } catch {
      errors++;
    }
  }
  return { processed, errors };
}
export function startAutomationWorker(db: DatabaseSync) {
  // Synchronous, local-only transactions: no network or paid adapter is reachable.
  const timer = setInterval(() => {
    try {
      tickAutomation(db);
    } catch {
      console.error("Automation tick failed; no success confirmed");
    }
  }, 15000);
  timer.unref();
  return () => clearInterval(timer);
}
