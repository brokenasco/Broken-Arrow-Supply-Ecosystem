# Shared Knowledge foundation verification

2026-10-06, Node 24.15 local Windows workspace. Synthetic evidence only; no external model/API execution, publishing, spending or operational database migration.

## Automated coverage

`npm test`: 125 passing tests, including eight SKD suites covering:

- tenant, private agent and department read isolation before retrieval; invalid/forged principals;
- human-only review, immutable snapshots, version conflicts, verification reset, promotion and archive;
- exact duplicate reuse without discarding distinct source evidence or case-sensitive content;
- recognized secret patterns, unknown fields, malicious query text and prompt-injected document content remaining untrusted data;
- context ceilings, expiration and contradiction exclusion, explicit stale status, feedback preserving evidence;
- rollback of content/index/version on audit failure;
- HTTP authentication, CSRF, narrowed history denial, full review/search round trip, invalid input and request rate limiting;
- migration 18→19 preserving legacy memory and research rows, transactional rollback, FTS installation and foreign-key integrity.

Final checks passed: `npm run check` (TypeScript and browser syntax), `npm run format:check`, and `npm run security:scan` (148 source files, zero pattern findings). The existing full suite includes encrypted backup/inspection restore and all prior workflow regressions. Verification completed across October 6–7.

## Browser verification

An isolated in-memory server on port 3114 had workers disabled and one clearly labeled SIMULATION record. Verified login, Shared Knowledge navigation, default human-owner search, `bike` finding `Bicycle`, Alex receiving no Mason-private result, human revision saving version 2, and history retaining versions 1 and 2. Browser testing caught and fixed an optional read-view selector incorrectly marked required. No user database was used. Screenshot: [knowledge workspace](skd-knowledge.png).

## Before / after

Reproduce with `node scripts/skd-benchmark.ts`; [JSON report](SKD_BENCHMARK.json) includes the actual query plan. 5,000 synthetic rows, four fixed relevance queries, ten warmups, fifty measured calls; in-memory SQLite, same corpus for both paths. The initial historical capture remains [SKD_BASELINE.json](SKD_BASELINE.json).

| Measurement | Full-row fetch + browser-equivalent substring | Scoped FTS/concept service |
| --- | ---: | ---: |
| P50 | 11.26 ms | 0.28 ms |
| P95 | 14.62 ms | 0.40 ms |
| P99 | 16.77 ms | 0.54 ms |
| Recall@10 on four questions | 0.75 | 1.00 |
| Mean serialized context | 1,815 bytes | 516 bytes |
| Paid embedding calls | 0 | 0 |

The measured first implementation regressed (P95 about 208 ms) because the query planner nested FTS against company rows. FTS-first CROSS JOIN corrected it; permission conditions remain before candidate LIMIT. The final timings include retrieval counters and transactional audit. Context sizes compare different return shapes and numbers of matches, not a controlled compression ratio. Four questions cannot establish general relevance, production scale, concurrency or learned semantic quality. No performance claim applies to the still-existing whole-company `/api/state` payload.

## Remaining acceptance work

Legacy knowledge adoption, ingestion/chunking, near-duplicate detection, automatic contradiction detection, incremental maintenance, larger relevance/soak tests, actual authenticated agent execution and production operations remain open. Pattern screening cannot guarantee that arbitrary secrets are absent. See [Shared Knowledge](../SHARED_KNOWLEDGE.md) for exact APIs, migration/backup procedure and next milestones.
