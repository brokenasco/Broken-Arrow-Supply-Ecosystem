import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { AgentConfigurationService } from "../src/agent-configuration.ts";
import { CompanyService } from "../src/service.ts";

test("configuration versions preserve identities and reject reporting cycles", () => {
  const db = openDatabase(":memory:");
  try {
    const u = provision(
        db,
        "config@example.test",
        "synthetic-config-password",
        "Configuration fixture",
      ),
      p = { id: u.user, company_id: u.company, role: "CEO" },
      service = new AgentConfigurationService(db, p);
    const anna = service.get("anna");
    assert.equal(anna.version, 1);
    assert.equal(anna.definition.name, "Анна");
    service.assertTasking("anna", "mason");
    service.assertTasking("boris", "mason");
    assert.throws(() => service.assertTasking("mason", "anna"), /authority/);
    assert.throws(() => service.assertTasking("anna", "jack"), /authority/);
    assert.throws(() => service.assertTasking("anna", "anna"), /denied/);
    const update = db.prepare(
      "UPDATE agents SET definition=? WHERE company_id=? AND id=?",
    );
    assert.throws(
      () =>
        update.run(
          JSON.stringify({ ...anna.definition, manager: "mason" }),
          u.company,
          "anna",
        ),
      /Circular/,
    );
    assert.throws(
      () =>
        update.run(
          JSON.stringify({ ...anna.definition, manager: "unknown" }),
          u.company,
          "anna",
        ),
      /Unknown/,
    );
    assert.equal(service.history("anna").length, 1);
    // Trusted fixture mutation only: application exposes no configuration-write endpoint.
    update.run(
      JSON.stringify({
        ...anna.definition,
        mission: "Synthetic revised mission",
      }),
      u.company,
      "anna",
    );
    assert.equal(service.get("anna").version, 2);
    assert.equal(service.history("anna").length, 2);
    assert.throws(
      () => db.prepare("DELETE FROM agent_config_versions").run(),
      /retained/,
    );
    assert.throws(
      () => db.prepare("UPDATE constitution_versions SET rules='[]'").run(),
      /immutable/,
    );
    assert.ok(
      service.constitution().rules.some((r) => r.includes("cannot approve")),
    );
    assert.throws(
      () => new AgentConfigurationService(db, { ...p, id: "anna" }),
      /Authenticated/,
    );
  } finally {
    db.close();
  }
});

test("runtime context is bounded to the assigned company task and stays nonexecuting", () => {
  const db = openDatabase(":memory:");
  try {
    const u = provision(
        db,
        "context@example.test",
        "synthetic-context-password",
        "Context fixture",
      ),
      p = { id: u.user, company_id: u.company, role: "CEO" },
      service = new AgentConfigurationService(db, p);
    const company = new CompanyService(db, p);
    const project = company.project({
      name: "Context fixture",
      objective: "Test bounded context",
    });
    const task = company.task({
      projectId: project.id,
      agentId: "anna",
      objective: "Untrusted fixture task",
    });
    const context = service.context("anna", task.id);
    assert.equal(context.modelExecutionEnabled, false);
    assert.equal(context.task.objective, "Untrusted fixture task");
    assert.equal(context.configuration.version, 1);
    assert.equal(context.constitution.version, 1);
    assert.throws(() => service.context("mason", task.id), /not found/);
    assert.throws(() => service.context("anna", "nonexistent"), /not found/);
    const other = provision(
      db,
      "context-other@example.test",
      "synthetic-other-password",
      "Other fixture",
    );
    assert.throws(
      () =>
        new AgentConfigurationService(db, {
          id: other.user,
          company_id: other.company,
          role: "CEO",
        }).context("anna", task.id),
      /not found/,
    );
    company.control("agent", "anna", true);
    assert.throws(() => service.context("anna", task.id), /paused/);
    company.control("agent", "anna", false);
    db.prepare(
      "UPDATE tasks SET status='COMPLETE' WHERE company_id=? AND id=?",
    ).run(u.company, task.id);
    assert.throws(() => service.context("anna", task.id), /terminal/);
    assert.equal(
      new AgentConfigurationService(db, {
        id: other.user,
        company_id: other.company,
        role: "CEO",
      }).history("anna").length,
      1,
    );
  } finally {
    db.close();
  }
});
