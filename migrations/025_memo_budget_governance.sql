CREATE TABLE memo_budget_proposals (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, memo_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), content_hash TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 FOREIGN KEY(company_id,memo_id) REFERENCES executive_memos(company_id,id), UNIQUE(company_id,memo_id)
);
CREATE TABLE memo_budget_decisions (
 proposal_id TEXT PRIMARY KEY REFERENCES memo_budget_proposals(id), company_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN('APPROVED','DENIED','MODIFICATION REQUESTED','INFORMATION REQUESTED')),
 content_hash TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE resource_budget_policies (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, department_id TEXT NOT NULL, effective_month TEXT NOT NULL,
 limit_micros INTEGER NOT NULL CHECK(limit_micros>=0), allocations TEXT NOT NULL CHECK(json_valid(allocations)),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES memo_budget_proposals(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id)
);
CREATE INDEX resource_policy_lookup ON resource_budget_policies(company_id,department_id,effective_month);
CREATE TRIGGER memo_proposal_immutable BEFORE UPDATE ON memo_budget_proposals BEGIN SELECT RAISE(ABORT,'Proposal immutable'); END;
CREATE TRIGGER memo_proposal_retained BEFORE DELETE ON memo_budget_proposals BEGIN SELECT RAISE(ABORT,'Proposal retained'); END;
CREATE TRIGGER memo_decision_immutable BEFORE UPDATE ON memo_budget_decisions BEGIN SELECT RAISE(ABORT,'Decision immutable'); END;
CREATE TRIGGER memo_decision_retained BEFORE DELETE ON memo_budget_decisions BEGIN SELECT RAISE(ABORT,'Decision retained'); END;
CREATE TRIGGER resource_policy_immutable BEFORE UPDATE ON resource_budget_policies BEGIN SELECT RAISE(ABORT,'Policy immutable'); END;
CREATE TRIGGER resource_policy_retained BEFORE DELETE ON resource_budget_policies BEGIN SELECT RAISE(ABORT,'Policy retained'); END;
