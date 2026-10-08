CREATE TABLE executive_report_closes (
 company_id TEXT NOT NULL, period TEXT NOT NULL, department_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('MONTH','QUARTER')),
 memo_id TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence)),content_hash TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,period,department_id,kind),FOREIGN KEY(company_id,memo_id) REFERENCES executive_memos(company_id,id),
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id)
);
CREATE TABLE executive_evaluations (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL,memo_id TEXT NOT NULL,agent_id TEXT NOT NULL,
 rating TEXT NOT NULL CHECK(rating IN('Exceptional','Exceeds Expectations','Meets Expectations','Needs Improvement','Unsatisfactory')),
 rationale TEXT NOT NULL,evidence_ids TEXT NOT NULL CHECK(json_valid(evidence_ids)),assessor TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,memo_id) REFERENCES executive_memos(company_id,id),FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id),UNIQUE(company_id,memo_id,agent_id)
);
CREATE TABLE executive_reporting_settings (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),start_month TEXT NOT NULL,authorized_by TEXT NOT NULL REFERENCES users(id),last_error TEXT,last_attempt_at TEXT
);
CREATE TRIGGER executive_close_immutable BEFORE UPDATE ON executive_report_closes BEGIN SELECT RAISE(ABORT,'Closed report evidence is immutable'); END;
CREATE TRIGGER executive_close_retained BEFORE DELETE ON executive_report_closes BEGIN SELECT RAISE(ABORT,'Closed report evidence retained'); END;
CREATE TRIGGER executive_evaluation_immutable BEFORE UPDATE ON executive_evaluations BEGIN SELECT RAISE(ABORT,'Evaluation retained; use a new memo'); END;
CREATE TRIGGER executive_evaluation_retained BEFORE DELETE ON executive_evaluations BEGIN SELECT RAISE(ABORT,'Evaluation history retained'); END;
