CREATE TABLE skd_metadata (
 company_id TEXT NOT NULL,memory_id TEXT NOT NULL,agent_id TEXT NOT NULL,department TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope IN('AGENT_PRIVATE','DEPARTMENT','ORGANIZATION','EXECUTIVE','SECURITY_RESTRICTED','SYSTEM')),
 knowledge_type TEXT NOT NULL,sensitivity TEXT NOT NULL CHECK(sensitivity IN('INTERNAL','RESTRICTED')),
 summary TEXT NOT NULL,source_type TEXT NOT NULL,topic TEXT NOT NULL,project_id TEXT,
 importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 5),version INTEGER NOT NULL DEFAULT 1,
 content_hash TEXT NOT NULL,verified_by TEXT REFERENCES users(id),last_verified_at TEXT,
 metadata TEXT NOT NULL CHECK(json_valid(metadata)),retrieval_count INTEGER NOT NULL DEFAULT 0,last_accessed_at TEXT,
 PRIMARY KEY(company_id,memory_id),FOREIGN KEY(company_id,memory_id) REFERENCES memory_items(company_id,id),
 FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id),FOREIGN KEY(company_id,department) REFERENCES departments(company_id,id),FOREIGN KEY(company_id,project_id) REFERENCES projects(company_id,id)
);
CREATE INDEX skd_scope ON skd_metadata(company_id,scope,department,agent_id);
CREATE INDEX skd_hash ON skd_metadata(company_id,content_hash);
CREATE INDEX skd_type_topic ON skd_metadata(company_id,knowledge_type,topic);
CREATE TABLE skd_versions(id TEXT NOT NULL,company_id TEXT NOT NULL,memory_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),content_hash TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),UNIQUE(company_id,memory_id,version),FOREIGN KEY(company_id,memory_id) REFERENCES skd_metadata(company_id,memory_id));
CREATE TRIGGER skd_version_immutable BEFORE UPDATE ON skd_versions BEGIN SELECT RAISE(ABORT,'Knowledge versions are immutable'); END;
CREATE TRIGGER skd_version_retained BEFORE DELETE ON skd_versions BEGIN SELECT RAISE(ABORT,'Knowledge history is retained'); END;
CREATE TABLE skd_relations(id TEXT NOT NULL,company_id TEXT NOT NULL,left_id TEXT NOT NULL,right_id TEXT NOT NULL,left_version INTEGER NOT NULL,right_version INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN('CONTRADICTS','SUPPORTS','DERIVED_FROM','RELATED_TO','DUPLICATE_CANDIDATE')),status TEXT NOT NULL CHECK(status IN('OPEN','RESOLVED')),resolution TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),CHECK(left_id<>right_id),FOREIGN KEY(company_id,left_id,left_version) REFERENCES skd_versions(company_id,memory_id,version),FOREIGN KEY(company_id,right_id,right_version) REFERENCES skd_versions(company_id,memory_id,version));
CREATE INDEX skd_conflicts ON skd_relations(company_id,kind,status,left_id,right_id);
CREATE TABLE skd_feedback(id TEXT PRIMARY KEY,company_id TEXT NOT NULL,memory_id TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN('USEFUL','OUTDATED','INCORRECT','DUPLICATE','INCOMPLETE','CONTRADICTORY')),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,FOREIGN KEY(company_id,memory_id,version) REFERENCES skd_versions(company_id,memory_id,version));
CREATE TABLE skd_searches(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),route TEXT NOT NULL,result_count INTEGER NOT NULL,duration_ms REAL NOT NULL,returned_bytes INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX skd_search_time ON skd_searches(company_id,created_at);
CREATE INDEX skd_review_due ON memory_items(company_id,review_at,id);
CREATE VIRTUAL TABLE skd_fts USING fts5(title,body,summary,topic,tokenize='unicode61');
CREATE TRIGGER skd_index_create AFTER INSERT ON skd_metadata BEGIN
 INSERT INTO skd_fts(rowid,title,body,summary,topic) SELECT m.rowid,m.title,m.body,NEW.summary,NEW.topic FROM memory_items m WHERE m.company_id=NEW.company_id AND m.id=NEW.memory_id;
END;
CREATE TRIGGER skd_index_memory AFTER UPDATE OF title,body ON memory_items WHEN EXISTS(SELECT 1 FROM skd_metadata k WHERE k.company_id=NEW.company_id AND k.memory_id=NEW.id) BEGIN
 DELETE FROM skd_fts WHERE rowid=NEW.rowid;
 INSERT INTO skd_fts(rowid,title,body,summary,topic) SELECT NEW.rowid,NEW.title,NEW.body,k.summary,k.topic FROM skd_metadata k WHERE k.company_id=NEW.company_id AND k.memory_id=NEW.id;
END;
CREATE TRIGGER skd_index_metadata AFTER UPDATE OF summary,topic ON skd_metadata BEGIN
 DELETE FROM skd_fts WHERE rowid=(SELECT rowid FROM memory_items WHERE company_id=NEW.company_id AND id=NEW.memory_id);
 INSERT INTO skd_fts(rowid,title,body,summary,topic) SELECT m.rowid,m.title,m.body,NEW.summary,NEW.topic FROM memory_items m WHERE m.company_id=NEW.company_id AND m.id=NEW.memory_id;
END;
