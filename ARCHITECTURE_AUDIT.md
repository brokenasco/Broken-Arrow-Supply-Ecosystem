# Architecture audit — Broken Arrow AI

Audit date: 2026-10-04. Scope: current working tree, not an assumed deployed release. No production database, credentials, external integration or live business action was changed for this audit. Existing Viktor work is preserved and assessed as work in progress.

## 1. Current architecture assessment

Broken Arrow AI is a modular monolith with a native Node HTTP server, TypeScript source executed using Node 24.15+ type stripping, strict TypeScript checking, a vanilla JavaScript browser application and SQLite. The server is deliberately loopback-only. It is an authenticated local business workflow platform, not yet a general autonomous agent runtime.

The request path is browser → `src/server.ts` → persisted CEO session → domain service → scoped SQL and transaction/audit. `HumanWorkflow` centralizes persisted human checks and ordinary workflow stop/compliance gates; `CompanyService` owns foundation operations. Domain modules implement research, design, products, campaigns, customer intelligence, technology, operations, compliance, learning, automation and organization review. Most actions are human initiated. Some local draft work can run under a bounded human-authorized schedule.

`src/providers.ts` defines provider interfaces and explicit unavailable results. Ask Boris uses deterministic stored-data answers. There is no connected general LLM task executor, tool-call ledger, context assembler or authenticated agent workload identity. Registry tools are declarations, not evidence that those tools execute.

SQLite uses WAL, foreign keys, immediate transactions and nested savepoints. Eighteen numbered migrations exist in `src/db.ts`. Existing databases receive migrations on open; future migrations must not rewrite already-applied files. All repository files currently appear untracked in Git; release provenance and a recoverable committed baseline have not been established.

## 2. Existing organization — preserve identities

The registry contains 24 distinct agents: the original 23 named roles plus Viktor. Do not collapse Viktor into Victoria or rename any existing employee. Supervisor relationships currently live in JSON definitions, not a separately validated relationship graph.

| Department | Agents, as currently displayed | Reporting |
| --- | --- | --- |
| Executive | Борис — COO | Human CEO |
| Marketing | Анна; Mason; Катерина | Анна → Борис; specialists → Анна |
| Product | Алекс; Marisha; Марк; Jack; Garry; Tyler | Алекс → Борис; specialists → Алекс |
| Technology | Дмитрий; Sarah; Wilhelm | Дмитрий → Борис; specialists → Дмитрий |
| Analytics | София; Benjamin; Мария | София → Борис; specialists → София |
| Customers | Oliver; Николай; Jessica; Андрей | Oliver → Борис; specialists → Oliver |
| Operations | Rachel; Сергей | Rachel → Борис; Сергей → Rachel |
| Compliance | Виктория | Human CEO, independent compliance authority |
| Security | Viktor — Chief Security Officer (CSO) | Human CEO, independent security role; integration incomplete |

`src/registry.ts` seeds definitions; the `agents` table persists a JSON copy. Pause state is separate. There is no complete configuration-version lifecycle, model assignment administration, validated supervisor graph or runtime capability resolution. The seed file and persisted copies could diverge without a controlled migration/version process.

## 3. Database inventory

| Migrations | Existing entities and responsibilities |
| --- | --- |
| 001–002 | Companies, users, sessions, departments, agents, projects, tasks, task dependencies, approvals, memory items, research items, notifications, audit logs, chat messages, webhook receipts; approval immutability |
| 003 | Shopify authorization/sync leases and normalized product, inventory, order, refund, fulfillment and optional customer caches |
| 004 | Daily analytics, saved reports, experiments |
| 005–006 | Research sources/reviews/trends/opportunities/handoffs; design settings/briefs/jobs/private assets/QA/billing reconciliation |
| 007–008 | Product templates/proposals/write authorization/events; campaign plans and results |
| 009–010 | Customer evidence/documents/personas/support drafts; UX observations/reports/validations/monitor runs |
| 011–012 | Operations ingress/events/alerts/incidents; compliance settings/holds/reviews/releases/audit reviews |
| 013–015 | Learning cycles and follow-ups; bounded automation schedules/runs; organization reports and human assessments |
| 016–018, in progress | Security settings/events/grants/approvals/incidents/alerts/reports; credential metadata/rotation/breach checks/session IDs/rate limits/review schedule; passkey public keys/challenges/authentication events |

