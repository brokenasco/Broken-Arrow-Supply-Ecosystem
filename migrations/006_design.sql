CREATE TABLE design_settings (
 company_id TEXT PRIMARY KEY REFERENCES companies(id), provider TEXT NOT NULL CHECK(provider IN('NONE','SIMULATION','OPENAI')),
 daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 0 AND 100), budget_cents INTEGER NOT NULL CHECK(budget_cents BETWEEN 0 AND 100000),
 reservation_cents INTEGER NOT NULL CHECK(reservation_cents BETWEEN 0 AND 10000), max_iterations INTEGER NOT NULL CHECK(max_iterations BETWEEN 1 AND 10),
 categories TEXT NOT NULL CHECK(json_valid(categories)), updated_at TEXT NOT NULL
);
CREATE TABLE design_briefs (
 id TEXT NOT NULL, company_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)), content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), FOREIGN KEY(company_id,opportunity_id) REFERENCES opportunities(company_id,id), FOREIGN KEY(company_id,parent_id) REFERENCES design_briefs(company_id,id)
);
CREATE TRIGGER brief_immutable BEFORE UPDATE ON design_briefs BEGIN SELECT RAISE(ABORT,'Briefs are immutable; create a revision'); END;
CREATE TABLE generation_jobs (
 id TEXT NOT NULL, company_id TEXT NOT NULL, brief_id TEXT NOT NULL, parent_asset_id TEXT, version INTEGER NOT NULL,
 request_key TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN('SIMULATION','OPENAI')), reserved_cents INTEGER NOT NULL CHECK(reserved_cents>=0),
 status TEXT NOT NULL CHECK(status IN('QUEUED','APPROVED','RUNNING','SUCCEEDED','CANCELLED','RECONCILIATION')),
 approved_by TEXT REFERENCES users(id), expires_at INTEGER, consumed_at TEXT, started_at TEXT, finished_at TEXT, error_code TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,request_key), UNIQUE(company_id,brief_id,version),
 FOREIGN KEY(company_id,brief_id) REFERENCES design_briefs(company_id,id), FOREIGN KEY(company_id,parent_asset_id) REFERENCES design_assets(company_id,id)
);
CREATE TRIGGER generation_content_immutable BEFORE UPDATE OF id,company_id,brief_id,parent_asset_id,version,request_key,payload,payload_hash,provider,reserved_cents,created_at ON generation_jobs BEGIN SELECT RAISE(ABORT,'Generation content is immutable'); END;
CREATE TABLE design_assets (
 id TEXT NOT NULL, company_id TEXT NOT NULL, job_id TEXT NOT NULL, brief_id TEXT NOT NULL, version INTEGER NOT NULL,
 content BLOB NOT NULL, content_hash TEXT NOT NULL, mime TEXT NOT NULL CHECK(mime='image/png'), width INTEGER NOT NULL, height INTEGER NOT NULL,
 alpha_channel INTEGER NOT NULL, simulation INTEGER NOT NULL CHECK(simulation IN(0,1)), provider_ref TEXT NOT NULL,
 usage TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('PENDING','PASS','REVISE','REJECT')), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,job_id), FOREIGN KEY(company_id,job_id) REFERENCES generation_jobs(company_id,id), FOREIGN KEY(company_id,brief_id) REFERENCES design_briefs(company_id,id)
);
CREATE TRIGGER asset_content_immutable BEFORE UPDATE OF id,company_id,job_id,brief_id,version,content,content_hash,mime,width,height,alpha_channel,simulation,provider_ref,usage,created_at ON design_assets BEGIN SELECT RAISE(ABORT,'Asset content is immutable'); END;
CREATE TABLE design_reviews (
 id TEXT NOT NULL, company_id TEXT NOT NULL, asset_id TEXT NOT NULL, content_hash TEXT NOT NULL, verdict TEXT NOT NULL CHECK(verdict IN('PASS','REVISE','REJECT')),
 checks TEXT NOT NULL CHECK(json_valid(checks)), note TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,asset_id), FOREIGN KEY(company_id,asset_id) REFERENCES design_assets(company_id,id)
);
CREATE TABLE generation_reconciliations (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT NOT NULL, actual_cents INTEGER NOT NULL CHECK(actual_cents>=0), evidence TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(company_id,job_id), FOREIGN KEY(company_id,job_id) REFERENCES generation_jobs(company_id,id)
);
CREATE TRIGGER qa_reviews_immutable BEFORE UPDATE ON design_reviews BEGIN SELECT RAISE(ABORT,'QA reviews are immutable'); END;
CREATE TRIGGER reconciliations_immutable BEFORE UPDATE ON generation_reconciliations BEGIN SELECT RAISE(ABORT,'Billing records are immutable'); END;
