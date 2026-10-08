# Implementation roadmap — Broken Arrow AI

Baseline: 2026-10-04 architecture audit. Current verification: 117 tests passing; TypeScript/browser script and formatting checks pass. Documents: ARCHITECTURE_AUDIT.md and BROKEN_ARROW_ARCHITECTURE.md. This roadmap is proposed work, not a list of completed capabilities.

## Delivery rules

Implement one milestone at a time. Before edits, state its scope, files, schema and dependencies. For each milestone: implement backend, frontend, input validation and safe errors; add meaningful negative/integration tests; run `npm test`, `npm run check` and `npm run format:check`; fix failures; verify existing workflows; record completed scope and remaining limits in `docs/VERIFICATION_ORG_M<n>.md`.

Preserve identities, APIs and domain validation. New tables must link existing records rather than duplicate them. Never edit applied migrations. New migration numbers below are provisional descriptive allocations after current 018; recheck the runner before assigning filenames. Do not run live spending, publishing, remote credential changes or destructive actions in tests.

A failed foundational gate stops progression into dependent execution features. There is no need to wait for hosted infrastructure to improve local data modeling, but missing external infrastructure must remain visibly unavailable.

## Stabilization prerequisite — unfinished Viktor work

**Objective:** make the partially implemented security boundary coherent before any increase in autonomy.

**Files:** `src/security-foundation.ts`, `src/security.ts`, `src/login-broker.ts`, `src/passkeys.ts`, `src/auth.ts`, `src/server.ts`, `src/compliance-gates.ts`, `public/app.js`, `public/index.html`, proposed `public/security.js`, `tests/security.test.ts`, recovery/schema documentation.

**Schema:** inspect deployed versions first; append a corrective migration for session-ID compatibility, missing tenant-safe security references or retention constraints where necessary. Preserve security evidence. Do not rewrite migrations 016–018 if applied.

**Work:** unify compliance/pause/lockdown checks for authorization-changing operations; preserve denial evidence after rollback; make timer failures observable; fix existing-session revocation IDs; complete authenticated security UI; distinguish passkey registration/reauthentication from enforced MFA. Validate vault/breach adapter fail-closed behavior without activating external services. Keep privileged scope changes human-only.

**Acceptance:** cross-tenant, forged identity, compromise, compliance hold, stop, lockdown, expiry/replay, secret-leak and broker race tests; WebAuthn origin/challenge/verification tests; security HTTP/CSRF/rate tests; browser verification; all 117 baseline tests still pass. Vault/provider production acceptance remains separate. Establish a recoverable Git baseline before release work; do not claim a commit exists until created.

## Milestone 1 — Agent Registry + Organization + Constitution

**Objective:** turn current definitions into versioned organizational configuration without increasing authority.

**Files/services:** add `src/agent-registry.ts`, `src/agent-configuration.ts`, `src/constitution.ts`, `src/authority.ts`; adapt `src/registry.ts`, `src/db.ts`, `src/service.ts`, `src/server.ts`; extend organization/agent views and add constitution UI module.

**Migration:** config versions/current pointers, reporting relationships, constitution versions and human change proposals; backfill all 24 agents, names and intended reporting relationships exactly.

**Dependencies:** stabilized security boundary; existing human authentication/audit; no model provider needed.

**Backend/frontend:** query registry through services, validate schema and supervisor graph, show hierarchy and version history, support human-reviewed configuration proposals. Preserve current `definition` response as a projection. Show unsupported runtime/model capabilities as unavailable.

**Validation/errors/tests:** cross-company edges, cycles, self-reporting, invalid configuration, agent self-edit and activation during holds fail safely; version activation/rollback audits atomically; reopen/backfill preserves IDs and current permissions; existing organization/agent pages remain functional.

**Exit:** centralized configuration reads, versioned constitution, preserved roles and documented effective grants; no autonomous execution introduced.

## Milestone 2 — Tasks + Communication + Authority

**Objective:** track coordinated work as tasks with authorized delegation and structured handoffs.

**Files/services:** new `src/tasks.ts`, `src/communication.ts`; extend AuthorityService and existing task/chat handlers; add task-tree and communication components.

**Migration:** task metadata/parent links, input/output contracts, attempts and structured communication tables; retain legacy task IDs/status constraints through adapters.

**Dependencies:** M1 identity/config/constitution.

**Backend/frontend:** task creation, dependencies, subtasks, deadlines, supervisor/cross-department validation, typed message envelopes and human-readable history. Existing CEO chat remains separate.

**Validation/errors/tests:** tenant scoping, cyclic dependencies, unauthorized delegation, duplicate task requests, invalid output and illegal terminal transitions; task tree and reference navigation; mutations and audit rollback together. No task may become complete merely because an agent sends RESULT.

**Exit:** tasks are trackable/assignable but still blocked when no executor is configured.

## Milestone 3 — Workflow Engine + Scheduler + Events

**Objective:** durable orchestration of existing services, beginning with simulation/internal drafts.

