# Phase 6 verification — 2026-10-03

Implemented the Product Factory core: company-scoped immutable templates and packages, variant/SKU construction, currency-aware pricing, titles/descriptions/SEO/tags, manual collection selection, private schematic placement proofs, explicit draft-write authorization, approval/dispatch/reconciliation, and an unavailable print-provider abstraction.

- npm test: 59 passed, zero failures.
- npm run check: TypeScript and all browser script syntax checks passed.
- npm run format:check: passed.
- New fixtures cover pricing, safe description encoding, immutable content, idempotency, approval expiry/replay, simulation isolation, tenant access, lost-response reconciliation, disconnect invalidation, excess scopes, stop controls, transactional audit rollback, private SVG reads and HTTP CSRF.
- Browser: synthetic preview at port 3103 successfully created a two-variant template and product package, approved it, and completed local simulation. The page displayed SIMULATED, the embedded placement proof and workflow history. Screenshot: phase-6-product-factory.png.

No external Shopify mutation or paid provider request was performed. Shopify live acceptance is pending. Draft exports contain no images. Production mockup/media upload is still unfinished; print fulfillment is deliberately an unavailable adapter. Publishing remains disabled. These limitations are visible in the UI and PRODUCT_FACTORY.md.