Reuse these entities. Do not add replacement users, generic duplicate tasks, a second company identity, another experiment register or a parallel credential database. New generic orchestration records should link to domain artifacts rather than copy them.

## 4. Integration and execution inventory

| Capability | Implementation evidence | Acceptance limit |
| --- | --- | --- |
| Shopify reads | Fixed GraphQL catalog, server-pinned company/store credentials, scope checks, sync leases and atomic caches | Fixture tested; live sandbox acceptance not established |
| Shopify writes | Separate approval-bound DRAFT product adapter and uncertain-result reconciliation | No publishing, media upload or fulfillment completion claim |
| Image generation | Simulation provider and optional OpenAI adapter with human approval/reservation/reconciliation | Paid execution requires separate explicit configuration and approval |
| UX monitoring | Bounded, company-pinned public homepage read | Not an intrusive scanner or comprehensive security monitor |
| Webhooks | Shopify HMAC verification, minimization, deduplication and manual processing | Live subscriptions/delivery not established |
| Marketing/support | Internal drafts, reviews and human-reported results | No sending, ad spending, refunds or social publishing |
| LLM/search/print/email/social/ads/storage | Interfaces or unconfigured implementations | No general operational agent runtime |
| Viktor vault/breach/passkeys | Vault port and HashiCorp adapter, HIBP adapter, SimpleWebAuthn server code | Work in progress; no verified live vault, breach service or physical passkey enrollment |

The new SimpleWebAuthn dependency means the older architecture statement “runtime has no dependencies” is obsolete. `DATABASE.md` also contains obsolete three-migration descriptions. Domain-specific guides are more current than those historical summaries.

## 5. Authentication, authorization and human control

Local CEO provisioning uses scrypt hashes, not plaintext password storage. Sessions contain hashed bearer tokens, eight-hour expiry, HttpOnly/SameSite cookies and session-specific CSRF. POST requests require exact Origin. Secure cookies depend on HTTPS configuration. The API has one persisted human role, CEO; there is no authenticated autonomous agent or multi-role employee login.

Foundation policy denies external agent execution. Dedicated business services separately enforce narrowly approved external operations. Human approval content is immutable, expiring and single-use where execution is implemented. Company, department and agent pause controls, compliance holds and rejection/cancellation paths are reusable.

Security drafts introduce human reauthentication, opaque credential references, session revocation and lockdown. These do not yet establish a complete organization-wide RBAC/ABAC or authentication gateway.

## 6. Scheduling, workflows and communication

`AutomationService` supports eight fixed internal operations with immutable bounded schedules, daily/total limits, approval, run history and duplicate-slot prevention. `startAutomationWorker` uses a local timer; failed/blocked actions pause rather than automatically retry external effects. It is not a general DAG workflow engine or distributed queue.

Viktor adds a separate local review timer and schedule table. Its error handling currently catches failures without recording an observable failure result. Consolidate scheduling infrastructure while preserving an explicit exception allowing defensive security reviews during a business stop. Such reviews must never confer ordinary business execution authority.

Tasks have project/agent ownership, status, dependency rows, retry count and cost fields; new foundation tasks begin BLOCKED because no generic executor is configured. There is no full parent-child task model, runtime lease, task-attempt record, workflow run or validated inter-agent delegation protocol. Existing `messages` represent CEO/assistant chat, not structured agent communications.

## 7. Knowledge, memory, analytics and quality

Research sources carry dates, review/freshness and provenance. `memory_items` classify claims, require evidence and support review/expiry/supersession. However, `research_items` point into memory: knowledge and memory are not fully separated by purpose or retrieval ACL. There is no layered knowledge collection model or semantic index.

