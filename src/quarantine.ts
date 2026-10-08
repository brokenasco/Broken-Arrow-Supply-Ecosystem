import { HumanWorkflow, field } from "./workflow.ts";
import { activeQuarantine, quarantinePending } from "./quarantine-gates.ts";
import { transaction, audit, now } from "./db.ts";
import { DomainError } from "./policy.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
export class QuarantineService extends HumanWorkflow {
  hold(input: Record<string, unknown>) {
    return this.attempt("HOLD", () => this.performHold(input));
  }
  release(input: Record<string, unknown>) {
    return this.attempt("RELEASE", () => this.performRelease(input));
  }
  private attempt<T>(action: string, work: () => T): T {
    this.authenticate();
    try {
      return work();
    } catch (error) {
      transaction(this.db, () => {
        this.authenticate();
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "quarantine.denied",
          "quarantine",
          "DENIED",
          { action, code: error instanceof DomainError ? error.status : 500 },
        );
      });
      throw error;
    }
  }
  private performHold(input: Record<string, unknown>) {
    this.authenticate();
    const agent = field(input.agent, "Agent", 80),
      request = field(input.requestId, "Request ID", 80),
      reason = field(input.reason, "Reason", 1000);
    screenKnowledge(reason);
    if (input.confirm !== true)
      throw new DomainError("Explicit owner confirmation required");
    return transaction(this.db, () => {
      this.authenticate();
      const existing = this.db
        .prepare("SELECT * FROM agent_quarantine_holds WHERE id=?")
        .get(request);
      if (existing) {
        if (
          existing.company_id !== this.p.company_id ||
          existing.agent_id !== agent ||
          existing.reason !== reason
        )
          throw new DomainError(
            "Request ID already bound to another action",
            409,
          );
        return existing;
      }
      if (
        !this.db
          .prepare("SELECT id FROM agents WHERE company_id=? AND id=?")
          .get(this.p.company_id, agent)
      )
        throw new DomainError("Unknown agent", 404);
      if (activeQuarantine(this.db, this.p.company_id, agent))
        throw new DomainError("Agent already held; refresh current hold", 409);
      const latest = this.db
        .prepare(
          "SELECT id FROM agent_quarantine_holds WHERE company_id=? AND agent_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(this.p.company_id, agent);
      if ((latest?.id ?? "") !== (input.previousHoldId ?? ""))
        throw new DomainError(
          "Stale quarantine request; refresh agent state",
          409,
        );
      this.db
        .prepare("INSERT INTO agent_quarantine_holds VALUES(?,?,?,?,?,?)")
        .run(request, this.p.company_id, agent, reason, this.p.id, now());
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "quarantine.held",
        agent,
        "SUCCESS",
        { holdId: request, reason },
      );
      return activeQuarantine(this.db, this.p.company_id, agent);
    });
  }
  private performRelease(input: Record<string, unknown>) {
    this.authenticate();
    const holdId = field(input.holdId, "Hold", 80),
      reason = field(input.reason, "Release reason", 1000);
    screenKnowledge(reason);
    if (input.confirm !== true)
      throw new DomainError("Explicit owner confirmation required");
    return transaction(this.db, () => {
      this.authenticate();
      const hold = this.db
        .prepare(
          "SELECT * FROM agent_quarantine_holds WHERE company_id=? AND id=?",
        )
        .get(this.p.company_id, holdId);
      if (!hold) throw new DomainError("Hold not found", 404);
      const active = activeQuarantine(
        this.db,
        this.p.company_id,
        String(hold.agent_id),
      );
      if (active && active.id !== holdId)
        throw new DomainError("Stale release; a newer hold exists", 409);
      const released = this.db
        .prepare("SELECT * FROM agent_quarantine_releases WHERE hold_id=?")
        .get(holdId);
      if (released) return released;
      if (quarantinePending(this.db, this.p.company_id, String(hold.agent_id)))
        throw new DomainError(
          "Quarantine pending: finish stopping or reconcile outstanding execution before release",
          409,
        );
      this.db
        .prepare("INSERT INTO agent_quarantine_releases VALUES(?,?,?,?)")
        .run(holdId, this.p.id, now(), reason);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "quarantine.released",
        String(hold.agent_id),
        "SUCCESS",
        { holdId, reason },
      );
      return { holdId, released: true };
    });
  }
}
