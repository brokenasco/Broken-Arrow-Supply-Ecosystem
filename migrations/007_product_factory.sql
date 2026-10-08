CREATE TABLE product_templates (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), title TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER product_templates_immutable BEFORE UPDATE ON product_templates BEGIN SELECT RAISE(ABORT,'Templates are immutable; create a new version'); END;
CREATE TABLE product_write_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id), domain TEXT NOT NULL, currency TEXT NOT NULL, scopes TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), generation INTEGER NOT NULL, verified_at TEXT NOT NULL, authorized_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE product_proposals (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), template_id TEXT NOT NULL, asset_id TEXT NOT NULL,
 parent_id TEXT, request_key TEXT NOT NULL, input_hash TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('SIMULATION','SHOPIFY')),
 title TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), payload_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('PROPOSED','APPROVED','CHECKING','DISPATCHING','SIMULATED','DRAFT_CREATED','BLOCKED','RECONCILIATION','CANCELLED')),
 approved_by TEXT REFERENCES users(id), expires_at INTEGER, consumed_at TEXT, started_at TEXT, finished_at TEXT, remote_id TEXT, error_code TEXT, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,request_key),
 FOREIGN KEY(company_id,template_id) REFERENCES product_templates(company_id,id), FOREIGN KEY(company_id,asset_id) REFERENCES design_assets(company_id,id), FOREIGN KEY(company_id,parent_id) REFERENCES product_proposals(company_id,id)
);
CREATE TRIGGER product_proposals_immutable BEFORE UPDATE OF id,company_id,template_id,asset_id,parent_id,request_key,input_hash,mode,title,payload,payload_hash,created_at ON product_proposals BEGIN SELECT RAISE(ABORT,'Product content is immutable; create a new proposal'); END;
CREATE TABLE product_events (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, proposal_id TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,proposal_id) REFERENCES product_proposals(company_id,id)
);