The learning loop already binds product, campaign and customer evidence to human-approved hypotheses and research follow-ups. Reuse its provenance and withdrawal rules. Experiments and campaign results exist, with explicit limitations on causality. Organization reports derive workflow metrics and avoid inventing agent/model usage. They are not general event-sourced agent performance profiles.

Design QA and compliance reviews already block important downstream actions. Preserve them as specialist validators. There is no universal structured QA contract covering every workflow artifact.

## 8. Requirements coverage

“Reusable” means implemented local capability, not production or live-provider acceptance.

| Requested phases | Assessment | Extension needed |
| --- | --- | --- |
| 1 Registry | Partial | Versioned configuration services, normalized identity/reporting, lifecycle/model/context fields |
| 2 Constitution | Missing as versioned data | Separate immutable rule versions and deterministic enforcement |
| 3 Authority | Partial JSON hierarchy | Cycle-safe graph, delegation validation and cross-department routing |
| 4 Tasks | Partial | Parent/attempt/deadline/contracts/state transitions and tree UI |
| 5 Workflows | Missing generic engine | Versioned templates, step/run state, conditional routing and durable execution |
| 6 Communication | Partial human chat | Typed envelopes, references and authority-aware agent messaging |
| 7 Knowledge | Partial provenance | Collections, scoped retrieval, versions and memory separation |
| 8 Memory | Reusable foundation | Task/decision/episode categories and bounded retrieval |
| 9 Decisions | Missing general ledger | Evidence-linked decision/outcome/review records |
| 10 Experiments | Reusable | Structured metric/sample linkage and memory promotion |
| 11 QA | Reusable domain checks | Common result envelope and mandatory downstream gates |
| 12 Approvals | Reusable, several implementations | Shared authorization contract without weakening domain gates |
| 13 RBAC | Partial | Resource/action grants, workload identity and uniform enforcement |
| 14 Audit | Reusable append-only SQL | Correlation, filtering and off-host tamper evidence |
| 15 Recovery | Partial | Standard attempts/classification, durable retry/dead-letter policy |
| 16 Scheduler | Reusable bounded subset | Calendar/one-shot/event triggers and unified failure visibility |
| 17 Events | Domain records/webhooks only | Transactional outbox and idempotent subscriptions |
| 18 Analytics | Reusable observed metrics | Runtime, workflow and tool/cost instrumentation |
| 19 Feedback | Reusable learning loop | Generalize beyond current product/campaign/customer lineage |
| 20 Performance | Partial organization reports | System-derived runtime/QA/intervention measurements |
| 21 Command center | Reusable shell and pages | Workflow/task tree/decision/context drill-down |
| 22 Emergency control | Reusable stop/hold controls | Workflow-level controls and central dispatch enforcement |
| 23 Notifications | Reusable in-app storage | Channel adapters, deduplication/outbox and delivery state |
| 24 Cost | Partial design reservations/reconciliation | Company/department/workflow budgets and usage ledger |
| 25 Observability | Partial health/run records | Structured correlation, queue/worker health and explicit failures |
| 26–28 Models/APIs/security | Substantial foundation | Incremental migrations, typed routes and consistent gateways |
| 29–31 Execution/output/context | Mostly missing | Validated runtime contract and scoped bounded context assembly |
| 32 Hygiene | Partial | Cross-collection duplicate/review/withdrawal propagation |
| 33–34 Improvements/versioning | Domain-specific partial | Human-approved versioned organizational change proposals |
| 35 Testing | Reusable suite | New graph/runtime/retrieval/worker/integration adversarial tests |
| 36 Simulation | Reusable domain simulators | Complete isolated end-to-end workflow simulation |
| 37 Autonomy | Partial risk/permission controls | Per-action autonomy levels separate from risk classification |
| 38–40 Learning/daily cycle/briefing | Partial deterministic reports | Evidence-backed daily workflow and briefing composition |

