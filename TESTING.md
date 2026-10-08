# Testing strategy and evidence

Phase 2 adds tests/shopify.test.ts: synthetic GraphQL contracts for all resource pages and nested pages, scope/identity checks before reads, exact money parsing, timezone/DST boundaries, customer opt-in, tenant isolation, retries/redaction, failed-commit rollback, lease recovery, stop/disconnect races, freshness and authenticated routes. This is not live Shopify verification. Read docs/VERIFICATION_PHASE_2.md for current evidence.

Run npm ci to install locked development dependencies, npm test for Node tests, npm run check for strict TypeScript checking and browser syntax, and npm run format:check for formatting. Tests create in-memory or isolated temporary databases, never mutate the real company database, and make no live provider calls.

Coverage: 23-role registry, independent compliance hierarchy, password/session behavior, denied tools, company/department/agent pause, external-write denial, no agent/self approval, exact payload hash and expiry, replay rejection, tenant isolation, task deduplication/lineage/cancellation, atomic rollback, immutable audits, evidence validation, honest missing-provider results, authenticated duplicate webhook receipt, persistence across reopen, API authentication/origin/CSRF/method checks and logout invalidation.

These tests validate a control plane, not a production agent runtime. Tests of CONSUMED approvals validate rejection of consumed state; automatic consumption/dispatch is not implemented. Webhook tests validate receipt only, not asynchronous processing. Shopify, real AI output validation, provider failures after dispatch, budget races, background worker leases, customer privacy lifecycle, backup restore under load and production scale are future mandatory gates.

Browser acceptance checklist: sign in/out; verify no fabricated KPIs; inspect employee profile and manager; save project/task; submit and decide proposal; add knowledge and research; ask Борис status; pause/resume employee and department; emergency stop and reload; inspect audit trail; test responsive navigation and keyboard focus. Evidence and results are recorded in docs/VERIFICATION.md after execution.
