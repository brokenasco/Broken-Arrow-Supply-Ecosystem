# Operations events — Phase 10

Rachel and Сергей have a durable event inbox, operations/inventory alerts, incident triage, internal escalation and resolution. No stock changes, refunds, fulfillment actions, purchases or messages are performed.

## Configure reception

Set SHOPIFY_WEBHOOK_COMPANY_ID, SHOPIFY_WEBHOOK_DOMAIN (exact myshopify.com domain), and SHOPIFY_WEBHOOK_SECRET (the Shopify app's signing/client secret) in server environment configuration. In Operations, a company CEO explicitly authorizes that shop. This is local authorization, not a live identity/scope verification or a subscription installation. Tokens/secrets are never accepted by UI or stored in SQLite.

The implemented endpoint is POST /webhooks/shopify. The app still binds only to loopback. A production HTTPS ingress, Shopify subscriptions, operational rate limits, privacy lifecycle handling and live acceptance are not configured by this phase. Do not expose the entire local control plane just to test webhooks. No public tunnel or subscription was created.

Supported topics: orders/create, orders/updated, orders/cancelled, fulfillments/create, fulfillments/update, inventory_levels/update, refunds/create, products/create, products/update, products/delete. The receiver expects the pinned Admin API version 2026-07.

## Receipt boundary

The route reads raw bytes before JSON parsing, caps bodies at 1 MiB, verifies base64 SHA-256 HMAC using constant-time comparison, checks configured shop/API version/topic/event ID, validates resource IDs and timestamps, and checks the persisted authorization against its still-valid CEO identity. Unlike human routes it uses provider HMAC, not browser CSRF. Only this exact webhook route bypasses session/Origin requirements.

Normalized storage retains resource identifiers, event time, status or inventory quantity/location and a body hash; raw customer/address/payment data is discarded after validation. Resource IDs and hashes still require sensible access/retention controls; this is not a legal anonymization guarantee. Raw payloads and secrets are not logged.

Deduplication key is company + shop + event ID + topic + simulation flag. Retries with the same key/body return success without another row or alert. Conflicting content for the same key is rejected. Receipt and its audit commit together before HTTP success. The machine audit actor identifies the authorizing human. Reception is the narrow authenticated-provider exception to interactive human mutations; it does not execute business actions.

Shopify's official [delivery verification guidance](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries) specifies raw-body HMAC and explains event IDs across duplicate deliveries. Required delivery headers are described in [delivery structure](https://shopify.dev/docs/apps/build/webhooks/delivery-structure).

## Processing and incidents

Press Process to handle up to 50 pending events in one audited transaction. No background processor is installed. Emergency stop blocks processing, but an already authorized connection may continue durable receipt to avoid loss. Disable reception separately to reject new deliveries. Disconnect does not remove remote subscriptions. Previously captured events remain available for later human processing.

A latest-observed timestamp per resource/shop/simulation namespace prevents strictly older events superseding newer observations. Equal timestamps are not a total ordering guarantee. Alerts describe historical event observations, not current cache truth; refresh Shopify before acting. The event path does not replace the Phase 2 Shopify snapshot or analytics.

Inventory ≤5 triggers a low-stock alert (≤0 is HIGH); null inventory is unknown, never zero. Fulfillment failure/error is HIGH; cancellations and refunds are MEDIUM review alerts. Other events produce INFO review alerts. Alerts are not automatically resolved by subsequent recovery events.

Open one incident per alert, initially assigned to Сергей. Escalate internally to Rachel or CEO, or resolve with evidence. Resolution is terminal and does not prove a remote business action occurred. Escalation changes internal ownership only. Synthetic scenarios create visibly labeled records in a separate namespace without signatures, credentials or external calls; only the authenticated simulation API can create them.

Migration 011 contains connections, event envelopes, latest-event markers, alerts and incidents. The old Phase 1 webhook primitive remains for compatibility; the Phase 10 endpoint uses the new normalized inbox.
