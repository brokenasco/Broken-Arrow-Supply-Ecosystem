# Deployment

Current supported environment: Node 24.15+ on one local machine. Server binds loopback only. Start with npm run setup, then npm start. Do not tunnel this pilot to the internet. /health reports process availability only; it does not assert provider or worker health.

Before hosting: migrate to managed PostgreSQL, introduce OIDC/MFA, HTTPS and Secure cookies, centralized secrets, encrypted object storage, worker leases/outbox, distributed rate limits, monitoring, retention policies and off-host audit storage. Review all external scopes with the CEO. Use separate demo/staging/production databases and credentials. Run sandbox contracts and failure tests before enabling any live writes.

Release gates: locked dependency audit, compiler, tests, UI regression, authorization audit, backup/restore drill, policy/approval review, budget enforcement, webhook failure/replay checks and Shopify sandbox testing. Run migrations as a release step before application startup. Keep previous image and database-compatible rollback available. No cloud resources or deployments were created by this increment.

Phase 15 local controls and an explicit release-gate matrix are documented in HARDENING.md. The CI workflow is configuration only until executed remotely. A passing local suite does not remove the hosting restrictions above.
