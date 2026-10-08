# Phase 7 verification — 2026-10-03

- npm test: 64 passing, zero failures.
- npm run check: passed (TypeScript plus all browser script syntax checks).
- Marketing fixtures cover immutable content, request idempotency, template labeling, single-use approvals, RED acknowledgement, expiration, stop/cancellation, tenant isolation, disputed evidence, invalid dates, transactional audit rollback, measurement denominators and completion, HTTP authentication/CSRF and absent external dispatch.
- Browser preview at http://127.0.0.1:3104/#marketing: created a synthetic campaign against the existing simulation product/source, approved it, marked it internally READY, then recorded final synthetic A/B aggregates and lessons. UI showed COMPLETED, 10% and 12% conversion, unavailable ROAS and an explicit no-significance statement.
- Browser testing found and fixed first-campaign optional-parent validation and empty optional-copy overrides. Successful submission was rechecked after the fix.
- Screenshot: phase-7-marketing.png.

No actual campaign was sent, published, launched or funded. No external analytics or model execution was performed. Measurements are human-reported fixtures. Calendar dates do not activate a scheduler. Existing Phase 6 media-upload and print-provider limitations remain.
