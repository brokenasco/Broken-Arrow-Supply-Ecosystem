# Phase 0 architecture review

Review date: 2026-10-02. Source: PRODUCT_REQUIREMENTS.txt.

## 1. Repository assessment
The workspace contains only an empty Git repository, with no commits or tracked files. No frontend, backend, database, authentication, Shopify integration, AI implementation, tests, deployment configuration, environment templates, reusable code, or local AGENTS.md existed. Node 24.15.0 and npm 11.12.1 are available. There is no existing technical debt; the primary risk is prematurely enabling a broad, consequential automation surface.

## 2. Current architecture
None. No store connection or deployment is assumed. The directory name is not treated as verified brand information.

## 3. Proposed architecture
A modular monolith owns HTTP authentication, company domain services, policy enforcement, relational persistence, and a same-origin executive UI. A later durable worker claims tasks through database leases. All credentialed operations must pass a server-owned tool gateway. Model output proposes structured actions; it never grants authority. Human CEO and independent compliance blocks outrank department hierarchies.

## 4. Technology recommendations
Start with typed Node 24 source and its built-in SQLite driver, native HTTP, and a small dependency-free browser UI. This yields an executable, auditable local foundation without inventing cloud accounts. SQLite is a single-host development/pilot decision, not the production scale plan. Use PostgreSQL before multi-instance workers or a hosted multi-tenant launch. Add strict TypeScript compilation and a framework when dependencies can be locked and audited; native stripping runs types but does not type-check. The initial UI deliberately requires no build tool. Prefer OIDC with MFA for hosted production; local foundation uses scrypt passwords and opaque server-side sessions.

## 5. Database schema proposal
Phase 1: companies, users, sessions, stores, departments, agents, projects, tasks, task_dependencies, approvals, memory_items, research_items, notifications, audit_logs, messages, webhook_events. Every owned row has company_id; composite foreign keys prevent cross-company linkage. Agent definitions are versionable structured documents; mutable status is separate. Task and approval statuses have SQL constraints. Credentials remain outside database in Phase 1. Add encrypted credential envelopes and key references when integrations arrive.

Later normalized tables: agent_permissions, agent_messages, research_sources, product_opportunities, products, design_briefs, design_assets, design_reviews, campaigns, campaign_metrics, customer_insights, customer_personas, support_cases, orders_cache, inventory_snapshots, analytics_snapshots, experiments, decision_records, agent_runs, tool_calls, integration_credentials, settings, brand_bible. Asset bytes live in private object storage; database holds version, hash, lineage and ACL metadata. Add composite tenant foreign keys, idempotency keys, indexes and retention rules to each phase's migration. Money is integer minor units plus currency; timestamps UTC.

## 6. Agent runtime architecture
Registry contains 22 definitions with manager, mission, responsibilities, tools, read/write grants, prohibitions, escalation, autonomy, approval requirements, KPIs, schedules, memory scope, output schemas, integrations and budgets. Definitions are configuration, not per-agent application branches. Separate proposal, policy evaluation, approval, execution and reconciliation. Worker limits: delegation depth 4, retries 3 with backoff, bounded context and provider timeout; persist budgets before dispatch. Tasks include deduplication keys, dependencies and expected/actual outputs. Phase 1 does not run autonomous model jobs; Ask Boris is explicitly a deterministic status assistant. Unknown requests return INTEGRATION REQUIRED. No simulated research is passed off as an AI finding.

## 7. Full agent permission matrix
See PERMISSIONS.md. All 22 agents have explicitly scoped internal write families. Phase 1 grants zero external writes. Read access in the future is filtered by tenant and category; raw customer PII is excluded by default. No actor receives policy-edit or self-metric-edit authority through a model.

## 8. Approval matrix
See APPROVALS.md. GREEN internal drafts are bounded by budgets and permissions; YELLOW defaults to CEO approval; RED always requires CEO. Approval cannot confer a missing tool grant. Approvals bind actor, tool, payload hash and company, expire, and cannot be replayed. Rejected or changed proposals require a new request. Compliance vetoes cannot be overridden by department heads.

## 9. Shopify integration strategy
Phase 2 introduces supported, pinned GraphQL Admin API with OAuth, server-only tokens and minimum read scopes. No legacy REST dependency. Scope additions are explicit CEO decisions. Customer protected data is a separate gate; no customer access by default. Normalize paginated reads with freshness metadata; handle GraphQL userErrors and throttle costs. Validate webhook raw-body HMAC before storage, deduplicate by store and event ID, acknowledge durable receipt, then process asynchronously. Deletion/redaction and uninstall revoke credentials and schedule retention cleanup. Phase 6 adds draft creation through policy gateway; publishing is separately approved. Sandbox verification precedes live access. Sources: https://shopify.dev/docs/api/usage/access-scopes and https://shopify.dev/docs/api/usage/authentication and https://shopify.dev/docs/apps/build/apis.

