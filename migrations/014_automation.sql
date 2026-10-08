CREATE TABLE automation_schedules (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), title TEXT NOT NULL, kind TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), content_hash TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN('DRAFT','APPROVED','ENABLED','PAUSED','EXPIRED','EXHAUSTED')),
 approved_by TEXT REFERENCES users(id), approval_expires_at INTEGER, approval_consumed_at TEXT,
 next_run_at INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER automation_content_immutable BEFORE UPDATE OF id,company_id,title,kind,body,content_hash,created_by,created_at ON automation_schedules BEGIN SELECT RAISE(ABORT,'Schedule content is immutable; create a new schedule'); END;
CREATE TABLE automation_runs (
 id TEXT NOT NULL,company_id TEXT NOT NULL,schedule_id TEXT NOT NULL,due_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN('SUCCEEDED','BLOCKED','FAILED')),output TEXT NOT NULL CHECK(json_valid(output)),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,schedule_id,due_at),FOREIGN KEY(company_id,schedule_id) REFERENCES automation_schedules(company_id,id)
);
CREATE TRIGGER automation_runs_immutable BEFORE UPDATE ON automation_runs BEGIN SELECT RAISE(ABORT,'Automation run history is immutable'); END;
CREATE TRIGGER automation_runs_retained BEFORE DELETE ON automation_runs BEGIN SELECT RAISE(ABORT,'Automation run history is retained'); END;
CREATE INDEX automation_due ON automation_schedules(status,next_run_at);
