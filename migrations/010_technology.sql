CREATE TABLE ux_observations (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER ux_observations_immutable BEFORE UPDATE ON ux_observations BEGIN SELECT RAISE(ABORT,'Observations are immutable'); END;
CREATE TABLE ux_reports (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),parent_id TEXT,title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('PROPOSED','APPROVED','IN_PROGRESS','VALIDATED','REWORK','CANCELLED')),
 approved_by TEXT REFERENCES users(id),expires_at INTEGER,consumed_at TEXT,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),FOREIGN KEY(company_id,parent_id) REFERENCES ux_reports(company_id,id)
);
CREATE TRIGGER ux_reports_immutable BEFORE UPDATE OF id,company_id,parent_id,title,body,content_hash,created_at ON ux_reports BEGIN SELECT RAISE(ABORT,'Create a new report revision'); END;
CREATE TABLE ux_report_sources (
 company_id TEXT NOT NULL,report_id TEXT NOT NULL,observation_id TEXT NOT NULL,PRIMARY KEY(company_id,report_id,observation_id),
 FOREIGN KEY(company_id,report_id) REFERENCES ux_reports(company_id,id),FOREIGN KEY(company_id,observation_id) REFERENCES ux_observations(company_id,id)
);
CREATE TABLE ux_validations (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL,report_id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),created_at TEXT NOT NULL,
 UNIQUE(company_id,report_id),FOREIGN KEY(company_id,report_id) REFERENCES ux_reports(company_id,id)
);
CREATE TRIGGER ux_validations_immutable BEFORE UPDATE ON ux_validations BEGIN SELECT RAISE(ABORT,'Validation records are immutable'); END;
CREATE TABLE ux_monitor_runs (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),started_at INTEGER NOT NULL,token TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('RUNNING','COMPLETE','FAILED'))
);
