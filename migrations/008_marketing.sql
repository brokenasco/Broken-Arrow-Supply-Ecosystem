CREATE TABLE campaigns (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), parent_id TEXT,
 request_key TEXT NOT NULL, input_hash TEXT NOT NULL, title TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('DRAFT','APPROVED','READY','CANCELLED','COMPLETED')),
 approved_by TEXT REFERENCES users(id), expires_at INTEGER, consumed_at TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,request_key),
 FOREIGN KEY(company_id,parent_id) REFERENCES campaigns(company_id,id)
);
CREATE TRIGGER campaigns_immutable BEFORE UPDATE OF id,company_id,parent_id,request_key,input_hash,title,body,content_hash,created_at ON campaigns BEGIN SELECT RAISE(ABORT,'Campaign content is immutable; create a revision'); END;
CREATE TABLE campaign_results (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, campaign_id TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), created_at TEXT NOT NULL,
 UNIQUE(company_id,campaign_id), FOREIGN KEY(company_id,campaign_id) REFERENCES campaigns(company_id,id)
);
CREATE TRIGGER campaign_results_immutable BEFORE UPDATE ON campaign_results BEGIN SELECT RAISE(ABORT,'Results are immutable'); END;
CREATE TRIGGER campaign_results_no_delete BEFORE DELETE ON campaign_results BEGIN SELECT RAISE(ABORT,'Results are retained'); END;
