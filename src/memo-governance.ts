import { HumanWorkflow, field, choice } from "./workflow.ts";
import { ResourceService } from "./resources.ts";
import { MemoService } from "./memos.ts";
import { id } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { dollars } from "./resource-money.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
type Row = Record<string, any>;
export class MemoGovernanceService extends HumanWorkflow {
  clock = () => new Date();
  resources() {
    const s = new ResourceService(this.db, this.p);
    s.clock = this.clock;
    return s;
  }
  state(departmentId: string, month: string) {
    const s = this.resources();
    s.department(departmentId);
    return {
      policy: s.policy(departmentId, month) ?? null,
      budgetMicros: s.budget(departmentId, month),
      members: s
        .balances()
        .departments.find((d) => d.id === departmentId)!
        .workers.filter((w) => w.active && !w.nonBillable)
        .map((w) => w.id)
        .sort(),
    };
  }
  get(memoId: unknown): Row | null {
    this.authenticate();
    const row = this.db
      .prepare(
        "SELECT p.*,d.decision,d.reason decision_reason,d.created_at decided_at FROM memo_budget_proposals p LEFT JOIN memo_budget_decisions d ON d.proposal_id=p.id AND d.company_id=p.company_id WHERE p.company_id=? AND p.memo_id=?",
      )
      .get(this.p.company_id, field(memoId, "Memo", 120));
    return row
      ? {
          ...row,
          body: JSON.parse(String(row.body)),
          status:
            row.decision ??
            (String(row.expires_at) <= this.clock().toISOString()
              ? "EXPIRED"
              : "PENDING"),
        }
      : null;
  }
  propose(input: Row) {
    return this.mutate("memo.budget_proposed", "budget", [], () => {
      const departmentId = field(input.departmentId, "Department", 80),
        month = field(input.effectiveMonth, "Effective month", 7);
      if (
        !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
        month <= this.clock().toISOString().slice(0, 7)
      )
        throw new DomainError(
          "Permanent policy must start in a future calendar month",
        );
      const previous = this.state(departmentId, month),
        limitMicros = dollars(input.limitUsd),
        reason = field(
          input.reason,
          "Workload and resource justification",
          3000,
        );
      screenKnowledge(reason);
      if (!Array.isArray(input.allocations) || input.allocations.length > 100)
        throw new DomainError(
          "Allocations must be an array; empty means equal allocation",
        );
      const allocations = input.allocations
        .map((a: Row) => ({
          agentId: field(a.agentId, "Agent", 80),
          micros: dollars(a.usd),
        }))
        .sort((a: Row, b: Row) => a.agentId.localeCompare(b.agentId));
      if (
        allocations.length &&
        (new Set(allocations.map((a: Row) => a.agentId)).size !==
          allocations.length ||
          allocations.length !== previous.members.length ||
          allocations.some((a: Row) => !previous.members.includes(a.agentId)) ||
          allocations.reduce((n: number, a: Row) => n + a.micros, 0) !==
            limitMicros)
      )
        throw new DomainError(
          "Explicit allocations must cover every active billable worker exactly once and sum to the department limit",
        );
      const body = {
        departmentId,
        effectiveMonth: month,
        limitMicros,
        allocations,
        previous,
        reason,
      };
      const increase = limitMicros - previous.budgetMicros;
      const memo = new MemoService(this.db, this.p).submit({
        authorId: "boris",
        type: "REA",
        subject: `Budget decision: ${departmentId} from ${month}`,
        priority: "ACTION REQUIRED",
        actionRequired: true,
        purpose:
          "Request a permanent monthly budget policy. This proposal grants no spending authority.",
        summary: `Current department default for effective month: $${(previous.budgetMicros / 1e6).toFixed(6)}. Proposed: $${(limitMicros / 1e6).toFixed(6)}. Monthly change: $${(increase / 1e6).toFixed(6)}. Annualized change: $${((increase * 12) / 1e6).toFixed(6)}.`,
        details: allocations.length
          ? allocations
              .map(
                (a: Row) =>
                  `${a.agentId}: $${(a.micros / 1e6).toFixed(6)} per month`,
              )
              .join("\n")
          : "Equal allocation among active billable workers.",
        analysis: reason,
        recommendation:
          "Owner review required. An increase adds to the organization budget and is not a neutral transfer. Explicit worker allocations revert to equal shares if billable membership changes or a different monthly override is applied.",
        ownerAction:
          "Approve exact policy, deny, request modification, or request more information. Decision expires ten minutes after proposal creation. Changes require a new proposal.",
        supportingData:
          "Previous policy and membership are bound in the immutable proposal. Approval is single-use and applies no earlier than the specified future month. Actual paid dispatch still requires all existing gates.",
      });
      const record = id(),
        stamp = this.clock().toISOString();
      this.db
        .prepare("INSERT INTO memo_budget_proposals VALUES(?,?,?,?,?,?,?,?)")
        .run(
          record,
          this.p.company_id,
          memo.id,
          JSON.stringify(body),
          payloadHash(body),
          this.p.id,
          stamp,
          new Date(this.clock().getTime() + 600000).toISOString(),
        );
      return this.get(memo.id)!;
    });
  }
  decide(input: Row) {
    return this.mutate("memo.budget_decided", String(input.memoId), [], () => {
      const p = this.get(input.memoId);
      if (!p || p.status !== "PENDING")
        throw new DomainError("Fresh pending proposal required", 409);
      if (
        input.confirm !== true ||
        input.contentHash !== p.content_hash ||
        payloadHash(p.body) !== p.content_hash
      )
        throw new DomainError(
          "Explicit exact-content owner decision required",
          409,
        );
      const decision = choice(
          input.decision,
          [
            "APPROVED",
            "DENIED",
            "MODIFICATION REQUESTED",
            "INFORMATION REQUESTED",
          ] as const,
          "Decision",
        ),
        reason = field(input.reason, "Decision reason", 1500);
      screenKnowledge(reason);
      if (
        decision === "APPROVED" &&
        (p.body.effectiveMonth <= this.clock().toISOString().slice(0, 7) ||
          payloadHash(
            this.state(p.body.departmentId, p.body.effectiveMonth),
          ) !== payloadHash(p.body.previous))
      )
        throw new DomainError(
          "Budget configuration or membership changed; submit a new proposal",
          409,
        );
      this.db
        .prepare("INSERT INTO memo_budget_decisions VALUES(?,?,?,?,?,?,?)")
        .run(
          p.id,
          this.p.company_id,
          decision,
          p.content_hash,
          reason,
          this.p.id,
          this.clock().toISOString(),
        );
      if (decision === "APPROVED")
        this.db
          .prepare(
            "INSERT INTO resource_budget_policies VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            this.p.company_id,
            p.body.departmentId,
            p.body.effectiveMonth,
            p.body.limitMicros,
            JSON.stringify(p.body.allocations),
            p.id,
            this.clock().toISOString(),
          );
      new MemoService(this.db, this.p).review({
        id: p.memo_id,
        status:
          decision === "APPROVED" || decision === "DENIED"
            ? "CLOSED"
            : "MODIFICATION REQUESTED",
        reason: `${decision}: ${reason}. Bound financial decision ${p.id}.`,
        confirmNoExecution: true,
      });
      return this.get(p.memo_id)!;
    });
  }
}
