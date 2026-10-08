# Phase 12 verification

- npm test: 94 passed, zero failures, including Phase 11 regression coverage.
- npm run check: TypeScript and all browser scripts passed.
- End-to-end fixture tests use public services to create source → reviewed opportunity → brief → simulated generation → QA → product draft → approved campaign → measured aggregates → customer insight → lesson → approved memory/research handoff → new opportunity link.
- Boundaries tested: idempotency/conflicting replay, immutable content, exact approval, expiration/replay, company isolation, mixed simulation rejection, personal-data pattern rejection, human relevance attestation, compliance hold expiration/blocking, cancellation during hold, source dispute/withdrawal and hidden downstream memory, and audit-failure rollback of memory/research/consumption.
- HTTP tests cover unauthenticated and missing-CSRF rejection and successful proposal/approval/promotion plus replay denial.
- Browser at port 3109: used the existing synthetic product/campaign and persona, created a SIMULATION lesson, approved it, consumed approval to create a memory candidate and research question, and verified HYPOTHESIS / NEEDS VERIFICATION in Company memory.
- Screenshot: phase-12-learning.png. Follow-up opportunity linkage is covered by automated service tests; the browser fixture remains RESEARCH_QUEUED.
- No real marketing, publication, provider/model run, customer message or external spending occurred. Publishing is visibly unavailable; no causal result or production readiness is asserted.
