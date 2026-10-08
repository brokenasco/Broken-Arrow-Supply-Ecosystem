# Acceptance matrix — authoritative completion tracker

Status vocabulary: IMPLEMENTED AND VERIFIED; IMPLEMENTED BUT NOT FULLY VERIFIED; BLOCKED BY EXTERNAL DEPENDENCY; NOT IMPLEMENTED; DEFERRED WITH EVIDENCE AND JUSTIFICATION.

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Baseline audit | IMPLEMENTED AND VERIFIED | 154 baseline tests; current 166 tests. COMPLETION_AUDIT.md and docs/COMPLETION_VERIFICATION.md |
| Persistent owner quarantine and exact release | IMPLEMENTED AND VERIFIED | tests/quarantine.test.ts; local fixtures only |
| Precise in-flight ownership and recovery | IMPLEMENTED BUT NOT FULLY VERIFIED | Migration 027, execution-control.ts; explicit participants, generation fences, cooperative abort, stale recovery; mock image/Shopify races and real competing-process holds. Live adapter/restart acceptance remains |
| Returned provider usage survives quarantine | IMPLEMENTED AND VERIFIED | Migration 028; immutable minimized receipts; audit rollback and held-image billing tests. Reference is hashed, no raw provider payload stored |
| Complete Hole details | IMPLEMENTED BUT NOT FULLY VERIFIED | Actor, supervisor, hold, operations, recovery, retained restrictions; synthetic keyboard hold/release verified. Full mobile/high-zoom/stopping-state interaction matrix remains |
| Prison presentation | IMPLEMENTED BUT NOT FULLY VERIFIED | docs/prison-office-preview.png; further visual/accessibility work required |
| Versioned registry and constitution foundation | IMPLEMENTED AND VERIFIED | Migration 029; agent-configuration.test.ts; profile history/constitution view. Historical baseline is labeled, not invented. Owner configuration editor and runtime integration remain |
| Structured task handoff | IMPLEMENTED AND VERIFIED | Migration 030; task-coordination.test.ts; exact idempotency, reporting authority, retained held-recipient tasks, atomic audit. Owner-authored only; no autonomous agent identity |
| General organization/runtime contract | NOT IMPLEMENTED | Shared provider gateway, full workflow/event delivery and structured general messaging remain; new context/authority helpers are foundations, not a working autonomous runtime |
| Model activation | BLOCKED BY EXTERNAL DEPENDENCY | Owner will configure models; no paid activation during tests |
| Temporary transfers and task overages | NOT IMPLEMENTED | Existing reservations and permanent policies do not implement these |
| Automatic project expenditure memo | NOT IMPLEMENTED | Depends on transfer/overage records |
| Knowledge lifecycle and bounded FTS | IMPLEMENTED AND VERIFIED | tests/knowledge.test.ts; synthetic evaluation |
| Ingestion and maintenance | NOT IMPLEMENTED | Reuse current knowledge permissions/provenance |
| Full historical reporting and filters | NOT IMPLEMENTED | Current snapshots cannot recreate missing historical events |
| DOCX visual verification | BLOCKED BY EXTERNAL DEPENDENCY | Working document generation; trusted renderer unavailable in prior verification |
| Production security/operational acceptance | IMPLEMENTED BUT NOT FULLY VERIFIED | Local controls exist; live acceptance, off-host custody and independent assessment incomplete |
| Documentation consolidation | NOT IMPLEMENTED | This tracker supersedes earlier completion claims; historical docs still need reconciliation |
| Production rollout | BLOCKED BY EXTERNAL DEPENDENCY | Restore-tested operational backup and deployment authorization required |
