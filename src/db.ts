import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { agents, departments } from "./registry.ts";
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const [version, file] of [
    [1, "001_foundation.sql"],
    [2, "002_approval_integrity.sql"],
    [3, "003_shopify_reads.sql"],
    [4, "004_analytics.sql"],
    [5, "005_research.sql"],
    [6, "006_design.sql"],
    [7, "007_product_factory.sql"],
    [8, "008_marketing.sql"],
    [9, "009_customers.sql"],
    [10, "010_technology.sql"],
    [11, "011_operations.sql"],
    [12, "012_compliance.sql"],
    [13, "013_learning.sql"],
    [14, "014_automation.sql"],
    [15, "015_organization.sql"],
    [16, "016_security.sql"],
    [17, "017_credentials.sql"],
    [18, "018_passkeys.sql"],
    [19, "019_shared_knowledge.sql"],
    [20, "020_ai_resources.sql"],
    [21, "021_pixel_office.sql"],
    [22, "022_executive_memos.sql"],
    [23, "023_executive_reporting.sql"],
    [24, "024_design_resource_gate.sql"],
    [25, "025_memo_budget_governance.sql"],
    [26, "026_quarantine.sql"],
    [27, "027_execution_operations.sql"],
    [28, "028_execution_receipts.sql"],
    [29, "029_registry_versions.sql"],
    [30, "030_task_handoffs.sql"],
    [31, "031_runtime_foundation.sql"],
  ] as const) {
    transaction(db, () => {
      if (
        db
          .prepare("SELECT version FROM schema_migrations WHERE version=?")
          .get(version)
      )
        return;
      db.exec(
        readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      );
      if (version === 16) {
        db.prepare(
          "INSERT OR IGNORE INTO departments(id,company_id,name) SELECT 'security',id,'security' FROM companies",
        ).run();
        db.prepare(
          "INSERT OR IGNORE INTO agents(id,company_id,department,definition) SELECT 'viktor',id,'security',? FROM companies",
        ).run(JSON.stringify(agents.find((a) => a.id === "viktor")));
      }
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        version,
        now(),
      );
    });
  }
  return db;
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    const savepoint = "nested_" + id().replaceAll("-", "");
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = fn();
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      db.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function audit(
  db: DatabaseSync,
  company: string,
  actor: string,
  action: string,
  resource: string,
  result = "SUCCESS",
  details: object = {},
) {
  db.prepare(
    "INSERT INTO audit_logs(company_id,actor,action,resource,result,details,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    company,
    actor,
    action,
    resource,
    result,
    JSON.stringify(details),
    now(),
  );
}
export function seedCompany(db: DatabaseSync, name: string) {
  const company = id();
  db.prepare(
    "INSERT INTO companies(id,name,mode,created_at) VALUES(?,?,?,?)",
  ).run(company, name, "DEMO", now());
  db.prepare("INSERT INTO stores(id,company_id,name,mode) VALUES(?,?,?,?)").run(
    id(),
    company,
    "No Shopify store connected",
    "DEMO",
  );
  for (const department of departments)
    db.prepare("INSERT INTO departments(id,company_id,name) VALUES(?,?,?)").run(
      department,
      company,
      department,
    );
  for (const agent of agents)
    db.prepare(
      "INSERT INTO agents(id,company_id,department,definition) VALUES(?,?,?,?)",
    ).run(agent.id, company, agent.department, JSON.stringify(agent));
  const project = id();
  db.prepare(
    "INSERT INTO projects(id,company_id,name,objective,owner,created_at) VALUES(?,?,?,?,?,?)",
  ).run(
    project,
    company,
    "Company activation",
    "Establish company goals, brand and integration permissions",
    "boris",
    now(),
  );
  db.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?)").run(
    id(),
    company,
    "INFO",
    "Foundation ready. All providers are disconnected; autonomous schedules are disabled.",
    0,
    now(),
  );
  audit(db, company, "system", "company.created", company);
  return company;
}
