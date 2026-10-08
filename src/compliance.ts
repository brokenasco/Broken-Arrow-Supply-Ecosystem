import type { DatabaseSync } from "node:sqlite";
import { HumanWorkflow, field, choice, integer } from "./workflow.ts";
import { id, now, audit, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import {
  artifactKinds,
  artifact,
  compliancePolicy,
  scanContent,
  supportArtifactUsable,
  type ArtifactKind,
} from "./compliance-gates.ts";
export const complianceChecks = [
  "privacyMinimized",
  "authorizedUse",
  "brandAlignment",
  "claimsSupported",
  "ipReviewed",
  "actionScopeReviewed",
] as const;
const tables = {
  PRODUCT: "product_proposals",
  CAMPAIGN: "campaigns",
  SUPPORT: "support_drafts",
  IMAGE: "generation_jobs",
  UX: "ux_reports",
} as const;
export function complianceState(db: DatabaseSync, company: string) {
  const policy = compliancePolicy(db, company);
  return {
    policy,
    checks: complianceChecks,
    artifacts: artifactKinds.flatMap((kind) =>
      db
        .prepare(
          `SELECT id FROM ${tables[kind]} WHERE company_id=? ORDER BY created_at DESC LIMIT 100`,
        )
        .all(company)
        .filter(
          (r) =>
            kind !== "SUPPORT" ||
            supportArtifactUsable(db, company, String(r.id)),
        )
        .map((r) => {
          const a = artifact(db, company, kind, String(r.id));
          return { ...a, flags: scanContent(a.content, policy.terms) };
        }),
    ),
    holds: db
      .prepare(
        "SELECT * FROM compliance_holds WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
    releases: db
      .prepare(
        "SELECT * FROM compliance_releases WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
    reviews: db
      .prepare(
        "SELECT * FROM compliance_reviews WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
    auditReviews: db
      .prepare(
        "SELECT * FROM compliance_audit_reviews WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company),
    auditRows: db
      .prepare(
        "SELECT sequence,actor,action,resource,result,created_at FROM audit_logs WHERE company_id=? ORDER BY sequence DESC LIMIT 100",
      )
      .all(company),
  };
}
export class ComplianceService extends HumanWorkflow {
  change<T>(action: string, resource: string, fn: () => T) {
    return transaction(this.db, () => {
      this.authenticate();
      const result = fn();
      audit(this.db, this.p.company_id, this.p.id, action, resource);
      return result;
    });
  }
  invalidateApprovals() {
    this.db
      .prepare(
        "UPDATE automation_schedules SET status='PAUSED',approval_expires_at=0 WHERE company_id=? AND status IN('ENABLED','APPROVED')",
      )
      .run(this.p.company_id);
    for (const table of [
      "approvals",
      "generation_jobs",
      "product_proposals",
      "campaigns",
      "ux_reports",
      "learning_cycles",
    ])
      this.db
        .prepare(
          `UPDATE ${table} SET expires_at=0 WHERE company_id=? AND ${table === "approvals" ? "state='APPROVED'" : "status='APPROVED'"}`,
        )
        .run(this.p.company_id);
  }
  holdRecord(category: string, reason: string) {
    const record = id();
    this.db
      .prepare("INSERT INTO compliance_holds VALUES(?,?,?,?,'OPEN',?,?,NULL)")
      .run(record, this.p.company_id, category, reason, this.p.id, now());
    this.invalidateApprovals();
    return { id: record };
  }
  hold(input: Record<string, unknown>) {
    return this.change("compliance.hold_opened", "compliance", () =>
      this.holdRecord(
        choice(
          input.category,
          ["SECURITY", "PRIVACY", "BRAND", "AUTHORITY", "DESTRUCTIVE"],
          "Category",
        ),
        field(input.reason, "Reason and evidence", 3000),
      ),
    );
  }
  configure(input: Record<string, unknown>) {
    return this.change("compliance.policy_updated", "compliance", () => {
      if (input.confirm !== true || typeof input.requireReviews !== "boolean")
        throw new DomainError("Explicit human policy confirmation required");
      if (!Array.isArray(input.terms) || input.terms.length > 30)
        throw new DomainError("Up to 30 prohibited brand terms required");
      const terms = [
        ...new Set(input.terms.map((t) => field(t, "Brand term", 80))),
      ];
      const before = compliancePolicy(this.db, this.p.company_id);
      const guidelines = field(input.brandGuidelines, "Brand guidelines", 4000),
        reason = field(input.reason, "Policy change reason", 2000);
      this.db
        .prepare(
          "INSERT INTO compliance_settings VALUES(?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET version=excluded.version,require_reviews=excluded.require_reviews,terms=excluded.terms,brand_guidelines=excluded.brand_guidelines,updated_at=excluded.updated_at",
        )
        .run(
          this.p.company_id,
          before.version + 1,
          input.requireReviews ? 1 : 0,
          JSON.stringify(terms),
          guidelines,
          now(),
        );
      this.invalidateApprovals();
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "compliance.policy_revision",
        "compliance",
        "SUCCESS",
        {
          version: before.version + 1,
          requireReviews: input.requireReviews,
          terms,
          brandGuidelines: guidelines,
          reason,
        },
      );
      return { ok: true };
    });
  }
  review(input: Record<string, unknown>) {
    return this.change("compliance.artifact_reviewed", String(input.id), () => {
      const kind = choice(input.kind, artifactKinds, "Artifact kind"),
        a = artifact(
          this.db,
          this.p.company_id,
          kind,
          field(input.id, "Artifact", 80),
        ),
        policy = compliancePolicy(this.db, this.p.company_id);
      if (input.contentHash !== a.hash)
        throw new DomainError("Exact artifact content hash required", 409);
      const verdict = choice(input.verdict, ["PASS", "BLOCK"], "Verdict"),
        raw = input.checks as Record<string, unknown>;
      if (!raw || typeof raw !== "object")
        throw new DomainError("Review checklist required");
      const checks = Object.fromEntries(
        complianceChecks.map((k) => [k, raw[k] === true]),
      );
      if (
        verdict === "PASS" &&
        (Object.values(checks).some((v) => !v) ||
          scanContent(a.content, policy.terms).length)
      )
        throw new DomainError(
          "PASS requires all checks and no unresolved privacy/brand flags",
          409,
        );
      const record = id(),
        note = field(input.note, "Review evidence and limitations", 3000);
      this.db
        .prepare(
          "INSERT INTO compliance_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          record,
          this.p.company_id,
          kind,
          a.id,
          a.hash,
          policy.version,
          verdict,
          JSON.stringify(checks),
          note,
          this.p.id,
          Date.now() + 7 * 86400000,
          now(),
        );
      if (verdict === "BLOCK")
        this.holdRecord("BRAND", `Blocked ${kind} ${a.id}: ${note}`);
      return { id: record };
    });
  }
  releaseRequest(input: Record<string, unknown>) {
    return this.change("compliance.release_approved", String(input.id), () => {
      const hold = this.db
        .prepare(
          "SELECT * FROM compliance_holds WHERE company_id=? AND id=? AND status='OPEN'",
        )
        .get(this.p.company_id, field(input.id, "Hold", 80));
      if (!hold) throw new DomainError("Open hold required", 404);
      if (input.confirm !== true)
        throw new DomainError("Explicit CEO release approval required");
      const remediation = field(
          input.remediation,
          "Remediation evidence",
          4000,
        ),
        record = id(),
        contentHash = payloadHash({
          holdId: hold.id,
          category: hold.category,
          reason: hold.reason,
          remediation,
        });
      this.db
        .prepare("INSERT INTO compliance_releases VALUES(?,?,?,?,?,?,?,NULL,?)")
        .run(
          record,
          this.p.company_id,
          String(hold.id),
          remediation,
          contentHash,
          this.p.id,
          Date.now() + 600000,
          now(),
        );
      return { id: record, contentHash };
    });
  }
  release(input: Record<string, unknown>) {
    return this.change("compliance.hold_released", String(input.id), () => {
      const r = this.db
        .prepare(
          "SELECT * FROM compliance_releases WHERE company_id=? AND id=?",
        )
        .get(this.p.company_id, field(input.id, "Release", 80));
      if (
        !r ||
        r.consumed_at ||
        Number(r.expires_at) <= Date.now() ||
        input.contentHash !== r.content_hash ||
        input.confirm !== true
      )
        throw new DomainError(
          "Exact unexpired single-use release approval required",
          409,
        );
      const hold = this.db
        .prepare(
          "SELECT * FROM compliance_holds WHERE company_id=? AND id=? AND status='OPEN'",
        )
        .get(this.p.company_id, String(r.hold_id));
      if (
        !hold ||
        payloadHash({
          holdId: hold.id,
          category: hold.category,
          reason: hold.reason,
          remediation: r.remediation,
        }) !== r.content_hash
      )
        throw new DomainError("Hold or remediation mismatch", 409);
      this.db
        .prepare(
          "UPDATE compliance_releases SET consumed_at=? WHERE company_id=? AND id=?",
        )
        .run(now(), this.p.company_id, String(r.id));
      this.db
        .prepare(
          "UPDATE compliance_holds SET status='RELEASED',released_at=? WHERE company_id=? AND id=?",
        )
        .run(now(), this.p.company_id, String(hold.id));
      return { ok: true };
    });
  }
  auditReview(input: Record<string, unknown>) {
    return this.change("compliance.audit_reviewed", "audit", () => {
      const start = integer(
          input.start,
          "First sequence",
          1,
          Number.MAX_SAFE_INTEGER,
        ),
        end = integer(
          input.end,
          "Last sequence",
          start,
          Number.MAX_SAFE_INTEGER,
        );
      const rows = this.db
        .prepare(
          "SELECT * FROM audit_logs WHERE company_id=? AND sequence BETWEEN ? AND ? ORDER BY sequence LIMIT 1001",
        )
        .all(this.p.company_id, start, end);
      if (
        !rows.length ||
        rows.length > 1000 ||
        rows[0].sequence !== start ||
        rows.at(-1)!.sequence !== end
      )
        throw new DomainError(
          "Choose 1–1000 company audit records with matching range endpoints",
        );
      const verdict = choice(
          input.verdict,
          ["NO_FINDINGS", "ESCALATE"],
          "Verdict",
        ),
        note = field(input.note, "Review findings", 4000),
        record = id();
      this.db
        .prepare(
          "INSERT INTO compliance_audit_reviews VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          record,
          this.p.company_id,
          start,
          end,
          rows.length,
          payloadHash({ rows }),
          verdict,
          note,
          this.p.id,
          now(),
        );
      if (verdict === "ESCALATE")
        this.holdRecord("SECURITY", "Audit review " + record + ": " + note);
      return { id: record };
    });
  }
}
