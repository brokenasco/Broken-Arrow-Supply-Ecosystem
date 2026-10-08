CREATE UNIQUE INDEX sync_run_company_store ON shopify_sync_runs(company_id,store_id,id);
CREATE TABLE analytics_days (
 company_id TEXT NOT NULL, store_id TEXT NOT NULL, currency TEXT NOT NULL, timezone TEXT NOT NULL,
 day TEXT NOT NULL, orders INTEGER NOT NULL CHECK(orders>=0), value_minor INTEGER NOT NULL CHECK(value_minor>=0),
 source_run TEXT NOT NULL REFERENCES shopify_sync_runs(id), as_of TEXT NOT NULL,
 PRIMARY KEY(company_id,store_id,currency,timezone,day),
 FOREIGN KEY(company_id,store_id) REFERENCES stores(company_id,id),
 FOREIGN KEY(company_id,store_id,source_run) REFERENCES shopify_sync_runs(company_id,store_id,id)
);
CREATE TABLE analytics_reports (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE experiments (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), title TEXT NOT NULL,
 hypothesis TEXT NOT NULL, variant TEXT NOT NULL, metric TEXT NOT NULL, target TEXT NOT NULL,
 starts_on TEXT NOT NULL, ends_on TEXT NOT NULL, baseline TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PLANNED','RUNNING','COMPLETED','CANCELLED')),
 evidence TEXT, conclusion TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER analytics_reports_no_update BEFORE UPDATE ON analytics_reports BEGIN SELECT RAISE(ABORT,'Reports are immutable'); END;
CREATE TRIGGER analytics_reports_no_delete BEFORE DELETE ON analytics_reports BEGIN SELECT RAISE(ABORT,'Reports are immutable'); END;
