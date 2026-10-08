CREATE TABLE learning_cycles (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),request_key TEXT NOT NULL,input_hash TEXT NOT NULL,
 campaign_id TEXT NOT NULL,customer_document_id TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('PROPOSED','APPROVED','RESEARCH_QUEUED','CANCELLED')),approved_by TEXT REFERENCES users(id),expires_at INTEGER,consumed_at TEXT,memory_id TEXT,research_id TEXT,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,request_key),FOREIGN KEY(company_id,campaign_id) REFERENCES campaigns(company_id,id),FOREIGN KEY(company_id,customer_document_id) REFERENCES customer_documents(company_id,id),FOREIGN KEY(company_id,memory_id) REFERENCES memory_items(company_id,id),FOREIGN KEY(company_id,research_id) REFERENCES research_items(company_id,id)
);
CREATE TRIGGER learning_content_immutable BEFORE UPDATE OF id,company_id,request_key,input_hash,campaign_id,customer_document_id,title,body,content_hash,created_at ON learning_cycles BEGIN SELECT RAISE(ABORT,'Learning content is immutable; propose a new cycle'); END;
CREATE TABLE learning_followups (
 company_id TEXT NOT NULL,cycle_id TEXT NOT NULL,opportunity_id TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,cycle_id),FOREIGN KEY(company_id,cycle_id) REFERENCES learning_cycles(company_id,id),FOREIGN KEY(company_id,opportunity_id) REFERENCES opportunities(company_id,id)
);
CREATE TRIGGER learning_followups_immutable BEFORE UPDATE ON learning_followups BEGIN SELECT RAISE(ABORT,'Research handoffs are immutable'); END;
