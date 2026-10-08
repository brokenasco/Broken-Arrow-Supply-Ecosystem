import { securityOverview } from "./security.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
import { complianceState } from "./compliance.ts";
import { organizationState } from "./organization.ts";
import { automationState } from "./automation.ts";
import { learningState, learningMemoryUsable } from "./learning.ts";
import { assertComplianceClear } from "./compliance-gates.ts";
import { operationsState } from "./operations.ts";
import { technologyState } from "./technology.ts";
import { customerState } from "./customers.ts";
import { marketingState } from "./marketing.ts";
import { productState } from "./products.ts";
import { designState } from "./design.ts";
import { researchState } from "./research.ts";
import { analyticsState } from "./analytics.ts";
import type { DatabaseSync } from "node:sqlite";
import { audit, id, now, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { shopifySummary, shopifyAnswer } from "./shopify/service.ts";
export type Principal = { id: string; company_id: string; role: string };
export function text(value: unknown, name: string, max = 2000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new DomainError(`${name} must contain 1–${max} characters`);
  return value.trim();
}
export function ceo(p: Principal) {
  if (p.role !== "CEO") throw new DomainError("CEO authority required", 403);
}
export class CompanyService {
  db: DatabaseSync;
  p: Principal;
  constructor(db: DatabaseSync, p: Principal) {
    this.db = db;
    this.p = p;
    ceo(p);
    if (
      !db
        .prepare(
          "SELECT id FROM users WHERE id=? AND company_id=? AND role='CEO'",
        )
        .get(p.id, p.company_id)
    )
      throw new DomainError("Authenticated company CEO required", 403);
  }
  rows(table: string) {
    const allowed = [
      "departments",
      "stores",
      "projects",
      "tasks",
      "approvals",
      "memory_items",
      "notifications",
    ];
    if (!allowed.includes(table)) throw new Error("Invalid table");
    return this.db
      .prepare(`SELECT * FROM ${table} WHERE company_id=?`)
      .all(this.p.company_id);
  }
  state() {
    const c = this.p.company_id;
    const shopify = shopifySummary(this.db, c);
    return {
      company: this.db.prepare("SELECT * FROM companies WHERE id=?").get(c),
      user: { email: (this.p as any).email },
      agents: this.db
        .prepare("SELECT * FROM agents WHERE company_id=?")
        .all(c)
        .map((a) => ({ ...a, definition: JSON.parse(String(a.definition)) })),
      departments: this.rows("departments"),
      stores: this.rows("stores"),
      projects: this.rows("projects"),
      tasks: this.rows("tasks"),
      approvals: this.rows("approvals"),
      memory: this.rows("memory_items").map((m) => ({
        ...m,
        body: learningMemoryUsable(this.db, c, String(m.id))
          ? m.body
          : "Unavailable: customer evidence withdrawn, disputed or expired",
        status:
          !learningMemoryUsable(this.db, c, String(m.id)) ||
          (m.expires_at && String(m.expires_at) < now())
            ? "STALE"
            : m.status,
      })),
      research: this.db
        .prepare(
          "SELECT r.id research_id,m.* FROM research_items r JOIN memory_items m ON m.company_id=r.company_id AND m.id=r.memory_id WHERE r.company_id=?",
        )
        .all(c)
        .map((m) => ({
          ...m,
          body: learningMemoryUsable(this.db, c, String(m.id))
            ? m.body
            : "Unavailable: customer evidence withdrawn, disputed or expired",
        })),
      notifications: this.rows("notifications"),
      audit: this.db
        .prepare(
          "SELECT * FROM audit_logs WHERE company_id=? ORDER BY sequence DESC LIMIT 300",
        )
        .all(c),
      messages: this.db
        .prepare(
          "SELECT * FROM (SELECT rowid,* FROM messages WHERE company_id=? ORDER BY rowid DESC LIMIT 100) ORDER BY rowid",
        )
        .all(c),
      integrations: {
        shopify: shopify.connection?.status ?? "INTEGRATION REQUIRED",
        llm: "INTEGRATION REQUIRED",
        images: "INTEGRATION REQUIRED",
      },
      runtime: {
        enabled: false,
        reason: "Autonomous execution is not enabled in this foundation",
      },
      metrics: { revenue: null, orders: null, aov: null, aiSpendCents: 0 },
      shopify,
      analytics: analyticsState(this.db, c),
      market: researchState(this.db, c),
      studio: designState(this.db, c),
      factory: productState(this.db, c),
      marketing: marketingState(this.db, c),
      customers: customerState(this.db, c),
      technology: technologyState(this.db, c),
      operations: operationsState(this.db, c),
      compliance: complianceState(this.db, c),
      learning: learningState(this.db, c),
      automation: automationState(this.db, c),
      organization: organizationState(this.db, c),
      security: securityOverview(this.db, c),
    };
  }
  mutate<T>(action: string, resource: string, fn: () => T): T {
    return transaction(this.db, () => {
      ceo(this.p);
      if (
        !this.db
          .prepare(
            "SELECT id FROM users WHERE id=? AND company_id=? AND role='CEO'",
          )
          .get(this.p.id, this.p.company_id)
      )
        throw new DomainError("Authenticated company CEO required", 403);
      if (
        !/^(company|agent|department)\.(paused|resumed)$/.test(action) &&
        !["task.cancelled", "approval.rejected"].includes(action)
      )
        assertComplianceClear(this.db, this.p.company_id);
      const result = fn();
      audit(this.db, this.p.company_id, this.p.id, action, resource);
      return result;
    });
  }
  control(kind: string, target: string, paused: boolean) {
    if (typeof paused !== "boolean")
      throw new DomainError("paused must be boolean");
    return this.mutate(
      `${kind}.${paused ? "paused" : "resumed"}`,
      target,
      () => {
        let result;
        if (kind === "company")
          result = this.db
            .prepare("UPDATE companies SET stopped=? WHERE id=?")
            .run(Number(paused), this.p.company_id);
        else if (kind === "agent" || kind === "department")
          result = this.db
            .prepare(
              `UPDATE ${kind === "agent" ? "agents" : "departments"} SET paused=? WHERE company_id=? AND id=?`,
            )
            .run(Number(paused), this.p.company_id, target);
        else throw new DomainError("Invalid control");
        if (!result.changes) throw new DomainError("Resource not found", 404);
        return { ok: true };
      },
    );
  }
  project(input: Record<string, unknown>) {
    const name = text(input.name, "name", 120),
      objective = text(input.objective, "objective"),
      project = id();
    return this.mutate("project.created", project, () => {
      this.db
        .prepare(
          "INSERT INTO projects(id,company_id,name,objective,owner,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(project, this.p.company_id, name, objective, "boris", now());
      return { id: project };
    });
  }
  task(input: Record<string, unknown>) {
    const project = text(input.projectId, "projectId", 80),
      agent = text(input.agentId, "agentId", 80),
      objective = text(input.objective, "objective"),
      task = id();
    if (
      !this.db
        .prepare("SELECT id FROM projects WHERE company_id=? AND id=?")
        .get(this.p.company_id, project) ||
      !this.db
        .prepare("SELECT id FROM agents WHERE company_id=? AND id=?")
        .get(this.p.company_id, agent)
    )
      throw new DomainError("Project or agent not found", 404);
    const duplicate = this.db
      .prepare(
        "SELECT id FROM tasks WHERE company_id=? AND project_id=? AND agent_id=? AND objective=?",
      )
      .get(this.p.company_id, project, agent, objective);
    if (duplicate) return { id: duplicate.id, duplicate: true };
    return this.mutate("task.created", task, () => {
      this.db
        .prepare(
          "INSERT INTO tasks(id,company_id,project_id,agent_id,objective,status,expected_output,created_at) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          task,
          this.p.company_id,
          project,
          agent,
          objective,
          "BLOCKED",
          "Validated specialist artifact; requires configured worker and provider",
          now(),
        );
      return { id: task };
    });
  }
  cancel(taskId: string) {
    return this.mutate("task.cancelled", taskId, () => {
      const result = this.db
        .prepare(
          "UPDATE tasks SET status='CANCELLED',completed_at=? WHERE company_id=? AND id=? AND status NOT IN('COMPLETE','CANCELLED')",
        )
        .run(now(), this.p.company_id, taskId);
      if (!result.changes)
        throw new DomainError("Task not found or already terminal", 409);
      return { ok: true };
    });
  }
  requestApproval(input: Record<string, unknown>) {
    const agent = text(input.agentId, "agentId", 80),
      tool = text(input.tool, "tool", 100),
      summary = text(input.summary, "summary");
    const risk = input.risk;
    if (risk !== "YELLOW" && risk !== "RED")
      throw new DomainError("YELLOW or RED risk required");
    if (
      !this.db
        .prepare("SELECT id FROM agents WHERE company_id=? AND id=?")
        .get(this.p.company_id, agent)
    )
      throw new DomainError("Agent not found", 404);
    const approval = id(),
      payload = { summary };
    return this.mutate("approval.requested", approval, () => {
      this.db
        .prepare(
          "INSERT INTO approvals(id,company_id,agent_id,tool,payload,payload_hash,risk,state,requested_by,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          approval,
          this.p.company_id,
          agent,
          tool,
          JSON.stringify(payload),
          payloadHash(payload),
          risk,
          "PENDING",
          agent,
          Date.now() + 24 * 60 * 60 * 1000,
          now(),
        );
      this.db
        .prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?)")
        .run(
          id(),
          this.p.company_id,
          "ACTION REQUIRED",
          `Review ${risk} proposal: ${summary.slice(0, 160)}`,
          0,
          now(),
        );
      return { id: approval };
    });
  }
  decide(approvalId: string, decision: string) {
    if (!["APPROVED", "REJECTED"].includes(decision))
      throw new DomainError("Invalid approval decision");
    return this.mutate(`approval.${decision.toLowerCase()}`, approvalId, () => {
      const approval = this.db
        .prepare("SELECT * FROM approvals WHERE company_id=? AND id=?")
        .get(this.p.company_id, approvalId);
      if (!approval) throw new DomainError("Approval not found", 404);
      if (
        approval.requested_by === this.p.id ||
        approval.agent_id === this.p.id
      )
        throw new DomainError("Self-approval is prohibited", 403);
      if (
        approval.state !== "PENDING" ||
        Number(approval.expires_at) <= Date.now()
      )
        throw new DomainError("Approval already decided or expired", 409);
      this.db
        .prepare(
          "UPDATE approvals SET state=?,decided_by=? WHERE company_id=? AND id=?",
        )
        .run(decision, this.p.id, this.p.company_id, approvalId);
      return { ok: true };
    });
  }
  memory(input: Record<string, unknown>) {
    screenKnowledge(JSON.stringify(input));
    const title = text(input.title, "title", 160),
      body = text(input.body, "body", 10000),
      evidence = text(input.evidence, "evidence", 4000),
      category = text(input.category, "category", 80);
    const classification = input.classification;
    if (
      !["FACT", "OBSERVATION", "HYPOTHESIS", "RECOMMENDATION"].includes(
        String(classification),
      )
    )
      throw new DomainError("Invalid classification");
    const confidence = Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      throw new DomainError("Confidence must be 0–1");
    const source = input.sourceUrl
      ? text(input.sourceUrl, "sourceUrl", 2000)
      : null;
    if (source) {
      let url;
      try {
        url = new URL(source);
      } catch {
        throw new DomainError("Valid source URL required");
      }
      if (!["https:", "http:"].includes(url.protocol))
        throw new DomainError("HTTP source URL required");
    }
    const review = text(input.reviewAt, "reviewAt", 40);
    if (!Number.isFinite(Date.parse(review)))
      throw new DomainError("Valid review date required");
    const sourceDate = input.sourceDate
      ? text(input.sourceDate, "sourceDate", 40)
      : null;
    if (sourceDate && !Number.isFinite(Date.parse(sourceDate)))
      throw new DomainError("Valid source date required");
    const memory = id();
    return this.mutate("memory.created", memory, () => {
      this.db
        .prepare(
          "INSERT INTO memory_items(id,company_id,title,body,classification,category,evidence,source_url,source_date,confidence,status,created_by,created_at,updated_at,review_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          memory,
          this.p.company_id,
          title,
          body,
          String(classification),
          category,
          evidence,
          source,
          sourceDate,
          confidence,
          "NEEDS VERIFICATION",
          this.p.id,
          now(),
          now(),
          new Date(review).toISOString(),
        );
      if (input.research === true)
        this.db
          .prepare("INSERT INTO research_items VALUES(?,?,?,?)")
          .run(id(), this.p.company_id, memory, now());
      return { id: memory };
    });
  }
  chat(input: Record<string, unknown>) {
    const agent = text(input.agentId ?? "boris", "agentId", 80),
      body = text(input.message, "message", 3000);
    const row = this.db
      .prepare("SELECT * FROM agents WHERE company_id=? AND id=?")
      .get(this.p.company_id, agent);
    if (!row) throw new DomainError("Agent not found", 404);
    const state = this.state();
    let reply =
      "INTEGRATION REQUIRED — No language model is connected. Your message is saved. I can currently report stored tasks, approvals and company status; I cannot execute research or external actions.";
    if (/approval|одобр/i.test(body))
      reply = `There are ${state.approvals.filter((a) => a.state === "PENDING" && Number(a.expires_at) > Date.now()).length} pending approvals. Review the exact proposals in Approvals. Approving a proposal does not execute it.`;
    else if (
      /task|working|priorit|status|brief|perform|sales|revenue/i.test(body)
    )
      reply = `Company status: ${state.company?.stopped ? "PAUSED" : "control plane available"}. ${state.agents.length} employees registered; autonomous execution is disabled. ${state.tasks.filter((t) => !["COMPLETE", "CANCELLED"].includes(String(t.status))).length} open tasks. Shopify is not connected, so revenue, orders and performance are unavailable. Next: define company goals, review agent authority, then configure a read-only Shopify integration in Phase 2.`;
    else if (/pause|stop|resume/i.test(body))
      reply =
        "Use the explicit company, department or agent controls to change execution state. This status assistant does not interpret chat text as authorization for control changes.";
    const grounded =
      agent === "boris"
        ? shopifyAnswer(this.db, this.p.company_id, body)
        : null;
    if (grounded) reply = grounded;
    else if (
      agent === "boris" &&
      state.shopify.data &&
      /brief|status|perform/i.test(body)
    )
      reply = `Company status: ${state.company?.stopped ? "PAUSED" : "control plane available"}. ${state.tasks.length} stored tasks. Shopify snapshot: ${state.shopify.data.asOf}${state.shopify.data.stale ? " (stale)" : ""}; ${state.shopify.data.orderCount} eligible orders in its trailing 7-day window. Ask what sold best, which stock is low, or which products had no observed sales. Autonomous model execution remains disabled.`;
    if (
      ["boris", "sofia", "benjamin", "maria"].includes(agent) &&
      /analytics|kpi|compar|anomal|strategy|report|last month|last week/i.test(
        body,
      )
    ) {
      const a = state.analytics.data;
      reply = a
        ? "Rule-based analytics; no model execution. Source cutoff " +
          a.asOf +
          (a.stale ? " (STALE)" : "") +
          ". Last 7 completed days: " +
          (a.week.current.orders ?? "insufficient coverage") +
          " orders; preceding 7: " +
          (a.week.previous.orders ?? "insufficient coverage") +
          ". Last completed month: " +
          (a.month.current.orders ?? "insufficient coverage") +
          "; preceding month: " +
          (a.month.previous.orders ?? "insufficient coverage") +
          ". " +
          a.findings.join(" ") +
          " " +
          a.recommendations.join(" ") +
          " See Analytics for exact date ranges and KPI definitions."
        : "INTEGRATION REQUIRED — Sync Shopify to begin daily analytics.";
      if (
        state.company?.stopped ||
        state.departments.some((d) => d.id === "analytics" && d.paused)
      )
        reply =
          "Analytics workflow is paused. Stored reports remain available.";
    }
    if (
      ["boris", "anna", "mason", "marisha", "alex"].includes(agent) &&
      /research|opportunit|competitor|trend/i.test(body)
    ) {
      reply = `Stored research status — ${state.market.sources.length} human-entered sources, ${state.market.sources.filter((s) => s.fresh && s.status === "VERIFIED").length} fresh and human-verified. ${state.market.opportunities.length} opportunity reports. Review evidence and Mason → Marisha → Alex → Boris handoffs in Market & product research. No autonomous web search or model research was performed.`;
    }
    if (
      ["boris", "alex", "mark", "jack", "garry"].includes(agent) &&
      /design|brief|generation|asset|\bqa\b/i.test(body)
    ) {
      reply = `Stored Design Studio status — ${state.studio.briefs.length} briefs, ${state.studio.jobs.length} generation jobs, ${state.studio.assets.length} assets. Provider selection: ${state.studio.settings.provider}. Jobs require an exact human approval and explicit run; QA is human-recorded. Simulation patterns cannot pass production QA. No publishing or autonomous schedule is enabled.`;
    }
    if (activeQuarantine(this.db, this.p.company_id, agent))
      return this.mutate("message.queued_quarantine", agent, () => {
        this.db
          .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)")
          .run(id(), this.p.company_id, agent, "CEO", body, now());
        return {
          reply:
            "Message retained. This agent is quarantined; no agent response or execution was started.",
          mode: "QUARANTINED",
        };
      });
    if (row.paused)
      reply =
        "This agent is paused. Your message is saved for review; no agent work was started.";
    return this.mutate("message.created", agent, () => {
      for (const [role, message] of [
        ["CEO", body],
        ["ASSISTANT", reply],
      ])
        this.db
          .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?)")
          .run(id(), this.p.company_id, agent, role, message, now());
      return { reply, mode: "STATUS_ASSISTANT" };
    });
  }
}
import { activeQuarantine } from "./quarantine-gates.ts";
