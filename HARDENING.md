# Phase 15: Production hardening and release gates

Status: local hardening implemented; production release BLOCKED. This phase provides executable checks and recovery tooling, not authorization to host the pilot publicly. The server remains loopback-only. `/health` explicitly returns `productionReady: false` and does not certify integrations.

## Implemented controls

- HTTP request timeout 30 seconds, header timeout 10 seconds, idle socket timeout 30 seconds, keep-alive timeout 5 seconds, 16 KiB header limit and 100 requests per socket. Existing body limits, CSP, exact Origin, session and CSRF checks remain.
- SQLite online backup API creates a consistent snapshot including committed WAL state. AES-256-GCM encrypts the snapshot with a random nonce and authenticated format header. A separate 32-byte key is required. Archive creation and restoration use exclusive file creation and never overwrite existing files.
- Restore is inspection-only: validates SQLite integrity, foreign keys, supported migration sequence and presence of audit update/delete protection. It does not migrate, start workers or change the source database. Audit protection presence is not a cryptographic audit-history attestation.
- Pattern-based source secret scan reports file names only. It excludes runtime environment files, databases, Git history and ignored directories. It detects a limited set of common credential signatures; a clean scan is not proof that secrets are absent.
- CI configuration runs locked install without lifecycle scripts, dependency advisory audit, source scan, type/script checks, formatting and tests. The workflow is authored locally; no remote CI execution or deployment is claimed.

## Backup and recovery procedure

Run from the repository root as the trusted local filesystem administrator. This is an offline operations tool with access to the entire installation, not a tenant API. It writes no company business records. Keep runtime data and the `data/backup-work` directory restricted to the OS account. POSIX mode bits are not a substitute for verifying Windows NTFS ACLs.

Supply `BACKUP_KEY` through the process environment from a secret manager: exactly 64 hexadecimal characters representing 32 cryptographically random bytes. Never put it in a command argument, source file, report or chat. Store the key separately from the archive; losing it makes recovery impossible.

```
npm run recovery -- backup data/company.sqlite data/recovery-unique.cosbak
npm run recovery -- restore-inspect data/recovery-unique.cosbak data/inspection-unique.sqlite
```

The tool temporarily writes a plaintext SQLite snapshot under `data/backup-work` and removes that temporary directory in a finally block. A process or machine crash may leave a snapshot behind. Filesystem deletion is not secure erasure; use OS disk encryption and verified private ACLs. Whole-file encryption currently loads the snapshot into memory, so this is a bounded local-pilot tool, not a large-database backup service. Backups include password hashes, session records and any retained customer evidence; treat them as sensitive even when encrypted.

A restored copy preserves sessions, approvals, schedules and integration metadata as historical evidence. **Do not run the application or workers against it or connect provider credentials.** Successful integrity inspection does not reconcile external writes that happened after the backup. A controlled failover must first revoke old sessions/approvals, reauthorize schedules, reconcile uncertain provider actions and apply privacy deletion obligations. Automated failover is not implemented.

For rollback, preserve the pre-change encrypted backup and matching source/lockfile release. Restore to a new inspection path and compare schema and evidence. Never run an older release against a newer schema or overwrite the active database as a rollback shortcut. No destructive down migrations are supplied.

## Audit and release evidence

| Gate | Local evidence | Remaining release requirement |
| --- | --- | --- |
| Authorization and permissions | Session/CSRF and tenant tests; persisted CEO guard; fixed scheduler allowlist; no agent approval API | Independent security review and hosted identity/MFA |
| Failure, rollback and stop | Transaction/audit rollback, uncertain provider results, company/agent stop and in-flight stop fixtures | Hosted failure and deployment rollback drill |
| Webhook replay | HMAC, tenant binding, duplicate event and processing tests | Real configured Shopify sandbox delivery |
| AI budgets | Reservation, approval expiry/replay, schedule run limits and failure-pause tests | Provider invoice reconciliation and live budget acceptance |
| Backup and restore | Encrypted snapshot roundtrip with committed WAL data, audit count, integrity, corruption/wrong-key/overwrite rejection | Off-host encrypted storage, key recovery, retention and RPO/RTO drill |
| Dependencies | npm audit passed with zero reported vulnerabilities on 2026-10-04 | Re-run on each release; pin/review CI action provenance |
| Secrets | Source pattern scan passed | Runtime secrets, Git history and secret-manager review |
| Privacy | Existing redaction/withdrawal and simulation separation tests | Erasure/retention across source data, derived reports, backups and providers |
| Audit | Immutable SQL triggers and same-transaction rollback tests | Independent off-host tamper-evident retention |
| Load | 100 local HTTP requests in batches of 20; limits and unauthenticated access verified | Authenticated realistic datasets, sustained load, latency SLOs and multi-instance capacity |
| UI | Existing static asset/API contract coverage; previous phase browser verification | Full cross-browser/accessibility/mobile regression before release |
| Shopify sandbox | Mock contract and failure tests only | Human-authorized live sandbox credentials and acceptance evidence |

PostgreSQL migration, OIDC/MFA, centralized rate limiting/secrets, production TLS, private object storage, durable distributed workers and independent penetration testing remain release blockers. Do not infer production readiness from passing unit tests.
