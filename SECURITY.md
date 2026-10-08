# Security boundaries

## Current completion checkpoint

See ACCEPTANCE_MATRIX.md and docs/COMPLETION_VERIFICATION.md for current evidence and remaining gaps; earlier phase sections describe historical boundaries. Migrations 027–030 add explicit execution participants and quarantine generations, expired-operation recovery without replay, minimized immutable provider receipts, versioned registry/constitution records and owner-authored task handoffs. Holds do not suppress receipt/billing bookkeeping. Unknown paid/write outcomes require reconciliation. Read-only configuration APIs do not grant permission editing. Handoffs authenticate the persisted human and audit atomically; no machine identity or autonomous runtime is enabled. SQLite triggers protect application history, not against a filesystem/database administrator. No operational migration or live provider acceptance was performed for this work.

## Executive reporting and financial decisions

Migrations 023–025 add immutable completed-period evidence, owner-enabled internal reporting, authenticated document exports, central budget interception of paid image jobs and exact permanent-budget proposals. A memo review is never financial approval. Budget decisions require a persisted human CEO, exact proposal hash, current policy/membership, explicit confirmation and a ten-minute expiry. Decision, policy and audit commit atomically; replay is denied. Policies start in a future month. Default $5/equal shares remain unless the owner explicitly approves a new policy. Paid-image output retains its central reservation until human billing reconciliation; image prices are never inferred from generic text-token rates. All verification used isolated fixtures. See docs/EXECUTIVE_REPORTING.md for current limitations; earlier phase descriptions below are historical boundaries.

## Shared Knowledge foundation

The SKD APIs reuse persisted CEO authentication, exact Origin/CSRF checks and transactional audit. Agent IDs only narrow a human read view; they never authenticate or authorize a machine principal. SQL filters scope before candidate limiting. Human verification/promotion binds the current version; immutable snapshots preserve evidence. Open contradictions block default retrieval and revision until human resolution. Recognizable credentials are rejected on SKD and legacy manual-memory writes, but heuristic screening cannot detect every secret. External content is escaped data, never policy or an instruction to execute. See [Shared Knowledge](SHARED_KNOWLEDGE.md) for limitations and migration/backup requirements. No operational database was migrated for the synthetic verification.

## Phase 2 read boundary

Shopify credentials are server-environment-only, bound to SHOPIFY_COMPANY_ID and an exact Shopify domain. Authenticated CEO authorization is persisted before sync. Credentials never enter SQLite, browser state, messages or logs. Exchanged tokens live in client memory; manual access tokens require manual rotation. All write scopes and unapproved read scopes are rejected. Fixed queries, host validation and redirect refusal prevent arbitrary credentialed requests. Raw Shopify errors are suppressed.

Customer queries require server opt-in plus a CEO choice and request only ID, creation time and order count. These IDs may still be personal data. Production retention/erasure is not implemented. Disconnect stops local access without claiming remote credential revocation.

Connection and sync state/cache mutations are transactionally audited. Stop state and generation are rechecked before logical queries and commit; leases prevent stale workers overwriting newer state. Reads already in flight may finish, but a stopped/disconnected sync cannot commit. No autonomous worker, external business write or paid model is activated. Contracts are fixture-tested; live Shopify acceptance is pending.

This is a loopback-only local foundation, not a hardened public service. CEO provisioning occurs through a local terminal with no default password. Passwords use scrypt with random salts. Sessions are random 256-bit bearer values stored as SHA-256 hashes, expire after eight hours, and use HttpOnly/SameSite=Strict cookies. Secure cookies require HTTPS. POST routes require the configured exact Origin and authenticated requests require a session-specific CSRF token. Login attempts are limited per socket IP in process. CSP disallows remote scripts, frames and inline handlers. Input sizes and important fields are validated; SQL values are parameterized.

Every API principal comes from a session joined to its user and company. No agent API identities exist yet. CompanyService verifies CEO role; internal callers must not construct principals from untrusted input. All domain writes transact with audit. Source links allow only HTTP(S); user text is escaped in UI. Error responses suppress internal exception details. No provider secrets are accepted by the UI or stored in source control. Environment variables or deployment secret manager are the only future credential source until envelope encryption is designed and tested.

