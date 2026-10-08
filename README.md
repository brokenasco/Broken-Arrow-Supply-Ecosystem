# Company OS

A local executive control plane for a coordinated Shopify AI company. **Phase 0 is documented; Phases 1–10 now cover foundations, Shopify reads, analytics, human-operated research, Design Studio, Product Factory, internal marketing workflows, Customer Intelligence, Technology/UX and Operations. Live Shopify acceptance requires your store configuration. This is not production-ready and does not run autonomous model agents.**

## Run locally

Requires Node 24.15+ (24.x).

```powershell
Copy-Item .env.example .env
npm run setup
npm start
```

Setup asks for company name, CEO email and a hidden password (14+ characters). No default credentials exist. Open http://127.0.0.1:3100 and sign in. Runtime uses Node built-ins and requires no package installation. Data persists in the ignored `data/company.sqlite`. Keep this pilot on loopback.

## Phase 2: Shopify read access

Follow [SHOPIFY.md](SHOPIFY.md). Configure a dedicated read-only Shopify app through server environment variables, authorize reads in **Shopify store**, then sync. Customer reads are off by default and require both server opt-in and CEO authorization.

- Pinned GraphQL client with a closed read-only query catalog.
- Products, variants, inventory by location, 30-day order cohort, line items, refunds, fulfillments and optional minimal customer summaries.
- Bounded pagination, scopes/identity checks, timeouts, retries, atomic snapshot replacement, sync leases and audited failure recovery.
- Store dashboard with freshness, coverage, order counts/value, product rankings, low inventory, review candidates and sync history.
- Борис answers grounded in stored Shopify records. This-week boundaries use store timezone; missing/stale data is disclosed.

**No real store or credentials have been configured or live-verified.** Tests use synthetic responses. Same-organization client credentials and already-issued Admin API tokens are supported. General merchant OAuth callback installation is not implemented. Product publishing, refunds and customer messages remain disabled. Optional paid image generation now has a separate, explicitly approved Phase 5 path; no paid call has been live-verified.

## Foundation

CEO login, expiring sessions, CSRF/origin checks, companies, departments, all **23 named employees**, projects/tasks, approvals, memory, research, notifications, transactional audit, profiles, pause controls and emergency stop. The original specification states 22 employees but names 23; every named role is preserved.

Tasks remain blocked without an autonomous worker and model provider. Approval records intent and does not execute external actions. Agent profiles do not imply running LLM agents.

## Verify

```powershell
npm ci
npm test
npm run check
npm run format:check
```

[Phase 2 verification](docs/VERIFICATION_PHASE_2.md) distinguishes contract tests from live acceptance. Architecture and operations: [Phase 0](docs/PHASE_0.md), [Architecture](ARCHITECTURE.md), [Security](SECURITY.md), [Database](DATABASE.md), [Permissions](PERMISSIONS.md), [Approvals](APPROVALS.md), [Operations](OPERATIONS.md).

Phase 3 now adds persistent daily KPI snapshots, weekly/monthly comparisons with coverage checks, anomaly review signals, immutable reports and a human-managed experiment register. See [Analytics](ANALYTICS.md) and [Phase 3 verification](docs/VERIFICATION_PHASE_3.md). Next: validate a real Shopify sandbox/store. Autonomous LLM execution and hosted production hardening remain pending.


## Phase 4–5: research and design

Use **Market & product research** for source provenance, freshness, competitor/trend observations and reviewed opportunity reports. Use **Design Studio** for immutable briefs, approval-bound generation jobs, private versioned PNGs, human QA and revisions. A local simulator is clearly labeled; the optional OpenAI adapter is disabled until explicitly configured and approved. See [Research & Design guide](RESEARCH_DESIGN.md) and [verification](docs/VERIFICATION_PHASE_4_5.md).

## Phase 6: Product Factory

[Product Factory](PRODUCT_FACTORY.md) adds immutable templates, variants, cost-based price proposals, copy/SEO, private schematic placement proofs, collection selection and explicitly approved Shopify DRAFT creation. Simulation is local and visibly labeled. Media upload and print-provider fulfillment remain unfinished; live Shopify acceptance is pending.

## Phase 7: Marketing

