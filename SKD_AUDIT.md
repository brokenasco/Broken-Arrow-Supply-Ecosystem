# Shared Knowledge Database audit

Date: 2026-10-04. Inspected `src/service.ts`, `src/db.ts`, `src/learning.ts`, `src/research.ts`, policy/workflow/authentication modules, existing migrations and browser memory/research rendering before implementation.

## Existing flow

Human CEO → authenticated same-origin `/api/memory` → CompanyService validation → company-scoped `memory_items` (optional `research_items` link) + audit transaction → entire company memory in `/api/state` → browser substring filtering. Agents are stored role definitions, not authenticated autonomous runtime principals. No existing agent knowledge HTTP identity should be invented from an agent ID in a request.

SQLite WAL, foreign keys and nested transactions already work. `memory_company_category` indexes company/category/status. Source dates/URLs, evidence, classification, confidence, review/expiry, tags and supersession states exist. Research source review and learning provenance/withdrawal protections must remain. No vector database, embeddings, cache, document parser, chunker, full-text index or agent/department retrieval ACL currently exists. Background automation can review research evidence but has no dedicated incremental knowledge worker. Logs/audits and backup/restore tooling already exist and will be reused.

## Findings

1. Keep SQLite, memory IDs, research links, domain provenance, same-transaction audit and existing APIs.
2. Whole-company payload transfer plus browser filtering scales poorly; measure it against bounded indexed retrieval.
3. Memory creation has no exact/near duplicate check or immutable revision history. Repeated submissions create repeated records.
4. Freshness is partly rendered/derived but not enforced consistently by a retrieval service; there is no review queue.
5. Metadata is useful but not scoped to agent/department; do not reinterpret all existing records as globally trusted agent knowledge.
6. Human-provided confidence can be high while status remains unverified. Retrieval must cap effective confidence until an authorized review.
7. Existing content validation does not screen obvious secrets; arbitrary source text must never become an instruction or grant.
8. No paid embedding or reranking calls exist; adding a provider, vector database or cache without measured benefit would add cost and complexity.
9. General `api/state` is a CEO view, not a safe agent context. New retrieval must use independent scoped queries and bounded responses.
10. Viktor integration is incomplete and out of scope for this SKD increment; do not rely on its agent-access preview as authenticated machine identity.

## Incremental design

Reuse `memory_items` as the current content projection. Add one metadata extension, immutable version snapshots, explicit relationships/conflicts/feedback and query telemetry without query text. Add SQLite FTS5 for lexical retrieval and deterministic local concept expansion for a limited hybrid route. This is not a learned embedding model or unrestricted semantic understanding; report that distinction. Keep a provider embedding deployment deferred until relevance evaluation justifies it.

Use persisted human authority for mutations. Human-owned service calls may prepare an agent-scoped context through a validated agent view; body-supplied agent IDs only narrow access and never authenticate an agent. Private/department/org reads are filtered before candidate limiting. Only humans verify/promote; agent-attributed submissions remain candidates with capped confidence. Existing records remain accessible through their existing UI; explicit audited adoption is needed to enter scoped SKD.

Baseline and after measurements use the same synthetic dataset and process-local storage. No live business records are modified for benchmarking. Schema migration is additive and must be tested on a restored copy before an operational database is opened with the new release.
