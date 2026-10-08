import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, choice, ids, iso } from "./workflow.ts";
import { id, now, transaction, audit } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
export const personaFields = [
  "summary",
  "interests",
  "purchasingBehavior",
  "preferredProducts",
  "aestheticPreferences",
  "priceSensitivity",
  "averageOrderValue",
  "objections",
  "motivations",
  "recurringLanguage",
  "channelPreferences",
  "unmetNeeds",
] as const;
export const supportCategories = [
  "DELIVERY",
  "QUALITY",
  "RETURNS",
  "REFUND",
  "BILLING",
  "PRODUCT_QUESTION",
  "OTHER",
] as const;
function safe(value: unknown, name: string, max = 2000) {
  const s = field(value, name, max);
  if (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s) ||
    /(?:\+?\d[\s().-]*){9,}/.test(s)
  )
    throw new DomainError(
      "Remove contact details and long identifying numbers before saving",
    );
  return s;
}
function confidence(v: unknown) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
    throw new DomainError("Confidence must be 0–1");
  return v;
}
function parse(r: any) {
  return { ...r, body: JSON.parse(String(r.body)) };
}
function fresh(r: any) {
  return (
    r.status === "VERIFIED" &&
    Date.parse(JSON.parse(String(r.body)).expiresAt) > Date.now()
  );
}
export function classify(text: string) {
  const t = text.toLowerCase();
  const category = /refund/.test(t)
    ? "REFUND"
    : /charged|billing|payment/.test(t)
      ? "BILLING"
      : /return/.test(t)
        ? "RETURNS"
        : /broken|damaged|defect|quality/.test(t)
          ? "QUALITY"
          : /delivery|shipping|late|arriv/.test(t)
            ? "DELIVERY"
            : "OTHER";
  const urgent = /injur|unsafe|fraud|threat|legal/.test(t);
  return {
    category,
    priority: urgent ? "ESCALATE" : "NORMAL",
    label: "Keyword suggestion only; human classification required",
  };
}
export function customerState(db: DatabaseSync, company: string) {
  const raw = db
    .prepare(
      "SELECT * FROM customer_evidence WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company);
  const evidence = raw.map((r) => ({
    ...parse(r),
    body: r.status === "WITHDRAWN" ? null : parse(r).body,
    fresh: fresh(r),
    suggestion:
      r.status === "WITHDRAWN" ? null : classify(parse(r).body.excerpt),
  }));
  const docs = db
    .prepare(
      "SELECT * FROM customer_documents WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company)
    .map((r) => {
      const sourceIds = db
        .prepare(
          "SELECT evidence_id FROM customer_document_sources WHERE company_id=? AND document_id=?",
        )
        .all(company, String(r.id))
        .map((s) => String(s.evidence_id));
      const usable =
        sourceIds.length > 0 &&
        sourceIds.every((s) => raw.some((e) => e.id === s && fresh(e)));
      return {
        ...parse(r),
        body: usable ? parse(r).body : null,
        sourceIds,
        usable,
      };
    });
  const cases = db
    .prepare(
      "SELECT * FROM support_cases WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company)
    .map((r) => ({
      ...r,
      id: String(r.id),
      status: String(r.status),
      priority: String(r.priority),
      category: String(r.category),
      usable: raw.some((e) => e.id === r.evidence_id && fresh(e)),
      simulation: raw.find((e) => e.id === r.evidence_id)
        ? parse(raw.find((e) => e.id === r.evidence_id)).body.simulation
        : false,
    }));
  const drafts = db
    .prepare(
      "SELECT * FROM support_drafts WHERE company_id=? ORDER BY created_at DESC",
    )
    .all(company)
    .map((r) => ({
      ...r,
      id: String(r.id),
      content_hash: String(r.content_hash),
      body: cases.some((c) => c.id === r.case_id && c.usable) ? r.body : null,
    }));
  const windowStart = Date.now() - 30 * 86400000;
  const complaints = raw
    .filter((r) => fresh(r))
    .map(parse)
    .filter(
      (r) =>
        r.body.kind === "COMPLAINT" &&
        Date.parse(r.body.observedAt) >= windowStart,
    );
  const groups = new Map<
    string,
    { theme: string; simulation: boolean; count: number }
  >();
  for (const r of complaints) {
    const key = JSON.stringify([r.body.simulation, r.body.theme]);
    const g = groups.get(key) ?? {
      theme: r.body.theme,
      simulation: r.body.simulation,
      count: 0,
    };
    g.count++;
    groups.set(key, g);
  }
  return {
    personaFields,
    supportCategories,
    evidence,
    documents: docs,
    cases,
    drafts,
    complaints: [...groups.values()].filter((g) => g.count >= 3),
    analytics: {
      simulationCases: cases.filter((c) => c.usable && c.simulation).length,
      realEvidenceCases: cases.filter((c) => c.usable && !c.simulation).length,
      open: cases.filter((c) => c.usable && c.status === "OPEN").length,
      closed: cases.filter((c) => c.usable && c.status === "CLOSED").length,
      escalated: cases.filter(
        (c) => c.usable && c.status === "OPEN" && c.priority === "ESCALATE",
      ).length,
      byCategory: supportCategories.map((category) => ({
        category,
        count: cases.filter((c) => c.usable && c.category === category).length,
      })),
      label:
        "Local case records, including labeled simulation. No provider sync, response-time, CSAT or unique-customer inference.",
    },
  };
}
export class CustomerService extends HumanWorkflow {
  evidenceRow(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM customer_evidence WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Evidence", 80));
    if (!r) throw new DomainError("Evidence not found", 404);
    return r;
  }
  sources(value: unknown) {
    const list = ids(value, "Evidence");
    const rows = list.map((s) => this.evidenceRow(s));
    if (rows.some((r) => !fresh(r)))
      throw new DomainError("Fresh verified evidence required", 409);
    if (new Set(rows.map((r) => parse(r).body.simulation)).size !== 1)
      throw new DomainError("Do not mix simulation and real evidence");
    return { list, simulation: parse(rows[0]).body.simulation };
  }
  capture(input: Record<string, unknown>) {
    return this.mutate(
      "customers.evidence_captured",
      "evidence",
      ["oliver", "nikolai"],
      () => {
        if (input.redacted !== true || input.authorized !== true)
          throw new DomainError("Confirm redaction and authorized use");
        if (typeof input.simulation !== "boolean")
          throw new DomainError("Explicit simulation choice required");
        const key = field(input.requestKey, "Request key", 80),
          hash = payloadHash(input),
          old = this.db
            .prepare(
              "SELECT id,input_hash FROM customer_evidence WHERE company_id=? AND request_key=?",
            )
            .get(this.p.company_id, key);
        if (old) {
          if (old.input_hash !== hash)
            throw new DomainError("Request key reused", 409);
          return { id: String(old.id) };
        }
        const observedAt = iso(input.observedAt, "Observation"),
          expiresAt = iso(input.expiresAt, "Review due");
        if (
          Date.parse(observedAt) > Date.now() ||
          Date.parse(expiresAt) <= Date.now() ||
          Date.parse(expiresAt) - Date.now() > 366 * 86400000
        )
          throw new DomainError(
            "Observation must be past; review due within one year",
          );
        const body = {
          kind: choice(
            input.kind,
            ["REVIEW", "SURVEY", "COMPLAINT", "SUPPORT", "PURCHASE_PATTERN"],
            "Kind",
          ),
          excerpt: safe(input.excerpt, "Redacted observation", 4000),
          provenance: safe(
            input.provenance,
            "Source/method and authorized-use basis",
          ),
          theme: safe(input.theme, "Normalized theme", 80).toLowerCase(),
          observedAt,
          expiresAt,
          simulation: input.simulation,
        };
        const record = id();
        this.db
          .prepare(
            "INSERT INTO customer_evidence VALUES(?,?,?,?,?,?,'UNVERIFIED',NULL,?)",
          )
          .run(
            record,
            this.p.company_id,
            key,
            hash,
            safe(input.title, "Title", 160),
            JSON.stringify(body),
            now(),
          );
        return { id: record };
      },
    );
  }
  reviewEvidence(input: Record<string, unknown>) {
    return this.mutate(
      "customers.evidence_reviewed",
      String(input.id),
      ["oliver"],
      () => {
        const r = this.evidenceRow(input.id);
        if (r.status === "WITHDRAWN")
          throw new DomainError("Withdrawn evidence is terminal", 409);
        const status = choice(input.status, ["VERIFIED", "DISPUTED"], "Review");
        this.db
          .prepare(
            "UPDATE customer_evidence SET status=?,review_note=? WHERE company_id=? AND id=?",
          )
          .run(
            status,
            safe(input.note, "Review note"),
            this.p.company_id,
            String(r.id),
          );
        return { ok: true };
      },
    );
  }
  withdraw(input: Record<string, unknown>) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.evidenceRow(input.id);
      this.db
        .prepare(
          "UPDATE customer_evidence SET status='WITHDRAWN',review_note='Withdrawn from use' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, String(r.id));
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "customers.evidence_withdrawn",
        String(r.id),
      );
      return { ok: true };
    });
  }
  document(input: Record<string, unknown>) {
    return this.mutate(
      "customers.document_created",
      "document",
      ["oliver", "jessica", "nikolai"],
      () => {
        const kind = choice(
            input.kind,
            ["PERSONA", "INSIGHT"],
            "Document kind",
          ),
          sources = this.sources(input.sourceIds);
        let parent = null,
          version = 1;
        if (input.parentId) {
          const r = this.db
            .prepare(
              "SELECT * FROM customer_documents WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, field(input.parentId, "Parent", 80));
          if (!r || r.kind !== kind)
            throw new DomainError("Matching parent document required", 404);
          if (
            this.db
              .prepare(
                "SELECT id FROM customer_documents WHERE company_id=? AND parent_id=?",
              )
              .get(this.p.company_id, String(r.id))
          )
            throw new DomainError("Revise the latest version", 409);
          parent = String(r.id);
          version = Number(r.version) + 1;
        }
        const body = {
          simulation: sources.simulation,
          confidence: confidence(input.confidence),
          observed: safe(
            input.observed,
            "Observed attributes / findings",
            4000,
          ),
          inferred: safe(
            input.inferred,
            "Inferred attributes / hypothesis",
            4000,
          ),
          limitations: safe(input.limitations, "Evidence gaps and limitations"),
          attributes:
            kind === "PERSONA"
              ? Object.fromEntries(
                  personaFields.map((k) => [k, safe(input[k], k, 1000)]),
                )
              : null,
          recommendation:
            kind === "INSIGHT"
              ? safe(input.recommendation, "Recommendation")
              : null,
        };
        const record = id();
        this.db
          .prepare("INSERT INTO customer_documents VALUES(?,?,?,?,?,?,?,?)")
          .run(
            record,
            this.p.company_id,
            kind,
            parent,
            version,
            safe(input.title, "Document title", 160),
            JSON.stringify(body),
            now(),
          );
        for (const source of sources.list)
          this.db
            .prepare("INSERT INTO customer_document_sources VALUES(?,?,?)")
            .run(this.p.company_id, record, source);
        return { id: record };
      },
    );
  }
  caseRow(value: unknown) {
    const r = this.db
      .prepare("SELECT * FROM support_cases WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(value, "Case", 80));
    if (!r) throw new DomainError("Case not found", 404);
    return r;
  }
  support(input: Record<string, unknown>) {
    return this.mutate(
      "customers.support_classified",
      "case",
      ["andrey", "oliver"],
      () => {
        const r = this.evidenceRow(input.evidenceId);
        this.sources([String(r.id)]);
        if (!["SUPPORT", "COMPLAINT"].includes(parse(r).body.kind))
          throw new DomainError("Support or complaint evidence required");
        const suggestion = classify(parse(r).body.excerpt);
        const category = choice(input.category, supportCategories, "Category"),
          priority = choice(input.priority, ["NORMAL", "ESCALATE"], "Priority");
        if (
          (suggestion.priority === "ESCALATE" ||
            ["REFUND", "BILLING"].includes(suggestion.category) ||
            ["REFUND", "BILLING"].includes(category)) &&
          priority !== "ESCALATE"
        )
          throw new DomainError(
            "Sensitive/refund/billing case requires escalation",
          );
        const record = id();
        if (
          this.db
            .prepare(
              "SELECT id FROM support_cases WHERE company_id=? AND evidence_id=?",
            )
            .get(this.p.company_id, String(r.id))
        )
          throw new DomainError("Evidence already has a case", 409);
        this.db
          .prepare("INSERT INTO support_cases VALUES(?,?,?,?,?,?,'OPEN',?)")
          .run(
            record,
            this.p.company_id,
            String(r.id),
            category,
            priority,
            safe(input.rationale, "Human classification rationale"),
            now(),
          );
        return { id: record };
      },
    );
  }
  draft(input: Record<string, unknown>) {
    return this.mutate(
      "customers.support_drafted",
      String(input.id),
      ["andrey"],
      () => {
        const r = this.caseRow(input.id);
        if (r.status !== "OPEN")
          throw new DomainError("Open case required", 409);
        this.sources([String(r.evidence_id)]);
        const mode = choice(input.mode, ["TEMPLATE", "HUMAN"], "Draft mode");
        const body =
          mode === "TEMPLATE"
            ? `Thank you for raising this ${String(r.category).toLowerCase().replaceAll("_", " ")} concern. We need to review the details before confirming an outcome. ${r.priority === "ESCALATE" ? "This needs review by the appropriate team." : "Please use the authorized support channel for order-specific information."}\n[DRAFT ONLY — no order lookup, refund, promise or message sent]`
            : safe(input.body, "Response draft", 4000);
        const record = id();
        this.db
          .prepare(
            "INSERT INTO support_drafts VALUES(?,?,?,?,?,'DRAFT',NULL,?)",
          )
          .run(
            record,
            this.p.company_id,
            String(r.id),
            body,
            payloadHash({ body }),
            now(),
          );
        return { id: record };
      },
    );
  }
  reviewDraft(input: Record<string, unknown>) {
    return this.mutate(
      input.status === "REJECTED"
        ? "customers.support_draft_rejected"
        : "customers.support_draft_reviewed",
      String(input.id),
      ["andrey", "oliver"],
      () => {
        const r = this.db
          .prepare("SELECT * FROM support_drafts WHERE company_id=? AND id=?")
          .get(this.p.company_id, field(input.id, "Draft", 80));
        if (!r) throw new DomainError("Draft not found", 404);
        if (r.status !== "DRAFT" || input.contentHash !== r.content_hash)
          throw new DomainError("Exact unreviewed draft required", 409);
        const c = this.caseRow(r.case_id);
        if (c.status !== "OPEN")
          throw new DomainError("Open case required", 409);
        this.sources([String(c.evidence_id)]);
        this.db
          .prepare(
            "UPDATE support_drafts SET status=?,review_note=? WHERE company_id=? AND id=?",
          )
          .run(
            choice(input.status, ["REVIEWED", "REJECTED"], "Review"),
            safe(input.note, "Review note"),
            this.p.company_id,
            String(r.id),
          );
        return { ok: true, sent: false };
      },
    );
  }
  close(input: Record<string, unknown>) {
    return this.mutate(
      "customers.support_closed",
      String(input.id),
      ["andrey", "oliver"],
      () => {
        const r = this.caseRow(input.id);
        if (r.status !== "OPEN")
          throw new DomainError("Open case required", 409);
        const note = safe(input.note, "Resolution evidence");
        this.db
          .prepare(
            "UPDATE support_cases SET status='CLOSED' WHERE company_id=? AND id=?",
          )
          .run(this.p.company_id, String(r.id));
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "customers.resolution_recorded",
          String(r.id),
          "SUCCESS",
          { note },
        );
        return { ok: true };
      },
    );
  }
}
