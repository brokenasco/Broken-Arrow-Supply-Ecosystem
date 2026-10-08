# Database

Phase 2 migration 003_shopify_reads.sql adds tenant/store-scoped products, variants, location inventory, orders, line items, refunds, fulfillments and optional customer summaries. Composite foreign keys enforce ownership. shopify_connections records authorization, last verified scopes, timezone/currency, coverage, generation and lease; shopify_sync_runs records attempts and safe failure codes. Full sync atomically replaces one store's cache and retains the prior snapshot on failure. LIVE rows do not relabel the original DEMO store. Money uses integer currency minor units. The migration runner now applies versions 1, 2 and 3 in order.

Migration: migrations/001_foundation.sql. Applied once using schema_migrations under an immediate transaction. SQLite WAL and foreign_keys are enabled on every open. Records use UUIDs, UTC ISO timestamps, integer currency units where present, JSON validity constraints and composite tenant foreign keys.

Companies own users, departments, agents, stores, projects, tasks, approvals, research, knowledge, messages, notifications and audit records. Agents reference same-company departments. Tasks reference same-company projects and agents. Research references same-company knowledge. Dependencies reference same-company tasks. Approval payloads and hashes are preserved as decision evidence. Sessions store only hashed random tokens and expire after eight hours.

Indexes cover task status, approval state, memory category, audit sequence and message history. Audit triggers prevent application SQL updates/deletes; filesystem/database administrators remain capable of bypassing them. Off-host append-only audit export is a production requirement.

Future data entities and PostgreSQL plan are listed in docs/PHASE_0.md. No vector extension or external blob store exists yet. Use a new numbered migration for schema changes; do not edit an already-applied migration in an established deployment. The ordered migration runner currently applies versions 1, 2 and 3, checking each version inside its write transaction. Migration 2 protects approval proposal content and history against SQL modification/deletion. Add new migrations to the explicit registry in src/db.ts.


Phase 3 migration 004 adds analytics_days (company/store/currency/timezone/day key, tenant-bound sync provenance), immutable analytics_reports and experiments. See ANALYTICS.md for coverage and retention semantics.


Migrations 005–006 add research_sources/reviews, research_trends, opportunities/source links/handoffs, design_settings, immutable design_briefs, generation_jobs, private design_assets BLOBs, design_reviews and billing reconciliation. Composite tenant foreign keys bind research/design lineage. BLOB storage and metadata share the audit transaction. Source and brief corrections create new records. See RESEARCH_DESIGN.md.
