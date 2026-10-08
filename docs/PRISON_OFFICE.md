# Prison Office and owner quarantine

The existing office now has an original SVG isometric cellblock presentation. WARDEN and ENFORCER offices share a boundary, with the HOLE adjacent. Department assignments, agent names, prompts, budgets and permissions are unchanged. Shot Caller is a presentation title only. Classic controls, task panels, meetings and resource navigation remain available.

The geometry uses shared grid edges. Occupant slots are stable when another occupant is held. The scene displays up to six occupants per room, with the complete selectable roster below. No visual behavior makes model calls. Working motion requires stored WORKING status; held occupants do not animate as working. Reduced motion, hidden-page and offscreen controls stop animation. Mobile users have the same directory and text roster.

## Authoritative hold

Migration 026 adds retained, immutable hold and release records. Both owner endpoints reuse authenticated session, CSRF, company scoping and office rate limiting. A persisted human CEO must confirm the exact action. Viktor has no added approval, release or autonomous detection authority.

`POST /api/office/quarantine`: agent, requestId, previousHoldId, reason, confirm. A retry is bound to the original agent and reason. The previous hold identifier rejects stale new requests. Transactional locking prevents two connections from creating competing holds.

`POST /api/office/release`: holdId, reason, confirm. Only the current exact hold can be released. A completed release is idempotent; it cannot clear a newer hold. Ordinary agent/department/company resume never changes these records. Audit insertion and control changes commit together or both roll back. Reasons use the existing credential-content screen.

Workflow guards, tool policy and paid-resource reservation gates reject held agents. Due schedules return QUARANTINED without advancing or creating execution attempts. Incoming chat is retained as an owner message without an agent reply. Queued tasks, schedules, messages, configuration and financial records are retained. Existing independent human security/reconciliation controls remain available.

Known asynchronous paths expose pending holds while image generation, product dispatch/reconciliation or storefront monitoring remains outstanding. Product dispatch rechecks guards between external read calls. Remote calls already sent cannot be recalled; the UI does not claim otherwise. Image/product accounting reconciliation is preserved. Pending execution blocks release until the existing stopping/reconciliation flow resolves it. There is no general autonomous LLM runtime in this application, and this feature does not introduce one. Future execution adapters must use the shared guards before dispatch and between asynchronous stages.

## Verification and rollout

Automated coverage includes persisted restart, conflicting database connections, audit rollback, exact/stale releases, unrelated pauses, tool rejection, retained incoming messages, unchanged due schedules and an in-flight mock probe. No paid model or Shopify operation is used. `scripts/preview-prison.ts` runs an explicitly synthetic in-memory company on port 3118.

Validation on 2026-10-08: 154 tests passed; `npm run check` and the prison JavaScript syntax check passed. The source secret scan checked 186 files with no pattern findings (not proof of absence). Browser verification used the in-memory preview: keyboard character selection, owner-confirmed quarantine, Hole count, exact owner release and return to zero held. Desktop and 390px mobile layouts were inspected. The saved `prison-office-preview.png` is synthetic evidence, not a live-company screenshot. Narrow screens use horizontal scene navigation plus the department directory and text roster.

Before operational rollout, create and restoration-test an encrypted backup using the existing recovery procedure, then restart the application with migration 026. No operational database was migrated during development. This is not a production-readiness certification.
