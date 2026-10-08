# Phase 3 analytics

Open **Analytics & reports** and **Experiments** in the workspace. Restart the server to apply migration 004, then run a successful Shopify sync to populate history. Existing Phase 2 caches are not silently treated as historical snapshots.

Sofia owns the version-1 KPI definitions, Benjamin the deterministic comparisons and review signals, and Maria the rule-based recommendations and experiment register. These are human-triggered software workflows, not activated autonomous LLM employees. Paid model execution, schedules and external writes remain disabled.

## Data and coverage

Every successful Shopify sync upserts complete interior store-local dates in the same transaction as cache replacement and its audit. Both edge dates are excluded conservatively. Test and cancelled orders are excluded. Observed empty days record zero; missing days remain unavailable. History persists beyond the rolling cache window. Repeated reads revise covered dates without duplication. Failed syncs preserve all prior snapshots.

Each day carries company, store, currency, timezone, source run and observation cutoff. Different series cannot mix. Creation-date cohorts reflect their last observed state, not finalized accounting revenue; changes to old orders outside the 30-day cache will not be refreshed. Shopify reads themselves are not a cross-resource transactional snapshot.

KPIs: eligible orders, current order value and average order value. Value includes tax, shipping and unpaid orders; no profit, conversion, traffic, CAC or ROAS is inferred. Zero-order AOV is unavailable. Weekly comparisons use the last seven completed local days versus the preceding seven. Monthly comparisons use the last completed calendar month versus its predecessor; months have unequal durations. Both require all dates, so an initial 30-day sync generally cannot support a monthly comparison. Continue regular manual syncs to accumulate history. No scheduler is installed.

Anomaly rule: yesterday's order count is at least 50% below or above the prior seven-day daily mean. Requires eight covered dates, at least 35 baseline orders, READY connection and a source cutoff no older than one hour. This is a review heuristic, not a significance test, forecast or causal explanation. A zero comparison baseline yields no percentage change.

## Reports and experiments

Saved reports preserve immutable JSON evidence, source run references, coverage, findings and recommendations; the UI lists the latest 20. Historical reports remain available after disconnect and are labeled with their original cutoff. They do not claim current freshness.

Experiment registration captures a hypothesis, control/variant and assignment method, supported KPI, success/stopping criterion, date range and the available baseline with currency/timezone/source context. States are PLANNED → RUNNING → COMPLETED, or cancellation from planned/running. Completion requires human-reported evidence and conclusions/limitations. Completed outcomes cannot be edited through the application. No allocation engine, campaign execution, statistical inference or automated outcome measurement is implied. The register displays the latest 100 records.

All mutations require an authenticated company CEO, Origin and CSRF at the HTTP boundary, input validation, tenant scope and transactional audit. Company, analytics-department or any analytics-specialist pause blocks report and experiment mutations. Read-only historical inspection remains available. Migration 004 adds tenant-bound daily provenance, reports and experiments; secrets and customer contact details are not copied into analytics.

No live Shopify store has been verified. This remains a local pilot, not production-ready analytics infrastructure.
