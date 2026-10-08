import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, iso } from "./workflow.ts";
import { id, now, audit, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { opportunitySourceIds, requireSources } from "./research.ts";
import { scanContent, compliancePolicy } from "./compliance-gates.ts";
export const learningFields = [
  "observed",
  "interpretation",
  "limitations",
  "strategy",
  "researchQuestion",
  "successCriterion",
] as const;
export function learningEvidenceUsable(
  db: DatabaseSync,
  company: string,
  document: string,
) {
  const rows = db
    .prepare(
      "SELECT e.status,e.body FROM customer_document_sources s JOIN customer_evidence e ON e.company_id=s.company_id AND e.id=s.evidence_id WHERE s.company_id=? AND s.document_id=?",
    )
    .all(company, document);
  return (
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.status === "VERIFIED" &&
        Date.parse(JSON.parse(String(r.body)).expiresAt) > Date.now(),
    )
  );
}
export function learningMemoryUsable(
  db: DatabaseSync,
  company: string,
  memory: string,
) {
  const r = db
    .prepare(
      "SELECT customer_document_id FROM learning_cycles WHERE company_id=? AND memory_id=?",
    )
    .get(company, memory);
  return (
    !r || learningEvidenceUsable(db, company, String(r.customer_document_id))
  );
}
export function learningState(db: DatabaseSync, company: string) {
  return {
    fields: learningFields,
    cycles: db
      .prepare(
        "SELECT * FROM learning_cycles WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => {
        const usable = learningEvidenceUsable(
          db,
          company,
          String(r.customer_document_id),
        );
        return {
          ...r,
          body: usable ? JSON.parse(String(r.body)) : null,
          usable,
        };
      }),
    followups: db
      .prepare(
        "SELECT * FROM learning_followups WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
  };
}
export class LearningService extends HumanWorkflow {
  row(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM learning_cycles WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Learning cycle", 80));
    if (!r) throw new DomainError("Learning cycle not found", 404);
    return r;
  }
  evidence(campaignId: string, documentId: string) {
    const company = this.p.company_id;
    const campaign = this.db
      .prepare(
        "SELECT * FROM campaigns WHERE company_id=? AND id=? AND status='COMPLETED'",
      )
      .get(company, campaignId);
    const result = this.db
      .prepare(
        "SELECT * FROM campaign_results WHERE company_id=? AND campaign_id=?",
      )
      .get(company, campaignId);
    if (!campaign || !result)
      throw new DomainError(
        "Completed campaign with measured results required",
        409,
      );
    const plan = JSON.parse(String(campaign.body));
    const product = this.db
      .prepare(
        "SELECT id,asset_id,payload_hash,mode,status FROM product_proposals WHERE company_id=? AND id=?",
      )
      .get(company, plan.productId);
    if (
      !product ||
      !["SIMULATED", "DRAFT_CREATED"].includes(String(product.status))
    )
      throw new DomainError("Completed product draft lineage required", 409);
    const asset = this.db
      .prepare(
        "SELECT id,job_id,brief_id,content_hash,status,simulation FROM design_assets WHERE company_id=? AND id=?",
      )
      .get(company, String(product.asset_id));
    if (!asset) throw new DomainError("Design lineage missing", 409);
    const brief = this.db
      .prepare(
        "SELECT id,opportunity_id,content_hash FROM design_briefs WHERE company_id=? AND id=?",
      )
      .get(company, String(asset.brief_id))!;
    const opportunity = this.db
      .prepare(
        "SELECT id,body,stage FROM opportunities WHERE company_id=? AND id=?",
      )
      .get(company, String(brief.opportunity_id))!;
    const qa = this.db
      .prepare(
        "SELECT id,verdict FROM design_reviews WHERE company_id=? AND asset_id=?",
      )
      .get(company, String(asset.id));
    if (!qa || opportunity.stage !== "READY")
      throw new DomainError("Reviewed research and QA lineage required", 409);
    const sourceIds = [
      ...new Set([
        ...opportunitySourceIds(this.db, company, String(opportunity.id)),
        ...(plan.sourceIds as string[]),
      ]),
    ];
    requireSources(this.db, company, sourceIds);
    const customer = this.db
      .prepare("SELECT * FROM customer_documents WHERE company_id=? AND id=?")
      .get(company, documentId);
    if (!customer || !learningEvidenceUsable(this.db, company, documentId))
      throw new DomainError("Fresh verified customer document required", 409);
    const simulation = product.mode === "SIMULATION";
    if (
      plan.simulation !== simulation ||
      !!asset.simulation !== simulation ||
      JSON.parse(String(customer.body)).simulation !== simulation
    )
      throw new DomainError("Cannot mix simulation and real evidence", 409);
    return {
      simulation,
      sourceIds,
      opportunity: {
        id: opportunity.id,
        hash: payloadHash(JSON.parse(String(opportunity.body))),
      },
      brief,
      asset,
      qa,
      product,
      campaign: { id: campaign.id, hash: campaign.content_hash },
      results: {
        id: result.id,
        hash: payloadHash(JSON.parse(String(result.body))),
        ...JSON.parse(String(result.body)),
      },
      customer: {
        id: customer.id,
        hash: payloadHash(JSON.parse(String(customer.body))),
      },
      publishing: "UNAVAILABLE — no publishing adapter or publication verified",
      attribution:
        "Human-reported campaign aggregates; customer document relevance is a human assertion. No causal winner, store-wide attribution or autonomous learning claimed.",
    };
  }
  validate(r: ReturnType<LearningService["row"]>) {
    const body = JSON.parse(String(r.body));
    if (payloadHash(body) !== r.content_hash)
      throw new DomainError("Learning content hash mismatch", 409);
    const current = this.evidence(
      String(r.campaign_id),
      String(r.customer_document_id),
    );
    if (payloadHash(current) !== payloadHash(body.evidence))
      throw new DomainError(
        "Evidence changed; propose a new learning cycle",
        409,
      );
    if (Date.parse(body.reviewAt) <= Date.now())
      throw new DomainError("Learning review date expired", 409);
    if (
      scanContent(
        JSON.stringify(body),
        compliancePolicy(this.db, this.p.company_id).terms,
      ).length
    )
      throw new DomainError("Privacy/brand flags require remediation", 409);
    return body;
  }
  propose(input: Record<string, unknown>) {
    return this.mutate(
      "learning.proposed",
      "learning",
      ["boris", "maria"],
      () => {
        const key = field(input.requestKey, "Request key", 80),
          hash = payloadHash(input);
        const previous = this.db
          .prepare(
            "SELECT id,input_hash FROM learning_cycles WHERE company_id=? AND request_key=?",
          )
          .get(this.p.company_id, key);
        if (previous) {
          if (previous.input_hash !== hash)
            throw new DomainError("Request key already used", 409);
          return { id: String(previous.id) };
        }
        const campaignId = field(input.campaignId, "Campaign", 80),
          documentId = field(input.customerDocumentId, "Customer document", 80),
          evidence = this.evidence(campaignId, documentId);
        if (input.relevanceConfirmed !== true)
          throw new DomainError(
            "Human confirmation of customer evidence relevance required",
          );
        const reviewAt = iso(input.reviewAt, "Review date");
        if (
          Date.parse(reviewAt) <= Date.now() ||
          Date.parse(reviewAt) > Date.now() + 90 * 86400000
        )
          throw new DomainError("Review date must be within the next 90 days");
        if (
          typeof input.confidence !== "number" ||
          !Number.isFinite(input.confidence) ||
          input.confidence < 0 ||
          input.confidence > 1
        )
          throw new DomainError("Confidence must be 0–1");
        const title = field(input.title, "Title", 160),
          body = {
            ...Object.fromEntries(
              learningFields.map((k) => [k, field(input[k], k, 2000)]),
            ),
            confidence: input.confidence,
            reviewAt,
            evidence,
            label: evidence.simulation
              ? "SIMULATION — human learning proposal"
              : "HUMAN-REPORTED — unverified strategy hypothesis",
          };
        if (
          scanContent(
            JSON.stringify({ title, body }),
            compliancePolicy(this.db, this.p.company_id).terms,
          ).length
        )
          throw new DomainError("Privacy/brand flags require remediation", 409);
        const record = id();
        this.db
          .prepare(
            "INSERT INTO learning_cycles VALUES(?,?,?,?,?,?,?,?,?,'PROPOSED',NULL,NULL,NULL,NULL,NULL,?)",
          )
          .run(
            record,
            this.p.company_id,
            key,
            hash,
            campaignId,
            documentId,
            title,
            JSON.stringify(body),
            payloadHash(body),
            now(),
          );
        return { id: record };
      },
    );
  }
  approve(input: Record<string, unknown>) {
    return this.mutate(
      "learning.approved",
      String(input.id),
      ["boris", "maria"],
      () => {
        const r = this.row(input.id);
        if (
          r.status !== "PROPOSED" &&
          !(r.status === "APPROVED" && Number(r.expires_at) <= Date.now())
        )
          throw new DomainError("Cycle not awaiting approval", 409);
        if (input.confirm !== true || input.contentHash !== r.content_hash)
          throw new DomainError("Exact human learning approval required", 409);
        this.validate(r);
        this.db
          .prepare(
            "UPDATE learning_cycles SET status='APPROVED',approved_by=?,expires_at=? WHERE company_id=? AND id=?",
          )
          .run(this.p.id, Date.now() + 600000, this.p.company_id, String(r.id));
        return { ok: true };
      },
    );
  }
  promote(input: Record<string, unknown>) {
    return this.mutate(
      "learning.research_queued",
      String(input.id),
      ["boris", "maria", "mason"],
      () => {
        const r = this.row(input.id);
        if (
          r.status !== "APPROVED" ||
          r.consumed_at ||
          Number(r.expires_at) <= Date.now() ||
          input.contentHash !== r.content_hash ||
          input.confirm !== true
        )
          throw new DomainError(
            "Exact unexpired single-use learning approval required",
            409,
          );
        const body = this.validate(r),
          memory = id(),
          research = id(),
          stamp = now();
        const text = `${body.label}\nObservation: ${body.observed}\nInterpretation: ${body.interpretation}\nLimitations: ${body.limitations}\nStrategy: ${body.strategy}\nNext research: ${body.researchQuestion}\nSuccess criterion: ${body.successCriterion}`;
        this.db
          .prepare(
            "INSERT INTO memory_items(id,company_id,title,body,classification,category,evidence,confidence,status,created_by,created_at,updated_at,review_at,expires_at,relationships) VALUES(?,?,?,?,'HYPOTHESIS','learning',?,?,'NEEDS VERIFICATION',?,?,?,?,?,?)",
          )
          .run(
            memory,
            this.p.company_id,
            String(r.title),
            text,
            `Learning cycle ${r.id}; campaign ${r.campaign_id}; evidence hash ${r.content_hash}`,
            body.confidence,
            this.p.id,
            stamp,
            stamp,
            body.reviewAt,
            body.reviewAt,
            JSON.stringify({
              cycleId: r.id,
              campaignId: r.campaign_id,
              customerDocumentId: r.customer_document_id,
            }),
          );
        this.db
          .prepare("INSERT INTO research_items VALUES(?,?,?,?)")
          .run(research, this.p.company_id, memory, stamp);
        this.db
          .prepare(
            "UPDATE learning_cycles SET status='RESEARCH_QUEUED',consumed_at=?,memory_id=?,research_id=? WHERE company_id=? AND id=?",
          )
          .run(stamp, memory, research, this.p.company_id, String(r.id));
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "learning.memory_candidate_created",
          memory,
        );
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "learning.research_question_created",
          research,
        );
        return {
          memoryId: memory,
          researchId: research,
          externalAction: false,
        };
      },
    );
  }
  followup(input: Record<string, unknown>) {
    return this.mutate(
      "learning.research_linked",
      String(input.id),
      ["mason"],
      () => {
        const r = this.row(input.id);
        if (r.status !== "RESEARCH_QUEUED")
          throw new DomainError("Queued research required", 409);
        this.validate(r);
        const opportunity = this.db
          .prepare(
            "SELECT id,created_at FROM opportunities WHERE company_id=? AND id=?",
          )
          .get(
            this.p.company_id,
            field(input.opportunityId, "Next opportunity", 80),
          );
        if (
          !opportunity ||
          String(opportunity.created_at) <= String(r.consumed_at)
        )
          throw new DomainError(
            "New company research opportunity after handoff required",
            409,
          );
        if (
          this.db
            .prepare(
              "SELECT cycle_id FROM learning_followups WHERE company_id=? AND cycle_id=?",
            )
            .get(this.p.company_id, String(r.id))
        )
          throw new DomainError("Research follow-up already linked", 409);
        const sources = opportunitySourceIds(
          this.db,
          this.p.company_id,
          String(opportunity.id),
        );
        if (!sources.length)
          throw new DomainError("Research evidence required", 409);
        requireSources(this.db, this.p.company_id, sources);
        this.db
          .prepare("INSERT INTO learning_followups VALUES(?,?,?,?,?)")
          .run(
            this.p.company_id,
            String(r.id),
            String(opportunity.id),
            field(input.note, "How the lesson informed research", 2000),
            now(),
          );
        return { ok: true };
      },
    );
  }
  cancel(input: Record<string, unknown>) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(input.id);
      if (!["PROPOSED", "APPROVED"].includes(String(r.status)))
        throw new DomainError(
          "Only pending learning cycles can be cancelled",
          409,
        );
      this.db
        .prepare(
          "UPDATE learning_cycles SET status='CANCELLED' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, String(r.id));
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "learning.cancelled",
        String(r.id),
      );
      return { ok: true };
    });
  }
}