## 9. Conflicts, technical debt and security concerns

1. **Do not treat tests as full Viktor acceptance.** The security suite currently covers five foundational cases. No full incident/lockdown, breach HTTP contract, broker race, WebAuthn success/replay, security timer or Security Command Center browser acceptance exists.
2. **Incomplete static/UI integration:** `server.ts` allowlists `/security.js`, but `public/security.js` does not exist and the browser shell does not load or navigate to a security page. A request for that asset can produce an internal file-read failure. Complete it before advertising the dashboard.
3. **Policy disagreement:** the new security grant evaluation checks pause/lockdown but not the existing compliance hold gate. HumanWorkflow and security administration deliberately have different stop behavior, but authorization-changing operations need explicit classification. Do not activate the login broker until this disagreement is fixed and tested.
4. **Denied-operation evidence can roll back:** broker evaluation writes denial events inside a transaction that may subsequently throw; its denial record can disappear. Preserve rejection evidence through a separate bounded post-rollback record without retaining secret input.
5. **Security worker failures are silent:** `tickSecurity` suppresses exceptions. This conflicts with the new requirement to expose failures. Add persisted failure status, safe correlation and bounded retry/backoff before enabling it operationally.
6. **Session compatibility:** migration 017 gives existing sessions 32-character IDs, while the new revoke route matches 36-character IDs. Test and support both or migrate IDs safely; do not strand existing sessions.
7. **Passkeys are not MFA enforcement:** the draft server supports enrollment/reauthentication, but local password login remains and no enrollment UI is wired. Do not label human-reported external MFA metadata as enforced authentication.
8. **Metadata privacy:** credential identifiers and security inventories enter the broad CEO `/api/state` payload. That endpoint must never become an agent model context. Split paginated security views from ordinary application state before expanding user roles or telemetry.
9. **Logging exceptions need explicit ownership:** logout currently deletes a session and audits separately; failed-login evidence and rate-limit counters use dedicated paths. Formalize transaction/audit requirements for those system-authentication events instead of assuming all mutations already share one gate.
10. **Schema consistency:** new security incident evidence/credential links and generic grant resource IDs need stronger tenant-safe reference validation. Some immutable tables block updates but not deletion. Review retention versus lawful erasure deliberately.
11. **Runtime assumptions:** SQLite synchronous reads, large aggregate `/api/state`, private asset BLOBs and a growing monolithic route chain are workable locally but not a hosted scaling plan. Do not introduce microservices to avoid modular cleanup.
12. **Security and operations:** no verified hosted identity/MFA, independent penetration test, off-host audit, distributed limits, managed key custody or full privacy erasure. Recovery restores historical sessions/approvals and is inspection-only. Windows backup-temp ACL validation remains operationally required.
13. **Requirement conflict:** “agent approvals” must mean QA recommendations or permitted low-risk review, not human authorization of privileged/external actions. Existing AGENTS.md forbids agents approving actions.
14. **Autonomy is not risk:** GREEN/YELLOW/RED classification cannot be replaced by levels 0–4. Both must be enforced independently, with unknown tools denied.
15. **No evidence of live integration acceptance:** adapters, configuration fields and simulated successes do not establish operational Shopify, vault, breach or paid-provider connectivity.

These are an engineering audit, not an independent penetration test. Runtime secrets and private company records were not inspected.

## 10. Verification and recommended next step

Audit run: 117 tests passed, zero failures; `npm run check` and `npm run format:check` passed. Tests used fixtures/in-memory or temporary databases; no production workflows were executed. Test output: ignored `data/architecture-audit-tests.log`.

First stabilize and document the incomplete Viktor boundary; then implement Milestone 1 (registry, organization, constitution) additively. Preserve existing business services and tests. See BROKEN_ARROW_ARCHITECTURE.md and IMPLEMENTATION_ROADMAP.md. This audit creates the architecture baseline; it does not claim all requested milestones or Viktor phases are implemented.
