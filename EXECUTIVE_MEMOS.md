# Executive Memo System — records foundation

**Historical foundation checkpoint.** The current implementation includes completed-period reporting, human evaluations, permanent budget decisions and DOCX/PDF exports. See [Executive reporting and governance](docs/EXECUTIVE_REPORTING.md) for current behavior, tests and limitations. The original milestone list below records the earlier audit rather than today's delivery status.

Implementation checkpoint: 2026-10-07. This is the first tested milestone, not the complete ten-phase reporting/governance system.

## Audit and reuse

The application uses Node 24 native TypeScript, a single SQLite database, persisted CEO sessions, company-scoped services, transactionally committed audit, a vanilla browser dashboard and the existing agent hierarchy. No authenticated autonomous agent runtime exists. ResourceService provides an accounting foundation but does not yet cover live paid dispatch, temporary transfers or task overage approvals. OrganizationService already contains evidence-based organizational reporting and human assessments; those should supply future evaluations instead of being duplicated.

New files: migration 022, `src/memos.ts`, `public/memos.js`, and memo/office tests. Server routes, dashboard navigation, the office adapter, migration registration and recovery validation were extended. No dependencies, separate database, queue, model calls or new agents were added.

## Implemented

- Official submissions use seven required narrative sections plus automatically generated record information. Human authorship on behalf of a registered leader is explicit; the system does not impersonate an AI-generated assessment.
- A central memo-type registry contains the 15 requested codes. Department codes are assigned and retained on first submission; collision suffixes support additional departments. Numbering uses UTC year, department, type and sequence inside SQLite BEGIN IMMEDIATE. The primary key prevents duplicate IDs within a company. IDs are company-local, never authorization credentials.
- Submitted content, sender name/title, human submitter and timestamp are immutable through database triggers. Revisions and addenda are separate records linked to the original (`-R1`, `-A1`, etc.). Archived originals remain readable and searchable.
- Review history is append-only. Supported states are UNREAD, REVIEWED, ACTION REQUIRED, MODIFICATION REQUESTED, CLOSED and ARCHIVED. This milestone submits directly rather than persisting editable drafts. APPROVED/DENIED are deliberately not offered until exact-action approval integration exists.
- Company-scoped FTS5 searches memo ID, subject and section text, with department/type/priority/status filters. Results are bounded to 100; narrower queries retrieve older records. Pagination, reporting-period filters and arbitrary related-record links remain future work.
- Memo Center supports compose, view, revision, addendum, owner review and archive. Opening an unread memo records review. Pixel Office links directly to the relevant memo. Unresolved action-required memos continue to surface after reading; closed/archived records do not.

## Authority and retention

All API access requires the persisted CEO session. Mutation routes use the existing Origin/CSRF boundary and 30 requests/minute per human for memo POST routes. Submission uses current company controls and transactional audit. Owner review remains available during an automation stop; it has no execution authority. Other agents have no direct access, including to executive evaluations. A future machine read API must implement explicit category/scope authorization before knowledge integration.

Memo review cannot change financial limits, spend, approve tools, grant permissions or execute an action. There is no memo approve endpoint. The five requested priorities classify correspondence, not authority. Input validation and heuristic credential screening reject recognized secrets; these patterns are not proof of complete secret detection. Narrative claims remain human-reported, not verified metrics.

Retention is append-only at the application/SQL-trigger boundary. Local filesystem administrators can still alter SQLite; this is not external tamper-proof archival or encrypted storage. Use the existing encrypted backup/recovery procedure. Do not store live secrets or unnecessary personal information in memos.

## Next milestones, in order

1. Reporting-period metadata and locked, idempotent monthly close based on immutable ledger/allocation snapshots. USD remains authoritative; tokens are usage counts. Incomplete ledger coverage must remain visible.
2. Integrate assessed temporary transfers, task-specific overage authorizations and post-project expenditure memos once those budget workflows exist. Never infer approval from prose.
3. Reuse OrganizationService evidence for monthly agent/department assessments, with explicit unavailable data and provenance. No invented efficiency ratings.
4. Completed-quarter COO reviews and proposed permanent allocations, preserving the $5/equal-allocation default until a separately approved policy change takes effect.
5. Immutable exact-action, expiring, single-use human decisions and separately validated execution. Approval, execution and memo status must remain distinct.
6. Scheduled reporting requirements, notification deduplication, full metadata filters, role-scoped knowledge retention and trends.
7. Real DOCX/PDF generation with matching professional templates, tables, pagination, export audit and rendered-document verification.
8. Failure recovery, production migration rehearsal and rollout after the relevant controls have acceptance evidence.

No operational database was migrated or deployed for this checkpoint. Opening a database with this release applies migrations 020–022 when missing: take an encrypted backup, restore and test a separate copy, then validate the application before changing an operational instance. Rollback should restore the verified pre-migration backup; do not delete official memo tables to downgrade.

See `docs/VERIFICATION_EXECUTIVE_FOUNDATION.md` for checks and screenshots.
