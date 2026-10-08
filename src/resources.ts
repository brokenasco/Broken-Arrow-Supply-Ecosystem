import { HumanWorkflow, field, choice, integer, iso } from "./workflow.ts";
import { id, audit, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import {
  USD,
  dollars,
  usage,
  calculateCost,
  budgetStatus,
} from "./resource-money.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
type Row = Record<string, any>;
export class ResourceService extends HumanWorkflow {
  clock = () => new Date();
  month() {
    return this.clock().toISOString().slice(0, 7);
  }
  stamp() {
    return this.clock().toISOString();
  }
  agent(agentId: unknown): Row {
    const row = this.db
      .prepare(
        "SELECT a.*,COALESCE(s.non_billable,0) non_billable FROM agents a LEFT JOIN resource_agent_settings s ON s.company_id=a.company_id AND s.agent_id=a.id WHERE a.company_id=? AND a.id=?",
      )
      .get(this.p.company_id, field(agentId, "Agent", 80));
    if (!row) throw new DomainError("Agent not found", 404);
    return row;
  }
  task(taskId: unknown): Row {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(taskId, "Task", 80));
    if (!row) throw new DomainError("Task not found", 404);
    return row;
  }
  department(departmentId: string) {
    const row = this.db
      .prepare("SELECT * FROM departments WHERE company_id=? AND id=?")
      .get(this.p.company_id, departmentId);
    if (!row) throw new DomainError("Department not found", 404);
    return row;
  }
  budget(departmentId: string, month = this.month()) {
    this.department(departmentId);
    const override = this.db
      .prepare(
        "SELECT limit_micros FROM resource_budget_overrides WHERE company_id=? AND department_id=? AND budget_month=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(this.p.company_id, departmentId, month);
    return Number(
      override?.limit_micros ??
        this.policy(departmentId, month)?.limit_micros ??
        5 * USD,
    );
  }
  policy(departmentId: string, month = this.month()): Row | undefined {
    return this.db
      .prepare(
        "SELECT * FROM resource_budget_policies WHERE company_id=? AND department_id=? AND effective_month<=? ORDER BY effective_month DESC,rowid DESC LIMIT 1",
      )
      .get(this.p.company_id, departmentId, month);
  }
  balances(month = this.month()) {
    this.authenticate();
    let agents = this.db
      .prepare(
        "SELECT a.id,a.department,a.definition,a.paused,COALESCE(s.non_billable,0) non_billable FROM agents a LEFT JOIN resource_agent_settings s ON s.company_id=a.company_id AND s.agent_id=a.id WHERE a.company_id=? ORDER BY a.id",
      )
      .all(this.p.company_id) as Row[];
    const saved =
      month !== this.month()
        ? this.db
            .prepare(
              "SELECT body FROM agent_budget_allocations WHERE company_id=? AND budget_month=? ORDER BY rowid DESC LIMIT 1",
            )
            .get(this.p.company_id, month)
        : null;
    const historical: Row[] | null = saved
      ? JSON.parse(String(saved.body)).departments
      : null;
    if (historical)
      agents = historical.flatMap((d) =>
        d.workers.map((w: Row) => ({
          id: w.id,
          department: d.id,
          definition: JSON.stringify({ name: w.name }),
          paused: w.active ? 0 : 1,
          non_billable: w.nonBillable ? 1 : 0,
        })),
      );
    const ledger = this.db
      .prepare(
        "SELECT department_id,agent_id,SUM(cost_micros) spent,SUM(CASE WHEN kind='CHARGE' THEN COALESCE(total_tokens,0) ELSE 0 END) tokens,SUM(kind='CHARGE') calls FROM ai_usage_ledger WHERE company_id=? AND budget_month=? GROUP BY department_id,agent_id",
      )
      .all(this.p.company_id, month) as Row[];
    const holds = this.db
      .prepare(
        "SELECT department_id,agent_id,SUM(estimated_micros) reserved FROM resource_reservations WHERE company_id=? AND budget_month=? AND state IN('RESERVED','UNCERTAIN') GROUP BY department_id,agent_id",
      )
      .all(this.p.company_id, month) as Row[];
    const departments = this.db
      .prepare("SELECT * FROM departments WHERE company_id=? ORDER BY id")
      .all(this.p.company_id)
      .map((d) => {
        const limit = this.budget(String(d.id), month),
          members = agents.filter((a) => a.department === d.id),
          eligible = members.filter((a) => !a.paused && !a.non_billable);
        const policy = this.policy(String(d.id), month),
          planned: Row[] = policy ? JSON.parse(String(policy.allocations)) : [],
          usePlan =
            planned.length === eligible.length &&
            planned.length > 0 &&
            planned.every((w) => eligible.some((a) => a.id === w.agentId)) &&
            planned.reduce((n, w) => n + w.micros, 0) === limit;
        const costs = ledger.filter((r) => r.department_id === d.id),
          reserved = holds
            .filter((r) => r.department_id === d.id)
            .reduce((n, r) => n + Number(r.reserved), 0),
          spent = costs.reduce((n, r) => n + Number(r.spent), 0);
        const workers = members.map((a) => {
          const position = eligible.findIndex((e) => e.id === a.id),
            allocation =
              historical
                ?.find((d) => d.id === a.department)
                ?.workers.find((w: Row) => w.id === a.id)?.allocationMicros ??
              (usePlan
                ? (planned.find((w) => w.agentId === a.id)?.micros ?? 0)
                : position < 0
                  ? 0
                  : Math.floor(limit / eligible.length) +
                    (position < limit % eligible.length ? 1 : 0));
          const used = costs
              .filter((r) => r.agent_id === a.id)
              .reduce((n, r) => n + Number(r.spent), 0),
            held = holds
              .filter((r) => r.department_id === d.id && r.agent_id === a.id)
              .reduce((n, r) => n + Number(r.reserved), 0);
          return {
            id: a.id,
            name: JSON.parse(a.definition).name,
            department: a.department,
            nonBillable: !!a.non_billable,
            active: !a.paused,
            allocationMicros: allocation,
            spentMicros: used,
            reservedMicros: held,
            remainingMicros: allocation - used - held,
            status: a.non_billable
              ? "NON_BILLABLE"
              : a.paused
                ? "INACTIVE"
                : budgetStatus(used, allocation),
            tokens: costs
              .filter((r) => r.agent_id === a.id)
              .reduce((n, r) => n + Number(r.tokens), 0),
          };
        });
        return {
          id: String(d.id),
          name: d.name,
          budgetMicros: limit,
          standardBudgetMicros: 5 * USD,
          spentMicros: spent,
          reservedMicros: reserved,
          remainingMicros: limit - spent - reserved,
          status: budgetStatus(spent, limit),
          tokens: costs.reduce((n, r) => n + Number(r.tokens), 0),
          calls: costs.reduce((n, r) => n + Number(r.calls), 0),
          workers,
        };
      });
    return {
      month,
      currency: "USD",
      unitsPerDollar: USD,
      resetTimezone: "UTC",
      rollover: false,
      automaticRedistribution: false,
      departments,
    };
  }
  snapshot(agentId: string) {
    const a = this.agent(agentId),
      d = this.balances().departments.find((d) => d.id === a.department)!;
    return {
      agent: a,
      worker: d.workers.find((w) => w.id === agentId)!,
      department: d,
    };
  }
  captureAllocations() {
    this.authenticate();
    if (!this.db.isTransaction)
      throw new Error("Allocation snapshots require caller transaction");
    const body = {
      departments: this.balances().departments.map((d) => ({
        id: d.id,
        budgetMicros: d.budgetMicros,
        workers: d.workers.map((w) => ({
          id: w.id,
          name: w.name,
          active: w.active,
          nonBillable: w.nonBillable,
          allocationMicros: w.allocationMicros,
        })),
      })),
    };
    const hash = payloadHash(body),
      latest = this.db
        .prepare(
          "SELECT content_hash FROM agent_budget_allocations WHERE company_id=? AND budget_month=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(this.p.company_id, this.month());
    if (latest?.content_hash !== hash) {
      this.db
        .prepare("INSERT INTO agent_budget_allocations VALUES(?,?,?,?,?,?,?)")
        .run(
          id(),
          this.p.company_id,
          this.month(),
          hash,
          JSON.stringify(body),
          this.p.id,
          this.stamp(),
        );
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "resources.allocations_recalculated",
        this.month(),
      );
    }
  }
  configureAgent(input: Row) {
    return this.mutate(
      "resources.agent_configured",
      String(input.agentId),
      [],
      () => {
        const a = this.agent(input.agentId);
        if (typeof input.nonBillable !== "boolean" || input.confirm !== true)
          throw new DomainError(
            "Explicit human confirmation and nonBillable boolean required",
          );
        if (
          this.db
            .prepare(
              "SELECT id FROM resource_reservations WHERE company_id=? AND agent_id=? AND state IN('RESERVED','UNCERTAIN')",
            )
            .get(this.p.company_id, a.id)
        )
          throw new DomainError(
            "Reconcile active reservations before changing billing participation",
            409,
          );
        this.db
          .prepare(
            "INSERT INTO resource_agent_settings VALUES(?,?,?) ON CONFLICT(company_id,agent_id) DO UPDATE SET non_billable=excluded.non_billable",
          )
          .run(this.p.company_id, a.id, input.nonBillable ? 1 : 0);
        this.captureAllocations();
        return this.balances();
      },
    );
  }
  override(input: Row) {
    return this.mutate(
      "resources.monthly_override",
      String(input.departmentId),
      [],
      () => {
        const department = field(input.departmentId, "Department", 80);
        this.department(department);
        if (input.confirm !== true || input.month !== this.month())
          throw new DomainError(
            "Explicit confirmation for current month required",
          );
        const amount = dollars(input.limitUsd),
          reason = field(input.reason, "Reason", 1500);
        screenKnowledge(reason);
        const current = this.balances().departments.find(
          (d) => d.id === department,
        )!;
        if (amount < current.spentMicros + current.reservedMicros)
          throw new DomainError(
            "Limit cannot be below committed spending",
            409,
          );
        this.db
          .prepare(
            "INSERT INTO resource_budget_overrides VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id(),
            this.p.company_id,
            department,
            this.month(),
            amount,
            reason,
            this.p.id,
            this.stamp(),
          );
        this.captureAllocations();
        return this.balances();
      },
    );
  }
  pricing(input: Row) {
    screenKnowledge(JSON.stringify(input));
    return this.mutate(
      "resources.pricing_versioned",
      "model-pricing",
      [],
      () => {
        const provider = field(input.provider, "Provider", 80),
          model = field(input.modelId, "Model", 120),
          source = field(
            input.source,
            "Pricing source and accounting convention",
            2000,
          );
        screenKnowledge(source);
        if (input.confirm !== true || typeof input.active !== "boolean")
          throw new DomainError("Explicit human pricing confirmation required");
        const record = id(),
          effective = iso(input.effectiveAt, "Effective date");
        this.db
          .prepare(
            "INSERT INTO model_pricing VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            record,
            this.p.company_id,
            provider,
            model,
            field(input.displayName, "Display name", 160),
            dollars(input.inputUsdPerMillion),
            dollars(input.cachedUsdPerMillion),
            dollars(input.outputUsdPerMillion),
            dollars(input.separateReasoningUsdPerMillion ?? "0"),
            dollars(input.requestUsd ?? "0"),
            dollars(input.toolUsd ?? "0"),
            "USD",
            source,
            effective,
            this.stamp(),
            input.active ? 1 : 0,
            this.p.id,
            this.stamp(),
          );
        return { id: record };
      },
    );
  }
  price(provider: string, model: string): Row {
    const p = this.db
      .prepare(
        "SELECT * FROM model_pricing WHERE company_id=? AND provider=? AND model_id=? AND effective_at<=? ORDER BY effective_at DESC,rowid DESC LIMIT 1",
      )
      .get(this.p.company_id, provider, model, this.stamp());
    if (!p || !p.active)
      throw new DomainError(
        "Verified active pricing is required for this model",
        409,
      );
    return p;
  }
  setTaskLimits(input: Row) {
    return this.mutate(
      "resources.task_limits",
      String(input.taskId),
      [],
      () => {
        const task = this.task(input.taskId),
          cost = dollars(input.maxCostUsd),
          calls = integer(input.maxCalls, "Maximum calls", 1, 100);
        if (input.confirm !== true || !cost)
          throw new DomainError(
            "Positive limit and explicit human confirmation required",
          );
        const committed = this.taskCommitted(task.id);
        if (cost < committed.cost || calls < committed.calls)
          throw new DomainError("Limits cannot be below task commitments", 409);
        this.db
          .prepare(
            "INSERT INTO resource_task_limits VALUES(?,?,?,?) ON CONFLICT(company_id,task_id) DO UPDATE SET max_cost_micros=excluded.max_cost_micros,max_calls=excluded.max_calls",
          )
          .run(this.p.company_id, task.id, cost, calls);
        return { ok: true };
      },
    );
  }
  taskCommitted(task: string) {
    const cost =
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(cost_micros),0) n FROM ai_usage_ledger WHERE company_id=? AND task_id=?",
          )
          .get(this.p.company_id, task)!.n,
      ) +
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(estimated_micros),0) n FROM resource_reservations WHERE company_id=? AND task_id=? AND state IN('RESERVED','UNCERTAIN')",
          )
          .get(this.p.company_id, task)!.n,
      );
    const calls = Number(
      this.db
        .prepare(
          "SELECT COUNT(*) n FROM resource_reservations WHERE company_id=? AND task_id=? AND state!='CANCELLED'",
        )
        .get(this.p.company_id, task)!.n,
    );
    return { cost, calls };
  }
  reserve(input: Row) {
    return this.mutate(
      "resources.preflight",
      String(input.taskId),
      [field(input.agentId, "Agent", 80)],
      () => {
        const task = this.task(input.taskId),
          a = this.agent(input.agentId);
        if (
          task.agent_id !== a.id ||
          ["COMPLETE", "FAILED", "CANCELLED"].includes(task.status) ||
          a.non_billable
        )
          throw new DomainError(
            "Active billable task assignment required",
            409,
          );
        const price = this.price(
          field(input.provider, "Provider", 80),
          field(input.modelId, "Model", 120),
        );
        const estimate = dollars(input.estimatedCostUsd),
          key = field(input.requestKey, "Idempotency key", 120),
          priority = choice(
            input.priority,
            ["P0", "P1", "P2", "P3"],
            "Priority",
          ),
          taskType = field(input.taskType, "Task type", 80);
        if (!estimate)
          throw new DomainError("Positive cost reservation required");
        const hash = payloadHash({
          task: task.id,
          agent: a.id,
          price: price.id,
          estimate,
          priority,
          taskType,
          requestHash: field(
            input.requestHash,
            "Immutable request content hash",
            128,
          ),
        });
        const existing = this.db
          .prepare(
            "SELECT * FROM resource_reservations WHERE company_id=? AND request_key=?",
          )
          .get(this.p.company_id, key);
        if (existing) {
          if (existing.content_hash !== hash)
            throw new DomainError(
              "Idempotency key already binds different content",
              409,
            );
          return {
            status: "EXISTING",
            id: existing.id,
            state: existing.state,
            execute: false,
          };
        }
        const { worker, department } = this.snapshot(a.id);
        this.captureAllocations();
        const uncertain = this.db
          .prepare(
            "SELECT id FROM resource_reservations WHERE company_id=? AND agent_id=? AND (state='UNCERTAIN' OR (budget_month<>? AND state='RESERVED')) LIMIT 1",
          )
          .get(this.p.company_id, a.id, this.month());
        if (uncertain)
          return { status: "RECONCILIATION_REQUIRED", execute: false };
        if (
          this.db
            .prepare(
              "SELECT id FROM resource_incidents WHERE company_id=? AND agent_id=? AND reason LIKE 'ACTUAL_COST_EXCEEDED_RESERVATION:%' LIMIT 1",
            )
            .get(this.p.company_id, a.id)
        )
          return { status: "BILLING_REVIEW_REQUIRED", execute: false };
        const limits = this.db
          .prepare(
            "SELECT * FROM resource_task_limits WHERE company_id=? AND task_id=?",
          )
          .get(this.p.company_id, task.id);
        if (!limits) return { status: "TASK_LIMIT_REQUIRED", execute: false };
        const committed = this.taskCommitted(task.id);
        if (
          committed.cost + estimate > Number(limits.max_cost_micros) ||
          committed.calls >= Number(limits.max_calls)
        ) {
          this.incident(
            a.id,
            null,
            "RUNAWAY_TASK_PREVENTED: task cost/call limit reached",
          );
          return { status: "TASK_LIMIT_REACHED", execute: false };
        }
        if (
          (worker.status === "RED" || department.status === "RED") &&
          ["P2", "P3"].includes(priority)
        )
          return { status: "CONSERVATION_MODE", execute: false };
        if (
          estimate > worker.remainingMicros ||
          estimate > department.remainingMicros
        ) {
          const notice = this.db
            .prepare("INSERT OR IGNORE INTO resource_alerts VALUES(?,?,?,?,?)")
            .run(
              this.p.company_id,
              this.month(),
              `funding:${task.id}`,
              0,
              this.stamp(),
            );
          if (notice.changes)
            this.db
              .prepare("INSERT INTO notifications VALUES(?,?,?, ?,0,?)")
              .run(
                id(),
                this.p.company_id,
                "HIGH",
                `BUDGET DECISION REQUIRED: ${a.id}, task ${task.id}. Department head assessment and human authorization required; no spending authorized.`,
                this.stamp(),
              );
          return {
            status: "HUMAN_BUDGET_DECISION_REQUIRED",
            execute: false,
            agent: a.id,
            department: a.department,
            task: task.id,
            priority,
            workerRemainingMicros: worker.remainingMicros,
            estimatedCostMicros: estimate,
            overageMicros: Math.max(0, estimate - worker.remainingMicros),
            departmentRemainingMicros: department.remainingMicros,
            departmentOverageMicros: Math.max(
              0,
              estimate - department.remainingMicros,
            ),
            note: "No allocation moved and no paid request authorized. A documented assessment and explicit human funding decision are required.",
          };
        }
        const record = id();
        this.db
          .prepare(
            "INSERT INTO resource_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'RESERVED',?,?,?,?,NULL)",
          )
          .run(
            record,
            this.p.company_id,
            key,
            this.month(),
            a.department,
            a.id,
            task.id,
            price.id,
            estimate,
            priority,
            taskType,
            hash,
            worker.remainingMicros,
            department.remainingMicros,
            this.p.id,
            this.stamp(),
          );
        return {
          status: "APPROVED",
          id: record,
          execute: true,
          reservedMicros: estimate,
          pricingId: price.id,
        };
      },
    );
  }
  incident(agentId: string, request: string | null, reason: string) {
    this.db
      .prepare("INSERT INTO resource_incidents VALUES(?,?,?,?,?,?)")
      .run(id(), this.p.company_id, agentId, request, reason, this.stamp());
    this.db
      .prepare("INSERT INTO notifications VALUES(?,?,?, ?,0,?)")
      .run(id(), this.p.company_id, "HIGH", reason, this.stamp());
  }
  reservation(record: unknown): Row {
    const row = this.db
      .prepare(
        "SELECT * FROM resource_reservations WHERE company_id=? AND id=?",
      )
      .get(this.p.company_id, field(record, "Reservation", 80));
    if (!row) throw new DomainError("Reservation not found", 404);
    return row;
  }
  uncertain(input: Row) {
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.reservation(input.id);
      if (r.state !== "RESERVED")
        throw new DomainError("Active reservation required", 409);
      this.db
        .prepare(
          "UPDATE resource_reservations SET state='UNCERTAIN' WHERE company_id=? AND id=?",
        )
        .run(this.p.company_id, r.id);
      this.incident(
        r.agent_id,
        r.id,
        input.billingPending === true
          ? "Provider output received; billing unverified, reservation retained until reconciliation"
          : "Provider outcome uncertain; reservation retained and paid work blocked",
      );
      audit(this.db, this.p.company_id, this.p.id, "resources.uncertain", r.id);
      return { ok: true };
    });
  }
  reconcile(input: Row) {
    // Recording incurred expenses remains possible during a stop/hold.
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.reservation(input.id);
      if (!["RESERVED", "UNCERTAIN"].includes(r.state))
        throw new DomainError("Reservation already reconciled", 409);
      const price = this.db
        .prepare("SELECT * FROM model_pricing WHERE company_id=? AND id=?")
        .get(this.p.company_id, r.pricing_id)!;
      const status = choice(
          input.usageStatus,
          ["PROVIDER_REPORTED", "ESTIMATED", "INVOICE_CONFIRMED"],
          "Usage status",
        ),
        outcome = choice(
          input.outcome,
          ["SUCCESS", "FAILURE", "UNKNOWN"],
          "Outcome",
        );
      const evidence = field(
        input.evidence,
        "Provider/invoice evidence reference",
        1200,
      );
      screenKnowledge(evidence);
      const counts = input.usage ? usage(input.usage) : null;
      const aggregate = input.aggregateUsage
        ? {
            inputTokens: integer(
              input.aggregateUsage.inputTokens,
              "Reported input tokens",
              0,
              1e12,
            ),
            outputTokens: integer(
              input.aggregateUsage.outputTokens,
              "Reported output tokens",
              0,
              1e12,
            ),
            totalTokens: integer(
              input.aggregateUsage.totalTokens,
              "Reported total tokens",
              0,
              1e12,
            ),
          }
        : null;
      if (
        aggregate &&
        (counts ||
          aggregate.totalTokens !==
            aggregate.inputTokens + aggregate.outputTokens)
      )
        throw new DomainError("Consistent aggregate-only usage required");
      if (status === "PROVIDER_REPORTED" && !counts)
        throw new DomainError("Provider-reported usage required");
      const cost =
        status === "PROVIDER_REPORTED"
          ? calculateCost(price, counts!)
          : dollars(input.costUsd);
      const costs = this.balances(r.budget_month).departments.find(
        (d) => d.id === r.department_id,
      )!;
      const worker = costs.workers.find((w) => w.id === r.agent_id);
      const workerBefore = worker?.remainingMicros ?? 0,
        departmentBefore = costs.remainingMicros;
      this.db
        .prepare(
          "INSERT INTO ai_usage_ledger VALUES(?,?,?,'CHARGE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id(),
          this.p.company_id,
          r.id,
          r.budget_month,
          r.department_id,
          r.agent_id,
          r.task_id,
          r.pricing_id,
          counts?.inputTokens ?? aggregate?.inputTokens ?? null,
          counts?.cachedInputTokens ?? null,
          counts?.outputTokens ?? aggregate?.outputTokens ?? null,
          counts?.reasoningTokens ?? null,
          counts
            ? counts.inputTokens + counts.outputTokens + counts.reasoningTokens
            : (aggregate?.totalTokens ?? null),
          counts?.toolCalls ?? null,
          r.estimated_micros,
          cost,
          status,
          outcome,
          workerBefore,
          workerBefore + Number(r.estimated_micros) - cost,
          departmentBefore,
          departmentBefore + Number(r.estimated_micros) - cost,
          evidence,
          this.p.id,
          this.stamp(),
        );
      this.db
        .prepare(
          "UPDATE resource_reservations SET state='SETTLED',settled_at=? WHERE company_id=? AND id=?",
        )
        .run(this.stamp(), this.p.company_id, r.id);
      if (cost > r.estimated_micros)
        this.incident(
          r.agent_id,
          r.id,
          "ACTUAL_COST_EXCEEDED_RESERVATION: review provider billing and task limits before further inference",
        );
      this.alerts(r.budget_month);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "resources.reconciled",
        r.id,
        "SUCCESS",
        { costMicros: cost, usageStatus: status },
      );
      return {
        costMicros: cost,
        estimatedMicros: r.estimated_micros,
        differenceMicros: cost - Number(r.estimated_micros),
      };
    });
  }
  alerts(month: string) {
    for (const d of this.balances(month).departments) {
      for (const s of [
        {
          id: `department:${d.id}`,
          spent: d.spentMicros,
          limit: d.budgetMicros,
        },
        ...d.workers.map((w) => ({
          id: `agent:${w.id}`,
          spent: w.spentMicros,
          limit: w.allocationMicros,
        })),
      ]) {
        for (const threshold of [80, 90, 100])
          if (s.limit > 0 && s.spent * 100 >= s.limit * threshold) {
            const inserted = this.db
              .prepare(
                "INSERT OR IGNORE INTO resource_alerts VALUES(?,?,?,?,?)",
              )
              .run(this.p.company_id, month, s.id, threshold, this.stamp());
            if (inserted.changes)
              this.db
                .prepare("INSERT INTO notifications VALUES(?,?,?, ?,0,?)")
                .run(
                  id(),
                  this.p.company_id,
                  threshold >= 90 ? "HIGH" : "MEDIUM",
                  `AI resource warning: ${s.id} reached ${threshold}% in ${month}. ${threshold >= 90 ? "Conserve paid inference; human review required." : "Review projected workload."} Owner / department head / COO visibility.`,
                  this.stamp(),
                );
          }
      }
    }
  }
  overview() {
    this.authenticate();
    return {
      ...this.balances(),
      pricing: this.db
        .prepare(
          "SELECT * FROM model_pricing WHERE company_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(this.p.company_id),
      ledger: this.db
        .prepare(
          "SELECT l.*,p.provider,p.model_id FROM ai_usage_ledger l JOIN model_pricing p ON p.company_id=l.company_id AND p.id=l.pricing_id WHERE l.company_id=? ORDER BY l.created_at DESC LIMIT 100",
        )
        .all(this.p.company_id),
      reservations: this.db
        .prepare(
          "SELECT * FROM resource_reservations WHERE company_id=? AND state IN('RESERVED','UNCERTAIN') ORDER BY created_at LIMIT 100",
        )
        .all(this.p.company_id),
      incidents: this.db
        .prepare(
          "SELECT * FROM resource_incidents WHERE company_id=? ORDER BY created_at DESC LIMIT 50",
        )
        .all(this.p.company_id),
      historicalMonths: this.db
        .prepare(
          "SELECT budget_month,SUM(cost_micros) cost_micros,SUM(CASE WHEN kind='CHARGE' THEN total_tokens ELSE 0 END) tokens FROM ai_usage_ledger WHERE company_id=? GROUP BY budget_month ORDER BY budget_month DESC LIMIT 36",
        )
        .all(this.p.company_id),
      integrationStatus:
        "Accounting foundation; no model dispatch adapter connected to this ledger yet",
      cacheSavings: null,
    };
  }
}
