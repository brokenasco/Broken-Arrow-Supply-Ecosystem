# Phase 12: Closed learning loop

The Learning loop workspace connects the implemented local workflows without inventing a published product or causal result. Start with a completed product draft, a completed measured campaign and a fresh verified customer persona/insight. Propose a human-authored lesson, approve the exact content for ten minutes, then explicitly create the memory candidate and research question. A later research opportunity can be linked to that lesson.

## Evidence and lineage

The service resolves the campaign's product package, design asset, generation job reference, brief, opportunity, reviewed QA and current research sources within the same company. It binds identifiers and content hashes alongside the immutable human-reported campaign aggregates and customer-document hash. Customer source text is not copied into the lineage snapshot. Human confirmation is required that the customer document is relevant to the campaign; matching company is not proof of causality.

Simulation labels must match across product, asset, campaign and customer document. Missing denominators remain null; no winner, statistical significance, profit or causal lift is inferred. Product creation is a draft. Publishing remains explicitly UNAVAILABLE, including for a real Shopify draft. Store-wide analytics are not attributed to the campaign. No live delivery, marketing send or model execution is claimed.

## Human strategy and memory

Each immutable proposal separates observation, interpretation, limitations, strategy, next research question and success criterion. Confidence is human-entered, not a calibrated model score. Review dates must fall within the next 90 days. Privacy/brand pattern flags prevent proposal/approval/promotion but do not constitute complete privacy protection.

Approval authenticates the persisted CEO, binds the content hash and expires after ten minutes. Promotion rechecks source freshness, customer evidence, current lineage, review date, pause/hold state and exact approval, then consumes it once. The memory item, research-library item, cycle transition and all audit entries commit atomically. Holds and policy revisions expire learning approvals. Pending cycles can still be cancelled while paused or held.

Memory is always HYPOTHESIS / NEEDS VERIFICATION, with simulation label, evidence references and review/expiry date. Customer evidence withdrawal, dispute or expiry hides dependent lesson bodies and memory/research bodies in application state; the immutable stored history is retained and is not physical erasure. Candidate expiration marks memory stale. A new opportunity must be created after the handoff and have current verified sources before it can be linked as a follow-up. This links the next research cycle; it does not automatically run research or promote a hypothesis to fact.

## Routes and storage

Migration 013 adds learning_cycles and immutable learning_followups. All interactive POST routes require session, exact Origin and CSRF:

- /api/learning/propose: validated, idempotent proposal; conflicting request-key reuse rejected.
- /api/learning/approve: exact-content human approval.
- /api/learning/promote: single-use memory/research handoff.
- /api/learning/followup: link new company-scoped research opportunity.
- /api/learning/cancel: cancel a pending cycle.

Phase 13 automation is not enabled. The full live commercial loop remains incomplete until publishing, live integration acceptance and production controls are implemented.