**Files/services:** `src/orchestration.ts`, `src/events.ts`, `src/scheduler.ts`, `src/agent-runtime.ts`, `src/execution-gateway.ts`; adapt `src/automation.ts` and security review timer; workflow UI module.

**Migration:** immutable workflow template versions, runs, step runs/leases, outbox/delivery receipts/dead letters, schedule extensions and idempotency keys.

**Dependencies:** M1–2. Runtime initially uses deterministic/simulation adapters; no model is implicitly activated.

**Backend/frontend:** role-based steps, safe conditional expressions, dependency scheduling, human gates, bounded retries/deadlines, pause/cancel and traceable events. Extend current schedules rather than introduce a third timer architecture. Include one-shot, daily/weekly/monthly and validated calendar recurrence incrementally.

**Validation/errors/tests:** restart and competing-claim tests, duplicate delivery, timeout/lease expiry, event tenant isolation, denied approval stopping downstream work, uncertain external result preventing replay, company/agent/department/workflow stop and cancellation races. Browser step/run graph shows blocked/failure state.

**Exit:** one complete local simulation workflow plus failure paths. No generic live dispatch until M5–6 and integration acceptance.

## Milestone 4 — Knowledge + Memory

**Objective:** distinguish reusable knowledge from historical experience and assemble safe bounded context.

**Files/services:** `src/knowledge.ts`, `src/memory.ts`, `src/context.ts`; adapt research/learning services and current library/memory pages.

**Migration:** knowledge collections/versions/memberships/source links and memory provenance fields; legacy links preserved.

**Dependencies:** M1–3 identities/tasks/output evidence.

**Backend/frontend:** tenant/role/project-scoped retrieval, review/expiry/supersession, duplicate candidates, distinct knowledge/memory navigation and context preview with source references. Begin with text search; add FTS if justified. Embeddings are a separate optional adapter.

**Validation/errors/tests:** tenant/role filtering occurs before ranking; withdrawn/expired evidence unavailable; arbitrary model text remains unverified; context budgets enforce truncation with references; duplicate and missing-source handling explicit.

**Exit:** runtime can retrieve relevant authorized evidence without receiving the complete database.

## Milestone 5 — Approvals + Permissions + QA

**Objective:** one effective policy contract across orchestration, security and business services.

**Files/services:** `src/permissions.ts`, `src/approval-service.ts`, `src/qa.ts`; adapters around `policy.ts`, compliance gates and domain approval implementations; approval/QA UI extensions.

**Migration:** typed resource grants, policy versions, generic authorization references and QA result envelopes; retain immutable historical approval records.

**Dependencies:** M1–4; existing domain authorization remains active throughout.

**Backend/frontend:** server-owned action risk/effects, narrowly scoped exceptions for defensive work, exact expiring human approval and mandatory QA gates. Show content diff, policy version, reasons and evidence. Agent approval responses are advisory reviews only.

**Validation/errors/tests:** secret/permission escalation, self-approval, altered content, expiry/replay, stale policy, failed QA, unknown resource and conflicting holds all block; existing generation/product/campaign/learning authorization tests still pass.

**Exit:** a single effective decision at every dispatch boundary without replacing specialist validation.

## Milestone 6 — Audit + Failure Recovery + Observability

**Objective:** explain each attempt and recover safely without hiding or duplicating effects.

**Files/services:** `src/observability.ts`, `src/failure.ts`, `src/costs.ts`, shared audit/event adapters; extend recovery tooling and audit/run views.

**Migration:** correlated operation receipts, failure classifications, retry state, usage/reservation ledger and health snapshots.

**Dependencies:** M3 and M5. Hosted off-host retention remains an operational dependency.

**Backend/frontend:** explicit attempt/failure/uncertain outcomes, bounded retries/backoff, dead-letter review, worker health and audit filters. Reserve costs atomically before dispatch; distinguish actual charges from estimates. Extend logs with safe codes, never raw secret/provider payloads.

**Validation/errors/tests:** audit outage, worker restart, duplicate receipt, budget race, unconfigured provider, database failure, corrupted backup/wrong key, abandoned leases and uncertain external effects. Verify no silent exception path claims success.

**Exit:** local operational diagnosis and recovery evidence, not automatic production failover.

## Milestone 7 — Analytics + Decisions + Experiments

**Objective:** connect strategic decisions to measurable outcomes and costs.

**Files/services:** `src/decisions.ts`; extend analytics/organization/experiment/cost services and decision/result UI.

**Migration:** decision versions/evidence/outcome reviews; structured experiment results linked to existing experiments.

**Dependencies:** M4–6 provenance and runtime observations.

**Backend/frontend:** options, assumptions, chosen action, human approval references, review date and actual result. Derive workflow/task/QA/cost metrics from records; retain currency, coverage and simulation separation.

**Validation/errors/tests:** missing metrics stay unavailable; reservations are not spend; zero denominators and mixed currencies do not create false success; users/agents cannot edit their own derived scores; decisions link only company evidence.

**Exit:** evidence-backed operational and strategic review, without invented causal lift.

## Milestone 8 — Feedback + Organizational Learning

