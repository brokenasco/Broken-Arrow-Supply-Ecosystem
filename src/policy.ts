import { assertComplianceClear } from "./compliance-gates.ts";
import { assertNotQuarantined } from "./quarantine-gates.ts";
import type { DatabaseSync } from "node:sqlite";
import { hash } from "./auth.ts";
export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export type Action = {
  company: string;
  agent: string;
  tool: string;
  payload: Record<string, unknown>;
  external: boolean;
  risk: "GREEN" | "YELLOW" | "RED";
  approvalId?: string;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const payloadHash = (payload: Record<string, unknown>) =>
  hash(canonical(payload));
export function checkPolicy(db: DatabaseSync, action: Action) {
  assertNotQuarantined(db, action.company, action.agent);
  assertComplianceClear(db, action.company);
  const company = db
    .prepare("SELECT * FROM companies WHERE id=?")
    .get(action.company);
  const agent = db
    .prepare(
      "SELECT a.*,d.paused department_paused FROM agents a JOIN departments d ON d.company_id=a.company_id AND d.id=a.department WHERE a.company_id=? AND a.id=?",
    )
    .get(action.company, action.agent);
  if (!company || !agent)
    throw new DomainError("Unknown company or agent", 403);
  if (company.stopped || agent.paused || agent.department_paused)
    throw new DomainError("Company, department or agent is paused", 403);
  const definition = JSON.parse(String(agent.definition));
  if (!definition.tools.includes(action.tool))
    throw new DomainError("Tool permission denied", 403);
  if (action.external)
    throw new DomainError("External execution is disabled in Phase 1", 403);
  if (action.risk !== "GREEN") {
    const approval = db
      .prepare("SELECT * FROM approvals WHERE company_id=? AND id=?")
      .get(action.company, action.approvalId ?? "");
    if (
      !approval ||
      approval.state !== "APPROVED" ||
      Number(approval.expires_at) <= Date.now() ||
      approval.agent_id !== action.agent ||
      approval.tool !== action.tool ||
      approval.risk !== action.risk ||
      approval.payload_hash !== payloadHash(action.payload)
    )
      throw new DomainError("Valid matching CEO approval required", 403);
  }
}
