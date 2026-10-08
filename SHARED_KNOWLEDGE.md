# Shared Knowledge Database

Updated 2026-10-06. This increment implements the audited retrieval and human review foundation. It does not complete the entire 40-phase SKD specification. See [audit](SKD_AUDIT.md), [verification](docs/VERIFICATION_SKD.md), and [measurements](docs/SKD_BENCHMARK.json).

## Architecture and reuse

The existing Node 24 / SQLite monolith remains. `memory_items` retains current content, IDs, evidence, dates and lifecycle status. Migration 019 adds `skd_metadata`, immutable `skd_versions`, version-bound `skd_relations`, `skd_feedback`, aggregate-only `skd_searches`, and FTS5. Existing research/learning paths remain intact. There is no new database, queue, model provider, paid embedding service or cache.

Knowledge means reusable evidence. The existing memory/learning records still represent observations and historical outcomes. Adding metadata to the current content projection avoids a duplicate content store; immutable snapshots intentionally retain historical versions. Existing legacy rows are **not automatically trusted, indexed or assigned a new scope**. They remain in Company Memory and Research. Explicit adoption with research/learning withdrawal checks is the next milestone.

Flow: human session → input and credential screening → company-scoped transaction → memory projection + metadata + snapshot + FTS triggers + audit → scoped retrieval → bounded evidence context. No autonomous agent runtime is introduced.

## Object schema

Current content fields reuse `memory_items`: ID/company, title/body, classification, evidence, source URL/date, author, timestamps, confidence, status, tags, review and expiration dates. Metadata adds responsible agent/department, access scope, knowledge type, sensitivity, summary, source type, topic/project, importance, version, SHA-256 content hash, human verifier/time, concept-model metadata and retrieval counters.

The taxonomy has 17 types, including FACT, POLICY, RESEARCH, ASSUMPTION, HYPOTHESIS and AGENT_NOTE. Notes, assumptions and hypotheses cannot be verified into facts through this endpoint. Flexible metadata stores the deterministic concept vector, not hidden reasoning. No learned embedding columns are added without a selected provider and demonstrated relevance benefit.

Snapshots retain the complete reviewed record and its author/time/hash. SQL triggers prevent updating or deleting versions through normal database operations. A filesystem/database administrator can bypass local controls; this is not off-host tamper-proof storage.

## Permissions and human authority

All APIs require the existing persisted CEO session. POSTs additionally require exact Origin and session CSRF. Content mutations use `HumanWorkflow` and commit audit in the same transaction, respecting company stop/compliance/security controls. Retrieval remains available for human investigation during a stop; its counters and audit commit atomically.

`agentId` is a **human-owned narrowed read view**, never an authentication claim. Such views can read only INTERNAL organization records, their department records, and their own private records. Paused agents are rejected. Executive, security-restricted and system scopes require the human view. Restricted sensitivity is excluded from every agent view. Historical snapshots are human-only. Request bodies cannot elevate the authenticated principal. Agents cannot verify or promote records.

The browser workspace is a CEO interface; the existing `/api/state` still includes company memory for that owner. It must never be used as agent context. Server-to-server machine identity, granular authenticated agent writes and context assembly into an actual model remain future work.

## Retrieval

Routes: DIRECT ID lookup, KEYWORD, HYBRID, RECENT and AUTHORITATIVE. Filters include scope, knowledge type, project, minimum effective confidence and fresh-only. SQL applies company and narrowed read scope before the 80-candidate limit. Rejected, superseded and expired records are excluded. Open current-version contradictions are excluded before ranking/output. Historical/direct inspection exposes status and trust labels; it does not certify usability.

FTS5 retrieves lexical candidates. HYBRID expands a small documented dictionary and adds cosine similarity over seven binary concepts (bicycle, customer, security, credential, revenue, design, research). **This is limited concept matching, not general semantic embedding search.** Keyword search avoids concept scoring. No remote calls occur.

The deterministic score is 45% query-token overlap, 20% concept similarity in HYBRID, 10% effective confidence, 10% human verification, 10% freshness, 5% importance. FTS rank selects the initial candidates; RECENT sorts by update time. Unverified effective confidence is capped at 0.49. Freshness is FRESH, AGING (within seven days of review), STALE (review overdue or explicitly stale), or EXPIRED. AUTHORITATIVE requires active human verification and a future review date.

At most 20 results and 80 candidates are considered. Equal content hashes collapse in returned context, not in storage. `maxTokens` is conservatively implemented as a **256–8000 UTF-8 byte ceiling on serialized result items**, not exact model tokenization. Truncation is explicit; oversized metadata can cause a record to be omitted. Inspect/get is separate from model-context retrieval and can return a complete record. Result metadata labels all content as untrusted data.

The measured query regression was fixed by putting FTS first with CROSS JOIN, then row-ID and composite-key lookup. Tenant/scope filters still precede LIMIT. No query cache was justified. Search telemetry records route, result count, duration and bytes, never query text. Internal duration excludes telemetry commit; the benchmark measures the entire search service, including that commit.

## Lifecycle, provenance and review

Creation requires evidence, responsible agent, source type, summary, topic, type and future review date. Initial scope is private or department; initial confidence cannot exceed 0.49. SHA-256 uses exact content, preserving case and Unicode distinctions. Duplicate suppression requires matching scope, authoring agent, source and other candidate metadata; differing provenance remains a separate record. Near-duplicate candidate relationships can be recorded manually; automatic similarity deduplication is not implemented.

