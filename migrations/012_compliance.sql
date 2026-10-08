CREATE TABLE compliance_settings (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),version INTEGER NOT NULL,require_reviews INTEGER NOT NULL CHECK(require_reviews IN(0,1)),terms TEXT NOT NULL CHECK(json_valid(terms)),brand_guidelines TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE compliance_holds (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),category TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('OPEN','RELEASED')),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,released_at TEXT,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER compliance_holds_bound BEFORE UPDATE OF id,company_id,category,reason,created_by,created_at ON compliance_holds BEGIN SELECT RAISE(ABORT,'Hold content is immutable'); END;
CREATE TABLE compliance_releases (
 id TEXT NOT NULL,company_id TEXT NOT NULL,hold_id TEXT NOT NULL,remediation TEXT NOT NULL,content_hash TEXT NOT NULL,approved_by TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),FOREIGN KEY(company_id,hold_id) REFERENCES compliance_holds(company_id,id)
);
CREATE TRIGGER compliance_releases_bound BEFORE UPDATE OF id,company_id,hold_id,remediation,content_hash,approved_by,expires_at,created_at ON compliance_releases BEGIN SELECT RAISE(ABORT,'Release content is immutable'); END;
CREATE TABLE compliance_reviews (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),kind TEXT NOT NULL,artifact_id TEXT NOT NULL,content_hash TEXT NOT NULL,policy_version INTEGER NOT NULL,
 verdict TEXT NOT NULL CHECK(verdict IN('PASS','BLOCK')),checks TEXT NOT NULL CHECK(json_valid(checks)),note TEXT NOT NULL,reviewed_by TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER compliance_reviews_immutable BEFORE UPDATE ON compliance_reviews BEGIN SELECT RAISE(ABORT,'Compliance reviews are immutable'); END;
CREATE TABLE compliance_audit_reviews (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),start_sequence INTEGER NOT NULL,end_sequence INTEGER NOT NULL,row_count INTEGER NOT NULL,digest TEXT NOT NULL,verdict TEXT NOT NULL,note TEXT NOT NULL,reviewed_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER compliance_audit_reviews_immutable BEFORE UPDATE ON compliance_audit_reviews BEGIN SELECT RAISE(ABORT,'Audit reviews are immutable'); END;
