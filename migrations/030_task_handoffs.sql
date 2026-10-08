CREATE TABLE task_handoffs (
 company_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 task_id TEXT NOT NULL, parent_task_id TEXT NOT NULL,
 sender TEXT NOT NULL, recipient TEXT NOT NULL,
 sender_version INTEGER NOT NULL, recipient_version INTEGER NOT NULL,
 constitution_version INTEGER NOT NULL REFERENCES constitution_versions(version),
 authorized_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 message_type TEXT NOT NULL CHECK(message_type='TASK_REQUEST'),
 PRIMARY KEY(company_id,request_id), UNIQUE(company_id,task_id),
 CHECK(task_id<>parent_task_id),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,parent_task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,sender,sender_version) REFERENCES agent_config_versions(company_id,agent_id,version),
 FOREIGN KEY(company_id,recipient,recipient_version) REFERENCES agent_config_versions(company_id,agent_id,version)
);
CREATE INDEX task_handoff_parent ON task_handoffs(company_id,parent_task_id,created_at);
CREATE TRIGGER task_handoff_immutable BEFORE UPDATE ON task_handoffs BEGIN SELECT RAISE(ABORT,'Task handoff immutable'); END;
CREATE TRIGGER task_handoff_retained BEFORE DELETE ON task_handoffs BEGIN SELECT RAISE(ABORT,'Task handoff retained'); END;
