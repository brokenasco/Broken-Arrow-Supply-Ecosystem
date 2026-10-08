CREATE TABLE organization_reports (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),window_days INTEGER NOT NULL CHECK(window_days IN(7,30,90)),body TEXT NOT NULL CHECK(json_valid(body)),content_hash TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER organization_reports_immutable BEFORE UPDATE ON organization_reports BEGIN SELECT RAISE(ABORT,'Organization reports are immutable'); END;
CREATE TRIGGER organization_reports_retained BEFORE DELETE ON organization_reports BEGIN SELECT RAISE(ABORT,'Organization reports are retained'); END;
CREATE TABLE organization_reviews (
 id TEXT NOT NULL,company_id TEXT NOT NULL,report_id TEXT NOT NULL,subject_kind TEXT NOT NULL CHECK(subject_kind IN('AGENT','RECOMMENDATION')),subject_id TEXT NOT NULL,verdict TEXT NOT NULL,note TEXT NOT NULL,reviewed_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,report_id,subject_kind,subject_id),FOREIGN KEY(company_id,report_id) REFERENCES organization_reports(company_id,id)
);
CREATE TRIGGER organization_reviews_immutable BEFORE UPDATE ON organization_reviews BEGIN SELECT RAISE(ABORT,'Human assessments are immutable'); END;
