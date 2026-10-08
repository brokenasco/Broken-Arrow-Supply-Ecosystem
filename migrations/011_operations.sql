CREATE TABLE operations_connections (
 company_id TEXT PRIMARY KEY REFERENCES companies(id),domain TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),authorized_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
CREATE TABLE operations_events (
 id TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id),domain TEXT NOT NULL,event_id TEXT NOT NULL,topic TEXT NOT NULL,body_hash TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),
 simulation INTEGER NOT NULL CHECK(simulation IN(0,1)),status TEXT NOT NULL CHECK(status IN('RECEIVED','PROCESSED','IGNORED_OLDER')),created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,domain,event_id,topic,simulation)
);
CREATE TRIGGER operations_events_immutable BEFORE UPDATE OF id,company_id,domain,event_id,topic,body_hash,body,simulation,created_at ON operations_events BEGIN SELECT RAISE(ABORT,'Event envelopes are immutable'); END;
CREATE TABLE operations_latest (
 company_id TEXT NOT NULL,domain TEXT NOT NULL,simulation INTEGER NOT NULL,entity TEXT NOT NULL,observed_at TEXT NOT NULL,event_id TEXT NOT NULL,
 PRIMARY KEY(company_id,domain,simulation,entity)
);
CREATE TABLE operations_alerts (
 id TEXT NOT NULL,company_id TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,severity TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,event_id),FOREIGN KEY(company_id,event_id) REFERENCES operations_events(company_id,id)
);
CREATE TABLE operations_incidents (
 id TEXT NOT NULL,company_id TEXT NOT NULL,alert_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('OPEN','ESCALATED','RESOLVED')),owner TEXT NOT NULL CHECK(owner IN('rachel','sergey','ceo')),note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 PRIMARY KEY(company_id,id),UNIQUE(company_id,alert_id),FOREIGN KEY(company_id,alert_id) REFERENCES operations_alerts(company_id,id)
);
