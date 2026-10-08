import {
  assertComplianceClear,
  enforceComplianceReview,
} from "./compliance-gates.ts";
import type { DatabaseSync } from "node:sqlite";
import { assertNotQuarantined } from "./quarantine-gates.ts";
import type { Principal } from "./service.ts";
import { audit, transaction } from "./db.ts";
import { DomainError } from "./policy.ts";
export function field(v: unknown, name: string, max = 2000): string {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw new DomainError(`${name}: 1–${max} characters required`);
  return v.trim();
}
export function integer(v: unknown, name: string, min: number, max: number) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    throw new DomainError(`${name}: integer ${min}–${max} required`);
  return v;
}
export function choice<T extends string>(
  v: unknown,
  values: readonly T[],
  name: string,
): T {
  if (!values.includes(v as T)) throw new DomainError(`Invalid ${name}`);
  return v as T;
}
export function iso(v: unknown, name: string) {
  const s = field(v, name, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s)))
    throw new DomainError(`Valid ${name} timestamp required`);
  return new Date(s).toISOString();
}
export function ids(v: unknown, name: string) {
  if (!Array.isArray(v) || !v.length || v.length > 20)
    throw new DomainError(`${name}: 1–20 IDs required`);
  const values = v.map((x) => field(x, name, 80));
  if (new Set(values).size !== values.length)
    throw new DomainError(`Duplicate ${name}`);
  return values;
}
export class HumanWorkflow {
  db: DatabaseSync;
  p: Principal;
  constructor(db: DatabaseSync, p: Principal) {
    this.db = db;
    this.p = p;
    this.authenticate();
  }
  authenticate() {
    if (
      this.p.role !== "CEO" ||
      !this.db
        .prepare(
          "SELECT id FROM users WHERE id=? AND company_id=? AND role='CEO'",
        )
        .get(this.p.id, this.p.company_id)
    )
      throw new DomainError("Authenticated company CEO required", 403);
  }
  guard(agents: string[]) {
    this.authenticate();
    assertComplianceClear(this.db, this.p.company_id);
    if (
      this.db
        .prepare("SELECT stopped FROM companies WHERE id=?")
        .get(this.p.company_id)?.stopped
    )
      throw new DomainError("Company paused", 409);
    for (const agent of agents) {
      assertNotQuarantined(this.db, this.p.company_id, agent);
      const r = this.db
        .prepare(
          "SELECT a.paused,d.paused department_paused FROM agents a JOIN departments d ON d.company_id=a.company_id AND d.id=a.department WHERE a.company_id=? AND a.id=?",
        )
        .get(this.p.company_id, agent);
      if (!r || r.paused || r.department_paused)
        throw new DomainError(`${agent} workflow paused`, 409);
    }
  }
  mutate<T>(action: string, resource: string, agents: string[], fn: () => T) {
    return transaction(this.db, () => {
      if (
        ["design.job_cancelled", "customers.support_draft_rejected"].includes(
          action,
        )
      )
        this.authenticate();
      else this.guard(agents);
      enforceComplianceReview(this.db, this.p.company_id, action, resource);
      const result = fn();
      audit(this.db, this.p.company_id, this.p.id, action, resource);
      return result;
    });
  }
}
