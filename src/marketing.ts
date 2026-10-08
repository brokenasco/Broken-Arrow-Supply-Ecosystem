import type { DatabaseSync } from "node:sqlite";
import { id, now, transaction, audit } from "./db.ts";
import { HumanWorkflow, field, choice, integer, ids } from "./workflow.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { requireSources } from "./research.ts";
export const campaignFields = [
  "objective",
  "audience",
  "persona",
  "valueProposition",
  "hypothesis",
  "creativeConcept",
  "cta",
  "kpi",
  "strategy",
  "brandGuidelines",
  "customerInsights",
  "productPerformance",
  "historicalLearning",
  "launchPlan",
  "seoRecommendations",
  "testHypothesis",
  "testMetric",
  "testAllocation",
  "testStoppingRule",
] as const;
export function day(value: unknown) {
  const s = field(value, "Date", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new DomainError("Valid calendar date required");
  return s;
}
export function marketingState(db: DatabaseSync, company: string) {
  return {
    fields: campaignFields,
    campaigns: db
      .prepare(
        "SELECT * FROM campaigns WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({
        ...r,
        body: JSON.parse(String(r.body)),
        approvalExpired:
          r.status === "APPROVED" && Number(r.expires_at) <= Date.now(),
      })),
    results: db
      .prepare(
        "SELECT * FROM campaign_results WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({ ...r, body: JSON.parse(String(r.body)) })),
    integration:
      "INTEGRATION REQUIRED — no sending, publishing or paid spending",
  };
}
export class MarketingService extends HumanWorkflow {
  row(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM campaigns WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Campaign", 80));
    if (!r) throw new DomainError("Campaign not found", 404);
    return r;
  }
  evidence(body: any) {
    requireSources(this.db, this.p.company_id, body.sourceIds);
    const p = this.db
      .prepare(
        "SELECT status,payload FROM product_proposals WHERE company_id=? AND id=?",
      )
      .get(this.p.company_id, body.productId);
    if (!p || p.status === "CANCELLED")
      throw new DomainError("Available company product package required", 409);
    const product = JSON.parse(String(p.payload));
    if (body.simulation !== (product.mode === "SIMULATION"))
      throw new DomainError("Product simulation label mismatch", 409);
  }
  create(input: Record<string, unknown>) {
    return this.mutate(
      "marketing.campaign_created",
      "campaign",
      ["katerina", "anna"],
      () => {
        const key = field(input.requestKey, "Request key", 80),
          hash = payloadHash(input),
          old = this.db
            .prepare(
              "SELECT id,input_hash FROM campaigns WHERE company_id=? AND request_key=?",
            )
            .get(this.p.company_id, key);
        if (old) {
          if (old.input_hash !== hash)
            throw new DomainError("Request key already used", 409);
          return { id: String(old.id) };
        }
        const productId = field(input.productId, "Product package", 80),
          p = this.db
            .prepare(
              "SELECT payload FROM product_proposals WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, productId);
        if (!p) throw new DomainError("Product package not found", 404);
        const product = JSON.parse(String(p.payload));
        const startDate = day(input.startDate),
          endDate = day(input.endDate);
        if (endDate < startDate)
          throw new DomainError("End date must follow start date");
        const parent = input.parentId
          ? String(this.row(input.parentId).id)
          : null;
        const fields = Object.fromEntries(
          campaignFields.map((k) => [k, field(input[k], k, 1200)]),
        );
        const channel = choice(
          input.channel,
          ["EMAIL", "SOCIAL", "LANDING_PAGE", "PAID_AD"],
          "Channel",
        );
        const budgetMinor = integer(
          input.budgetMinor,
          "Proposed budget minor units",
          0,
          1000000000,
        );
        const title = field(input.title, "Campaign name", 160),
          copyMode = choice(input.copyMode, ["TEMPLATE", "HUMAN"], "Copy mode");
        const generated = `${product.input.title}\n${fields.valueProposition}\n${fields.cta}`;
        const finalCopy =
          copyMode === "TEMPLATE" ? generated : field(input.copy, "Copy", 4000);
        const body = {
          ...fields,
          productId,
          productTitle: product.input.title,
          simulation: product.mode === "SIMULATION",
          sourceIds: ids(input.sourceIds, "Research sources"),
          channel,
          startDate,
          endDate,
          budgetMinor,
          currency: product.currency,
          risk: channel === "PAID_AD" || budgetMinor > 0 ? "RED" : "YELLOW",
          copyMode,
          copy:
            copyMode === "TEMPLATE"
              ? generated
              : field(input.copy, "Copy", 4000),
          variantA: field(input.variantA ?? finalCopy, "Variant A", 4000),
          variantB: field(input.variantB, "Variant B", 4000),
          emailSubject: field(
            input.emailSubject ?? title,
            "Email subject",
            160,
          ),
          emailPreheader: field(
            input.emailPreheader ?? fields.valueProposition.slice(0, 200),
            "Email preheader",
            200,
          ),
          socialDraft: field(
            input.socialDraft ?? finalCopy,
            "Social draft",
            4000,
          ),
          landingHeadline: field(
            input.landingHeadline ?? title,
            "Landing headline",
            160,
          ),
          copyLabel:
            copyMode === "TEMPLATE"
              ? "Deterministic template assembled from human inputs; not model-generated"
              : "Human-authored copy",
          availability:
            "Product package is not proof that product is published or purchasable",
        };
        this.evidence(body);
        const campaign = id();
        this.db
          .prepare(
            "INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,?,'DRAFT',NULL,NULL,NULL,?)",
          )
          .run(
            campaign,
            this.p.company_id,
            parent,
            key,
            hash,
            title,
            JSON.stringify(body),
            payloadHash(body),
            now(),
          );
        return { id: campaign };
      },
    );
  }
  approve(input: Record<string, unknown>) {
    return this.mutate(
      "marketing.plan_approved",
      String(input.id),
      ["katerina", "anna", "garry"],
      () => {
        const r = this.row(input.id),
          body = JSON.parse(String(r.body));
        if (
          r.status !== "DRAFT" &&
          !(r.status === "APPROVED" && Number(r.expires_at) <= Date.now())
        )
          throw new DomainError("Campaign not awaiting approval", 409);
        if (
          input.confirm !== true ||
          input.contentHash !== r.content_hash ||
          payloadHash(body) !== r.content_hash
        )
          throw new DomainError("Exact campaign approval required", 409);
        if (body.risk === "RED" && input.acknowledgeRed !== true)
          throw new DomainError(
            "Explicit RED budget review required; no spending is authorized",
            409,
          );
        this.evidence(body);
        this.db
          .prepare(
            "UPDATE campaigns SET status='APPROVED',approved_by=?,expires_at=? WHERE company_id=? AND id=?",
          )
          .run(this.p.id, Date.now() + 600000, this.p.company_id, String(r.id));
        return { ok: true };
      },
    );
  }
  ready(input: Record<string, unknown>) {
    return this.mutate(
      "marketing.plan_marked_ready",
      String(input.id),
      ["katerina", "anna", "garry"],
      () => {
        const r = this.row(input.id);
        if (
          r.status !== "APPROVED" ||
          r.consumed_at ||
          Number(r.expires_at) <= Date.now()
        )
          throw new DomainError("Unexpired single-use approval required", 409);
        const body = JSON.parse(String(r.body));
        if (payloadHash(body) !== r.content_hash)
          throw new DomainError("Campaign integrity failed", 409);
        this.evidence(body);
        this.db
          .prepare(
            "UPDATE campaigns SET status='READY',consumed_at=? WHERE company_id=? AND id=?",
          )
          .run(now(), this.p.company_id, String(r.id));
        return { status: "READY", externalAction: false };
      },
    );
  }
  cancel(input: Record<string, unknown>) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(input.id);
      if (["CANCELLED", "COMPLETED"].includes(String(r.status)))
        throw new DomainError("Campaign is terminal", 409);
      this.db
        .prepare(
          "UPDATE campaigns SET status='CANCELLED' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, String(r.id));
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "marketing.cancelled",
        String(r.id),
      );
      return { ok: true };
    });
  }
  measure(input: Record<string, unknown>) {
    return this.mutate(
      "marketing.results_recorded",
      String(input.id),
      ["katerina", "sofia"],
      () => {
        const r = this.row(input.id);
        if (r.status !== "READY")
          throw new DomainError("Ready campaign required", 409);
        const plan = JSON.parse(String(r.body));
        const periodStart = day(input.periodStart),
          periodEnd = day(input.periodEnd);
        if (
          periodStart < plan.startDate ||
          periodEnd > plan.endDate ||
          periodStart > periodEnd ||
          periodEnd > now().slice(0, 10)
        )
          throw new DomainError(
            "Measurement window must be past/present and inside campaign dates",
          );
        const sample = (name: string) => {
          const raw = input[name];
          if (!raw || typeof raw !== "object")
            throw new DomainError("Variant aggregate required");
          const v = raw as Record<string, unknown>;
          const visitors = integer(
              v.visitors,
              "Unique exposed visitors",
              0,
              1000000000,
            ),
            conversions = integer(
              v.conversions,
              "Unique converting visitors",
              0,
              visitors,
            );
          return {
            visitors,
            conversions,
            rate: visitors ? conversions / visitors : null,
          };
        };
        const a = sample("a"),
          b = sample("b"),
          spendMinor = integer(
            input.spendMinor,
            "Reported spend",
            0,
            1000000000,
          ),
          revenueMinor = integer(
            input.revenueMinor,
            "Attributed revenue",
            0,
            1000000000,
          );

        const body = {
          periodStart,
          periodEnd,
          a,
          b,
          spendMinor,
          revenueMinor,
          currency: plan.currency,
          roas: spendMinor ? revenueMinor / spendMinor : null,
          rateDifference:
            a.rate === null || b.rate === null ? null : b.rate - a.rate,
          evidence: field(input.evidence, "Measurement evidence", 4000),
          attribution: field(
            input.attribution,
            "Attribution method and caveats",
            2000,
          ),
          actualResult: field(input.actualResult, "Actual KPI result", 2000),
          lessons: field(input.lessons, "Lessons learned", 2000),
          label: plan.simulation
            ? "SIMULATION — human-reported aggregates"
            : "HUMAN-REPORTED — not verified provider analytics",
          interpretation:
            "Descriptive only; no causal lift or statistically significant winner established. ROAS is attributed revenue/spend, not profit.",
        };
        this.db
          .prepare("INSERT INTO campaign_results VALUES(?,?,?,?,?)")
          .run(
            id(),
            this.p.company_id,
            String(r.id),
            JSON.stringify(body),
            now(),
          );
        this.db
          .prepare(
            "UPDATE campaigns SET status='COMPLETED' WHERE company_id=? AND id=?",
          )
          .run(this.p.company_id, String(r.id));
        return { ok: true };
      },
    );
  }
}
