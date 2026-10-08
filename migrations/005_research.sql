CREATE TABLE research_sources (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), kind TEXT NOT NULL CHECK(kind IN('MARKET','COMPETITOR','TREND','DESIGN')),
 title TEXT NOT NULL, url TEXT NOT NULL, publisher TEXT NOT NULL, excerpt TEXT NOT NULL, content_hash TEXT NOT NULL,
 published_at TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('UNVERIFIED','VERIFIED','DISPUTED')), review_note TEXT, created_by TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(company_id,id)
);
CREATE TRIGGER research_source_content BEFORE UPDATE OF id,company_id,kind,title,url,publisher,excerpt,content_hash,published_at,retrieved_at,expires_at,created_by ON research_sources BEGIN SELECT RAISE(ABORT,'Source evidence is immutable; add a new record'); END;
CREATE TABLE research_trends (
 id TEXT NOT NULL, company_id TEXT NOT NULL, source_id TEXT NOT NULL, series TEXT NOT NULL, unit TEXT NOT NULL,
 observed_on TEXT NOT NULL, value REAL NOT NULL CHECK(value>=0), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), UNIQUE(company_id,series,unit,observed_on),
 FOREIGN KEY(company_id,source_id) REFERENCES research_sources(company_id,id)
);
CREATE TABLE opportunities (
 id TEXT NOT NULL, company_id TEXT NOT NULL REFERENCES companies(id), parent_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
 stage TEXT NOT NULL CHECK(stage IN('MASON','MARISHA','ALEX','BORIS','READY','REJECTED')), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), FOREIGN KEY(company_id,parent_id) REFERENCES opportunities(company_id,id)
);
CREATE TRIGGER opportunity_content BEFORE UPDATE OF id,company_id,parent_id,title,body,created_at ON opportunities BEGIN SELECT RAISE(ABORT,'Opportunity content is immutable; create a revision'); END;
CREATE TABLE opportunity_sources (
 company_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, source_id TEXT NOT NULL,
 PRIMARY KEY(company_id,opportunity_id,source_id), FOREIGN KEY(company_id,opportunity_id) REFERENCES opportunities(company_id,id), FOREIGN KEY(company_id,source_id) REFERENCES research_sources(company_id,id)
);
CREATE TABLE research_handoffs (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, from_stage TEXT NOT NULL, to_stage TEXT NOT NULL, note TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,opportunity_id) REFERENCES opportunities(company_id,id)
);
CREATE TABLE research_source_reviews (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL,
 actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,source_id) REFERENCES research_sources(company_id,id)
);
CREATE TRIGGER source_reviews_immutable BEFORE UPDATE ON research_source_reviews BEGIN SELECT RAISE(ABORT,'Source reviews are immutable'); END;
CREATE TRIGGER research_handoffs_immutable BEFORE UPDATE ON research_handoffs BEGIN SELECT RAISE(ABORT,'Handoffs are immutable'); END;
CREATE TRIGGER trend_observations_immutable BEFORE UPDATE ON research_trends BEGIN SELECT RAISE(ABORT,'Trend observations are immutable'); END;
