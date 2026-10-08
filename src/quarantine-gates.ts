import type { DatabaseSync } from "node:sqlite";
import { DomainError } from "./policy.ts";
export function activeQuarantine(
  db: DatabaseSync,
  company: string,
  agent: string,
) {
  return db
    .prepare(
      "SELECT h.* FROM agent_quarantine_holds h LEFT JOIN agent_quarantine_releases r ON r.hold_id=h.id WHERE h.company_id=? AND h.agent_id=? AND r.hold_id IS NULL ORDER BY h.rowid DESC LIMIT 1",
    )
    .get(company, agent);
}
export function assertNotQuarantined(
  db: DatabaseSync,
  company: string,
  agent: string,
) {
  if (activeQuarantine(db, company, agent))
    throw new DomainError(
      `${agent} is quarantined; explicit owner release required`,
      409,
    );
}
export function quarantinePending(
  db: DatabaseSync,
  company: string,
  agent: string,
) {
  return (
    outstandingOperations(db, company, agent).length > 0 ||
    legacyExecutionPending(db, company)
  );
}
export function outstandingOperations(
  db: DatabaseSync,
  company: string,
  agent: string,
) {
  return db
    .prepare(
      "SELECT o.id,o.kind,o.resource_id,o.task_id,o.workflow_id,o.state,o.effect,o.started_at,o.deadline_at,o.outcome FROM execution_operations o JOIN execution_participants p ON p.company_id=o.company_id AND p.operation_id=o.id WHERE o.company_id=? AND p.agent_id=? AND o.state IN('RUNNING','UNKNOWN') ORDER BY o.started_at",
    )
    .all(company, agent);
}
// Historical work without participant metadata is a company migration blocker,
// not evidence of activity by a specific agent.
export function legacyExecutionPending(db: DatabaseSync, company: string) {
  return (
    !!db
      .prepare(
        "SELECT 1 FROM generation_jobs j LEFT JOIN generation_reconciliations r ON r.company_id=j.company_id AND r.job_id=j.id WHERE j.company_id=? AND (j.status='RUNNING' OR (j.status='RECONCILIATION' AND r.id IS NULL)) AND NOT EXISTS(SELECT 1 FROM execution_operations o WHERE o.company_id=j.company_id AND o.kind='IMAGE' AND o.resource_id=j.id) LIMIT 1",
      )
      .get(company) ||
    !!db
      .prepare(
        "SELECT 1 FROM product_proposals j WHERE j.company_id=? AND j.status IN('CHECKING','DISPATCHING','RECONCILIATION') AND NOT EXISTS(SELECT 1 FROM execution_operations o WHERE o.company_id=j.company_id AND o.kind='PRODUCT' AND o.resource_id=j.id) LIMIT 1",
      )
      .get(company) ||
    !!db
      .prepare(
        "SELECT 1 FROM ux_monitor_runs j WHERE j.company_id=? AND j.status='RUNNING' AND NOT EXISTS(SELECT 1 FROM execution_operations o WHERE o.company_id=j.company_id AND o.kind='MONITOR' AND o.resource_id=j.token) LIMIT 1",
      )
      .get(company)
  );
}
