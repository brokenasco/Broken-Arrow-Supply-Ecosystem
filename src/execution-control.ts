import { HumanWorkflow, field, ids, integer, choice } from "./workflow.ts";
import { transaction, audit, now, id } from "./db.ts";
import { DomainError } from "./policy.ts";
import { createHash } from "node:crypto";
export class ExecutionControl extends HumanWorkflow {
  // Receipt bookkeeping remains available after a hold; it grants no dispatch authority.
  receipt(operation: string, reference: string, usage: object) {
    this.authenticate();
    if (typeof reference !== "string" || reference.length > 4096)
      throw new DomainError("Invalid provider receipt");
    const safe: Record<string, number> = {};
    for (const key of [
      "input_tokens",
      "output_tokens",
      "total_tokens",
      "cached_input_tokens",
    ])
      if (Object.hasOwn(usage, key)) {
        const value = (usage as Record<string, unknown>)[key];
        if (
          Number.isSafeInteger(value) &&
          Number(value) >= 0 &&
          Number(value) <= 1e12
        )
          safe[key] = Number(value);
      }
    const digest = createHash("sha256").update(reference).digest("hex"),
      body = JSON.stringify(safe);
    return transaction(this.db, () => {
      this.row(operation);
      const existing = this.db
        .prepare(
          "SELECT * FROM execution_receipts WHERE company_id=? AND operation_id=?",
        )
        .get(this.p.company_id, operation);
      if (existing) {
        if (existing.reference_hash !== digest || existing.usage !== body)
          throw new DomainError(
            "Receipt conflicts with preserved evidence",
            409,
          );
        return;
      }
      this.db
        .prepare("INSERT INTO execution_receipts VALUES(?,?,?,?,?)")
        .run(this.p.company_id, operation, digest, body, now());
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "execution.receipt_recorded",
        operation,
        "SUCCESS",
        { usageFields: Object.keys(safe) },
      );
    });
  }
  watch(operation: string) {
    const controller = new AbortController();
    const check = () => {
      try {
        this.checkpoint(operation);
      } catch {
        controller.abort();
      }
    };
    check();
    const timer = setInterval(check, 250);
    timer.unref();
    return { signal: controller.signal, dispose: () => clearInterval(timer) };
  }
  generation(agent: string) {
    return Number(
      this.db
        .prepare(
          "SELECT count(*) n FROM agent_quarantine_holds WHERE company_id=? AND agent_id=?",
        )
        .get(this.p.company_id, agent)?.n,
    );
  }
  begin(input: {
    kind: string;
    resourceId: string;
    agents: string[];
    requestKey: string;
    effect: "READ" | "WRITE" | "PAID";
    timeoutMs: number;
    taskId?: string;
    workflowId?: string;
  }) {
    const participants = ids(input.agents, "Participants"),
      kind = field(input.kind, "Kind", 80),
      resource = field(input.resourceId, "Resource", 120),
      key = field(input.requestKey, "Request key", 180),
      effect = choice(input.effect, ["READ", "WRITE", "PAID"], "Effect"),
      timeout = integer(input.timeoutMs, "Timeout", 1000, 300000);
    return this.mutate("execution.started", resource, participants, () => {
      if (
        this.db
          .prepare(
            "SELECT id FROM execution_operations WHERE company_id=? AND request_key=?",
          )
          .get(this.p.company_id, key)
      )
        throw new DomainError(
          "Execution already recorded; never redispatch by retrying begin",
          409,
        );
      const operation = id();
      this.db
        .prepare(
          "INSERT INTO execution_operations VALUES(?,?,?,?,?,?,?,'RUNNING',?,?,?,?,?,'DISPATCH_PENDING')",
        )
        .run(
          this.p.company_id,
          operation,
          kind,
          resource,
          input.taskId ?? null,
          input.workflowId ?? null,
          key,
          effect,
          this.p.id,
          now(),
          Date.now() + timeout,
          now(),
        );
      for (const agent of participants)
        this.db
          .prepare("INSERT INTO execution_participants VALUES(?,?,?,?)")
          .run(this.p.company_id, operation, agent, this.generation(agent));
      return operation;
    });
  }
  row(operation: string) {
    this.authenticate();
    const r = this.db
      .prepare("SELECT * FROM execution_operations WHERE company_id=? AND id=?")
      .get(this.p.company_id, operation);
    if (!r) throw new DomainError("Execution not found", 404);
    return r;
  }
  checkpoint(operation: string) {
    const r = this.row(operation);
    if (r.state !== "RUNNING" || Number(r.deadline_at) <= Date.now())
      throw new DomainError(
        "Execution stopped or expired; reconcile without replay",
        409,
      );
    const participants = this.db
      .prepare(
        "SELECT * FROM execution_participants WHERE company_id=? AND operation_id=?",
      )
      .all(this.p.company_id, operation);
    this.guard(participants.map((p) => String(p.agent_id)));
    if (
      participants.some(
        (p) => this.generation(String(p.agent_id)) !== p.hold_generation,
      )
    )
      throw new DomainError(
        "Execution invalidated by quarantine generation",
        409,
      );
  }
  finish(
    operation: string,
    state: "COMPLETE" | "STOPPED" | "UNKNOWN",
    outcome: string,
  ) {
    choice(state, ["COMPLETE", "STOPPED", "UNKNOWN"], "State");
    if (!/^[A-Z_]{1,80}$/.test(outcome))
      throw new DomainError("Safe outcome code required");
    return transaction(this.db, () => {
      const r = this.row(operation);
      if (r.state === state) return r;
      if (r.state !== "RUNNING" && r.state !== "UNKNOWN")
        throw new DomainError("Execution already terminal", 409);
      this.db
        .prepare(
          "UPDATE execution_operations SET state=?,outcome=?,updated_at=? WHERE company_id=? AND id=?",
        )
        .run(state, outcome, now(), this.p.company_id, operation);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "execution.outcome",
        operation,
        state,
        { outcome },
      );
      return this.row(operation);
    });
  }
  recover(operation: string) {
    return transaction(this.db, () => {
      const r = this.row(operation);
      if (r.state !== "RUNNING" || Number(r.deadline_at) > Date.now())
        throw new DomainError("Only expired execution may be recovered", 409);
      return this.finish(
        operation,
        r.effect === "READ" ? "STOPPED" : "UNKNOWN",
        r.effect === "READ"
          ? "EXPIRED_READ_FENCED"
          : "EXTERNAL_OUTCOME_UNKNOWN",
      );
    });
  }
  recoverLegacyMonitor(token: string) {
    return transaction(this.db, () => {
      this.authenticate();
      field(token, "Monitor token", 80);
      const r = this.db
        .prepare(
          "SELECT * FROM ux_monitor_runs WHERE company_id=? AND token=? AND status='RUNNING'",
        )
        .get(this.p.company_id, token);
      if (!r || Date.now() - Number(r.started_at) < 60000)
        throw new DomainError("Only expired legacy monitor can be fenced", 409);
      if (
        this.db
          .prepare(
            "SELECT id FROM execution_operations WHERE company_id=? AND kind='MONITOR' AND resource_id=?",
          )
          .get(this.p.company_id, token)
      )
        throw new DomainError("Use the tracked execution recovery", 409);
      this.db
        .prepare(
          "UPDATE ux_monitor_runs SET status='FAILED',token=? WHERE company_id=? AND token=?",
        )
        .run(id(), this.p.company_id, token);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "execution.legacy_monitor_fenced",
        token,
      );
      return { recovered: true, externalReversal: false };
    });
  }
}
