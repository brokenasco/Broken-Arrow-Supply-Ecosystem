# Phase 4–5 verification

Verified during the 2026-10-02 America/New_York session (2026-10-03 UTC), Node 24.15.0.

- `npm test`: **53 tests pass**, including 14 new research/design tests.
- `npm run check`: TypeScript and both browser-script syntax checks pass.
- `npm run format:check`: pass.
- Phase 4 coverage: immutable source evidence, safe URL/date handling, human verification versus freshness, ordered handoffs, disputed evidence, tenant ownership, descriptive trends, duplicate observations, pauses and audit rollback.
- Phase 5 coverage: actual persisted CEO identity, immutable single-use approval, expiry, payload mismatch, idempotent queueing, iterations, daily limits, budget reservations, uncertain outcomes, interruption recovery, previously queued work blocked by unreconciled outcomes, in-flight stop, private tenant-scoped PNG serving, PNG corruption/size checks, QA gates, exact duplicate rejection, and asset/audit rollback.
- OpenAI adapter contract tested with a mock transport: fixed official endpoint, no redirects, bounded PNG/base64 response and no automatic retries. **No live provider call was made.** Test fixtures impersonate responses only inside tests; they are not evidence of account availability, successful live generation or print quality.
- Browser verification used a separate synthetic workspace on port 3102. Registered a synthetic competitor source and observed UNVERIFIED status. Inspected an exact simulation proposal, approved it, ran it, observed a persisted PNG asset and recorded a REVISE QA outcome. The source, company and asset all remain visibly synthetic.
- Screenshots: `phase-4-research.png`, `phase-5-design-studio.png`. The existing company on port 3101 retained its pause settings.
- Not verified: real store research, automated search, model-authored research, paid image generation, provider invoices, automated visual/IP review, pixel-preserving editing, print fulfillment, scheduled generation or publishing. These are not represented as completed external integrations.
