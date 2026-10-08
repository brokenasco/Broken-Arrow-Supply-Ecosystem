CREATE TABLE memo_department_codes (
 company_id TEXT NOT NULL, department_id TEXT NOT NULL, code TEXT NOT NULL,
 PRIMARY KEY(company_id,department_id), UNIQUE(company_id,code),
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id)
);
CREATE TABLE memo_type_codes (code TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO memo_type_codes VALUES ('TOK','Token expenditure'),('AEV','Agent evaluation'),('DEV','Department head evaluation'),('REA','Allocation recommendation'),('APR','Approval request'),('OPS','Operations'),('RSK','Risk'),('SEC','Security'),('PER','Performance'),('REC','Recommendation'),('INC','Incident'),('POL','Policy'),('SYS','System'),('GEN','General'),('URG','Urgent');
CREATE TABLE executive_memos (
 company_id TEXT NOT NULL REFERENCES companies(id), id TEXT NOT NULL, department_id TEXT NOT NULL,
 type TEXT NOT NULL REFERENCES memo_type_codes(code), author_id TEXT NOT NULL, author_name TEXT NOT NULL, author_role TEXT NOT NULL,
 subject TEXT NOT NULL, priority TEXT NOT NULL CHECK(priority IN('ROUTINE','INFORMATION','RECOMMENDATION','ACTION REQUIRED','URGENT')),
 body TEXT NOT NULL CHECK(json_valid(body)), action_required INTEGER NOT NULL CHECK(action_required IN(0,1)),
 parent_id TEXT, relation TEXT CHECK(relation IN('REVISION','ADDENDUM')), created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id), FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id),
 FOREIGN KEY(company_id,author_id) REFERENCES agents(company_id,id), FOREIGN KEY(company_id,parent_id) REFERENCES executive_memos(company_id,id),
 CHECK((parent_id IS NULL AND relation IS NULL) OR (parent_id IS NOT NULL AND relation IS NOT NULL))
);
CREATE TABLE memo_review_events (
 id INTEGER PRIMARY KEY, company_id TEXT NOT NULL, memo_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('UNREAD','REVIEWED','ACTION REQUIRED','MODIFICATION REQUESTED','CLOSED','ARCHIVED')),
 reason TEXT NOT NULL, actor TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,memo_id) REFERENCES executive_memos(company_id,id)
);
CREATE INDEX memo_inbox ON executive_memos(company_id,created_at,department_id,type);
CREATE INDEX memo_latest_review ON memo_review_events(company_id,memo_id,id DESC);
CREATE VIRTUAL TABLE memo_search USING fts5(company_id UNINDEXED,memo_id,subject,body,tokenize='unicode61');
CREATE TRIGGER memo_index AFTER INSERT ON executive_memos BEGIN INSERT INTO memo_search(company_id,memo_id,subject,body) VALUES(NEW.company_id,NEW.id,NEW.subject,NEW.body); END;
CREATE TRIGGER memo_immutable_update BEFORE UPDATE ON executive_memos BEGIN SELECT RAISE(ABORT,'Submitted memos are immutable; create revision or addendum'); END;
CREATE TRIGGER memo_immutable_delete BEFORE DELETE ON executive_memos BEGIN SELECT RAISE(ABORT,'Archive official memos instead'); END;
CREATE TRIGGER memo_review_immutable_update BEFORE UPDATE ON memo_review_events BEGIN SELECT RAISE(ABORT,'Memo history is append only'); END;
CREATE TRIGGER memo_review_immutable_delete BEFORE DELETE ON memo_review_events BEGIN SELECT RAISE(ABORT,'Memo history is append only'); END;
