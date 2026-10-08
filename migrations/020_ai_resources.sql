CREATE TABLE resource_agent_settings (
 company_id TEXT NOT NULL,agent_id TEXT NOT NULL,non_billable INTEGER NOT NULL DEFAULT 0 CHECK(non_billable IN(0,1)),
 PRIMARY KEY(company_id,agent_id),FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id)
);
CREATE TABLE resource_budget_overrides (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL,department_id TEXT NOT NULL,budget_month TEXT NOT NULL,
 limit_micros INTEGER NOT NULL CHECK(limit_micros>=0),reason TEXT NOT NULL,authorized_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id)
);
CREATE INDEX resource_override_month ON resource_budget_overrides(company_id,budget_month,department_id,created_at);
CREATE TABLE agent_budget_allocations (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),budget_month TEXT NOT NULL,content_hash TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
CREATE INDEX resource_allocation_month ON agent_budget_allocations(company_id,budget_month,created_at);
CREATE TRIGGER resource_allocation_immutable BEFORE UPDATE ON agent_budget_allocations BEGIN SELECT RAISE(ABORT,'Allocation history retained'); END;
CREATE TRIGGER resource_allocation_retained BEFORE DELETE ON agent_budget_allocations BEGIN SELECT RAISE(ABORT,'Allocation history retained'); END;
CREATE TABLE model_pricing (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),provider TEXT NOT NULL,model_id TEXT NOT NULL,display_name TEXT NOT NULL,
 input_micros_per_million INTEGER NOT NULL CHECK(input_micros_per_million>=0),cached_micros_per_million INTEGER NOT NULL CHECK(cached_micros_per_million>=0),
 output_micros_per_million INTEGER NOT NULL CHECK(output_micros_per_million>=0),reasoning_micros_per_million INTEGER NOT NULL CHECK(reasoning_micros_per_million>=0),
 request_micros INTEGER NOT NULL CHECK(request_micros>=0),tool_micros INTEGER NOT NULL CHECK(tool_micros>=0),currency TEXT NOT NULL CHECK(currency='USD'),
 pricing_source TEXT NOT NULL,effective_at TEXT NOT NULL,last_verified_at TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE INDEX resource_model_lookup ON model_pricing(company_id,provider,model_id,effective_at,created_at);
CREATE TABLE resource_reservations (
 id TEXT NOT NULL,company_id TEXT NOT NULL,request_key TEXT NOT NULL,budget_month TEXT NOT NULL,department_id TEXT NOT NULL,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,
 pricing_id TEXT NOT NULL,estimated_micros INTEGER NOT NULL CHECK(estimated_micros>0),priority TEXT NOT NULL CHECK(priority IN('P0','P1','P2','P3')),
 task_type TEXT NOT NULL,content_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('RESERVED','SETTLED','CANCELLED','UNCERTAIN')),
 budget_before INTEGER NOT NULL,department_before INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,settled_at TEXT,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,request_key),FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id),
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id),FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),FOREIGN KEY(company_id,pricing_id) REFERENCES model_pricing(company_id,id)
);
CREATE INDEX resource_reserved ON resource_reservations(company_id,state,budget_month,department_id,agent_id);
CREATE TABLE ai_usage_ledger (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('CHARGE','ADJUSTMENT')),
 budget_month TEXT NOT NULL,department_id TEXT NOT NULL,agent_id TEXT NOT NULL,task_id TEXT NOT NULL,pricing_id TEXT NOT NULL,
 input_tokens INTEGER,cached_input_tokens INTEGER,output_tokens INTEGER,reasoning_tokens INTEGER,total_tokens INTEGER,tool_calls INTEGER,
 estimated_micros INTEGER NOT NULL,cost_micros INTEGER NOT NULL,usage_status TEXT NOT NULL CHECK(usage_status IN('PROVIDER_REPORTED','ESTIMATED','INVOICE_CONFIRMED')),
 outcome TEXT NOT NULL CHECK(outcome IN('SUCCESS','FAILURE','UNKNOWN')),budget_before INTEGER NOT NULL,budget_after INTEGER NOT NULL,department_before INTEGER NOT NULL,department_after INTEGER NOT NULL,
 evidence TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,request_id) REFERENCES resource_reservations(company_id,id),FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),FOREIGN KEY(company_id,pricing_id) REFERENCES model_pricing(company_id,id)
);
CREATE UNIQUE INDEX resource_one_charge ON ai_usage_ledger(company_id,request_id) WHERE kind='CHARGE';
CREATE INDEX resource_usage_month ON ai_usage_ledger(company_id,budget_month,department_id,agent_id);
CREATE TABLE resource_task_limits (
 company_id TEXT NOT NULL,task_id TEXT NOT NULL,max_cost_micros INTEGER NOT NULL CHECK(max_cost_micros>0),max_calls INTEGER NOT NULL CHECK(max_calls BETWEEN 1 AND 100),
 PRIMARY KEY(company_id,task_id),FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE TABLE resource_incidents (
 id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),agent_id TEXT NOT NULL,request_id TEXT,reason TEXT NOT NULL,created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id),FOREIGN KEY(company_id,request_id) REFERENCES resource_reservations(company_id,id)
);
CREATE TABLE resource_alerts (
 company_id TEXT NOT NULL,budget_month TEXT NOT NULL,subject TEXT NOT NULL,threshold INTEGER NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,budget_month,subject,threshold),FOREIGN KEY(company_id) REFERENCES companies(id)
);
CREATE TRIGGER resource_price_immutable BEFORE UPDATE ON model_pricing BEGIN SELECT RAISE(ABORT,'Pricing is versioned; append a revision'); END;
CREATE TRIGGER resource_price_retained BEFORE DELETE ON model_pricing BEGIN SELECT RAISE(ABORT,'Pricing history retained'); END;
CREATE TRIGGER resource_ledger_immutable BEFORE UPDATE ON ai_usage_ledger BEGIN SELECT RAISE(ABORT,'Cost ledger is append only'); END;
CREATE TRIGGER resource_ledger_retained BEFORE DELETE ON ai_usage_ledger BEGIN SELECT RAISE(ABORT,'Cost ledger retained'); END;
CREATE TRIGGER resource_override_immutable BEFORE UPDATE ON resource_budget_overrides BEGIN SELECT RAISE(ABORT,'Override history retained'); END;
CREATE TRIGGER resource_override_retained BEFORE DELETE ON resource_budget_overrides BEGIN SELECT RAISE(ABORT,'Override history retained'); END;
CREATE TRIGGER resource_reservation_content BEFORE UPDATE OF company_id,id,request_key,budget_month,department_id,agent_id,task_id,pricing_id,estimated_micros,priority,task_type,content_hash,budget_before,department_before,created_by,created_at ON resource_reservations BEGIN SELECT RAISE(ABORT,'Reservation terms are immutable'); END;
CREATE TRIGGER resource_reservation_retained BEFORE DELETE ON resource_reservations BEGIN SELECT RAISE(ABORT,'Reservation history retained'); END;