**Objective:** generalize the existing measured learning loop into controlled organizational improvement.

**Files/services:** extend `src/learning.ts`, memory/decision/experiment services; new improvement proposal service and version-diff UI.

**Migration:** generic lesson evidence and improvement proposal versions linked to current learning cycles.

**Dependencies:** M4–7.

**Backend/frontend:** reviewed lessons, uncertainty, new research/questions, prompt/workflow/knowledge change proposals, human approval and post-change measurement. No agent edits its own authority or constitution.

**Validation/errors/tests:** withdrawn evidence propagates, unsupported output cannot become verified memory, rejected proposals cannot apply, superseded versions remain traceable, comparisons cannot imply causation.

**Exit:** one complete evidence → lesson → human change → measurement loop.

## Milestone 9 — Human Command Center

**Objective:** expose the coordinated organization through the existing UI.

**Files/services:** `public/app.js` and feature modules; paginated read-model routes and shared rendering utilities; no domain logic in UI.

**Migration:** only measured read-model/index needs; avoid duplicate source-of-truth dashboard tables.

**Dependencies:** M1–8. Earlier milestones already deliver their relevant UI; this milestone integrates them.

**Backend/frontend:** company → department → agent → task → attempt drill-down, approvals, workflows, decisions, alerts, costs and schedules. Preserve all current pages and simulation labels. Keep security metadata in dedicated authorized views.

**Validation/errors/tests:** existing routes retained, pagination/empty/error/loading states, keyboard/screen-reader labels, responsive layout, stale data labels and server authorization despite manipulated frontend requests.

**Exit:** browser-verified daily management without misleading capability counts.

## Milestone 10 — Simulation + Autonomy Controls

**Objective:** demonstrate complete workflows with isolated side effects and explicit per-action authority.

**Files/services:** execution gateway/runtime/scheduler, simulation adapters, policy/config services and autonomy/control views.

**Migration:** action/environment autonomy policy versions and simulation run labels.

**Dependencies:** M3, M5, M6 and M9.

**Backend/frontend:** observe/assist/approval/limited/high autonomy settings constrained by actual capabilities, explicit publishing/spend/external toggles, workflow pause and cancellation. Keep real/simulation credentials, effects, artifacts and usage separate.

**Validation/errors/tests:** simulation cannot reach paid/real adapters; autonomy cannot override a hold, missing grant or denied human approval; all emergency controls apply at dispatch and after async boundaries.

**Exit:** one complete simulated product lifecycle and adverse path, with no live publishing claim.

## Milestone 11 — Daily Operations + Executive Briefing

**Objective:** coordinate bounded daily work and produce a useful evidence-backed briefing.

**Files/services:** `src/briefing.ts`, versioned daily operating template, scheduler/report/notification adapters and briefing UI.

**Migration:** briefing snapshot/source references and delivery receipts if not covered by existing reports/outbox.

**Dependencies:** M3–10; integration absence remains a valid explicit result.

**Backend/frontend:** daily workflow for status, authorized research/drafts/review/measurement/lessons; concise sections for work, outcomes, decisions, risks and approvals. Label facts, estimates and recommendations separately. In-app notifications first; other channels remain adapters.

**Validation/errors/tests:** absent providers produce blocked/unavailable sections, duplicate day activation cannot duplicate work, quiet unchanged reviews, actionable failures notify, every metric links to evidence and date.

**Exit:** restart-safe local operating cycle with a human-readable briefing and traceable work.

## Milestone 12 — Testing + Hardening + Production Readiness

**Objective:** satisfy explicit release gates rather than declare readiness from feature count.

**Files/services:** test suites, CI, deployment/incident/privacy/recovery documentation, gateway/provider boundaries and measured performance fixes.

**Schema:** only tested corrective migrations; PostgreSQL migration and hosted queue/identity changes receive their own compatibility plan and rollback drill.

**Dependencies:** all prior gates; configured sandbox providers, hosted identity/MFA, vault/key custody, off-host encrypted recovery/audit and owner-authorized deployment scope.

**Work:** threat model, independent security assessment, real sandbox contracts, WebAuthn/device acceptance, prompt/tool injection tests, privacy erasure across derived data/backups, dependency and secret reviews, realistic authenticated load, UI/accessibility regression and restore/failover exercise.

**Validation/errors/tests:** no unresolved critical/high security findings; no hidden unavailable capability; demonstrated session/approval invalidation during recovery; production operational SLOs, RPO/RTO and on-call responsibilities agreed and verified.

**Exit:** production readiness is an evidence-backed release decision. No deployment is implied by completing documents or local simulation.

## Completion status and next action

Completed in this architecture pass: repository inspection, current-schema/agent inventory, reusable-versus-missing assessment, baseline regression run and the three architecture documents.

Not completed: the stabilization prerequisite, organizational Milestones 1–12, full Viktor dashboard/integration acceptance, autonomous runtime or production release. Preserve the in-progress code; next implementation work should close the identified security inconsistencies and then deliver M1 as a tested vertical slice. Do not start several foundational engines simultaneously.
