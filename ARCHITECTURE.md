# Architecture

## Phase 2 addition

Authenticated CEO -> ShopifyService -> server-bound credentials -> closed GraphQL query catalog -> validated typed snapshot -> atomic normalized cache + audit. No arbitrary GraphQL or mutation endpoint exists. A new LIVE store row is separate from the original DEMO store; company mode is not silently changed. One explicitly configured company/store pair is served by each process. Request-body tenant IDs never select credentials.

Modules: src/shopify/client.ts (transport/auth), queries.ts (read catalog), read.ts (pagination/schema/normalization), service.ts (authorization/sync/metrics), time.ts (store-local week boundaries). Migration 3 adds connection, run lease and normalized resource tables. Read views and deterministic Борис answers use only committed snapshots. See SHOPIFY.md for supported authentication, metric definitions, scale limits and pending live verification.

The remaining sections describe the Phase 1 foundation. Its external execution policy remains unchanged: Phase 2 is a human-initiated read service, not an autonomous agent tool.

See docs/PHASE_0.md for the full 18-part assessment and decision record.

Browser -> same-origin HTTP -> authenticated CEO principal -> CompanyService -> SQLite transaction and audit. Registry definitions are shared data; no agent has an independent HTTP login or credential access. The policy module evaluates permitted tools and current stop state, then checks exact proposal approval. All external execution is denied. Provider interfaces return discriminated results; no fake success adapter exists.

The browser is plain JavaScript with escaped data insertion and a strict same-origin CSP. Node TypeScript source runs with native type stripping. Strict TypeScript checking and formatting use locked development dependencies through npm run check and npm run format:check; runtime has no dependencies.

The local SQLite database uses foreign keys, WAL and serialized write transactions. This single-process local boundary deliberately excludes distributed workers and live external writes. Hosted deployment requires PostgreSQL, identity provider, durable jobs, secret manager and further authorization review.

Future external gateway sequence: resolve tool-owned risk/side-effect metadata -> load tenant policy and grants -> reserve budget -> validate schema -> obtain exact approval -> atomically claim approval/outbox -> recheck stop state at dispatch -> call adapter with idempotency key -> persist provider receipt -> reconcile uncertain outcome. Never trust model-supplied risk or side-effect flags. The current checkPolicy function is a foundation primitive, not a production external dispatch gateway.

Ask Борис currently answers status questions from durable records with deterministic templates. It does not claim to be a connected language model. Real provider calls, delegation and business outcomes remain future increments.
