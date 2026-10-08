# Product Factory — Phase 6

Tyler's human-operated product workflow connects reviewed designs to immutable templates and product packages. It does not run autonomous agents.

1. In Product Factory, create a poster, shirt or mug template. Match the design brief category exactly. Specify one variant option and up to 20 unique values/SKU suffixes. Optional costs are integer currency minor units (USD 1000 = $10). Record cost evidence, exclusions and expiry.
2. Choose a design asset and destination. SIMULATION accepts only synthetic assets and never contacts Shopify. SHOPIFY requires a non-simulation asset with human QA PASS and fresh, verified research.
3. Enter titles, plain-text descriptions, SEO, tags, prices and optional manual collection IDs. Leave a price blank to calculate cost / (1 − target contribution). This contribution excludes unrecorded shipping, fees and taxes; it is not net profit.
4. Review the immutable package, variant prices, unique SKUs and private placement proof. Approve the exact package for ten minutes, then explicitly dispatch it. Changes require a new package; a request key cannot silently replace content.

## Draft-write configuration

Use a separate Shopify app/token from the read-only integration. Set SHOPIFY_DRAFT_WRITES_ENABLED=true, SHOPIFY_WRITE_COMPANY_ID, SHOPIFY_WRITE_SHOP_DOMAIN and SHOPIFY_WRITE_ACCESS_TOKEN in server environment configuration. Allow only write_products (and its read_products access); unrelated scopes are rejected. Authorize the exact shop in Product Factory. Credentials never appear in browser state or SQLite.

The adapter pins Admin GraphQL 2026-07. It sends one synchronous productSet with fixed DRAFT status, no existing product identifier and a unique handle. It validates shop identity/currency, scopes and manual collections before dispatch. Returned draft status, handle, correlation tag, SKUs, options and prices are checked. Publishing, existing-product updates and inventory adjustments have no endpoint.

Shopify documents [productSet](https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/productSet) and [product inputs](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/ProductSetInput). Live shop acceptance remains pending; fixture tests are not proof of live compatibility.

## Images and print limitations

Placement proofs are private SVG diagrams embedding the selected PNG on a schematic product shape. They are not physical print proofs or provider-rendered product photographs. Shopify exports currently exclude media; production mockup upload remains unfinished. The print-provider interface explicitly returns INTEGRATION REQUIRED. No manufacturing order, fulfillment integration or live cost quote is implemented. Template print specifications and costs are human-entered.

## Recovery

Dispatch consumes approval before sending a mutation. Timeouts, rejected or mismatched responses after dispatch enter RECONCILIATION; no automatic retry occurs. A read-only lookup can verify the original draft by unique handle and variants. An absent result is not proof no write occurred; unresolved Shopify outcomes block subsequent writes. Interrupted work can be recovered after three minutes. Undispatched packages can be cancelled. Disconnect invalidates pending approvals but does not revoke the remote token. Emergency stop cannot undo a mutation already sent.
