import { HumanWorkflow, field } from "./workflow.ts";
import { CompanyService } from "./service.ts";
import { DomainError } from "./policy.ts";
import { id, now } from "./db.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
import {
  activeQuarantine,
  quarantinePending,
  outstandingOperations,
  legacyExecutionPending,
} from "./quarantine-gates.ts";
type Row = Record<string, any>;
export function officeStatus(
  statuses: string[],
  paused = false,
  approval = false,
  meeting = false,
) {
  if (paused) return "OFFLINE";
  if (statuses.includes("FAILED")) return "ERROR";
  if (statuses.includes("BLOCKED")) return "BLOCKED";
  if (approval) return "NEEDS_APPROVAL";
  if (statuses.includes("WAITING FOR CEO")) return "WAITING_FOR_OWNER";
  if (meeting) return "IN_MEETING";
  if (statuses.includes("WORKING")) return "WORKING";
  if (statuses.includes("THINKING")) return "THINKING";
  if (statuses.includes("WAITING FOR AGENT")) return "WAITING_FOR_AGENT";
  if (statuses.some((s) => ["WAITING", "QUEUED"].includes(s))) return "WAITING";
  if (statuses.includes("COMPLETE")) return "COMPLETE";
  return "IDLE";
}
export class OfficeService extends HumanWorkflow {
  view() {
    this.authenticate();
    const c = this.p.company_id,
      company = this.db
        .prepare("SELECT id,name,stopped FROM companies WHERE id=?")
        .get(c)!;
    const departments = this.db
      .prepare(
        "SELECT id,name,paused FROM departments WHERE company_id=? ORDER BY id",
      )
      .all(c) as Row[];
    const records = this.db
      .prepare(
        "SELECT id,department,definition,paused FROM agents WHERE company_id=? ORDER BY id",
      )
      .all(c) as Row[];
    const tasks = this.db
      .prepare(
        "SELECT id,agent_id,objective,status,completed_at,created_at FROM tasks WHERE company_id=? AND status!='CANCELLED' ORDER BY created_at DESC LIMIT 500",
      )
      .all(c) as Row[];
    const approvals = this.db
      .prepare(
        "SELECT id,agent_id,tool,created_at FROM approvals WHERE company_id=? AND state='PENDING' AND expires_at>? ORDER BY created_at LIMIT 100",
      )
      .all(c, Date.now()) as Row[];
    const meetings: Row[] = this.db
      .prepare(
        "SELECT id,topic,participants,status,created_at FROM office_meetings WHERE company_id=? ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,created_at DESC LIMIT 30",
      )
      .all(c)
      .map((m) => ({ ...m, participants: JSON.parse(String(m.participants)) }));
    const activeParticipants = new Set(
      meetings
        .filter((m) => m.status === "ACTIVE")
        .flatMap((m) => m.participants),
    );
    const agents = records.map((a) => {
      const quarantine = activeQuarantine(this.db, c, a.id);
      const definition = JSON.parse(a.definition),
        own = tasks.filter((t) => t.agent_id === a.id),
        current = own.filter(
          (t) =>
            t.status !== "COMPLETE" ||
            (t.completed_at &&
              Date.parse(t.completed_at) > Date.now() - 86400000),
        );
      return {
        id: a.id,
        name: definition.name,
        title: definition.title,
        department: a.department,
        manager: definition.manager,
        quarantine: quarantine ?? null,
        operations: outstandingOperations(this.db, c, a.id),
        restrictions: [
          company.stopped ? "Company paused" : null,
          a.paused ? "Agent paused" : null,
          departments.find((d) => d.id === a.department)?.paused
            ? "Department paused"
            : null,
        ].filter(Boolean),
        previousHoldId:
          this.db
            .prepare(
              "SELECT id FROM agent_quarantine_holds WHERE company_id=? AND agent_id=? ORDER BY rowid DESC LIMIT 1",
            )
            .get(c, a.id)?.id ?? "",
        status: quarantine
          ? quarantinePending(this.db, c, a.id)
            ? "QUARANTINE_PENDING"
            : "QUARANTINED"
          : officeStatus(
              current.map((t) => t.status),
              !!company.stopped ||
                !!a.paused ||
                !!departments.find((d) => d.id === a.department)?.paused,
              approvals.some((p) => p.agent_id === a.id),
              activeParticipants.has(a.id),
            ),
        tasks: current
          .slice(0, 5)
          .map((t) => ({ id: t.id, title: t.objective, status: t.status })),
        taskCount: current.length,
      };
    });
    const coo =
      agents.find((a) => a.title === "Chief Operating Officer") ??
      agents.find((a) => a.id === "boris");
    const attention: Row[] = [
      ...approvals.map((p) => ({
        id: `approval:${p.id}`,
        agent: p.agent_id,
        department: agents.find((a) => a.id === p.agent_id)?.department,
        severity: "ACTION",
        summary: `Approval requested: ${p.tool}`,
        timestamp: p.created_at,
        route: "approvals",
        action: "Review exact approval",
      })),
      ...tasks
        .filter((t) =>
          ["FAILED", "BLOCKED", "WAITING FOR CEO"].includes(t.status),
        )
        .map((t) => ({
          id: `task:${t.id}`,
          agent: t.agent_id,
          department: agents.find((a) => a.id === t.agent_id)?.department,
          severity: t.status === "WAITING FOR CEO" ? "ACTION" : "URGENT",
          summary: `${t.status}: ${t.objective}`,
          timestamp: t.created_at,
          route: "projects",
          action: "Review task",
        })),
    ];
    const security = this.db
      .prepare(
        "SELECT id,severity,message,created_at FROM security_alerts WHERE company_id=? AND status='OPEN' ORDER BY created_at DESC LIMIT 50",
      )
      .all(c);
    for (const s of security)
      attention.push({
        id: `security:${s.id}`,
        agent: "viktor",
        department: "security",
        severity: ["HIGH", "CRITICAL"].includes(String(s.severity))
          ? "URGENT"
          : "ACTION",
        summary: s.message,
        timestamp: s.created_at,
        route: "notifications",
        action: "Open notification center",
      });
    const memos = this.db
      .prepare(
        "SELECT m.id,m.author_id,m.department_id,m.subject,m.priority,m.created_at FROM executive_memos m JOIN memo_review_events r ON r.id=(SELECT max(id) FROM memo_review_events WHERE company_id=m.company_id AND memo_id=m.id) WHERE m.company_id=? AND (r.status IN('UNREAD','ACTION REQUIRED') OR (m.action_required=1 AND r.status NOT IN('CLOSED','ARCHIVED'))) ORDER BY m.created_at DESC LIMIT 50",
      )
      .all(c);
    for (const m of memos)
      attention.push({
        id: "memo:" + m.id,
        agent: m.author_id,
        department: m.department_id,
        severity: m.priority === "URGENT" ? "URGENT" : "ACTION",
        summary: m.subject,
        timestamp: m.created_at,
        route: "memos?memo=" + encodeURIComponent(String(m.id)),
        action: "Open memo",
      });
    const floors = departments
      .map((d) => {
        const members = agents.filter((a) => a.department === d.id),
          heads = members.filter(
            (a) => !members.some((m) => m.id === a.manager),
          );
        return {
          id: d.id,
          name: d.id === "executive" ? "Penthouse — Executive Office" : d.name,
          head: heads.find((a) => a.id === coo?.id)?.id ?? heads[0]?.id ?? null,
          agents: members.map((a) => a.id),
          attentionCount: attention.filter((a) => a.department === d.id).length,
          paused: !!d.paused,
        };
      })
      .sort((a, b) =>
        a.id === "executive"
          ? -1
          : b.id === "executive"
            ? 1
            : String(a.id).localeCompare(String(b.id)),
      );
    const totals = this.db
      .prepare(
        "SELECT status,count(*) n FROM tasks WHERE company_id=? GROUP BY status",
      )
      .all(c);
    return {
      company,
      legacyExecutionPending: legacyExecutionPending(this.db, c),
      legacyMonitor:
        this.db
          .prepare(
            "SELECT token,started_at FROM ux_monitor_runs m WHERE company_id=? AND status='RUNNING' AND NOT EXISTS(SELECT 1 FROM execution_operations o WHERE o.company_id=m.company_id AND o.kind='MONITOR' AND o.resource_id=m.token)",
          )
          .get(c) ?? null,
      asOf: now(),
      mode: "STATE VISUALIZATION — no autonomous model runtime",
      coo: coo?.id ?? null,
      agents,
      floors,
      attention: attention.slice(0, 200),
      meetings,
      totals,
      truncated: tasks.length === 500 || attention.length > 200,
      flags: {
        pixelOfficeEnabled: true,
        meetingsEnabled: true,
        officeAnimationsEnabled: false,
        classicDashboardEnabled: true,
      },
    };
  }
  meeting(record: unknown): Row {
    this.authenticate();
    const row = this.db
      .prepare("SELECT * FROM office_meetings WHERE company_id=? AND id=?")
      .get(this.p.company_id, field(record, "Meeting", 80));
    if (!row) throw new DomainError("Meeting not found", 404);
    return {
      ...row,
      participants: JSON.parse(String(row.participants)),
      context: JSON.parse(String(row.context)),
      tasks: this.db
        .prepare(
          "SELECT t.id,t.agent_id,t.objective,t.status FROM office_meeting_tasks l JOIN tasks t ON t.company_id=l.company_id AND t.id=l.task_id WHERE l.company_id=? AND l.meeting_id=?",
        )
        .all(this.p.company_id, row.id),
    };
  }
  start(input: Row) {
    return this.mutate("office.meeting_started", "meeting", [], () => {
      const topic = field(input.topic, "Meeting topic", 1500);
      screenKnowledge(topic);
      if (
        !Array.isArray(input.participants) ||
        !input.participants.length ||
        input.participants.length > 24 ||
        input.participants.some((v: unknown) => typeof v !== "string")
      )
        throw new DomainError("Select 1–24 participants");
      const participants = [...new Set(input.participants)] as string[],
        view = this.view();
      if (participants.some((p) => !view.agents.some((a) => a.id === p)))
        throw new DomainError("Participant not found", 404);
      if (
        Number(
          this.db
            .prepare(
              "SELECT count(*) n FROM office_meetings WHERE company_id=? AND status='ACTIVE'",
            )
            .get(this.p.company_id)!.n,
        ) >= 5
      )
        throw new DomainError(
          "Close an existing context review before starting another",
          409,
        );
      const context = {
        mode: "HUMAN_LED_CONTEXT_REVIEW",
        asOf: view.asOf,
        contributions: participants.map((p) => {
          const a = view.agents.find((a) => a.id === p)!;
          return {
            agent: a.id,
            name: a.name,
            title: a.title,
            status: a.status,
            tasks: a.tasks,
          };
        }),
        notice:
          "Stored task context only. No participant or COO model response was generated; owner conclusions require evidence review.",
      };
      const record = id();
      this.db
        .prepare(
          "INSERT INTO office_meetings VALUES(?,?,?,?,?,'ACTIVE',NULL,NULL,?,?,NULL)",
        )
        .run(
          record,
          this.p.company_id,
          topic,
          JSON.stringify(participants),
          JSON.stringify(context),
          this.p.id,
          now(),
        );
      return this.meeting(record);
    });
  }
  close(input: Row) {
    return this.mutate("office.meeting_closed", String(input.id), [], () => {
      const m = this.meeting(input.id);
      if (m.status !== "ACTIVE")
        throw new DomainError("Meeting already closed", 409);
      const summary = field(input.summary, "Human summary", 3000),
        decisions = field(input.decisions, "Human decisions or none", 3000);
      screenKnowledge(summary + " " + decisions);
      this.db
        .prepare(
          "UPDATE office_meetings SET status='CLOSED',summary=?,decisions=?,closed_at=? WHERE company_id=? AND id=?",
        )
        .run(summary, decisions, now(), this.p.company_id, m.id);
      return this.meeting(m.id);
    });
  }
  createTask(input: Row) {
    return this.mutate(
      "office.meeting_task_created",
      String(input.id),
      [],
      () => {
        const m = this.meeting(input.id),
          agent = field(input.agentId, "Agent", 80);
        if (!m.participants.includes(agent))
          throw new DomainError(
            "Task assignee must be a meeting participant",
            403,
          );
        const objective = field(input.objective, "Owner task objective", 2000);
        screenKnowledge(objective);
        const result = new CompanyService(this.db, this.p).task({
          projectId: input.projectId,
          agentId: agent,
          objective,
        });
        this.db
          .prepare("INSERT OR IGNORE INTO office_meeting_tasks VALUES(?,?,?,?)")
          .run(this.p.company_id, m.id, result.id, now());
        return result;
      },
    );
  }
}
