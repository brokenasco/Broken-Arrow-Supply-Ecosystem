# Phase 13: Bounded local automation

Automation adds recurring internal work to the local application. It is off by default (`AUTOMATION_ENABLED=false`). Start the server with `AUTOMATION_ENABLED=true` to poll every 15 seconds, or use **Process due authorized schedules now** for one authenticated pass. A running application is required; this is not an operating-system service, cloud scheduler or autonomous model runtime.

## Supported scope

| Workflow | Actual output | Remaining boundary |
| --- | --- | --- |
| Research review | Counts and identifiers for stored evidence requiring review | No autonomous search or new research |
| Generation queue | A queued generation proposal using an existing brief | Human exact approval and explicit paid/simulation generation dispatch remain separate |
| Product proposal | A local immutable product package | No automatic Shopify draft write, publication or fulfillment |
| Report | A saved deterministic analytics report from fresh Shopify snapshots | No new sync, fabricated metrics or model analysis |
| Campaign draft | Internal template/human copy using existing product and research | No sending, advertising spend or publishing |
| Experiment plan | An experiment in PLANNED state | Human launch, measurement and conclusion required |
| Inventory projection | Descriptive net-change rate and possible time-to-zero | Not demand forecasting; no automatic purchasing |
| UX review | Freshness of stored UX observations | Fresh homepage checks remain the existing human-triggered Phase 9 flow |

The live/external portions of advanced automation remain gated pending stability and integration acceptance. This phase does not claim those actions are automated.

## Authorization and limits

Create an immutable schedule specifying first run, end date, cadence, daily and total limits, measurable value and success criterion. Review its exact payload/hash, approve it for ten minutes, then consume that approval once to enable the bounded recurrence. Activation is a recurring authorization for that exact plan, not reusable approval of any downstream consequential action. Authorizations end within 30 days; intervals are 1–168 hours; daily runs are 1–24 and total runs are 1–100. At most 20 nonterminal schedules exist per company. External-spend budget is fixed at zero.

Each run revalidates the persisted human authorizer, company ownership, immutable plan hash, expiry, run budgets, company/department/agent pause and compliance holds. Compliance holds and policy changes immediately pause approved/enabled schedules and invalidate activation approval. Resume needs a fresh exact approval and activation. Pause is available during stop/hold. A company stop prevents work even if the timer remains running.

The scheduler only calls a fixed allowlist of synchronous, local domain methods; approval, external generation, Shopify writes, sending and deployment are unreachable. Existing domain services validate the proposal inputs and current evidence again. Generation queueing can reserve amounts under existing design limits, but the scheduler cannot spend that reservation or approve the queued job.

## Failure and persistence

SQLite immediate transactions serialize a due slot. Nested domain transactions use savepoints so output, child audits, scheduler run record and next-run advance commit together. Unique company/schedule/due keys prevent duplicate committed slots. There are no asynchronous or external effects inside these transactions.

After downtime, one due run executes and the next is scheduled relative to the current time; missed intervals do not create a catch-up burst. Each poll handles at most ten schedules. A blocked/failed domain operation rolls back its output, records a redacted result and pauses the schedule. No retry occurs until a human reviews and reauthorizes. If the outer audit/commit fails, the entire transaction rolls back, leaving no output or committed occurrence; a future tick may safely attempt that uncommitted slot again.

Restart retains schedules and run history. The timer is opt-in and stops during server shutdown. A removed/moved authorizing identity cannot run work. Authentication failures do not invent another audit actor or continue under an agent identity.

Run history stores actual output identifiers/counts and zero external spend. Value metrics and success criteria are human-defined; successful execution does not prove business benefit. Simulation labels on generated artifacts remain supplied by their existing workflows.

## Inventory limitations

Only processed, minimized inventory events are used, grouped by store, item/location and simulation flag. A projection requires at least three distinct observed UTC days spanning two days and a latest point no older than two days. At most 2,000 events from 30 days are considered; a truncated input refuses projections. Duplicate observed timestamps collapse. The rate is `(last available - first available) / elapsed days`; time-to-zero is available divided by decline per day only when the rate is negative. Restocking and adjustments confound net change, so this is descriptive and not a validated sales forecast. Insufficient, flat, increasing or stale data does not fabricate a stockout date.

## Payload setup

Reviews, report and inventory projection use `{}`. The advanced payload editor accepts the existing workflow's creation input; keys that grant authority are rejected. Company IDs and credentials must not be entered. Invalid downstream inputs produce a blocked run with no partial output. Each output receives a scheduler-generated request key.

Generation queue example (replace with a company brief ID):

```json
{"briefId":"existing-brief-id","instruction":"Create an original variation for human review"}
```

Product proposal example (replace IDs with reviewed company artifacts):

```json
{"templateId":"template-id","assetId":"asset-id","mode":"SIMULATION","title":"Synthetic poster","vendor":"Synthetic","description":"Synthetic software test","variantPrices":[{"value":"Small","price":""}],"targetMarginPercent":50}
```

Campaign draft uses `productId`, `sourceIds`, `title`, `channel`, `startDate`, `endDate`, `budgetMinor`, `copyMode`, `variantB` and all campaign plan fields shown in Marketing. The schedule can create a paid-ad *proposal* but cannot approve it, spend or send it. Experiment plan example:

```json
{"title":"Packaging study","hypothesis":"Clearer packaging information may reduce uncertainty","variant":"Control description versus clearer packaging description","metric":"orders","target":"Compare eligible orders with explicit limitations","startsOn":"2026-10-10","endsOn":"2026-10-17"}
```

Changing schedule content requires a new schedule; pause the old one first. Review dated payloads and evidence lifetimes before choosing recurrence.
