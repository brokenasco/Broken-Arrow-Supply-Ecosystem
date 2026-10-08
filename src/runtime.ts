import { id, now, transaction, audit } from "./db.ts";
import { HumanWorkflow, field, integer } from "./workflow.ts";
import { DomainError, payloadHash } from "./policy.ts";

const MAX_OUTPUT = 32000;

export class RuntimeService extends HumanWorkflow {
  propose(input: Record<string, unknown>) {
    this.authenticate();
    const taskId = field(input.taskId, "Task", 80);
    const provider = field(input.provider ?? "NONE", "Provider", 80);
    const proposal = input.proposal;
    if (proposal === undefined)
      throw new DomainError("Structured proposal required");
    const encoded = JSON.stringify(proposal);
    if (encoded.length > MAX_OUTPUT)
      throw new DomainError(
        "Structured proposal exceeds 32000 characters",
        409,
      );
    return transaction(this.db, () => {
      const task = this.db
        .prepare(
          "SELECT agent_id,status,retry_count FROM tasks WHERE company_id=? AND id=?",
        )
        .get(this.p.company_id, taskId);
      if (!task) throw new DomainError("Task not found", 404);
      this.guard([String(task.agent_id)]);
      if (["COMPLETE", "FAILED", "CANCELLED"].includes(String(task.status)))
        throw new DomainError("Task is terminal", 409);
      const attemptNo = integer(Number(task.retry_count) + 1, "Attempt", 1, 3);
      const attemptId = id();
      this.db
        .prepare("INSERT INTO execution_attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          this.p.company_id,
          attemptId,
          taskId,
          attemptNo,
          "PROPOSED",
          payloadHash({ taskId, proposal }),
          null,
          null,
          provider,
          now(),
          null,
        );
      this.db
        .prepare(
          "INSERT INTO runtime_events VALUES(?,?,?,?,?,'PENDING',?,NULL)",
        )
        .run(
          this.p.company_id,
          id(),
          "runtime.execution.proposed",
          taskId,
          JSON.stringify({ attemptId, taskId, provider }),
          now(),
        );
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "runtime.execution_proposed",
        attemptId,
        "SUCCESS",
        { taskId, provider },
      );
      return {
        attemptId,
        taskId,
        attemptNo,
        state: "PROPOSED" as const,
        modelExecutionEnabled: false as const,
      };
    });
  }
  list(taskId: unknown) {
    this.authenticate();
    const task = field(taskId, "Task", 80);
    return this.db
      .prepare(
        "SELECT id,task_id,attempt_no,state,input_hash,provider,created_at,finished_at FROM execution_attempts WHERE company_id=? AND task_id=? ORDER BY attempt_no",
      )
      .all(this.p.company_id, task);
  }
}
