# Shopify read access — Phase 2

Implemented: pinned GraphQL Admin API reads, server-side credentials, explicit CEO authorization, bounded pagination, normalized SQLite cache, sync status/history, store dashboard, and deterministic Борис answers grounded in cached data. **No live store has been connected or sandbox-verified. Automated integration tests use synthetic responses.**

## Connect your store

1. Run `npm run setup` if needed, then `npm start` and sign in. Open **Shopify store** and copy the company ID.
2. Create/install a dedicated Shopify app with only `read_products`, `read_inventory`, `read_orders`. The connector rejects unnecessary read scopes and all write scopes.
3. Set `SHOPIFY_COMPANY_ID` and the exact `SHOPIFY_SHOP_DOMAIN` in the ignored `.env`. Do not paste credentials into chat, memory, the browser UI, or source control.
4. If the app and store belong to the **same Shopify organization**, set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. The server uses the client credentials grant and holds the resulting token only in memory for that sync. A new sync obtains a fresh token. This grant does not work for arbitrary third-party stores.
5. Alternatively, set `SHOPIFY_ACCESS_TOKEN` to an already legitimately issued Admin API token. General merchant OAuth redirect/callback installation is not implemented. Manually supplied expiring tokens must be replaced when expired; no refresh token is stored. Configuring both credential methods is rejected.
6. Restart the server. On **Shopify store**, enter the configured domain, keep customer access disabled initially, check the explicit read-access authorization, and submit. This records the CEO decision locally; it does not install an app or acquire new Shopify scopes.
7. Click **Sync now**. Identity and actual granted scopes are verified before business reads. Inspect status, counts, coverage, currency, timezone and sync history.

Ask Борис: “What sold best this week?”, “What products are low?”, “How many orders were placed?”, or “What products are underperforming?” This remains a deterministic data assistant, not a connected LLM. This-week questions use Monday in the shop timezone; default questions use the trailing seven days ending at the sync cutoff. Unsupported calendar periods are disclosed.

## Read and stored data

| Resource | Fields / coverage |
|---|---|
| Shop | Name, canonical domain, currency, timezone, granted scopes |
| Products | IDs, titles, status, creation/update times; paginated catalog |
| Variants | IDs, product references, title, SKU, inventory item reference |
| Inventory | Tracked flag and available quantity per item/location |
| Orders | IDs, creation/update/cancellation timestamps, test flag, payment/fulfillment status, shop-currency current total and refunded amount; rolling 30-day creation cohort |
| Line items | Product/variant references, title, quantity; nested pagination |
| Refunds | ID, order reference, time, shop-currency amount |
| Fulfillments | ID, order reference, status, creation time |
| Customers | Disabled by default; optional ID, creation time, order count only |

Names, emails, phone numbers, addresses, notes, tracking numbers, support content and payment credentials are not requested. Customer IDs are still potentially personal data, not anonymous. Optional customer access requires `SHOPIFY_CUSTOMERS_ENABLED=true`, explicit CEO authorization, `read_customers` and any required Shopify protected-data permission. Disabling customer access deletes the local customer-summary cache transactionally; Shopify scope revocation remains a separate action.

## Metric definitions and coverage

- Counts exclude test and cancelled orders but include unpaid orders. They are not payment counts.
- Current order value uses `currentTotalPriceSet.shopMoney`, including taxes/shipping and edits. Its average is divided by eligible order count. Neither is recognized revenue or profit. Refunds are shown separately, not subtracted again.
- Product rankings use quantities ordered, not net of returns. Deleted/custom product references remain on orders but are not ranked as current catalog products.
- Low inventory means tracked active variants with **5 or fewer available units summed across locations**. No stockout or supplier estimates are inferred.
- Active products created before the selected window with zero observed units are review candidates. Without exposure/traffic data, underperformance is not proven.
- Refund and fulfillment records belong only to orders created in the cached 30-day window. Events on older orders are excluded. No `read_all_orders` scope is requested.
- Snapshots become stale after one hour or immediately after a failed sync. No-data and zero-data differ. Today counts use shop timezone and are unavailable when the latest cutoff is on an earlier local date.
- Shopify does not supply a cross-resource transaction across pagination. Data reflects a bounded fetch interval. An inconsistent catalog fails sync rather than importing partially.

## Controls and failure behavior

API **2026-07** is pinned; unexpected served-version headers fail closed. The closed query catalog contains no mutations and accepts no user-provided GraphQL. Only exact `*.myshopify.com` hosts are allowed; credentialed requests never follow redirects.

Requests time out after 20 seconds, with at most three query attempts for throttles/server errors. Retry-after and GraphQL throttle metadata inform bounded backoff. Responses are capped at 8 MiB (token responses 64 KiB). Sync has a 120-second deadline, at most 1,000 logical queries, 200 pages/connection and 20,000 nodes/connection. Large stores exceeding bounds fail clearly and require a future bulk-import worker. Truncated imports never report success.

A database lease blocks concurrent syncs. Fetch/validation occurs outside the transaction; normalized-row replacement, success state and audit commit together. Failed reads or commits preserve the previous snapshot. Emergency stop blocks new syncs; stop/disconnect/generation changes prevent in-flight snapshots from committing. Reads already accepted by Shopify cannot be undone.

**Disconnect locally** invalidates in-flight work and hides cached data from normal state and answers. It preserves cache/audit history; it does not revoke Shopify credentials. Remove credentials from `.env` and revoke/uninstall the dedicated Shopify app to revoke access. Disconnect is not privacy erasure; production retention/redaction remains a later gate.

## Verification and sources

Run `npm test` and `npm run check`. Contract tests cover scopes, pagination, money, tenant isolation, session/CSRF, retries, atomic failures, privacy gates, stale data and cancellation. **Real-store installation, protected-data eligibility, GraphQL field availability in a Shopify sandbox, and agreement with Shopify reports still require live acceptance testing.**

Official references checked October 2, 2026: [Client credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant), [Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens), [Order schema](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order), [Scopes](https://shopify.dev/docs/api/usage/access-scopes), [InventoryItem](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/InventoryItem).
