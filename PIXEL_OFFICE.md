# Pixel Office — discovery and MVP architecture

2026-10-07. Reuse before rebuilding.

## Repository map

The frontend is dependency-free browser JavaScript with shared forms, panels, dialogs, navigation, chat, agent profiles and classic dashboards. The backend is native Node HTTP/TypeScript and SQLite WAL with migrations. Persisted CEO sessions, Origin/CSRF checks, scoped services, compliance/security gates and transactional audits already exist. The registry contains 24 agents in nine departments; Борис is the existing COO. Departments and managers come from persisted registry definitions.

Tasks, approvals, notifications, audit, research, design, products, analytics and scoped Shared Knowledge already exist. Resource accounting is an unfinished, explicitly labeled foundation; no new ledger coverage of live paid calls is implied. Native automation is separate from the UI. No existing WebSocket/SSE UI feed or autonomous multi-agent language-model runtime exists. The current agent conversation is a deterministic status assistant and clearly reports integration requirements.

## MVP boundary

Pixel Office is an optional hash-route presentation over those services. A compact authenticated office-state adapter returns normalized agent states, floors, attention items and executive counts. CSS and original inline vector shapes supply reusable sprites/desks; no game engine, image-generation calls, animation loop or new registry. Desktop shows a vertical building; mobile selects one floor. Offscreen floors use content visibility and animations are disabled by default. Reduced-motion preferences are respected.

Attention is derived from real pending approvals, blocked/failed tasks and security alerts. Bubbles open the durable attention queue; they do not approve anything. Links route to existing authorized management pages. No false security-safe or autonomous-working claims are inferred from a lack of alerts.

Meetings are explicitly **human-led context reviews**, not fabricated model conversations. A meeting snapshots selected participants' actual task context, records human summaries/decisions and can create tasks through CompanyService. New meeting tables contain only meeting metadata and task links. Original tasks, approval rules and knowledge remain authoritative. Context snapshots are untrusted data and bounded; no transcript is injected into prompts. Model-driven selective contributions and COO synthesis require the future authenticated, budgeted runtime.

## Delivery order

1. Compact state adapter and status mapping; dynamic building, original sprites, attention queue, elevator and existing COO chat.
2. Authenticated context-review meetings, durable owner decisions and linked task creation.
3. Responsive/accessibility checks, failure state, bounded polling/backoff, command palette, classic navigation and tests.
4. Future measured improvements: live normalized event feed, authenticated model meetings, broader permission-filtered global search and production rollout. No production-readiness claim from this local MVP.

Normal visualization uses zero AI tokens. Classic dashboards and backend operations remain usable if Pixel Office is disabled or closed. Operational database migration requires the existing encrypted backup/restore procedure before opening a new release.


## Verification checkpoint — 2026-10-07

Migration 021 and the office state API, dynamic floors, sprites, elevator, attention, existing COO navigation, command palette and human-led meetings are implemented. Memo attention links to exact records and survives reading when owner action remains unresolved. Synthetic browser checks exercised meeting creation, task linkage, closure and a 390px mobile Product floor. See docs/VERIFICATION_EXECUTIVE_FOUNDATION.md. Agent-driven meeting synthesis and production rollout remain unimplemented.