## 10. Provider integration strategy
Typed LLM, image, print, email, search, analytics, social, advertising and storage ports return explicit success or failure. Missing adapters return INTEGRATION REQUIRED. No credentials enter prompts. Adapters enforce timeout, schema, cost reservation, rate limits and idempotency. Uncertain external results become reconciliation-required, never automatic blind retries. No paid provider selected or invoked by the foundation.

## 11. Memory architecture
Durable records have classification FACT/OBSERVATION/HYPOTHESIS/RECOMMENDATION, evidence, source URL, source date, retrieval time, confidence, tags, relationships, author and review/expiration dates. Separate verified knowledge from unverified candidates and stale information. Start with text filtering; add semantic retrieval only with category ACLs and tenant filters applied before retrieval. Never send the full knowledge base to a provider. Corrections supersede prior records without erasing decision history. Research and memory retain separate source provenance.

## 12. Task and workflow architecture
CEO objective -> project -> dependency graph -> task proposals -> policy -> execution -> validated artifacts -> decision record -> outcome -> memory candidate. State transitions are explicit and terminal states cannot silently reopen. Approval does not mean task success. Task cancellation preserves lineage. Future worker leases, outbox, budget ledger and reconciliation handle crashes and concurrency. Avoid free-form recursive agent chat. Schedules remain disabled until provider/budget/worker acceptance tests pass.

## 13. Security risks
Prompt injection, stolen sessions, cross-tenant IDOR, approval replay, time-of-check races, credential leakage, fabricated evidence, runaway spending, PII exposure and duplicate external actions are principal threats. Mitigations: no model authority, server-side scoped queries, strong session secrets, scrypt, origin/CSRF checks, strict CSP, input limits, transactional audits, immutable proposal hashes, fail-closed adapters and explicit integration gates. The local pilot is not an internet-ready security boundary. Distributed rate limits, MFA, central secret management, off-host audit storage, retention/deletion and penetration testing are production gates.

## 14. Implementation roadmap
0 architecture and matrices; 1 authenticated durable control plane and command center in small tested increments; 2 Shopify read integration; 3 grounded metrics; 4 research provenance; 5 image generation and QA; 6 approved product drafts/publishing; 7 campaign drafts and measurement; 8 privacy-aware customer intelligence; 9 UX/technology workflow; 10 authenticated event operations; 11 enhanced compliance review (baseline enforcement begins in Phase 1); 12 measured learning loop; 13 bounded scheduling; 14 organization effectiveness; 15 production hardening. Each phase has its own acceptance evidence and cannot imply later integrations exist.

## 15. File/module plan
src/db.ts + migrations: relational state; src/registry.ts: organization; src/policy.ts: authority; src/providers.ts: integration contracts; src/service.ts: company domain; src/auth.ts: credentials and sessions; src/server.ts: validated same-origin HTTP; public/: command center; scripts/setup.ts: local provisioning; tests/: authority, persistence and API boundaries. Operational documents live at repository root. Future integrations/ workers/ analytics/ product/ modules share policy gateway, never duplicate permission logic.

## 16. Testing strategy
Mandatory foundation checks: no self-approval, no approval bypass, paused agents and company stop deny dispatch, missing grants deny tools, approval payload mutation/replay/expiration fail, duplicate webhook receipts dedupe, unavailable/failed adapters never return success, tenant boundaries, session/CSRF/input failures, SQL persistence and transactional audit. UI checks cover login, navigation, task creation, approvals, pause and stop with honest unavailable data. Live Shopify and provider tests wait for sandbox configuration.

## 17. Deployment strategy
Local loopback single-process pilot with durable SQLite and explicit first CEO setup. No default credentials or public listener. Production plan: containerized application/worker, managed PostgreSQL, HTTPS reverse proxy, OIDC/MFA, private object storage, secret manager, durable queue/outbox, encrypted backups and restore drills, monitored health and budget alerts. No cloud provision, spending, live permissions or deployment is assumed authorized by architecture alone.

## 18. Critical decisions
Keep one monolith; record all 22 employees but activate no autonomous work implicitly. Keep demo and future live stores separate. Deny all external tools in Phase 1. All refunds require approval until an explicit monetary threshold is approved. Customer support remains draft-only. No fabricated revenue, conversion, margin or model output. SQLite allows immediate local validation; PostgreSQL and hosted identity remain explicit production migration gates. Node SQLite reference: https://nodejs.org/docs/latest-v24.x/api/sqlite.html.
