CREATE TABLE execution_attempts (
 company_id TEXT NOT NULL,
 id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 attempt_no INTEGER NOT NULL CHECK(attempt_no BETWEEN 1 AND 3),
 state TEXT NOT NULL CHECK(state IN('PROPOSED','RUNNING','SUCCEEDED','FAILED','UNKNOWN','CANCELLED')),
 input_hash TEXT NOT NULL,
 output TEXT CHECK(output IS NULL OR json_valid(output)),
 output_hash TEXT,
 provider TEXT NOT NULL,
 created_at TEXT NOT NULL,
 finished_at TEXT,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,task_id,attempt_no),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE TABLE runtime_events (
 company_id TEXT NOT NULL, id TEXT NOT NULL, topic TEXT NOT NULL,
 aggregate_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
 state TEXT NOT NULL CHECK(state IN('PENDING','DELIVERED','FAILED')) DEFAULT 'PENDING',
 created_at TEXT NOT NULL, delivered_at TEXT,
 PRIMARY KEY(company_id,id)
);
CREATE INDEX execution_attempts_task ON execution_attempts(company_id,task_id,attempt_no);
CREATE INDEX runtime_events_pending ON runtime_events(company_id,state,created_at);
CREATE TRIGGER execution_attempts_immutable BEFORE UPDATE OF company_id,id,task_id,attempt_no,input_hash,provider,created_at ON execution_attempts BEGIN SELECT RAISE(ABORT,'Execution identity immutable'); END;
CREATE TRIGGER runtime_events_immutable BEFORE UPDATE OF company_id,id,topic,aggregate_id,payload,created_at ON runtime_events BEGIN SELECT RAISE(ABORT,'Runtime event immutable'); END;
