import type { DatabaseSync } from "node:sqlite";
import { DomainError, payloadHash } from "./policy.ts";
export const artifactKinds = [
  "PRODUCT",
  "CAMPAIGN",
  "SUPPORT",
  "IMAGE",
  "UX",
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];
export function supportArtifactUsable(
  db: DatabaseSync,
  company: string,
  id: string,
) {
  const evidence = db
    .prepare(
      "SELECT e.status,e.body FROM support_drafts d JOIN support_cases c ON c.company_id=d.company_id AND c.id=d.case_id JOIN customer_evidence e ON e.company_id=c.company_id AND e.id=c.evidence_id WHERE d.company_id=? AND d.id=?",
    )
    .get(company, id);
  return (
    !!evidence &&
    evidence.status === "VERIFIED" &&
    Date.parse(JSON.parse(String(evidence.body)).expiresAt) > Date.now()
  );
}
const artifacts = {
  PRODUCT: ["product_proposals", "payload"],
  CAMPAIGN: ["campaigns", "body"],
  SUPPORT: ["support_drafts", "body"],
  IMAGE: ["generation_jobs", "payload"],
  UX: ["ux_reports", "body"],
} as const;
export function artifact(
  db: DatabaseSync,
  company: string,
  kind: ArtifactKind,
  id: string,
) {
  const entry = artifacts[kind];
  if (!entry) throw new DomainError("Unsupported artifact");
  const [table, column] = entry;
  const r = db
    .prepare(
      `SELECT id,${column} AS content FROM ${table} WHERE company_id=? AND id=?`,
    )
    .get(company, id);
  if (!r) throw new DomainError("Artifact not found", 404);
  if (kind === "SUPPORT" && !supportArtifactUsable(db, company, id))
    throw new DomainError("Fresh verified customer evidence required", 409);
  const content = String(r.content);
  return {
    kind,
    id: String(r.id),
    content,
    hash: payloadHash({ kind, content }),
  };
}
export function compliancePolicy(db: DatabaseSync, company: string) {
  const r = db
    .prepare("SELECT * FROM compliance_settings WHERE company_id=?")
    .get(company);
  return r
    ? {
        version: Number(r.version),
        requireReviews: !!r.require_reviews,
        terms: JSON.parse(String(r.terms)) as string[],
        brandGuidelines: String(r.brand_guidelines),
      }
    : {
        version: 0,
        requireReviews: false,
        terms: [] as string[],
        brandGuidelines: "No brand policy configured",
      };
}
export function scanContent(content: string, terms: string[]) {
  const flags: string[] = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content))
    flags.push("Possible email/contact data");
  if (/\b(?:sk-[a-zA-Z0-9_-]{16,}|shpat_[a-zA-Z0-9]{16,})\b/.test(content))
    flags.push("Possible credential");
  for (const term of terms)
    if (content.toLowerCase().includes(term.toLowerCase()))
      flags.push("Configured brand term: " + term);
  return flags;
}
export function assertComplianceClear(db: DatabaseSync, company: string) {
  if (
    db
      .prepare("SELECT lockdown FROM security_settings WHERE company_id=?")
      .get(company)?.lockdown
  )
    throw new DomainError(
      "Security lockdown blocks work; review in Security Command Center",
      409,
    );
  if (
    db
      .prepare(
        "SELECT id FROM compliance_holds WHERE company_id=? AND status='OPEN' LIMIT 1",
      )
      .get(company)
  )
    throw new DomainError(
      "Compliance hold blocks work; remediate in Quality & Compliance",
      409,
    );
}
const gates: Record<string, ArtifactKind> = {
  "products.dispatch_authorized": "PRODUCT",
  "marketing.plan_marked_ready": "CAMPAIGN",
  "customers.support_draft_reviewed": "SUPPORT",
  "design.generation_dispatched": "IMAGE",
  "technology.assigned_to_sarah": "UX",
};
export function enforceComplianceReview(
  db: DatabaseSync,
  company: string,
  action: string,
  id: string,
) {
  const kind = gates[action];
  if (!kind) return;
  const policy = compliancePolicy(db, company);
  if (!policy.requireReviews) return;
  const current = artifact(db, company, kind, id);
  const review = db
    .prepare(
      "SELECT * FROM compliance_reviews WHERE company_id=? AND kind=? AND artifact_id=? AND content_hash=? AND policy_version=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(company, kind, id, current.hash, policy.version);
  if (
    !review ||
    review.verdict !== "PASS" ||
    Number(review.expires_at) <= Date.now()
  )
    throw new DomainError(
      "Fresh matching compliance PASS required for this content and policy",
      409,
    );
  if (scanContent(current.content, policy.terms).length)
    throw new DomainError(
      "Privacy/brand content checks require remediation",
      409,
    );
}
