import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { id, now } from "./db.ts";
import { DomainError } from "./policy.ts";
import { HumanWorkflow, field, choice, iso, ids } from "./workflow.ts";
export const opportunityFields = [
  "concept",
  "targetPersona",
  "customerNeed",
  "supportingEvidence",
  "demandIndicators",
  "productType",
  "sellingPriceRange",
  "estimatedCost",
  "expectedMargin",
  "competitorLandscape",
  "saturation",
  "seasonality",
  "creativeRequirements",
  "marketingOpportunity",
  "operationalRisks",
  "ipRisks",
  "recommendation",
] as const;
export function sourceRows(db: DatabaseSync, company: string) {
  return db
    .prepare(
      "SELECT * FROM research_sources WHERE company_id=? ORDER BY retrieved_at DESC",
    )
    .all(company)
    .map((r) => ({
      ...r,
      id: String(r.id),
      status: String(r.status),
      fresh: Date.parse(String(r.expires_at)) > Date.now(),
      provenance: "HUMAN_ENTERED",
    }));
}
export function requireSources(
  db: DatabaseSync,
  company: string,
  sourceIds: string[],
) {
  for (const source of sourceIds) {
    const r = db
      .prepare("SELECT * FROM research_sources WHERE company_id=? AND id=?")
      .get(company, source);
    if (!r) throw new DomainError("Source not found", 404);
    if (
      r.status !== "VERIFIED" ||
      Date.parse(String(r.expires_at)) <= Date.now()
    )
      throw new DomainError(
        "Every source must be fresh and human-verified",
        409,
      );
  }
}
export function opportunitySourceIds(
  db: DatabaseSync,
  company: string,
  opportunity: string,
) {
  return db
    .prepare(
      "SELECT source_id FROM opportunity_sources WHERE company_id=? AND opportunity_id=?",
    )
    .all(company, opportunity)
    .map((r) => String(r.source_id));
}
export function researchState(db: DatabaseSync, company: string) {
  const sources = sourceRows(db, company),
    points = db
      .prepare(
        "SELECT * FROM research_trends WHERE company_id=? ORDER BY observed_on",
      )
      .all(company);
  const groups = new Map<string, typeof points>();
  for (const p of points) {
    const key = String(p.series) + "\0" + String(p.unit);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const trends = [...groups.values()].map((rows) => {
    const first = rows[0],
      last = rows.at(-1)!;
    const usable = rows.every((r) =>
      sources.some(
        (s) => s.id === r.source_id && s.fresh && s.status === "VERIFIED",
      ),
    );
    return {
      series: first.series,
      unit: first.unit,
      points: rows,
      usable,
      changePercent:
        usable && rows.length >= 2 && Number(first.value) > 0
          ? Math.round(
              ((Number(last.value) - Number(first.value)) /
                Number(first.value)) *
                1000,
            ) / 10
          : null,
      note: "Human-entered observations; descriptive first-to-last change only. Comparable measurement methodology must be reviewed; no market-wide demand inference.",
    };
  });
  return {
    sourceReviews: db
      .prepare(
        "SELECT * FROM research_source_reviews WHERE company_id=? ORDER BY created_at",
      )
      .all(company),
    sources,
    trends,
    opportunityFields,
    opportunities: db
      .prepare(
        "SELECT * FROM opportunities WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => {
        const sourceIds = opportunitySourceIds(db, company, String(r.id));
        return {
          ...r,
          body: JSON.parse(String(r.body)),
          sourceIds,
          evidenceReady:
            sourceIds.length > 0 &&
            sourceIds.every((id) =>
              sources.some(
                (s) => s.id === id && s.fresh && s.status === "VERIFIED",
              ),
            ),
        };
      }),
    handoffs: db
      .prepare(
        "SELECT * FROM research_handoffs WHERE company_id=? ORDER BY created_at",
      )
      .all(company),
    mode: "HUMAN_RESEARCH · No autonomous search or LLM execution",
  };
}
export class ResearchService extends HumanWorkflow {
  source(input: Record<string, unknown>) {
    return this.mutate(
      "research.source_added",
      "research",
      ["anna", "mason"],
      () => {
        const title = field(input.title, "Title", 160),
          kind = choice(
            input.kind,
            ["MARKET", "COMPETITOR", "TREND", "DESIGN"],
            "source kind",
          );
        let url: URL;
        try {
          url = new URL(field(input.url, "URL", 1500));
        } catch {
          throw new DomainError("Valid source URL required");
        }
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          throw new DomainError(
            "Only HTTP(S) source URLs without credentials allowed",
          );
        const publisher = field(input.publisher, "Publisher", 200),
          excerpt = field(
            input.excerpt,
            "Evidence excerpt / observation",
            6000,
          ),
          published = iso(input.publishedAt, "Published"),
          retrieved = iso(input.retrievedAt, "Retrieved"),
          expires = iso(input.expiresAt, "Review due");
        if (
          published > retrieved ||
          Date.parse(retrieved) > Date.now() ||
          expires <= retrieved ||
          Date.parse(expires) - Date.parse(retrieved) > 366 * 86400000
        )
          throw new DomainError(
            "Dates must satisfy published ≤ retrieved ≤ now and review due within 366 days after retrieval",
          );
        const source = id();
        this.db
          .prepare(
            "INSERT INTO research_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,'UNVERIFIED',NULL,?)",
          )
          .run(
            source,
            this.p.company_id,
            kind,
            title,
            url.href,
            publisher,
            excerpt,
            createHash("sha256").update(excerpt).digest("hex"),
            published,
            retrieved,
            expires,
            this.p.id,
          );
        return { id: source };
      },
    );
  }
  verify(input: Record<string, unknown>) {
    const source = field(input.id, "Source", 80);
    return this.mutate(
      "research.source_reviewed",
      source,
      ["anna", "mason"],
      () => {
        const status = choice(
            input.status,
            ["VERIFIED", "DISPUTED"],
            "source review",
          ),
          note = field(input.note, "Verification evidence / caveats");
        const result = this.db
          .prepare(
            "UPDATE research_sources SET status=?,review_note=? WHERE company_id=? AND id=?",
          )
          .run(status, note, this.p.company_id, source);
        if (!result.changes) throw new DomainError("Source not found", 404);
        this.db
          .prepare("INSERT INTO research_source_reviews VALUES(?,?,?,?,?,?,?)")
          .run(id(), this.p.company_id, source, status, note, this.p.id, now());
        return { ok: true };
      },
    );
  }
  trend(input: Record<string, unknown>) {
    return this.mutate("research.trend_recorded", "research", ["mason"], () => {
      const source = field(input.sourceId, "Source", 80);
      requireSources(this.db, this.p.company_id, [source]);
      const observed = field(input.observedOn, "Observation date", 10);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(observed) ||
        !Number.isFinite(Date.parse(observed)) ||
        new Date(observed).toISOString().slice(0, 10) !== observed ||
        observed > now().slice(0, 10)
      )
        throw new DomainError("Valid past observation date required");
      if (
        typeof input.value !== "number" ||
        !Number.isFinite(input.value) ||
        input.value < 0 ||
        input.value > 1e12
      )
        throw new DomainError(
          "Observation must be a finite nonnegative number",
        );
      const trend = id();
      const series = field(input.series, "Comparable series", 120),
        unit = field(input.unit, "Unit", 60);
      if (
        this.db
          .prepare(
            "SELECT id FROM research_trends WHERE company_id=? AND series=? AND unit=? AND observed_on=?",
          )
          .get(this.p.company_id, series, unit, observed)
      )
        throw new DomainError(
          "An observation already exists for this series, unit and date",
          409,
        );
      this.db
        .prepare("INSERT INTO research_trends VALUES(?,?,?,?,?,?,?,?)")
        .run(
          trend,
          this.p.company_id,
          source,
          series,
          unit,
          observed,
          input.value,
          now(),
        );
      return { id: trend };
    });
  }
  opportunity(input: Record<string, unknown>) {
    return this.mutate(
      "research.opportunity_created",
      "research",
      ["anna", "mason", "marisha"],
      () => {
        const sourceIds = ids(input.sourceIds, "Sources");
        for (const s of sourceIds)
          if (
            !this.db
              .prepare(
                "SELECT id FROM research_sources WHERE company_id=? AND id=?",
              )
              .get(this.p.company_id, s)
          )
            throw new DomainError("Source not found", 404);
        const body: Record<string, string | number> = {};
        for (const key of opportunityFields) body[key] = field(input[key], key);
        if (
          typeof input.confidence !== "number" ||
          input.confidence < 0 ||
          input.confidence > 1 ||
          !Number.isFinite(input.confidence)
        )
          throw new DomainError("Confidence must be 0–1");
        body.confidence = input.confidence;
        body.provenance =
          "Human-authored assessment; price/cost/margin statements require cited evidence, otherwise enter Unknown.";
        const parent = input.parentId
          ? field(input.parentId, "Parent", 80)
          : null;
        if (
          parent &&
          !this.db
            .prepare("SELECT id FROM opportunities WHERE company_id=? AND id=?")
            .get(this.p.company_id, parent)
        )
          throw new DomainError("Parent opportunity not found", 404);
        const opportunity = id();
        this.db
          .prepare("INSERT INTO opportunities VALUES(?,?,?,?,?,'MASON',?)")
          .run(
            opportunity,
            this.p.company_id,
            parent,
            field(input.title, "Opportunity name", 160),
            JSON.stringify(body),
            now(),
          );
        for (const s of sourceIds)
          this.db
            .prepare("INSERT INTO opportunity_sources VALUES(?,?,?)")
            .run(this.p.company_id, opportunity, s);
        return { id: opportunity };
      },
    );
  }
  handoff(input: Record<string, unknown>) {
    const opportunity = field(input.id, "Opportunity", 80);
    return this.mutate(
      "research.handoff",
      opportunity,
      ["anna", "mason", "marisha", "alex", "boris"],
      () => {
        const row = this.db
          .prepare(
            "SELECT stage FROM opportunities WHERE company_id=? AND id=?",
          )
          .get(this.p.company_id, opportunity);
        if (!row) throw new DomainError("Opportunity not found", 404);
        const next = choice(
            input.stage,
            ["MARISHA", "ALEX", "BORIS", "READY", "REJECTED"],
            "stage",
          ),
          order = ["MASON", "MARISHA", "ALEX", "BORIS", "READY"];
        if (
          ["READY", "REJECTED"].includes(String(row.stage)) ||
          (next !== "REJECTED" &&
            order.indexOf(next) !== order.indexOf(String(row.stage)) + 1)
        )
          throw new DomainError("Invalid research handoff", 409);
        if (next !== "REJECTED")
          requireSources(
            this.db,
            this.p.company_id,
            opportunitySourceIds(this.db, this.p.company_id, opportunity),
          );
        const note = field(
          input.note,
          "Human review and handoff rationale",
          4000,
        );
        this.db
          .prepare(
            "UPDATE opportunities SET stage=? WHERE company_id=? AND id=?",
          )
          .run(next, this.p.company_id, opportunity);
        this.db
          .prepare("INSERT INTO research_handoffs VALUES(?,?,?,?,?,?,?,?)")
          .run(
            id(),
            this.p.company_id,
            opportunity,
            String(row.stage),
            next,
            note,
            this.p.id,
            now(),
          );
        return { ok: true };
      },
    );
  }
}
