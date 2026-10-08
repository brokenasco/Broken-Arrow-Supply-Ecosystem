import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, choice } from "./workflow.ts";
import { id, now } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
type Row = Record<string, any>;
const rate = (n: number, d: number) => (d ? n / d : null);
export function organizationMetrics(
  db: DatabaseSync,
  company: string,
  windowDays = 30,
) {
  if (![7, 30, 90].includes(windowDays))
    throw new DomainError("Choose a 7, 30 or 90 day window");
  const time = Date.now(),
    asOf = new Date(time).toISOString(),
    start = new Date(time - windowDays * 86400000).toISOString(),
    priorStart = new Date(time - windowDays * 2 * 86400000).toISOString();
  const rows = (table: string): Row[] =>
    db.prepare(`SELECT * FROM ${table} WHERE company_id=?`).all(company);
  const inside = (r: Row, from = start, to = asOf, key = "created_at") =>
    String(r[key]) >= from &&
    (to === asOf ? String(r[key]) <= to : String(r[key]) < to);
  const agents = rows("agents"),
    tasks = rows("tasks"),
    sources = rows("research_sources"),
    jobs = rows("generation_jobs"),
    reconciliations = rows("generation_reconciliations"),
    campaigns = rows("campaigns"),
    campaignResults = rows("campaign_results");
  // Metadata only: never load private image bytes or customer source text into an organization report.
  const assets: Row[] = db
      .prepare(
        "SELECT id,job_id,brief_id,simulation,status,content_hash,created_at FROM design_assets WHERE company_id=?",
      )
      .all(company),
    reviews = rows("design_reviews");
  const qa = (from: string, to: string, simulation: boolean) => {
    const cohort = reviews.filter(
      (r) =>
        inside(r, from, to) &&
        assets.some(
          (a) => a.id === r.asset_id && !!a.simulation === simulation,
        ),
    );
    const passed = cohort.filter((r) => r.verdict === "PASS").length;
    return {
      reviewed: cohort.length,
      passed,
      revise: cohort.filter((r) => r.verdict === "REVISE").length,
      rejected: cohort.filter((r) => r.verdict === "REJECT").length,
      passRate: rate(passed, cohort.length),
      reviewIds: cohort.map((r) => r.id),
    };
  };
  const design = [false, true].map((simulation) => {
    const current = qa(start, asOf, simulation),
      previous = qa(priorStart, start, simulation);
    return {
      simulation,
      current,
      previous,
      changePercentagePoints:
        current.reviewed >= 5 && previous.reviewed >= 5
          ? (current.passRate! - previous.passRate!) * 100
          : null,
      comparisonNote:
        "Human QA verdicts by review date; comparisons need at least five reviews per period. No causal attribution to templates or employees.",
    };
  });
  const selectedJobs = jobs.filter((j) => inside(j));
  const costs = ["OPENAI", "SIMULATION"].map((provider) => {
    const cohort = selectedJobs.filter(
        (j) => j.provider === provider && j.consumed_at,
      ),
      known = cohort.flatMap((j) =>
        reconciliations.filter((r) => r.job_id === j.id),
      ),
      sum = known.reduce((n, r) => n + Number(r.actual_cents), 0),
      successes = cohort.filter((j) => j.status === "SUCCEEDED").length;
    return {
      provider,
      attempts: cohort.length,
      successful: successes,
      reconciled: known.length,
      reservedCents: cohort.reduce((n, j) => n + Number(j.reserved_cents), 0),
      reportedActualCents: known.length ? sum : null,
      costPerSuccessfulOutputCents:
        cohort.length > 0 && known.length === cohort.length && successes > 0
          ? sum / successes
          : null,
      jobIds: cohort.map((j) => j.id),
      note: "Cents from human billing reconciliation, not verified invoices. Reservations are not spend; ratio requires complete cost coverage of attempted jobs created in the window.",
    };
  });
  const selectedSources = sources.filter((s) =>
    inside(s, start, asOf, "retrieved_at"),
  );
  const research = {
    sources: selectedSources.length,
    verified: selectedSources.filter((s) => s.status === "VERIFIED").length,
    freshVerified: selectedSources.filter(
      (s) => s.status === "VERIFIED" && Date.parse(s.expires_at) > time,
    ).length,
    disputed: selectedSources.filter((s) => s.status === "DISPUTED").length,
    stale: selectedSources.filter((s) => Date.parse(s.expires_at) <= time)
      .length,
    sourceIds: selectedSources.map((s) => s.id),
    note: "Retrieval-date cohort and current human review/freshness state. Verification coverage is not objective research accuracy; sources have no simulation field.",
  };
  const campaign = campaignResults
    .filter((r) => inside(r))
    .map((r) => {
      const c = campaigns.find((c) => c.id === r.campaign_id)!;
      const plan = JSON.parse(c.body),
        b = JSON.parse(r.body);
      return {
        campaignId: c.id,
        resultId: r.id,
        simulation: !!plan.simulation,
        currency: b.currency,
        a: b.a,
        b: b.b,
        rateDifference: b.rateDifference,
        spendMinor: b.spendMinor,
        revenueMinor: b.revenueMinor,
        roas: b.roas,
        label: b.label,
        interpretation: b.interpretation,
      };
    });
  const backlog: {
    workflow: string;
    id: string;
    status: string;
    ageHours: number;
  }[] = [];
  const add = (workflow: string, list: Row[], closed: string[]) => {
    for (const r of list) {
      const state = String(r.status ?? r.stage);
      if (!closed.includes(state) && Date.parse(r.created_at) <= time)
        backlog.push({
          workflow,
          id: String(r.id),
          status: state,
          ageHours: Math.max(0, (time - Date.parse(r.created_at)) / 3600000),
        });
    }
  };
  add("Task", tasks, ["COMPLETE", "CANCELLED"]);
  add("Research opportunity", rows("opportunities"), ["READY", "REJECTED"]);
  add("Generation", jobs, ["SUCCEEDED", "CANCELLED"]);
  add("Product", rows("product_proposals"), [
    "SIMULATED",
    "DRAFT_CREATED",
    "CANCELLED",
  ]);
  add("Campaign", campaigns, ["COMPLETED", "CANCELLED"]);
  add("UX", rows("ux_reports"), ["VALIDATED", "CANCELLED"]);
  add("Learning", rows("learning_cycles"), ["RESEARCH_QUEUED", "CANCELLED"]);
  const blocked = backlog.filter((b) =>
    [
      "BLOCKED",
      "RECONCILIATION",
      "WAITING FOR CEO",
      "WAITING FOR AGENT",
      "FAILED",
    ].includes(b.status),
  );
  const runs = rows("automation_runs").filter((r) => inside(r));
  const failed = runs.filter((r) => r.status === "FAILED").length,
    blockedRuns = runs.filter((r) => r.status === "BLOCKED").length;
  const duplicates = new Map<string, string[]>();
  for (const j of selectedJobs) {
    const p = JSON.parse(j.payload),
      key = payloadHash({
        briefId: j.brief_id,
        provider: j.provider,
        instruction: p.instruction,
        parentAssetId: j.parent_asset_id,
      });
    duplicates.set(key, [...(duplicates.get(key) ?? []), String(j.id)]);
  }
  const repeated = [...duplicates]
    .filter(([, ids]) => ids.length > 1)
    .map(([hash, jobIds]) => ({ hash, jobIds, count: jobIds.length }));
  const activity: Row[] = db
    .prepare(
      "SELECT action,COUNT(*) count FROM audit_logs WHERE company_id=? AND created_at>=? AND created_at<=? GROUP BY action ORDER BY count DESC,action",
    )
    .all(company, start, asOf);
  const totalEvents = activity.reduce((n, r) => n + Number(r.count), 0);
  const workforce = agents.map((a) => {
    const assigned = tasks.filter((t) => t.agent_id === a.id && inside(t)),
      definition = JSON.parse(a.definition);
    return {
      id: String(a.id),
      name: String(definition.name),
      department: String(a.department),
      assigned: assigned.length,
      completed: assigned.filter((t) => t.status === "COMPLETE").length,
      failed: assigned.filter((t) => t.status === "FAILED").length,
      taskIds: assigned.map((t) => t.id),
      autonomousUsefulness: null,
      note: "Assignment/status counts only; no attribution of human-operated workflows to autonomous agent ability.",
    };
  });
  const recommendations: {
    id: string;
    owner: string;
    reason: string;
    action: string;
    evidenceIds: string[];
  }[] = [];
  const recommend = (
    id: string,
    owner: string,
    reason: string,
    action: string,
    evidenceIds: string[],
  ) => recommendations.push({ id, owner, reason, action, evidenceIds });
  if (research.stale || research.disputed)
    recommend(
      "research-evidence",
      "mason",
      `${research.stale} stale and ${research.disputed} disputed source records in this cohort`,
      "Review source quality and refresh evidence before research handoff.",
      selectedSources
        .filter(
          (s) => s.status === "DISPUTED" || Date.parse(s.expires_at) <= time,
        )
        .map((s) => s.id),
    );
  for (const d of design)
    if (d.changePercentagePoints !== null && d.changePercentagePoints <= -10)
      recommend(
        "design-review-" + d.simulation,
        "mark",
        `Human QA pass rate changed ${d.changePercentagePoints.toFixed(1)} percentage points; simulation=${d.simulation}`,
        "Review briefs and rejected/revised assets. Investigate causes; do not attribute the change to a template without evidence.",
        d.current.reviewIds,
      );
  if (costs.some((c) => c.reconciled < c.attempts))
    recommend(
      "cost-coverage",
      "garry",
      "Some attempted generation jobs lack billing reconciliation",
      "Reconcile provider billing before drawing cost-efficiency conclusions.",
      costs.flatMap((c) => c.jobIds),
    );
  if (blocked.length || backlog.some((b) => b.ageHours >= 24))
    recommend(
      "workflow-backlog",
      "boris",
      `${blocked.length} explicitly blocked/uncertain records; ${backlog.filter((b) => b.ageHours >= 24).length} open records older than 24 hours`,
      "Review dependencies, approval queues and reconciliation. Retain existing approval and compliance controls.",
      backlog
        .filter((b) => b.ageHours >= 24 || blocked.includes(b))
        .map((b) => b.id),
    );
  if (failed || blockedRuns)
    recommend(
      "automation-failures",
      "boris",
      `${failed} failed and ${blockedRuns} blocked automation runs of ${runs.length}`,
      "Inspect paused schedules and evidence prerequisites before human reauthorization.",
      runs.filter((r) => r.status !== "SUCCEEDED").map((r) => r.id),
    );
  if (repeated.length)
    recommend(
      "repeated-instructions",
      "mark",
      `${repeated.length} repeated generation-instruction groups`,
      "Review whether repetitions were intentional iterations before classifying them as duplicate work.",
      repeated.flatMap((r) => r.jobIds),
    );
  if (totalEvents / windowDays > 100)
    recommend(
      "activity-review",
      "boris",
      `${totalEvents} audit events in ${windowDays} days`,
      "Inspect high-volume activity. Audit events are not provider tool calls and do not establish excessive model use.",
      [],
    );
  return {
    definitionVersion: 1,
    asOf,
    window: { days: windowDays, start, end: asOf, previousStart: priorStart },
    label:
      "Deterministic organization review; human-operated workflows, no model evaluation",
    workforce,
    research,
    design,
    costs,
    campaign,
    backlog: {
      total: backlog.length,
      over24Hours: backlog.filter((b) => b.ageHours >= 24).length,
      blocked: blocked.length,
      oldest: backlog.sort((a, b) => b.ageHours - a.ageHours).slice(0, 100),
      note: "Open inventory as of snapshot, all creation dates. Age is since creation, not time in current stage. Long age alone is not proof of a bottleneck.",
    },
    automation: {
      runs: runs.length,
      succeeded: runs.filter((r) => r.status === "SUCCEEDED").length,
      failed,
      blocked: blockedRuns,
      failureRate: rate(failed, runs.length),
      blockedRate: rate(blockedRuns, runs.length),
      runIds: runs.map((r) => r.id),
    },
    repeatedInstructions: repeated,
    activity: {
      totalEvents,
      eventsPerDay: totalEvents / windowDays,
      byAction: activity,
      providerToolCalls: null,
      excessiveToolUsage: null,
      note: "Audit activity is a review proxy, not a provider call/token ledger. Excessive tool use cannot be determined.",
    },
    recommendations,
  };
}
export function organizationState(db: DatabaseSync, company: string) {
  return {
    current: organizationMetrics(db, company),
    reports: db
      .prepare(
        "SELECT * FROM organization_reports WHERE company_id=? ORDER BY created_at DESC LIMIT 50",
      )
      .all(company)
      .map((r) => ({
        ...r,
        id: String(r.id),
        content_hash: String(r.content_hash),
        body: JSON.parse(String(r.body)),
      })),
    reviews: db
      .prepare(
        "SELECT * FROM organization_reviews WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
  };
}
export class OrganizationService extends HumanWorkflow {
  report(input: Record<string, unknown>) {
    return this.mutate(
      "organization.report_created",
      "organization",
      ["boris"],
      () => {
        const days = input.windowDays;
        if (typeof days !== "number" || ![7, 30, 90].includes(days))
          throw new DomainError("Choose 7, 30 or 90 days");
        const body = organizationMetrics(this.db, this.p.company_id, days),
          record = id();
        this.db
          .prepare("INSERT INTO organization_reports VALUES(?,?,?,?,?,?,?)")
          .run(
            record,
            this.p.company_id,
            days,
            JSON.stringify(body),
            payloadHash(body),
            this.p.id,
            now(),
          );
        return { id: record };
      },
    );
  }
  review(input: Record<string, unknown>) {
    return this.mutate(
      "organization.human_reviewed",
      String(input.reportId),
      ["boris"],
      () => {
        const report = this.db
          .prepare(
            "SELECT * FROM organization_reports WHERE company_id=? AND id=?",
          )
          .get(this.p.company_id, field(input.reportId, "Report", 80));
        if (!report) throw new DomainError("Report not found", 404);
        const body = JSON.parse(String(report.body));
        if (
          input.contentHash !== report.content_hash ||
          payloadHash(body) !== report.content_hash
        )
          throw new DomainError("Exact report hash required", 409);
        const kind = choice(
            input.subjectKind,
            ["AGENT", "RECOMMENDATION"],
            "Subject kind",
          ),
          subject = field(input.subjectId, "Subject", 80);
        const list = kind === "AGENT" ? body.workforce : body.recommendations;
        if (!list.some((x: { id: string }) => x.id === subject))
          throw new DomainError("Subject must belong to the report", 404);
        const verdict = choice(
          input.verdict,
          kind === "AGENT"
            ? ["USEFUL", "NEEDS_EVIDENCE", "REWORK"]
            : ["ACCEPT_FOR_REVIEW", "DISMISS"],
          "Human assessment",
        );
        if (
          this.db
            .prepare(
              "SELECT id FROM organization_reviews WHERE company_id=? AND report_id=? AND subject_kind=? AND subject_id=?",
            )
            .get(this.p.company_id, String(report.id), kind, subject)
        )
          throw new DomainError(
            "Assessment already recorded; use a new report for a new assessment",
            409,
          );
        const record = id();
        this.db
          .prepare("INSERT INTO organization_reviews VALUES(?,?,?,?,?,?,?,?,?)")
          .run(
            record,
            this.p.company_id,
            String(report.id),
            kind,
            subject,
            verdict,
            field(input.note, "Evidence and limitations", 3000),
            this.p.id,
            now(),
          );
        return {
          id: record,
          configurationChanged: false,
          externalAction: false,
        };
      },
    );
  }
}
