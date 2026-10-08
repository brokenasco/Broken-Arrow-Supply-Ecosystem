CREATE TABLE execution_operations (
 company_id TEXT NOT NULL REFERENCES companies(id), id TEXT NOT NULL,
 kind TEXT NOT NULL, resource_id TEXT NOT NULL, task_id TEXT, workflow_id TEXT,
 request_key TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('RUNNING','COMPLETE','STOPPED','UNKNOWN')),
 effect TEXT NOT NULL CHECK(effect IN('READ','WRITE','PAID')),
 created_by TEXT NOT NULL REFERENCES users(id), started_at TEXT NOT NULL, deadline_at INTEGER NOT NULL,
 updated_at TEXT NOT NULL, outcome TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,request_key),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE TABLE execution_participants (
 company_id TEXT NOT NULL, operation_id TEXT NOT NULL, agent_id TEXT NOT NULL, hold_generation INTEGER NOT NULL,
 PRIMARY KEY(company_id,operation_id,agent_id),
 FOREIGN KEY(company_id,operation_id) REFERENCES execution_operations(company_id,id),
 FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id)
);
CREATE INDEX execution_agent ON execution_participants(company_id,agent_id,operation_id);
CREATE INDEX execution_active ON execution_operations(company_id,state,deadline_at);
CREATE TRIGGER execution_identity BEFORE UPDATE OF company_id,id,kind,resource_id,task_id,workflow_id,request_key,effect,created_by,started_at,deadline_at ON execution_operations BEGIN SELECT RAISE(ABORT,'Execution identity immutable'); END;
CREATE TRIGGER execution_retained BEFORE DELETE ON execution_operations BEGIN SELECT RAISE(ABORT,'Execution history retained'); END;
CREATE TRIGGER execution_participant_immutable BEFORE UPDATE ON execution_participants BEGIN SELECT RAISE(ABORT,'Execution participant immutable'); END;
CREATE TRIGGER execution_participant_retained BEFORE DELETE ON execution_participants BEGIN SELECT RAISE(ABORT,'Execution participant retained'); END;
