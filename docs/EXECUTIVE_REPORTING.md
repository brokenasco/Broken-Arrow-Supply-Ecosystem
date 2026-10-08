# Executive reporting and budget decisions

The Memo Center shares the existing company database, CEO authentication, registered leaders, notifications, Pixel Office navigation and transactional audit. It adds no separate agent runtime or model calls. This document supersedes the earlier foundation milestone list in EXECUTIVE_MEMOS.md.

## Completed-period reports

Migration 023 and ExecutiveReportService implement completed UTC month/quarter validation, atomic idempotent close and immutable evidence hashes. Monthly reports contain department and agent expenditures, task summaries, allocation snapshots and token/call counts. Quarterly reports cover department heads and the COO's organization-wide allocation review, including recorded average, median, peak and low monthly costs.

Human ratings bind exact evidence and qualifying supporting records. Quarterly head assessments may cite departmental work. Missing quality evidence remains unavailable; low spend alone never establishes efficiency. Agent membership and task states are observed at generation, not reconstructed historical states. Missing ledger coverage never means zero provider billing.

Owner-enabled reporting runs once a minute while the application is running. It processes one missing monthly period per tick, then completed quarterly reviews. It defaults off. Outstanding reserved/uncertain calls block financial close. Failures preserve prior records, produce a deduplicated alert and audit, and cannot change budgets. Submitted reports remain fixed when later adjustments arrive.

## Financial owner decisions

Migration 025 and MemoGovernanceService implement immutable ten-minute content-bound proposals and single-use human decisions. The Memo Center offers approve, deny, modification request and information request. Ordinary memo review has no financial authority.

Proposals specify department, future effective month, monthly USD limit and optional explicit amounts for every active billable worker. Amounts must sum exactly to the department limit; an empty list preserves equal shares. Memos disclose monthly and annualized budget changes. Approval inserts the decision and policy in the same transaction as audit. Expiration, replay, stale policy/membership or failed audit blocks application.

The approved policy becomes the permanent default from its effective month. Existing monthly overrides still expire. If approved membership changes, or a monthly override changes the total, equal allocation applies; this is disclosed before approval. All paid-request gates remain active. Financial decision status is separate from memo review status and appears in review history.

## Word and PDF exports

Authenticated CSRF-protected POST requests generate actual DOCX/PDF files using docx and pdfkit. Both include memorandum metadata, sections, report tables and page numbers. Names include memo ID, date and subject. An audit commits before returning bytes. Exports are generated from retained records and never placed in public static storage.

PDF requires a Unicode TrueType font: MEMO_PDF_FONT, Windows Arial or Linux DejaVu Sans. Missing fonts return an explicit error. scripts/verify-memo-exports.ts generates synthetic samples in ignored data/export-qa. PDF pages were rendered and inspected; footer pagination was corrected. DOCX structural checks pass, but visual DOCX verification is blocked by the missing packaged LibreOffice renderer on this machine.

## Paid image accounting

Migration 024 links approved image jobs to internal tasks and central resource reservations. Paid dispatch requires active model pricing and atomic worker/department/task reservation before provider execution. Existing exact expiring image approval remains mandatory.

Image usage lacks the detail needed for reliable token-rate cost calculation. Successful output retains an uncertain billing reservation until human reconciliation, which atomically records both central ledger and design billing. Coherent aggregate provider token counts are retained; unknown cached/reasoning counts stay null. Human-entered cost is labeled estimated, not independently invoice-verified. Failures retain funds and never automatically retry. Legacy jobs are not silently backfilled.

## Verification and operating boundary

Tests cover completed periods, idempotency, unresolved billing, evidence preservation, owner assessments, tenant separation, scheduling, real export containers, PDF page counts, authenticated HTTP download, CSRF, exact decisions, expiration, replay, changed membership, policy start dates, audit rollback, paid dispatch denial and reconciliation. All providers are mocked. The isolated UI fixture exercises proposal creation and approval in the dashboard.

Opening a saved database applies migrations 023–025. Take an encrypted backup, restore and test a separate copy before operational restart. No operational migration, paid API call or production deployment was performed. SQLite triggers protect application history, not against filesystem administrators.

Remaining implementation scope: temporary agent transfers, task-specific overage grants and their automatic post-project expenditure memos; complete historical pagination and metadata filters; role-scoped machine access. These capabilities cannot be inferred from ordinary memo prose or permanent policy approval.