Known remaining requirements: OIDC/MFA and recovery, account-based/distributed rate limiting, authentication-failure audit without enumeration, strict typed database mappings, session rotation/admin revocation, request timeouts and broad rate limits, verified external dispatch gateway, model output schemas, prompt-injection defenses, privacy retention/deletion, encrypted backups, independent compliance veto, immutable off-host audit export, dependency scanning in CI and penetration testing. The initial API is one CEO role only; fine-grained service identities arrive before workers.

Local filesystem administrators can read the database and change it outside application controls. Keep the data directory private. SQLite and ordinary local backups are not encrypted by this application; do not enter live customer PII. No secrets or raw customer information should be pasted into company memory.

Emergency stop persists company state and blocks policy-approved agent work. External writes are unconditionally disabled in this phase, so none can bypass stop. A future live gateway must recheck controls at dispatch and reconcile already-in-flight operations; emergency stop cannot undo a request already accepted by a provider.


Phase 3 analytics report and experiment mutations revalidate the persisted CEO identity, enforce company/analytics pause controls, and transact with audit. Daily aggregate writes share the authenticated Shopify sync transaction and rollback boundary. Historical reports are immutable; user-entered experimental results remain explicitly human-reported evidence. No new external authority is granted.


## Phase 4–5 authority boundaries

Research source URLs are recorded only; no server-side arbitrary URL fetch is introduced. Evidence snapshots and reports are immutable, stage changes require fresh human-verified sources, and reviews are company-scoped and audited. User text remains escaped.

Phase 5 introduces one narrowly scoped external action: an authenticated CEO may approve and explicitly dispatch a bound image-generation job through DesignService. This is separate from the foundation agent policy, which still denies all external agent tools. Agents cannot call this API as actors. Server-only company-pinned OpenAI configuration, immutable payload hashes, ten-minute single-use approval, pause checks, category restrictions, reservation/day/iteration limits, no redirects and no automatic retries constrain dispatch. Actual provider billing is not capped by the local reservation ledger. Stop during an external request cannot undo billing; uncertain outcomes require human reconciliation.

PNG content and metadata commit with audit in SQLite. Assets are never public static files; scoped authenticated reads enforce ownership. Unsupported/active formats, invalid PNGs, excessive response sizes and decompression bounds are rejected. Provider errors are redacted. Human QA is neither automated copyright clearance nor proof of print readiness. New workflow controls and remaining deployment limitations are documented in RESEARCH_DESIGN.md.

## Phase 6 draft boundary

A separate authenticated ProductService permits explicitly approved Shopify DRAFT creation. The generic agent gateway still denies external agent writes. The dedicated write app is company/domain pinned and rejects unrelated scopes. Immutable payloads, ten-minute single-use approval, current QA/evidence, pause checks and transactional audit gate dispatch. Result recording remains possible after an in-flight stop so accepted remote writes are not lost. Uncertain writes require reconciliation and block new Shopify mutations. No publishing, media upload or print fulfillment is implemented. See PRODUCT_FACTORY.md.

## Phase 7 marketing boundary

MarketingService adds internal campaign drafting, immutable plans, ten-minute content-bound CEO approval, single-use internal readiness and human-reported aggregate measurement. PAID_AD or any positive budget is RED and requires explicit acknowledgement. Plan approval grants no external spending, sending or publishing authority; there is no marketing dispatch endpoint. All writes are company-scoped and transactionally audited. Simulation labels derive from the product package. See MARKETING.md for measurement and attribution limitations.

## Phase 8 customer boundary

CustomerService accepts human-entered redacted observations with explicit authorized-use/redaction attestations. Email/long-number checks are incomplete; personal or sensitive raw data must not be entered. Persona/insight versions and support drafts require fresh company-scoped verified evidence. Simulation cannot mix with real evidence in a document. Withdrawal prevents active use but is not erasure from SQLite or backups. Support remains DRAFT ONLY after review, with no send/refund/order-lookup endpoint. All mutations authenticate the persisted CEO and audit transactionally. See CUSTOMERS.md for privacy, retention and keyword-classification limitations.

## Phase 9 monitoring boundary

