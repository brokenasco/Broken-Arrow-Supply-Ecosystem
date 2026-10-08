import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { audit, id, now, transaction } from "./db.ts";
import { hash, verifyPassword } from "./auth.ts";
import { HumanWorkflow, field, integer } from "./workflow.ts";
import { DomainError, payloadHash } from "./policy.ts";
export function securityEvent(
  db: DatabaseSync,
  company: string,
  actor: string,
  action: string,
  target: string,
  result = "SUCCESS",
  severity = "LOW",
  metadata: Record<string, unknown> = {},
) {
  const record = id();
  db.prepare("INSERT INTO security_events VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
    record,
    company,
    actor,
    action,
    target,
    result,
    severity,
    "DETERMINISTIC",
    record,
    JSON.stringify(metadata),
    now(),
  );
  audit(db, company, actor, action, target, result, {
    securityEventId: record,
  });
  return record;
}
export function securitySettings(db: DatabaseSync, company: string) {
  return (
    db
      .prepare("SELECT * FROM security_settings WHERE company_id=?")
      .get(company) ?? { rotation_days: 90, lockdown: 0, version: 0 }
  );
}
export class SecurityFoundation extends HumanWorkflow {
  change<T>(action: string, target: string, fn: () => T) {
    return transaction(this.db, () => {
      this.authenticate();
      const result = fn();
      securityEvent(this.db, this.p.company_id, this.p.id, action, target);
      return result;
    });
  }
  reauthenticate(password: unknown) {
    if (typeof password !== "string" || password.length > 256)
      throw new DomainError("Reauthentication failed", 403);
    const user = this.db
      .prepare("SELECT password_hash FROM users WHERE id=? AND company_id=?")
      .get(this.p.id, this.p.company_id);
    if (!user || !verifyPassword(password, String(user.password_hash)))
      throw new DomainError("Reauthentication failed", 403);
    return this.change("SECURITY_REAUTHENTICATED", this.p.id, () => {
      const token = randomBytes(32).toString("hex");
      this.db
        .prepare("INSERT INTO security_reauth VALUES(?,?,?)")
        .run(hash(token), this.p.id, Date.now() + 5 * 60_000);
      return { token, expiresInSeconds: 300 };
    });
  }
  consumeReauth(value: unknown) {
    if (typeof value !== "string")
      throw new DomainError("Fresh single-use reauthentication required", 403);
    const deleted = this.db
      .prepare(
        "DELETE FROM security_reauth WHERE token_hash=? AND user_id=? AND expires_at>?",
      )
      .run(hash(value), this.p.id, Date.now());
    if (deleted.changes !== 1)
      throw new DomainError("Fresh single-use reauthentication required", 403);
  }
  configure(input: Record<string, unknown>) {
    return this.change("SECURITY_POLICY_CHANGED", "rotation", () => {
      this.consumeReauth(input.reauthToken);
      const days = integer(input.rotationDays, "Rotation days", 1, 365);
      this.db
        .prepare(
          "INSERT INTO security_settings VALUES(?,?,0,1,?) ON CONFLICT(company_id) DO UPDATE SET rotation_days=excluded.rotation_days,version=security_settings.version+1,updated_at=excluded.updated_at",
        )
        .run(this.p.company_id, days, now());
      return { rotationDays: days };
    });
  }
  evaluate(input: Record<string, unknown>) {
    return this.change("AGENT_ACCESS_EVALUATED", "gateway", () => {
      const agent = field(input.agentId, "Agent", 80),
        resource = field(input.resourceId, "Resource", 100),
        action = field(input.action, "Action", 80),
        environment = field(input.environment, "Environment", 20);
      const identity = this.db
        .prepare(
          "SELECT a.paused,d.paused department_paused,c.stopped FROM agents a JOIN departments d ON d.company_id=a.company_id AND d.id=a.department JOIN companies c ON c.id=a.company_id WHERE a.company_id=? AND a.id=?",
        )
        .get(this.p.company_id, agent);
      const grant = this.db
        .prepare(
          "SELECT 1 FROM security_permissions WHERE company_id=? AND agent_id=? AND resource_id=? AND action=? AND environment=? AND expires_at>?",
        )
        .get(
          this.p.company_id,
          agent,
          resource,
          action,
          environment,
          Date.now(),
        );
      const allowed =
        !!identity &&
        !identity.paused &&
        !identity.department_paused &&
        !identity.stopped &&
        !securitySettings(this.db, this.p.company_id).lockdown &&
        !!grant;
      securityEvent(
        this.db,
        this.p.company_id,
        this.p.id,
        allowed ? "AGENT_ACCESS_ALLOWED" : "AGENT_ACCESS_DENIED",
        agent,
        allowed ? "ALLOW" : "DENY",
        allowed ? "LOW" : "MEDIUM",
      );
      return {
        decision: allowed ? "ALLOW" : "DENY",
        execution: false,
        reason: allowed
          ? "Explicit time-bounded grant; execution still requires a trusted broker identity"
          : "Default deny: identity, scope or security state does not permit access",
      };
    });
  }
  approveGrant(input: Record<string, unknown>) {
    return this.change("SECURITY_GRANT_APPROVED", "gateway", () => {
      this.consumeReauth(input.reauthToken);
      const agentId = field(input.agentId, "Agent", 80);
      if (agentId === "viktor")
        throw new DomainError(
          "Viktor permissions cannot be expanded through this API",
          403,
        );
      if (
        !this.db
          .prepare("SELECT id FROM agents WHERE company_id=? AND id=?")
          .get(this.p.company_id, agentId)
      )
        throw new DomainError("Agent not found", 404);
      if (
        !["metadata.read", "authenticate"].includes(String(input.action)) ||
        !["DEVELOPMENT", "TESTING", "STAGING", "PRODUCTION"].includes(
          String(input.environment),
        )
      )
        throw new DomainError("Unsupported grant");
      const body = {
        agentId,
        resourceId: field(input.resourceId, "Resource", 100),
        action: String(input.action),
        environment: String(input.environment),
        expiresAt:
          Date.now() +
          integer(input.durationMinutes, "Duration", 1, 60) * 60000,
      };
      const record = id(),
        contentHash = payloadHash(body);
      this.db
        .prepare("INSERT INTO security_approvals VALUES(?,?,?,?,?,?,NULL,?)")
        .run(
          record,
          this.p.company_id,
          JSON.stringify(body),
          contentHash,
          this.p.id,
          Date.now() + 600000,
          now(),
        );
      return { id: record, body, contentHash };
    });
  }
  applyGrant(input: Record<string, unknown>) {
    return this.change("AGENT_PERMISSION_CHANGED", "gateway", () => {
      const row = this.db
        .prepare("SELECT * FROM security_approvals WHERE company_id=? AND id=?")
        .get(this.p.company_id, field(input.approvalId, "Approval", 80));
      if (
        !row ||
        row.consumed_at ||
        Number(row.expires_at) <= Date.now() ||
        row.content_hash !== input.contentHash
      )
        throw new DomainError(
          "Exact unexpired single-use approval required",
          403,
        );
      const body = JSON.parse(String(row.body));
      if (
        payloadHash(body) !== row.content_hash ||
        body.expiresAt <= Date.now() ||
        securitySettings(this.db, this.p.company_id).lockdown
      )
        throw new DomainError("Approval or security state invalid", 403);
      this.db
        .prepare(
          "INSERT INTO security_permissions VALUES(?,?,?,?,?,?,?) ON CONFLICT(company_id,agent_id,resource_id,action,environment) DO UPDATE SET expires_at=excluded.expires_at,granted_by=excluded.granted_by",
        )
        .run(
          this.p.company_id,
          body.agentId,
          body.resourceId,
          body.action,
          body.environment,
          body.expiresAt,
          this.p.id,
        );
      this.db
        .prepare(
          "UPDATE security_approvals SET consumed_at=? WHERE company_id=? AND id=?",
        )
        .run(now(), this.p.company_id, row.id);
      return { ok: true };
    });
  }
}
