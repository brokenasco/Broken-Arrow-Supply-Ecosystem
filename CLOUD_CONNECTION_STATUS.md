# Cloud connection status

Verified 2026-10-08 through connected account tools. This is a setup checkpoint, not deployment acceptance.

## Accounts

- GitHub: owner-selected `brokenasco/Broken-Arrow-Supply-Ecosystem` was found with push/admin access. It is currently empty and public. Local `origin` now points to `https://github.com/brokenasco/Broken-Arrow-Supply-Ecosystem.git`. Nothing has been uploaded; visibility confirmation is pending before source publication.
- Vercel team: `Keaton's projects` (`keaton-s-projects5`). No Broken Arrow project was found. The existing unrelated project was preserved.
- Supabase: owner supplied project ref `oeadagbfvyzlmmfylruk` and REST URL `https://oeadagbfvyzlmmfylruk.supabase.co/rest/v1/` for `Broken Arrow Supply Ecosystem`. The connected Supabase tools currently reject project-detail and URL verification for this ref with `INVALID_ARGUMENT`/permission error, so access is not yet proven and no schema or data operation was attempted. Existing listed projects remain untouched.

## Required setup sequence

1. Identify the exact Supabase destination. Inspect existing schemas before proposing changes; never repurpose unrelated application tables.
2. Create or select a private GitHub repository and grant the GitHub connector access to it. Audit the source upload: exclude environment secrets, operational databases, backups, dependencies and sensitive evidence.
3. Adapt persistence and background execution before a functional Vercel deployment. Current `src/db.ts` uses synchronous `node:sqlite`; `src/server.ts` restricts listening to loopback and starts process-local timers. A Supabase URL alone does not convert these services to PostgreSQL.
4. Preserve transactional company isolation, audit writes, approvals, budget reservations and quarantine behavior during the adaptation. Test migrations against an isolated copy and verify recovery.
5. Link the prepared GitHub repository to Vercel, configure server-only environment variables securely, and deploy a preview for verification.
6. Complete hosted authentication, security and release gates before production activation. Enable paid agent execution separately after provider configuration, pricing and financial controls are verified.

No cloud resources were created, application data migrated, secrets copied, deployment published, or paid model calls made during this connection check.