TechnologyService permits a human-triggered, company-pinned homepage read from a server-configured hostname. Public IPv4 filtering, pinned DNS address, TLS hostname verification, no redirects/credentials, deadline, response size and cooldown bound the request. Manual page URLs are never fetched. Reports require exact-content expiring approval for internal assignment, not deployment. See TECHNOLOGY.md.

## Phase 10 signed ingress boundary

POST /webhooks/shopify is an explicit provider-authenticated exception to browser session/Origin/CSRF requirements. It requires raw-body HMAC and a persisted company/domain authorization granted by an authenticated CEO whose identity is rechecked. Audit links receipt to that authorizing human. Only minimized, schema-validated event envelopes commit; all interactive operations remain authenticated and CSRF-protected. Stop blocks processing while authorized receipt remains durable; disconnect rejects new receipt. No external business action or autonomous worker is added. See OPERATIONS_EVENTS.md for supported topics, deduplication and deployment/retention gaps.

## Phase 11 compliance boundary

Persisted CEO identity is revalidated for company mutations. Company-wide compliance holds gate normal policy and workflow work independently of pause state. Exact, expiring, single-use human remediation release is required; holds and policy changes expire pending execution approvals. Optional content review is bound to artifact hash and policy version and does not replace execution approval. Review rejection, cancellation, withdrawal, disconnect and reconciliation remain available; signed event receipt remains durable while processing is blocked. See COMPLIANCE.md for coverage and limitations. This remains a single-human local pilot, not an independent multi-user compliance authority.

## Phase 12 learning boundary

LearningService joins company-scoped product/campaign/customer lineage and binds an immutable human lesson to exact, expiring, single-use CEO approval. Atomic promotion creates only a HYPOTHESIS / NEEDS VERIFICATION memory candidate and a research-library question. Evidence freshness, simulation separation, current content and stop/hold controls are rechecked before approval and promotion. Customer withdrawal/dispute/expiry hides dependent learning and memory bodies, without claiming physical erasure. Research follow-ups require newly created company opportunities with verified sources. No external authority or autonomous execution is added. See LEARNING_LOOP.md.

## Phase 13 automation boundary

The opt-in local scheduler executes only fixed synchronous internal methods under the persisted human who authorized an immutable bounded schedule. Activation approval is content-bound, expires in ten minutes and is consumed once; recurrence ends within 30 days and has daily/total limits. Every run rechecks human identity, tenant, controls and budgets. Output and run history commit atomically via nested savepoints; failed or blocked actions pause. Compliance holds/revisions revoke activation. No scheduler path approves proposals, dispatches providers, writes Shopify, sends campaigns or performs website requests. External spend is zero; generation proposals may reserve under existing design settings but still require separate human approval/dispatch. See AUTOMATION.md for limits and remaining live automation gaps.

## Phase 14 organization review boundary

OrganizationService computes company-scoped metrics and immutable report bodies on the server. Human assessments bind the exact report hash and a subject contained in it, require persisted CEO identity and current stop/hold checks, and commit with audit. Accepting a recommendation grants no execution authority and changes no agent configuration, security control, budget or approval. No automatic optimization endpoint is exposed. Assignment/activity proxies are explicitly distinguished from autonomous usefulness and provider tool usage. See ORGANIZATION.md.

## Phase 15 local hardening

HTTP timeouts, header limits and per-socket request caps now bound local transport use. Encrypted recovery tooling is a privileged filesystem operation outside the tenant API and never starts workers or changes company records. Snapshot/restore files contain sensitive historical sessions and approvals; restoration is for isolated inspection only. See HARDENING.md for plaintext temporary-file handling, key custody, Windows ACL requirements and outstanding production gates.


## Resource, Pixel Office and executive record foundations

Migrations 020–022 add accounting, context-review meetings and immutable executive correspondence. Resource APIs expose human configuration and read views; reservation/reconciliation are trusted server services, not browser endpoints. The new ledger is not yet connected to live paid dispatch. Memo APIs are CEO-only, company-scoped and CSRF-protected; reviews have no execution or financial authority. Submitted memo content and review history are append-only, with corrections through linked records. Meetings use the existing task creation service and never grant external permission. See AI_RESOURCES.md, PIXEL_OFFICE.md and EXECUTIVE_MEMOS.md for implemented boundaries and unfinished production gates.
