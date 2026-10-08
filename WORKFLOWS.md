# Workflows

Phase 2 read workflow: configure company-bound server credentials -> CEO explicitly authorizes read access -> manually sync -> verify identity/scopes -> paginate and validate bounded resource reads -> atomically replace the LIVE store cache with audit -> display freshness and coverage -> Борис answers from committed data. Failure retains the old snapshot and records a safe error/notification. Stop/disconnect invalidates in-flight commit. This workflow has no Shopify mutations or autonomous execution.

Current: provision company -> log in -> inspect workforce -> create project -> assign specialist task -> inspect BLOCKED state -> cancel or retain for future execution. Duplicate project/agent/objective tasks return the existing task. Terminal tasks cannot be cancelled again. No implicit background execution occurs.

Review: create exact proposal -> pending notification -> CEO approve/reject -> append audit. No provider call follows approval. Missing tool grants and disabled external writes remain barriers.

Knowledge: record classification, evidence, confidence, source and review date -> NEEDS VERIFICATION -> searchable company memory. Research adds a retrieval record. Later verification/supersession and measured outcomes must retain lineage.

Target product workflow: Mason research -> Marisha opportunity -> Марк brief -> Jack generation -> Garry PASS/REVISE/REJECT -> Tyler product draft -> CEO publishing approval -> Катерина campaign -> Benjamin metrics -> Николай response -> Мария strategy -> memory candidate. Each arrow will be a persisted dependency, with depth/iteration budgets and no circular free-form delegation.

Future task states: QUEUED, WORKING, WAITING, WAITING FOR AGENT, WAITING FOR CEO, BLOCKED, FAILED, COMPLETE, CANCELLED. Schema supports these states; only creation as BLOCKED and cancellation are implemented. Durable leasing, retries, completion validation and dependency activation are still required.


Phase 4: human source evidence → human verification → opportunity report → Mason / Marisha / Alex / Boris reviewed handoffs → READY. Phase 5: immutable Mark brief → queued Jack generation → explicit CEO approval and run → private versioned PNG → human Garry QA → new revision or terminal review. See RESEARCH_DESIGN.md for recovery and cost reconciliation.
