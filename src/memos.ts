import { HumanWorkflow, field, choice } from "./workflow.ts";
import { audit, transaction, now } from "./db.ts";
import { DomainError } from "./policy.ts";
import { screenKnowledge } from "./knowledge-utils.ts";
type Row = Record<string, any>;
export const memoSections = [
  "purpose",
  "summary",
  "details",
  "analysis",
  "recommendation",
  "ownerAction",
  "supportingData",
] as const;
const priorities = [
  "ROUTINE",
  "INFORMATION",
  "RECOMMENDATION",
  "ACTION REQUIRED",
  "URGENT",
] as const;
const statuses = [
  "REVIEWED",
  "ACTION REQUIRED",
  "MODIFICATION REQUESTED",
  "CLOSED",
  "ARCHIVED",
] as const;
export class MemoService extends HumanWorkflow {
  catalogue() {
    this.authenticate();
    const agents = this.db
      .prepare(
        "SELECT id,department,definition FROM agents WHERE company_id=? ORDER BY id",
      )
      .all(this.p.company_id)
      .map((a) => ({
        ...JSON.parse(String(a.definition)),
        id: a.id,
        department: a.department,
      }));
    return {
      types: this.db
        .prepare("SELECT * FROM memo_type_codes ORDER BY code")
        .all(),
      priorities,
      sections: memoSections,
      authors: agents.filter(
        (a) =>
          a.id === "boris" ||
          !agents.some(
            (b) => b.department === a.department && b.id === a.manager,
          ),
      ),
      departments: this.db
        .prepare(
          "SELECT id,name FROM departments WHERE company_id=? ORDER BY id",
        )
        .all(this.p.company_id),
    };
  }
  list(input: Row = {}) {
    this.authenticate();
    const args: any[] = [this.p.company_id],
      where = ["m.company_id=?"];
    for (const [key, column] of [
      ["department", "department_id"],
      ["type", "type"],
      ["priority", "priority"],
    ] as const)
      if (input[key]) {
        where.push(`m.${column}=?`);
        args.push(field(input[key], key, 80));
      }
    if (input.status) {
      where.push("r.status=?");
      args.push(field(input.status, "status", 40));
    } else where.push("r.status!='ARCHIVED'");
    if (input.query) {
      const terms =
        field(input.query, "Search", 200).match(/[\p{L}\p{N}]+/gu) || [];
      if (!terms.length)
        throw new DomainError("Search needs letters or numbers");
      where.push(
        "m.id IN (SELECT memo_id FROM memo_search WHERE company_id=? AND memo_search MATCH ?)",
      );
      args.push(
        this.p.company_id,
        terms.map((t) => '"' + t + '"').join(" AND "),
      );
    }
    const rows = this.db
      .prepare(
        `SELECT m.*,r.status FROM executive_memos m JOIN memo_review_events r ON r.id=(SELECT max(id) FROM memo_review_events WHERE company_id=m.company_id AND memo_id=m.id) WHERE ${where.join(" AND ")} ORDER BY CASE m.priority WHEN 'ACTION REQUIRED' THEN 0 WHEN 'URGENT' THEN 1 WHEN 'RECOMMENDATION' THEN 2 WHEN 'INFORMATION' THEN 3 ELSE 4 END,m.created_at DESC LIMIT 100`,
      )
      .all(...args)
      .map((m) => ({ ...m, body: JSON.parse(String(m.body)) }));
    return {
      items: rows,
      limit: 100,
      catalogue: this.catalogue(),
      notice:
        "Owner-authored memos and deterministic completed-period reports. Evaluations identify human judgment separately from recorded metrics. Memos do not grant execution authority; ledger coverage is not complete provider billing.",
    };
  }
  get(value: unknown): Row {
    this.authenticate();
    const memo = field(value, "Memo ID", 120);
    const row = this.db
      .prepare("SELECT * FROM executive_memos WHERE company_id=? AND id=?")
      .get(this.p.company_id, memo);
    if (!row) throw new DomainError("Memo not found", 404);
    const history = this.db
      .prepare(
        "SELECT status,reason,actor,created_at FROM memo_review_events WHERE company_id=? AND memo_id=? ORDER BY id",
      )
      .all(this.p.company_id, memo);
    return {
      ...row,
      body: JSON.parse(String(row.body)),
      status: history.at(-1)?.status,
      history,
      related: this.db
        .prepare(
          "SELECT id,subject,relation FROM executive_memos WHERE company_id=? AND (parent_id=? OR id=?)",
        )
        .all(this.p.company_id, memo, row.parent_id ?? ""),
    };
  }
  submit(input: Row) {
    return this.mutate("memo.submitted", "memo", [], () => {
      const author = this.catalogue().authors.find(
        (a) => a.id === input.authorId,
      );
      if (!author)
        throw new DomainError(
          "Only a registered department leader or COO can be represented as sender",
          403,
        );
      const type = field(input.type, "Memo type", 3);
      if (
        !this.db
          .prepare("SELECT code FROM memo_type_codes WHERE code=?")
          .get(type)
      )
        throw new DomainError("Unknown memo type");
      const subject = field(input.subject, "Subject", 180),
        priority = choice(input.priority, priorities, "priority");
      if (typeof input.actionRequired !== "boolean")
        throw new DomainError("Action required must be a boolean");
      const body: Row = {};
      for (const key of memoSections) body[key] = field(input[key], key, 4000);
      screenKnowledge(subject + " " + JSON.stringify(body));
      let parent: Row | undefined,
        relation: string | null = null;
      if (input.parentId) {
        parent = this.get(input.parentId);
        if (parent.parent_id)
          throw new DomainError(
            "Link revisions and addenda to the original memo",
          );
        relation = choice(
          input.relation,
          ["REVISION", "ADDENDUM"] as const,
          "relationship",
        );
        if (parent.department_id !== author.department || parent.type !== type)
          throw new DomainError(
            "Revision must retain department and memo type",
          );
      }
      const c = this.p.company_id,
        department = String(author.department),
        year = new Date().getUTCFullYear();
      let code = this.db
        .prepare(
          "SELECT code FROM memo_department_codes WHERE company_id=? AND department_id=?",
        )
        .get(c, department)?.code;
      if (!code) {
        const known: Row = {
          marketing: "MKT",
          product: "PRD",
          technology: "TEC",
          operations: "OPS",
          security: "SEC",
          executive: "EXE",
        };
        const base =
          known[department] ||
          department
            .replace(/[^a-z]/gi, "")
            .toUpperCase()
            .slice(0, 3) ||
          "DEP";
        let candidate = base,
          n = 1;
        while (
          this.db
            .prepare(
              "SELECT code FROM memo_department_codes WHERE company_id=? AND code=?",
            )
            .get(c, candidate)
        )
          candidate = base + String(n++);
        code = candidate;
        this.db
          .prepare("INSERT INTO memo_department_codes VALUES(?,?,?)")
          .run(c, department, candidate);
      }
      const prefix = parent
        ? `${parent.id}-${relation === "REVISION" ? "R" : "A"}`
        : `BA-${year}-${code}-${type}-`;
      const count =
        Number(
          this.db
            .prepare(
              parent
                ? "SELECT count(*) n FROM executive_memos WHERE company_id=? AND parent_id=? AND relation=?"
                : "SELECT count(*) n FROM executive_memos WHERE company_id=? AND id LIKE ? AND parent_id IS NULL",
            )
            .get(...(parent ? [c, parent.id, relation] : [c, prefix + "%"]))!.n,
        ) + 1;
      const memo =
          prefix + (parent ? String(count) : String(count).padStart(4, "0")),
        stamp = now();
      this.db
        .prepare(
          "INSERT INTO executive_memos VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          c,
          memo,
          department,
          type,
          author.id,
          author.name,
          author.title,
          subject,
          priority,
          JSON.stringify(body),
          input.actionRequired ? 1 : 0,
          parent?.id ?? null,
          relation,
          this.p.id,
          stamp,
        );
      this.db
        .prepare(
          "INSERT INTO memo_review_events(company_id,memo_id,status,reason,actor,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          c,
          memo,
          "UNREAD",
          "Official submission; owner action does not grant execution authority",
          this.p.id,
          stamp,
        );
      audit(
        this.db,
        c,
        this.p.id,
        parent ? "memo." + relation!.toLowerCase() : "memo.generated",
        memo,
      );
      return this.get(memo);
    });
  }
  review(input: Row) {
    // Owner record review remains available during an automation stop. No execution/configuration is changed.
    return transaction(this.db, () => {
      this.authenticate();
      const memo = this.get(input.id),
        status = choice(input.status, statuses, "review status"),
        reason = field(input.reason, "Owner review reason", 1500);
      screenKnowledge(reason);
      if (memo.status === "ARCHIVED")
        throw new DomainError(
          "Archived record is closed to further review; submit an addendum",
          409,
        );
      if (
        status === "CLOSED" &&
        memo.action_required &&
        memo.status !== "MODIFICATION REQUESTED" &&
        input.confirmNoExecution !== true
      )
        throw new DomainError("Confirm closure grants no execution approval");
      this.db
        .prepare(
          "INSERT INTO memo_review_events(company_id,memo_id,status,reason,actor,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(this.p.company_id, memo.id, status, reason, this.p.id, now());
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "memo.reviewed",
        memo.id,
        "SUCCESS",
        { previous: memo.status, status },
      );
      return this.get(memo.id);
    });
  }
}
