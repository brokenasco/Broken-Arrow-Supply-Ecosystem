CREATE TABLE security_passkeys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),public_key BLOB NOT NULL,counter INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE security_challenges(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN('REGISTER','AUTHENTICATE')),challenge TEXT NOT NULL,origin TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE authentication_events(id TEXT PRIMARY KEY,company_id TEXT REFERENCES companies(id),user_id TEXT REFERENCES users(id),outcome TEXT NOT NULL CHECK(outcome IN('LOGIN_SUCCESS','LOGIN_FAILURE')),created_at TEXT NOT NULL);
CREATE TRIGGER authentication_events_immutable BEFORE UPDATE ON authentication_events BEGIN SELECT RAISE(ABORT,'Authentication evidence immutable'); END;
CREATE TRIGGER authentication_events_retained BEFORE DELETE ON authentication_events BEGIN SELECT RAISE(ABORT,'Authentication evidence retained'); END;
