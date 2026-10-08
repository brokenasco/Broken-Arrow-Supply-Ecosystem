# Phase 4 and Phase 5

Restart the server to apply migrations 005 and 006. The workspace now includes **Market & product research** and **Design Studio**. Both operate inside the existing company, human authentication, CSRF, audit and pause boundaries.

## Phase 4: research workflow

Anna coordinates a human-operated pipeline: Mason → Marisha → Alex → Boris → READY. Stage labels record responsibility, not autonomous model execution. Source discovery and research writing are human-entered in this increment; there is no search API, crawler or fabricated AI research. The research library from Phase 1 remains available separately.

1. Record a MARKET, COMPETITOR, TREND or DESIGN source: title, publisher, URL, observed excerpt, publication/retrieval timestamps and review due date. Dates in the form are UTC. URLs are provenance links, never fetched by the server. Excerpts receive a SHA-256 hash and cannot be edited; add a new record when evidence changes.
2. Review each source as VERIFIED or DISPUTED with an evidence note. This is a human assertion, not automatic fact checking. Review history persists. Expiration is independent of verification: verifying an old source does not extend its freshness.
3. Add comparable trend observations with source, date, series/method, unit and value. The dashboard shows a descriptive first-to-last percentage only when all evidence is fresh/verified and the first value is positive. It does not imply market-wide demand, causality, significance, annualization or seasonal adjustment. Corrections use a new, explicitly named series; original observations remain intact.
4. Write a Product Opportunity Report with the specified concept/persona/need, evidence and demand indicators, product type, price range, costs and margins when supported, competitor landscape, saturation, seasonality, creative/marketing requirements, operational/IP risks, confidence and recommendation. Prices/costs/margins are human assessments, not automatically calculated or independently verified. Enter Unknown where evidence is missing.
5. Record each reviewed handoff with a rationale. Fresh verified evidence is required at every forward transition. Reports cannot skip stages. Rejection is terminal; revisions create a new linked report and restart review. READY does not publish or generate anything.

## Phase 5: design workflow

Mark → Jack → Garry is implemented as reviewed briefs, explicitly dispatched generation and human QA. There is no autonomous visual judge, employee scheduler, product publisher or print-provider integration. Company and relevant agent/department pauses block new work.

### Briefs and generation

Create an immutable brief from a READY opportunity with fresh evidence. The form covers the requested design fields, plus brand/product requirements. Research source IDs are inherited from the opportunity; previous-performance references can explicitly be Unknown. Brief revisions preserve their parent. The opportunity's category must match an approved design category exactly.

Generation controls default to NONE, zero budget and zero daily dispatches. The CEO chooses a provider, approved categories, cumulative USD-cent reservation limit, per-job reservation, UTC daily dispatch count and maximum attempts per brief (1–10). Cancelling a queued attempt does not erase its iteration number. Creating a revised brief is an explicit new design specification, with its own iteration limit; company budget and daily limits still apply.

- **SIMULATION:** a deterministic 128×128 PNG test pattern with zero provider cost, clearly labeled in the UI and database. It is not AI artwork and cannot receive production QA PASS.
- **OPENAI:** optional `OpenAIImageProvider`, behind the `ImageGenerationProvider` abstraction. The implemented initial configuration is `gpt-image-1`, one 1024×1024 low-quality opaque PNG per call. This is an initial compatibility choice, not a claim that it is the newest or best model. Uses the [official image-generation API](https://developers.openai.com/api/docs/guides/image-generation). Other vendors can implement the same byte-returning adapter without changing queue, storage or QA ownership.

For live OpenAI calls, configure server-only values in `.env`:

```dotenv
IMAGE_COMPANY_ID=<exact company UUID shown on the Shopify setup page>
IMAGE_GENERATION_ENABLED=true
OPENAI_API_KEY=<your server-side key>
```

No API key was configured or used during implementation. The key is not stored in SQLite or sent to the browser. Configuration alone does not dispatch. Do not put credentials or customer data in prompts, research or briefs.

Queue a variant with a stable request key. The service reserves its estimated cost atomically and binds the exact brief hash, prompt, provider/model, parameters, revision lineage and reservation into an immutable payload. Inspect that content, approve it as the CEO (expires in ten minutes), then explicitly run it. Approval is single use and is consumed transactionally before the external request. Source freshness, company/agent pauses, category, provider, daily limit and cumulative budget are checked again at dispatch. Only one job per company runs at a time.

The adapter posts only to `https://api.openai.com/v1/images/generations`, refuses redirects, requests one image, uses a two-minute timeout, bounds the response and does not automatically retry. An uncertain external outcome cannot safely be assumed free or retried. Failure, interruption, malformed output or a stop during execution moves the job to RECONCILIATION, retains its reservation, and blocks further queueing/dispatch until billing evidence is recorded. Stop cannot undo a request already sent. A RUNNING job left by process interruption can be recovered after three minutes. Recovery and reconciliation remain available while stopped.

**Budget limits cap recorded commitments, not provider invoices.** Per-job reservations are CEO-entered estimates and the provider request has no USD spending-cap parameter. Actual cost remains unknown until the CEO records billing evidence. Commitments conservatively retain the larger of reservation or reported actual charge. Use provider-side spending controls as well. A charge above the configured cumulative limit blocks future generation until the CEO explicitly adjusts it. Never describe a reservation as a verified bill.

### Assets, QA and revisions

Asset bytes and metadata are stored transactionally in private SQLite BLOBs, avoiding a filesystem/DB split commit. Authenticated, company-scoped `GET /api/design/assets/:id` serves PNGs with no-store and nosniff headers. This local SQLite storage is not encrypted cloud object storage. Back up the complete database privately, including assets and audit; a large production asset estate needs a separate migration.

The ingestion path validates PNG signature/chunk checksums, decompression bounds, dimensions and filter bytes. It accepts only non-interlaced 8-bit RGB/RGBA PNGs up to 2048×2048 and 8 MiB; ancillary metadata is stripped. SVG/HTML, remote image URLs and corrupt or unsupported files are not accepted. Alpha-channel presence is metadata, not proof of visible transparency. Provider/model, immutable prompt and constraints, parameters, brief/research/persona references, version, checksum, request reference, numeric token usage and reservation/billing records remain linked to the asset.

Every asset starts PENDING. Garry's QA screen records a **human** checklist for all requested technical, visual, spelling, brand, originality/IP and compatibility criteria. PASS requires every check, fresh research, a non-simulated asset and no exact checksum duplicate in the company. Visual similarity, print suitability, spelling, copyright and trademark judgment are not automated or independently certified. PASS is not legal clearance and does not publish.

REVISE requires findings and creates a new queued generation linked to the reviewed parent, including its QA findings in the approved prompt. This is text-based regeneration; parent pixels are not sent to the provider and pixel-preserving image editing is not implemented. REJECT remains excluded from downstream readiness. Reviews are immutable, and an already reviewed asset cannot be relabeled; use a new version/brief as appropriate.

## Local verification preview

`node scripts/preview-workflows.ts` creates only `data/workflow-preview.sqlite`, with obviously synthetic records and documented **test-only** login credentials. It refuses to overwrite an existing preview. Never use those credentials for a real company. Start it separately:

```powershell
$env:PORT='3102'
$env:APP_ORIGIN='http://127.0.0.1:3102'
$env:DATABASE_PATH='data/workflow-preview.sqlite'
node src/server.ts
```

The existing Phase 3 test company and its emergency stop were preserved. Live research/search, real OpenAI generation, production print quality and production deployment remain unverified. See [verification evidence](docs/VERIFICATION_PHASE_4_5.md).
