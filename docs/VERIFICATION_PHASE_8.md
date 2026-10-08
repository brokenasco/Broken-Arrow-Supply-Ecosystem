# Phase 8 verification — 2026-10-03

- npm test: 70 passed, zero failures.
- npm run check and npm run format:check passed.
- New tests exercise minimization attestations and basic contact rejection, idempotent evidence capture, tenant isolation, audit rollback, evidence prerequisites, immutable linear persona versioning, withdrawal invalidation, complaint threshold and simulation separation, support escalation (including category-change bypass), exact draft review, closure, stop controls, HTTP auth/CSRF and absent send/refund routes.
- A complaint test initially selected an unverified fixture while intending to test mixed simulation evidence; fixture selection was corrected to select fresh verified rows. No production guard was weakened.
- Browser at http://127.0.0.1:3105/#customers: captured and verified synthetic packaging feedback, classified a QUALITY case, generated and reviewed a template response, and created a persona with observed/inferred findings and unknown unsupported attributes. The result remained DRAFT ONLY and displayed SIMULATION labels. Reload after final changes showed the keyword suggestion and separate simulation/real case counts.
- Screenshot: phase-8-customers.png.

No real customer data, external provider call, message, refund or order lookup was used. Privacy checks are incomplete heuristics; withdrawal is not erasure. See CUSTOMERS.md.
