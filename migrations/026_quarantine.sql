CREATE TABLE agent_quarantine_holds (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL,
 reason TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,agent_id) REFERENCES agents(company_id,id)
);
CREATE INDEX quarantine_agent ON agent_quarantine_holds(company_id,agent_id,created_at);
CREATE TABLE agent_quarantine_releases (
 hold_id TEXT PRIMARY KEY REFERENCES agent_quarantine_holds(id),
 released_by TEXT NOT NULL REFERENCES users(id), released_at TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TRIGGER quarantine_hold_immutable BEFORE UPDATE ON agent_quarantine_holds BEGIN SELECT RAISE(ABORT,'Quarantine evidence immutable'); END;
CREATE TRIGGER quarantine_hold_retained BEFORE DELETE ON agent_quarantine_holds BEGIN SELECT RAISE(ABORT,'Quarantine evidence retained'); END;
CREATE TRIGGER quarantine_release_immutable BEFORE UPDATE ON agent_quarantine_releases BEGIN SELECT RAISE(ABORT,'Release evidence immutable'); END;
CREATE TRIGGER quarantine_release_retained BEFORE DELETE ON agent_quarantine_releases BEGIN SELECT RAISE(ABORT,'Release evidence retained'); END;
