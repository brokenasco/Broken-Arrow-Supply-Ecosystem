import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, id } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { CompanyService } from "../src/service.ts";
import { TaskCoordinationService } from "../src/task-coordination.ts";
import { QuarantineService } from "../src/quarantine.ts";
function fixture() {
  const db = openDatabase(":memory:"),
    u = provision(
      db,
      "handoff@example.test",
      "synthetic-handoff-password",
      "Handoff fixture",
    ),
    p = { id: u.user, company_id: u.company, role: "CEO" },
    company = new CompanyService(db, p),
    project = company.project({
      name: "Handoff",
      objective: "Delegation test",
    }),
    parent = company.task({
      projectId: project.id,
      agentId: "anna",
      objective: "Coordinate research",
    });
  return {
    db,
    p,
    company,
    project,
    parent,
    service: new TaskCoordinationService(db, p),
    input: {
      requestId: id(),
      parentTaskId: parent.id,
      agentId: "mason",
      objective: "Research fixture",
      expectedOutput: "Source-backed artifact",
    },
  };
}
test("owner delegation checks authority, preserves held incoming work and deduplicates exact requests", () => {
  const f = fixture();
  try {
    new QuarantineService(f.db, f.p).hold({
      agent: "mason",
      requestId: id(),
      reason: "Synthetic hold",
      confirm: true,
    });
    const result = f.service.delegate(f.input);
    assert.equal(f.service.delegate(f.input).id, result.id);
    assert.equal(f.service.list().length, 1);
    assert.equal(f.service.list()[0].status, "BLOCKED");
    assert.equal(f.service.list()[0].message_type, "TASK_REQUEST");
    assert.throws(
      () => f.service.delegate({ ...f.input, objective: "Different task" }),
      /different handoff/,
    );
    assert.throws(
      () =>
        f.service.delegate({ ...f.input, requestId: id(), agentId: "jack" }),
      /authority/,
    );
    assert.throws(
      () => f.service.delegate({ ...f.input, requestId: id() }),
      /silently adopted/,
    );
    new QuarantineService(f.db, f.p).hold({
      agent: "anna",
      requestId: id(),
      reason: "Sender hold",
      confirm: true,
    });
    assert.throws(
      () =>
        f.service.delegate({
          ...f.input,
          requestId: id(),
          objective: "Another task",
        }),
      /quarantined/,
    );
    assert.equal(f.service.list().length, 1);
  } finally {
    f.db.close();
  }
});
test("handoff audit rollback, parent/dependency scope and terminal boundaries fail closed", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.service.delegate({ ...f.input, dependencies: [f.parent.id] }),
      /Dependencies/,
    );
    f.db.exec(
      "CREATE TRIGGER reject_handoff_audit BEFORE INSERT ON audit_logs WHEN NEW.action='task.handoff_recorded' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;",
    );
    const count = f.db.prepare("SELECT count(*) n FROM tasks").get()?.n;
    assert.throws(() => f.service.delegate(f.input), /audit failure/);
    assert.equal(f.db.prepare("SELECT count(*) n FROM tasks").get()?.n, count);
    assert.equal(f.service.list().length, 0);
    f.db.exec("DROP TRIGGER reject_handoff_audit");
    const other = provision(
      f.db,
      "handoff-other@example.test",
      "synthetic-other-password",
      "Other fixture",
    );
    assert.throws(
      () =>
        new TaskCoordinationService(f.db, {
          id: other.user,
          company_id: other.company,
          role: "CEO",
        }).delegate(f.input),
      /not found/,
    );
    assert.throws(
      () => new TaskCoordinationService(f.db, { ...f.p, id: "anna" }),
      /Authenticated/,
    );
    f.company.cancel(String(f.parent.id));
    assert.throws(() => f.service.delegate(f.input), /terminal/);
  } finally {
    f.db.close();
  }
});
