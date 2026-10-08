# Approval matrix

| Risk | Examples | Default authority | Foundation behavior |
|---|---|---|---|
| GREEN | Internal research, analysis, copy drafts, recommendations | Granted specialist within limits | Can store CEO-created internal work; no autonomous provider runs |
| YELLOW | Product publishing, live prices, campaigns, customer sends, storefront content, discounts, collections | CEO approval by default | Proposal and decision records only |
| RED | Paid ads, refunds, bulk price changes, deletion, security/payment configuration, new scopes, financial commitments | Explicit CEO authorization always | Proposal and decision records only |

All refunds are RED until the CEO sets a reviewed threshold. No customer messages are sent. Default budgets are zero. A proposal cannot change financial authority merely by labeling itself GREEN or YELLOW: the future gateway must derive risk from a server-owned tool registry. The current CEO proposal form is a planning record, not an executable gateway.

Approval binds company, agent, tool, risk and SHA-256 canonical payload hash. It expires after 24 hours. Only PENDING records may be approved/rejected. An agent identity cannot approve, even its own proposal. Policy checks reject changed payload, expired, missing, rejected or consumed approval. Grant and pause checks remain mandatory even with approval. Future execution must atomically consume approval and persist idempotent dispatch; consumption is not wired to any executor in Phase 1.

CEO decisions and proposal creation are transactional with audit. Emergency stop does not erase approvals. Resume does not bypass grants, individual pauses or expiry. Significant changes require a new proposal.


Phase 5 image approvals live in generation_jobs and appear in Design Studio, separately from foundation action proposals. The authenticated CEO approves the exact immutable payload hash, including brief, provider/model, parameters, prompt, revision and reservation. Approval expires after ten minutes and is consumed exactly once before dispatch. QA verdicts are recorded human inspections, not agent approvals, and never authorize publication.
