import { createHash } from "node:crypto";
import { DomainError } from "./policy.ts";
export const knowledgeTypes = [
  "FACT",
  "RESEARCH",
  "DECISION",
  "POLICY",
  "PROCEDURE",
  "PRODUCT_INFORMATION",
  "MARKET_INTELLIGENCE",
  "CUSTOMER_INSIGHT",
  "COMPETITOR_INTELLIGENCE",
  "DESIGN_GUIDANCE",
  "TECHNICAL_DOCUMENTATION",
  "SECURITY_INFORMATION",
  "EXPERIMENT_RESULT",
  "LESSON_LEARNED",
  "ASSUMPTION",
  "HYPOTHESIS",
  "AGENT_NOTE",
] as const;
export function screenKnowledge(value: string) {
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-(?:proj-)?|shpat_|ghp_|xox[baprs]-)[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}|\bBearer\s+[A-Za-z0-9._-]{12,}|(?:password|api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s*[:=]\s*["']?\S{6,}|[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s@]+@/i.test(
      value,
    )
  )
    throw new DomainError(
      "Possible credential material rejected; use the approved vault, not knowledge storage",
    );
}
export const contentHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const concepts: Record<string, string[]> = {
  bicycle: ["bicycle", "bicycles", "bike", "bikes", "cycling"],
  customer: ["customer", "customers", "buyer", "buyers", "audience"],
  security: ["security", "cybersecurity", "protection"],
  credential: [
    "credential",
    "credentials",
    "password",
    "passwords",
    "authentication",
  ],
  revenue: ["revenue", "sales", "turnover"],
  design: ["design", "designs", "artwork"],
  research: ["research", "study", "studies", "investigation"],
};
export function tokens(text: string) {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])].slice(
    0,
    80,
  );
}
export function conceptVector(text: string) {
  const words = new Set(tokens(text));
  return Object.keys(concepts).map((key) =>
    concepts[key].some((w) => words.has(w)) ? 1 : 0,
  );
}
export function conceptSimilarity(a: number[], b: number[]) {
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function expansion(text: string) {
  const words = tokens(text).slice(0, 12);
  return [
    ...new Set([
      ...words,
      ...Object.values(concepts)
        .filter((v) => v.some((t) => words.includes(t)))
        .flat(),
    ]),
  ].slice(0, 60);
}
export function freshness(row: Record<string, any>, time = Date.now()) {
  if (row.expires_at && Date.parse(row.expires_at) <= time) return "EXPIRED";
  if (row.status === "STALE") return "STALE";
  const review = Date.parse(row.review_at);
  return review <= time
    ? "STALE"
    : review - time < 7 * 86400000
      ? "AGING"
      : "FRESH";
}
