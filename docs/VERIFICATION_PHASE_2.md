# Phase 2 verification — October 2, 2026

## Results

- `npm test`: **32 passed, 0 failed** (15 foundation tests plus 17 Phase 2 tests).
- `npm run check`: passed strict TypeScript and browser JavaScript syntax checks.
- `npm run format:check`: passed.
- Existing local database migrated from Phase 1 through migration 3 without replacing company, agent, task or audit records.

## Automated evidence

Synthetic Shopify contracts verify root and nested pagination; normalized products/variants/orders/inventory/refunds/fulfillments; repeat-sync deduplication; transaction rollback after read and SQL failures; exact money precision; stale/no-data handling; store-timezone calendar boundaries including DST; scope and shop-identity rejection before business reads; independent customer-access gates; tenant and human identity checks; expired-lease recovery; concurrent-sync denial; stop/disconnect before commit; closed read-only query catalog; redirect refusal; throttle retries; response size limits; redacted errors; token exchange/caching; and authenticated API routes with CSRF checks.

Tests validate the connector contract and local behavior. They do **not** prove live Shopify schema compatibility, protected-customer-data eligibility, actual scope grants or report reconciliation. Those require an installed Shopify sandbox/store and real configuration.

## Browser evidence

Codex in-app browser, isolated Example Company test database on loopback port 3101:

- Existing CEO session loads the new Shopify navigation and Phase 2 footer.
- Connection screen shows no authorized store and no invented metrics.
- Customer summaries default to disabled; explicit CEO authorization is required.
- No credential fields appear in the browser.
- A test-domain submission without server credentials shows INTEGRATION REQUIRED; no connection or sync was created.
- Emergency-stop state and original records remain intact after migration/reload.
- Desktop connection screen inspected visually; screenshot: phase-2-shopify.png.

The populated Shopify dashboard is backed by service/API fixture tests but was not exercised against a live store in the browser. Mobile/device verification and production load/security testing remain pending.

## Live acceptance gate

Follow SHOPIFY.md to configure an exact store domain, company binding and a dedicated read-only app. Verify installation/scopes, sync counts, pagination, zero/unknown distinctions, inventory across locations, test/cancelled orders, refunds on old orders, currency, timezone and manual reconciliation against Shopify. Confirm no query requests customer fields without both gates. Test revoked-token failure and recovery. Do not mark live Phase 2 acceptance complete before this evidence exists.

No store domain or real credentials were supplied during implementation. No live Shopify connection, permissions grant, business mutation or paid provider request was made.
