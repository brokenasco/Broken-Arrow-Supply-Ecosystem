CREATE TABLE office_meetings (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),topic TEXT NOT NULL,participants TEXT NOT NULL CHECK(json_valid(participants)),
 context TEXT NOT NULL CHECK(json_valid(context)),status TEXT NOT NULL CHECK(status IN('ACTIVE','CLOSED')),summary TEXT,decisions TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,closed_at TEXT,
 PRIMARY KEY(company_id,id)
);
CREATE INDEX office_meeting_status ON office_meetings(company_id,status,created_at);
CREATE TABLE office_meeting_tasks (
 company_id TEXT NOT NULL,meeting_id TEXT NOT NULL,task_id TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,meeting_id,task_id),FOREIGN KEY(company_id,meeting_id) REFERENCES office_meetings(company_id,id),FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE TRIGGER office_meeting_context_immutable BEFORE UPDATE OF id,company_id,topic,participants,context,created_by,created_at ON office_meetings BEGIN SELECT RAISE(ABORT,'Meeting source context is immutable'); END;
CREATE TRIGGER office_meeting_closed_immutable BEFORE UPDATE ON office_meetings WHEN OLD.status='CLOSED' BEGIN SELECT RAISE(ABORT,'Closed meeting history is immutable'); END;
CREATE TRIGGER office_meeting_retained BEFORE DELETE ON office_meetings BEGIN SELECT RAISE(ABORT,'Meeting history retained'); END;
