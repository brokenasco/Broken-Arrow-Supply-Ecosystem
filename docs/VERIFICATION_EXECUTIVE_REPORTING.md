# Executive reporting verification

Verified with Node 24.15 and isolated SQLite databases. No operational database was opened or migrated; no paid provider call was made.

- `npm test`: 149 passed, zero failures.
- `npm run check`: passed TypeScript and browser JavaScript checks.
- `npm run format:check`: passed.
- `npm run security:scan`: 178 source files, zero pattern findings; not proof of absence.
- New tests cover closed-calendar reporting, idempotency, immutable evidence, tenant isolation, missing-data labels, unsettled reservation rollback, human assessments, scheduled close, disabled/stopped reporting, DOCX/PDF signatures, PDF pagination and authenticated HTTP export.
- Governance tests cover unchanged budgets before approval, exact hash, expiration/replay, stale membership, audit failure rollback, delayed effective month and permanent worker allocation validation.
- Paid-image regression verifies missing pricing and insufficient funds prevent provider execution, unresolved billing retains reservations, and aggregate token totals survive reconciliation with unknown cached counts left null.
- Synthetic browser fixture on port 3117 verified proposal creation, full memo display and financial approval resulting in immutable history and a future effective policy. No live money moved. Browser download-event capture was unavailable; binary export was verified through the authenticated HTTP integration test.
- PDF fixture rendered through bundled Poppler. Two-page product report inspected with Cyrillic names, table, section flow and correct page footers. A discovered blank-footer-page defect was fixed and given a page-count regression assertion.
- DOCX is structurally generated and tested, but rendered visual verification remains blocked because packaged LibreOffice is unavailable. No claim of rendered DOCX layout verification is made.

Reproduce synthetic exports with `node scripts/verify-memo-exports.ts`. Use `node scripts/preview-executive-reports.ts` only for disposable local UI verification. Both scripts use in-memory databases.
