# Phase 14: Organization effectiveness

Organization effectiveness is Boris's deterministic review workspace. It measures stored human-operated workflows; it does not run a model or establish autonomous agent usefulness. The dashboard uses 30 days; immutable reports support 7, 30 or 90 days and retain their UTC boundaries, definition version, source identifiers and content hash.

## Metric definitions

- Workforce: task creation cohort, current assignment/status and source task IDs. Assignment counts do not prove agent execution. Usefulness is unavailable until a human supplies a qualitative assessment with evidence and limitations.
- Research: retrieval-date cohort with current verification/freshness status. Human verification coverage is not objective accuracy. Research sources have no simulation field; this limitation is visible.
- Design: human QA review-date cohorts, split between simulation and provider assets. Pass-rate changes compare adjacent equal windows only when both have at least five reviews. Changes do not establish employee or template causation.
- Costs: attempted generation jobs created in the window, split by provider. Reservations are not spend. Actual cents come from human reconciliation, not verified invoices. Cost per successful output requires complete reconciliation coverage and at least one success; missing coverage is unavailable. Reported zero remains a valid zero.
- Campaigns: results recorded in the window, shown separately by campaign, simulation status and currency. Zero denominators yield unavailable rates. ROAS is attributed revenue divided by spend, not profit or causal lift.
- Bottlenecks: all currently open workflow records, including records older than the report window. Age is time since creation, not time in the current stage. The report counts all open records and lists the oldest 100. Blocked/uncertain statuses and records older than 24 hours are review signals.
- Automation: run creation cohort with succeeded, failed and blocked counts. Failure and blocked rates are separate and use all runs as denominator.
- Repetition: generation jobs grouped by identical brief/provider/instruction/parent asset. Repetition may represent intentional iteration; it is not proven waste.
- Activity: audit events by action and events per day. These are workflow activity proxies. Provider tool calls, token use and excessive tool use remain unmeasured without a call ledger.

## Human review and controls

Save a report, then record an agent usefulness assessment or triage one of its recommendations. Each review binds the exact saved report hash and a subject present in that report. One assessment per subject/report is immutable; use a new report for a later assessment. Notes must contain evidence and limitations rather than sensitive personnel data.

Recommendations identify evidence and a review owner. Accepting one records human consideration only: it does not alter roles, permissions, security, budgets, schedules or approvals. There is no autonomous optimization or policy-edit endpoint.

All mutations require the persisted company CEO, current stop/hold checks and same-transaction audit. Metrics and report bodies are computed on the server from company-scoped records. Saved reports preserve historical metadata; they are not a physical-erasure mechanism. This remains a local pilot, with no new external integration or production-readiness claim.
