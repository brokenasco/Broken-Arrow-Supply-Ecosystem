import { HumanWorkflow, field, ids } from "./workflow.ts";
import { AgentConfigurationService } from "./agent-configuration.ts";
import { CompanyService } from "./service.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { transaction, audit, now } from "./db.ts";

export class TaskCoordinationService extends HumanWorkflow {
  delegate(input: Record<string, unknown>) {
    this.authenticate();
    const requestId = field(input.requestId, "Request ID", 80),
      parentTaskId = field(input.parentTaskId, "Parent task", 80),
      agentId = field(input.agentId, "Recipient", 80),
      objective = field(input.objective, "Objective", 2000),
      expectedOutput = field(input.expectedOutput, "Expected output", 2000),
      dependencies =
        input.dependencies === undefined ||
        (Array.isArray(input.dependencies) && input.dependencies.length === 0)
          ? []
          : ids(input.dependencies, "Dependencies").sort();
    const digest = payloadHash({
      parentTaskId,
      agentId,
      objective,
      expectedOutput,
      dependencies,
    });
    return transaction(this.db, () => {
      this.authenticate();
      const prior = this.db
        .prepare(
          "SELECT * FROM task_handoffs WHERE company_id=? AND request_id=?",
        )
        .get(this.p.company_id, requestId);
      if (prior) {
        if (prior.payload_hash !== digest)
          throw new DomainError(
            "Request ID already binds different handoff content",
            409,
          );
        return { id: String(prior.task_id), duplicate: true };
      }
      const parent = this.db
        .prepare("SELECT * FROM tasks WHERE company_id=? AND id=?")
        .get(this.p.company_id, parentTaskId);
      if (!parent) throw new DomainError("Parent task not found", 404);
      if (["COMPLETE", "FAILED", "CANCELLED"].includes(String(parent.status)))
        throw new DomainError("Parent task is terminal", 409);
      const configuration = new AgentConfigurationService(this.db, this.p),
        sender = String(parent.agent_id);
      configuration.assertTasking(sender, agentId);
      for (const dependency of dependencies) {
        const row = this.db
          .prepare(
            "SELECT id FROM tasks WHERE company_id=? AND project_id=? AND id=?",
          )
          .get(this.p.company_id, parent.project_id, dependency);
        if (!row || dependency === parentTaskId)
          throw new DomainError(
            "Dependencies must be other tasks in the same project",
            409,
          );
        // A new child cannot wait on an ancestor that may wait on the child.
        const ancestor = this.db
          .prepare(
            "WITH RECURSIVE parents(id) AS (SELECT ? UNION SELECT h.parent_task_id FROM task_handoffs h JOIN parents p ON h.task_id=p.id WHERE h.company_id=?) SELECT 1 FROM parents WHERE id=?",
          )
          .get(parentTaskId, this.p.company_id, dependency);
        if (ancestor) throw new DomainError("Ancestor dependency denied", 409);
      }
      const result = new CompanyService(this.db, this.p).task({
        projectId: parent.project_id,
        agentId,
        objective,
      });
      if ("duplicate" in result && result.duplicate)
        throw new DomainError(
          "Existing task cannot be silently adopted as a new subtask",
          409,
        );
      const task = String(result.id);
      this.db
        .prepare(
          "UPDATE tasks SET expected_output=? WHERE company_id=? AND id=?",
        )
        .run(expectedOutput, this.p.company_id, task);
      for (const dependency of dependencies)
        this.db
          .prepare("INSERT INTO task_dependencies VALUES(?,?,?)")
          .run(this.p.company_id, task, dependency);
      this.db
        .prepare(
          "INSERT INTO task_handoffs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'TASK_REQUEST')",
        )
        .run(
          this.p.company_id,
          requestId,
          digest,
          task,
          parentTaskId,
          sender,
          agentId,
          configuration.get(sender).version,
          configuration.get(agentId).version,
          configuration.constitution().version,
          this.p.id,
          now(),
        );
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "task.handoff_recorded",
        task,
        "SUCCESS",
        { parentTaskId, sender, recipient: agentId, requestId },
      );
      return { id: task, duplicate: false };
    });
  }
  list() {
    this.authenticate();
    return this.db
      .prepare(
        "SELECT h.*,t.objective,t.expected_output,t.status FROM task_handoffs h JOIN tasks t ON t.company_id=h.company_id AND t.id=h.task_id WHERE h.company_id=? ORDER BY h.created_at DESC LIMIT 200",
      )
      .all(this.p.company_id);
  }
}
