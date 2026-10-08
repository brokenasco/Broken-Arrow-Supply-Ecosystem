# AI Resource Management — architecture and staged delivery

Current implementation update: approved paid-image dispatch now uses central reservations and human billing reconciliation (migration 024). Memo-bound, expiring, single-use owner decisions can establish future permanent department defaults and explicit worker allocations (migration 025). Completed-period reports and DOCX/PDF exports are implemented. See [Executive reporting](docs/EXECUTIVE_REPORTING.md). The original audit below describes the earlier foundation; no autonomous text-model runtime is implied.

Audit: 2026-10-07. Existing agents/departments and hierarchy are retained.

## Existing boundaries

Node 24 native TypeScript, SQLite WAL/BEGIN IMMEDIATE transactions, persisted human CEO sessions, same-origin/CSRF HTTP, transactional audit and vanilla browser panels are reusable. There is no authenticated autonomous text-model runtime or pixel-art office/speech-bubble UI. Existing notifications and worker/department panels are the appropriate integration points; no replacement office will be invented.

`DesignService.run` is the only implemented paid inference dispatch. It already has immutable payload approval, expiring single-use human authorization, cumulative company reservation limits, daily limits and uncertain-outcome reconciliation. `generation_jobs` and `generation_reconciliations` must remain. Shopify, monitoring and breach requests are not model inference. Registry `dailyCents` values are configuration, not a complete usage ledger. SKD already bounds retrieved context without remote embedding calls. Simulation has no paid cost.

Image usage currently retains only aggregate token counts; image modality prices cannot safely be inferred from text-token prices. Pricing is not currently centralized. No live prices or model capability claims will be invented. Owner-configured versioned prices must describe accounting conventions and sources. Provider billing is distinct from calculated cost based on reported usage.

## Design decisions

- USD is authoritative. Store integer microdollars (1 USD = 1,000,000 units), calculate token charges with BigInt, and round the total upward at the microdollar boundary. Never use floating-point money balances.
- Default budget is 5,000,000 microdollars per department per UTC calendar month. Equal active billable allocations differ by at most one microdollar; deterministic ID ordering distributes indivisible remainder. Department totals never change because membership changes.
- Calendar months are ledger partitions, not destructive counter resets. Transfers/overrides/authorizations must be month-bound. No rollover or automatic redistribution is authorized.
- Existing paused agents are excluded from active allocation. Separate owner-controlled non-billable flags allow deterministic workers to remain visible. Historical consumption stays charged to its original department even if membership changes.
- Immutable pricing revisions pin every reservation and charge. Cached tokens are a subset of reported input tokens, charged once at their own price. Separately billed reasoning must be explicitly separate from output; never double-count included reasoning.
- Atomic reservations precede dispatch. Unknown/timeout outcomes retain reservations across month boundaries until reconciliation; resetting the calendar must not unlock another month of uncertain spending.
- Estimated/reported usage, calculated expense and invoice-confirmed expense are distinct. Unexpected actual overage must be recorded honestly and block further work; a local reservation cannot undo provider charges already incurred.
- Only persisted humans change financial controls or authorize funding. Budget permission never bypasses security, tool authorization or existing workflow approval.

## Milestones

1. Audit, additive schema, exact-money pricing engine, monthly equal allocations, immutable ledger, reservations and reconciliation with adversarial tests.
2. Explicit human funding decisions (overage vs assessed transfer), expiring single-use authorization, project expenditure memos and monthly reports.
3. Paid-adapter enforcement/reconciliation, conservative routing, task runtime/call limits, measured cache reuse and warnings.
4. Worker/department/office dashboards integrated into existing UI, owner settings and notifications.
5. Concurrency, migration/restore and full regression verification; live provider billing/production deployment remain gated by real configuration and acceptance evidence.

No operational database is to be opened with a new schema before encrypted backup and isolated restore validation. No paid calls or deployment are needed for tests. This document will track the implemented boundary rather than describing unfinished integrations as complete.


## Implemented checkpoint — 2026-10-07

Migration 020, ResourceService, exact-money calculations and Resource Center are implemented and covered by nine resource tests including a two-connection reservation race. Default budgets, equal allocations, monthly partitions, owner monthly overrides, pinned pricing, immutable charges, reservations/reconciliation, uncertainty holds, task cost/call limits and threshold notifications are present. Pixel Office now exists as a separate presentation layer.

Live paid adapters are not connected to this ledger. Assessed transfers, task-specific overage approvals, permanent policies, expenditure memos, monthly reports, correction service, model routing and measurable cache savings remain unfinished. No complete provider invoice or production financial enforcement is claimed. The Memo Center record foundation is available for the next reporting integration; it does not itself fund requests.