Updates require the current version, preserve history, clear human verification and cap confidence. Unchanged content does not create a new version. Verification requires explicit human evidence review, future revalidation, non-expired evidence and no open contradiction. It records the human identity/time. Confidence remains a human assessment, not an independently computed truth score.

Promotion requires a fresh/aging verified uncontested version and explicit human confirmation. Restricted content cannot be promoted into department/organization scope. Archiving removes current retrieval eligibility while preserving snapshots. Feedback records USEFUL, OUTDATED, INCORRECT, DUPLICATE, INCOMPLETE or CONTRADICTORY without deleting or automatically changing evidence.

Relationships pin both endpoint versions: CONTRADICTS, SUPPORTS, DERIVED_FROM, RELATED_TO, DUPLICATE_CANDIDATE. Contradictions are reported by humans in this increment, not inferred by an LLM. An open contradiction blocks default retrieval and editing/verification/promotion/archiving until reviewed. Resolution requires an accepted endpoint and rationale, rejects stale endpoint versions, marks the rejected record stale, clears its verification, preserves history and resolves the relation. Acceptance does not automatically verify the winning claim.

## API and UI

`GET /api/knowledge/overview`: counts, bounded due-review queue, up to 100 recent relationships, seven-day search aggregates.

Authenticated CSRF-protected POST routes under `/api/knowledge/`:

| Route | Input / purpose |
| --- | --- |
| search | query, mode, agentId, scope, knowledgeType, projectId, minimumConfidence, freshOnly, maxResults, maxTokens; id for DIRECT |
| get | id, optional narrowed agentId |
| history | id; at most 50 latest immutable versions, human only |
| create | title, content, summary, source, sourceType, agentId, scope, knowledgeType, topic, reviewAt; optional sourceUrl/sourceDate/validUntil/projectId/tags/sensitivity/importance/confidence |
| update | id, version, title, content, summary |
| verify | id, version, evidenceReviewed=true, confidence, reviewAt |
| promote | id, version, scope, confirm=true |
| archive | id, version |
| relate | leftId, rightId, kind |
| resolve | relation id, acceptedId, reason |
| feedback | id, version, kind |

The HTTP group has a local per-human limit of 60 requests/minute. This is process-local, not distributed rate limiting. Request bodies retain the existing 32 KiB ceiling. SQL parameters and allowlisted route dispatch prevent query/method injection.

Open **Shared knowledge** in the sidebar. The page loads bounded results separately from application state, supports narrowed reads, candidate submission, exact-version revision/verification/promotion, conflict review and history. It visibly identifies the local pilot and retains the shell's simulation/data labels. Existing memory and research screens remain available.

## Security and failure behavior

New knowledge and legacy manual memory submissions reject recognizable credential patterns (private-key headers, common provider tokens, password/key assignments, bearer values, credentialed URLs). Unknown create fields are rejected. This is a defense-in-depth heuristic, **not a guarantee that arbitrary or obfuscated secrets can be detected**. Vault material must never enter these routes. URLs are recorded only; no ingestion fetch or document execution occurs. UI text is escaped and external instructions remain data. No model receives authority from a retrieved record.

Audit contains action/result identifiers and safe summaries, not knowledge content or searches. Full content intentionally exists in authorized current records and immutable snapshots, so screening occurs before persistence. Transaction/audit failure rolls back record, index and version writes. Optimistic version conflicts require rereading the latest content. Search/index failures report errors rather than safe/empty success.

## Migration and recovery

Migration 019 is additive and automatically runs when `openDatabase` opens an older database. **Before starting this release on an operational database**, stop workers/server, create an encrypted backup using the existing `npm run recovery -- backup SOURCE NEW_ARCHIVE`, restore it to a new inspection path with `restore-inspect`, and verify integrity and evidence counts. Supply BACKUP_KEY through approved local key custody; never place it in documentation or prompts. See [Hardening](HARDENING.md) for the established recovery procedure and temporary plaintext-copy limitations.

First migrate an isolated restored copy with workers/providers disabled; compare memory/research counts and identifiers and run foreign-key/integrity checks. Migration rollback inside a transaction is tested. Operational rollback is restoration of the pre-migration backup with the previous release, after separately preserving any new writes; there is no destructive down-migration or claim of automatic rollback across concurrent writes. Never run an old writer against a migrated operational database without compatibility review.

This increment tested synthetic/in-memory databases only and did not open or migrate the user's operational database. Existing encrypted recovery tooling now recognizes schema 19. Automated backup scheduling, off-host custody, restore drills for actual business data and production encryption remain operational work.

## Remaining stages and simplicity review

1. **Complete:** repository audit, additive schema, scoped bounded FTS/concept retrieval, transactional human review/history/conflicts, UI, adversarial/HTTP/migration tests and synthetic measurements.
2. **Next:** explicit legacy adoption that preserves research/learning revocation, structure-aware text ingestion with provenance, bounded duplicate suggestions and larger fixed relevance fixtures. Do not bulk-promote old memory.
3. **Then:** incremental maintenance/revalidation, richer failed-search analysis and retention policy, backup restoration of populated SKD snapshots, operational latency/storage metrics.
4. **Evidence-gated:** learned embeddings and model migration only if realistic relevance evaluation justifies cost; cache only if measurements justify it; actual agent identity/context integration only with deterministic gateway permissions.

No document parsers, embeddings, new infrastructure, automatic contradiction resolver or background worker are claimed here. General-purpose vector search and the full SKD definition of done remain incomplete. The architecture remains one service module plus a small utility module, existing transactions/recovery, SQLite tables/index and a dependency-free UI.
