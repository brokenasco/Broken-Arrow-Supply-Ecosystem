# Engineering rules

Read docs/PHASE_0.md and SECURITY.md before changing authority boundaries.
Use Node 24.15+ with built-in TypeScript stripping. No external writes are enabled in Phase 1.
Every mutation must authenticate the human, validate input, scope records to the company, and audit within the same transaction.
Agents never approve actions. Approval binds immutable action content, expires, and is single use.
Do not claim external integrations, model execution, or production readiness without implementation and evidence.
Run npm test and npm run check after consequential changes. Keep simulation labels visible.
