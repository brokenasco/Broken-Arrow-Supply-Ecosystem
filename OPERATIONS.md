# Local operations

Phase 2: configure server-side Shopify credentials using SHOPIFY.md, authorize reads in the Shopify store screen, then run a manual sync. The previous successful snapshot remains until the new sync commits. Inspect scope/auth errors and stale markers instead of treating failed reads as zero sales. Stop/disconnect invalidates active sync commits. Disconnect is local only; revoke credentials in Shopify separately. No automatic sync schedule is installed.

Start: npm run setup once, then npm start. Login uses the credentials entered locally. Stop the process with Ctrl+C. Persistent data stays in data/company.sqlite. The server does not autonomously execute agents. Status messaging is not a model integration.

Emergency stop is the header control. It writes company.stopped and audit in one transaction. Company resume preserves individually paused departments and agents. CEO administration and viewing remain available while paused. Approval and task records are not deleted.

For a consistent backup in this pilot: stop the application cleanly, preserve the complete data directory (including any WAL files), store the copy securely, restart. Restore to a separate directory first, point DATABASE_PATH there, and verify login, company state and audit history before replacing active data. Online backup automation, encryption and restore drills are not yet implemented. Never blindly copy only the database file while WAL writes are active.

Troubleshooting: sign-in required -> use setup credentials; 403 Origin -> match APP_ORIGIN to the browser URL; 403 CSRF -> sign in again; missing metrics -> expected until Shopify Phase 2; BLOCKED task -> expected without worker; expired approval -> create a new proposal; database lock -> avoid multiple writers and inspect running processes; unknown error -> inspect server logs without pasting secrets.

Phase 10 event inbox operations and Shopify webhook configuration are documented in OPERATIONS_EVENTS.md. Manual event processing is separate from the Phase 2 read sync and does not rewrite its cache. Live ingress/subscriptions remain unconfigured.

Phase 15 adds consistent online encrypted snapshots and isolated restore inspection through npm run recovery. Follow HARDENING.md; the earlier manual cold-copy procedure remains a fallback. Do not start a restored copy with provider credentials or active schedules.
