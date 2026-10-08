# Marketing — Phase 7

Marketing campaigns activates Катерина's human-operated planning workflow. This is an internal drafting and measurement workspace, not an autonomous marketing agent or channel integration.

## Workflow

1. Select an immutable Product Factory package and fresh human-verified research sources. Simulation status and currency come from the product package. A package does not establish that a Shopify product is published or available to purchase.
2. Record objective, audience, persona, value proposition, hypothesis, creative concept, CTA, KPI, strategy, brand guidelines, customer insights, product performance, historical learning, launch plan, SEO recommendations and A/B test hypothesis/metric/allocation/stopping rule. Use explicit “unknown” statements where evidence is missing; do not invent results.
3. Set a UTC date range, channel and proposed budget in integer currency minor units. The calendar lists these plans by start date; it does not schedule or launch them.
4. TEMPLATE assembles the product title, human value proposition and CTA deterministically. HUMAN accepts written copy. Optional overrides cover variant A, email subject/preheader, social copy and landing headline; variant B is required. No model is called. Review the full plan before approval.
5. A human CEO approves the exact immutable content for ten minutes. Paid-ad plans and any positive proposed budget receive RED classification and require explicit RED acknowledgement. This approves only the internal plan/budget review, not expenditure. Marking READY consumes approval once and rechecks evidence and stop controls. There is no external dispatch endpoint.
6. Record final human-reported aggregates, attribution method, evidence, actual KPI result and lessons. Date windows must fall within the campaign and cannot be in the future. Visitors/conversions are unique exposed/converting people per variant; conversions cannot exceed visitors. Completion and result insertion share a transaction. Results are immutable; do not save provisional reports as final results.

Campaign content is immutable. To revise it, create another campaign and select the original under “Revision of”; the new version needs its own approval. Cancelled and completed plans are terminal. Cancellation remains available while stopped.

## Measurement limits

Conversion rates and their difference are descriptive. Zero exposure gives an unavailable rate. ROAS is attributed revenue divided by spend; zero spend gives unavailable ROAS. No confidence interval, causal attribution, significance or winner is inferred. Reported spend is historical evidence, never an authorization or payment. Results inherit the campaign's SIMULATION label. No recipient lists or personal customer data are collected by this phase.

## Security and integration boundaries

All mutation routes authenticate the persisted CEO, scope records to the company, validate input, and audit in the same transaction. Marketing/Anna/Garry pause controls gate approval/readiness; marketing/Sofia controls gate measurement. State is protected by existing session, Origin and CSRF checks. No new credentials, provider calls, email sending, social publishing, advertising spend or autonomous scheduling are enabled. These require separately implemented and verified adapters and action-specific authorization.

API: POST /api/marketing/create, /approve, /ready, /cancel, /measure. Read state through authenticated /api/state. Migration 008 adds campaigns and campaign_results.
