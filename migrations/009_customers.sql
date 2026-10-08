CREATE TABLE customer_evidence (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),request_key TEXT NOT NULL,input_hash TEXT NOT NULL,
 title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),status TEXT NOT NULL CHECK(status IN('UNVERIFIED','VERIFIED','DISPUTED','WITHDRAWN')),
 review_note TEXT,created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),UNIQUE(company_id,request_key)
);
CREATE TRIGGER customer_evidence_immutable BEFORE UPDATE OF id,company_id,request_key,input_hash,title,body,created_at ON customer_evidence BEGIN SELECT RAISE(ABORT,'Evidence snapshots are immutable'); END;
CREATE TABLE customer_documents (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),kind TEXT NOT NULL CHECK(kind IN('PERSONA','INSIGHT')),parent_id TEXT,version INTEGER NOT NULL,
 title TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),UNIQUE(company_id,parent_id),
 FOREIGN KEY(company_id,parent_id) REFERENCES customer_documents(company_id,id)
);
CREATE TRIGGER customer_documents_immutable BEFORE UPDATE ON customer_documents BEGIN SELECT RAISE(ABORT,'Create a new document version'); END;
CREATE TABLE customer_document_sources (
 company_id TEXT NOT NULL,document_id TEXT NOT NULL,evidence_id TEXT NOT NULL,PRIMARY KEY(company_id,document_id,evidence_id),
 FOREIGN KEY(company_id,document_id) REFERENCES customer_documents(company_id,id),FOREIGN KEY(company_id,evidence_id) REFERENCES customer_evidence(company_id,id)
);
CREATE TABLE support_cases (
 id TEXT NOT NULL,company_id TEXT NOT NULL,evidence_id TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,
 rationale TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('OPEN','CLOSED')),created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),UNIQUE(company_id,evidence_id),
 FOREIGN KEY(company_id,evidence_id) REFERENCES customer_evidence(company_id,id)
);
CREATE TABLE support_drafts (
 id TEXT NOT NULL,company_id TEXT NOT NULL,case_id TEXT NOT NULL,body TEXT NOT NULL,content_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('DRAFT','REVIEWED','REJECTED')),review_note TEXT,created_at TEXT NOT NULL,PRIMARY KEY(company_id,id),
 FOREIGN KEY(company_id,case_id) REFERENCES support_cases(company_id,id)
);
CREATE TRIGGER support_drafts_immutable BEFORE UPDATE OF id,company_id,case_id,body,content_hash,created_at ON support_drafts BEGIN SELECT RAISE(ABORT,'Create a new support draft'); END;