[Marketing workflows](MARKETING.md) provide campaign plans, a UTC calendar, deterministic template copy, email/social/landing drafts, launch and SEO planning, A/B test design, internal approvals and human-reported measurements. No sending, publishing or paid spending is enabled. Paid-ad plans retain RED review. Verification: [Phase 7](docs/VERIFICATION_PHASE_7.md).


## Phase 8: Customer Intelligence

[Customer workflows](CUSTOMERS.md) add redacted Voice-of-Customer evidence, persona and insight versions, recurring complaint signals, support classification, response drafts and local support analytics. Андрей remains draft-only. Evidence is human-reviewed; no helpdesk integration, customer messages, refunds or autonomous model execution are enabled. [Verification](docs/VERIFICATION_PHASE_8.md).


## Phase 9–10: Technology & Operations

[Technology & UX](TECHNOLOGY.md) adds bounded homepage checks, manual accessibility/mobile evidence, immutable recommendations, approval and Sarah's internal improvement pipeline. [Operations events](OPERATIONS_EVENTS.md) adds signed webhook reception, deduplication, minimized storage, manually processed alerts and incidents. Production deployment, webhook subscriptions and live acceptance remain pending. No remote business actions are performed.


## Phase 11: Quality & Compliance

[Compliance workspace](COMPLIANCE.md) adds company-wide holds, exact-content privacy/brand reviews, human remediation release and immutable audit-range reviews. The optional content gate is explicitly enabled by the CEO. [Verification](docs/VERIFICATION_PHASE_11.md).

## Phase 12: Learning loop

[Learning loop](LEARNING_LOOP.md) connects product/campaign lineage and customer evidence to human-reviewed lessons, memory candidates and new research questions. Simulation remains separate, approval is single-use, and publishing remains unavailable. [Verification](docs/VERIFICATION_PHASE_12.md).

## Phase 13: Bounded automation

[Automation](AUTOMATION.md) adds an opt-in local timer, immutable schedule authorization, run budgets, pause/hold enforcement, durable outcomes and atomic internal draft creation. Research and UX schedules review stored evidence; paid generation, remote product creation, live monitoring and sending remain separately gated. [Verification](docs/VERIFICATION_PHASE_13.md).

## Phase 14: Organization effectiveness

[Organization review](ORGANIZATION.md) adds source-backed workflow metrics, QA comparisons, cost coverage, bottlenecks, immutable reports and human usefulness/recommendation assessments. Missing agent-execution and provider-tool evidence remains explicitly unavailable. Recommendations cannot change permissions or approval controls. [Verification](docs/VERIFICATION_PHASE_14.md).

## Phase 15: Local hardening and release gates

[Hardening](HARDENING.md) adds encrypted SQLite backup/inspection restore, HTTP limits, source secret scanning and CI checks. Production acceptance remains blocked by the documented hosted, privacy and live-integration gates. [Verification](docs/VERIFICATION_PHASE_15.md).

## Shared Knowledge Database

[Shared Knowledge](SHARED_KNOWLEDGE.md) adds scoped FTS/concept retrieval, bounded context, human verification/promotion, immutable revisions and contradiction review using the existing SQLite memory projection. [Audit](SKD_AUDIT.md), [verification](docs/VERIFICATION_SKD.md), and [benchmark](docs/SKD_BENCHMARK.json). Back up before starting the release on an operational database: migration 019 is additive but runs on database open. Legacy adoption, document ingestion and learned embeddings remain future stages.


## Current local foundations

Pixel Office (`#office`) visualizes existing company state and provides human-led context-review meetings. Memo Center (`#memos`) supports preserved executive records, search, revisions and audited review. AI Resource Center (`#resources`) shows the new dollar-based accounting foundation. See [Pixel Office](PIXEL_OFFICE.md), [Executive Memos](EXECUTIVE_MEMOS.md), [AI Resources](AI_RESOURCES.md) and [verification](docs/VERIFICATION_EXECUTIVE_FOUNDATION.md). Autonomous model meetings, scheduled memo reporting, DOCX/PDF exports and full paid-provider budget enforcement remain unfinished. Back up and restore-test operational databases before applying new migrations.
