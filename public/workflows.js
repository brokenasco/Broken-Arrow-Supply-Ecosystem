function humanLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}
function wfInput(
  name,
  label = humanLabel(name),
  type = "text",
  value = "",
  required = true,
) {
  return `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} maxlength="1500" ${type === "number" ? 'min="0" step="1"' : ""}></label>`;
}
function wfText(name, label = humanLabel(name), max = 2000) {
  return `<label class="wide">${esc(label)}<textarea name="${esc(name)}" required maxlength="${max}"></textarea></label>`;
}
function wfOptions(rows, label = "title", blank = false) {
  return `${blank ? '<option value="">None</option>' : ""}${rows.map((r) => `<option value="${esc(r.id)}">${esc(r[label])}</option>`).join("")}`;
}
function wfSelect(name, label, options, required = true) {
  return `<label>${esc(label)}<select name="${esc(name)}" ${required ? "required" : ""}>${options}</select></label>`;
}
function wfDetails(title, body, open = false) {
  return `<details class="panel workflow-details" ${open ? "open" : ""}><summary>${esc(title)}</summary>${body}</details>`;
}
function marketPage() {
  const m = state.market;
  return (
    heading(
      "Research with a traceable source.",
      "Anna coordinates · Mason → Marisha → Alex → Boris. Human-authored research and reviews; no autonomous web search or model execution.",
    ) +
    `<div class="stats"><div class="stat"><small>SOURCES</small><strong>${m.sources.length}</strong></div><div class="stat"><small>FRESH & VERIFIED</small><strong>${m.sources.filter((s) => s.fresh && s.status === "VERIFIED").length}</strong></div><div class="stat"><small>OPPORTUNITIES</small><strong>${m.opportunities.length}</strong></div><div class="stat"><small>READY FOR DESIGN</small><strong>${m.opportunities.filter((o) => o.stage === "READY" && o.evidenceReady).length}</strong></div></div>` +
    wfDetails(
      "1 · Register a source",
      `<form id="source-form" class="inline-form"><p class="wide small">Enter evidence you actually reviewed. URLs are recorded, not fetched. A new source starts unverified; each snapshot is immutable. Do not paste private customer data or credentials.</p>${wfInput("title", "Source title")}${wfSelect("kind", "Research type", ["MARKET", "COMPETITOR", "TREND", "DESIGN"].map((x) => `<option>${x}</option>`).join(""))}${wfInput("url", "Source URL", "url")}${wfInput("publisher", "Publisher / competitor")}${wfText("excerpt", "Evidence excerpt / observation", 6000)}${wfInput("publishedAt", "Published timestamp (UTC)", "datetime-local")}${wfInput("retrievedAt", "Retrieved timestamp (UTC)", "datetime-local")}${wfInput("expiresAt", "Review due (UTC)", "datetime-local")}<button class="primary">Record source</button></form>`,
      !m.sources.length,
    ) +
    panel(
      "Source library",
      m.sources
        .map(
          (s) =>
            `<details class="panel-body"><summary>${esc(s.title)} · ${badge(s.fresh ? s.status : "STALE", s.fresh ? "" : "red")} · ${esc(s.kind)}</summary><p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.publisher)}</a> · Human-entered source</p><p>${esc(s.excerpt)}</p><p class="small">Published ${esc(s.published_at)} · Retrieved ${esc(s.retrieved_at)} · Review due ${esc(s.expires_at)}</p><p class="small">SHA-256: ${esc(s.content_hash)}</p><p>Latest review: ${esc(s.review_note ?? "Not reviewed")}</p>${m.sourceReviews
              .filter((r) => r.source_id === s.id)
              .map(
                (r) =>
                  `<p class="small">${esc(r.created_at)} · ${esc(r.status)} · ${esc(r.note)}</p>`,
              )
              .join("")}</details>`,
        )
        .join("") || empty("No sources recorded."),
    ) +
    wfDetails(
      "2 · Verify or dispute a source",
      `<form id="source-review-form" class="inline-form">${wfSelect("id", "Source", wfOptions(m.sources))}${wfSelect("status", "Review result", "<option>VERIFIED</option><option>DISPUTED</option>")}${wfText("note", "What did you verify? Record evidence and caveats.")}<button class="primary">Save human review</button></form>`,
    ) +
    wfDetails(
      "3 · Add comparable trend observations",
      `<form id="trend-form" class="inline-form">${wfSelect("sourceId", "Fresh verified source", wfOptions(m.sources.filter((s) => s.fresh && s.status === "VERIFIED")))}${wfInput("series", "Series / geography / measurement method")}${wfInput("unit", "Unit (keep consistent)")}${wfInput("observedOn", "Observed date", "date")}${wfInput("value", "Observed value", "number")}<button class="primary">Record observation</button></form>`,
    ) +
    panel(
      "Trend analysis",
      m.trends
        .map(
          (t) =>
            `<div class="panel-body"><strong>${esc(t.series)} · ${esc(t.unit)}</strong><p>${t.changePercent === null ? "Comparison unavailable" : esc(t.changePercent) + "% first-to-last change"} · ${t.usable ? "Evidence fresh and verified" : "Evidence needs review"}</p><p class="small">${esc(t.note)}</p><div class="table-wrap"><table><thead><tr><th>OBSERVED</th><th>VALUE</th><th>SOURCE</th></tr></thead><tbody>${t.points.map((p) => `<tr><td>${esc(p.observed_on)}</td><td>${esc(p.value)}</td><td>${esc(m.sources.find((s) => s.id === p.source_id)?.title)}</td></tr>`).join("")}</tbody></table></div></div>`,
        )
        .join("") ||
        empty("Two comparable observations are needed for a trend comparison."),
    ) +
    wfDetails(
      "4 · Write a Product Opportunity Report",
      `<form id="opportunity-form" class="inline-form"><input type="hidden" name="parentId"><p class="wide small">All assessments below are human-authored. Cite evidence in each claim. Enter Unknown for unsupported prices, costs, margins or demand. Revisions preserve earlier reports and restart review.</p>${wfInput("title", "Opportunity name")}<label>Source references (select one or more)<select name="sourceIds" multiple required>${wfOptions(m.sources)}</select></label>${m.opportunityFields.map((k) => wfText(k)).join("")}<label>Confidence (0–1, human judgment)<input name="confidence" type="number" min="0" max="1" step="0.05" required></label><button class="primary">Create opportunity report</button></form>`,
    ) +
    panel(
      "Opportunity pipeline",
      m.opportunities
        .map(
          (o) =>
            `<details class="panel-body"><summary>${esc(o.title)} · ${badge(o.stage)} · ${o.evidenceReady ? "Evidence ready" : "Evidence needs review"}</summary><p class="small">${esc(o.id)}${o.parent_id ? " · Revision of " + esc(o.parent_id) : ""}</p><dl>${Object.entries(
              o.body,
            )
              .map(
                ([k, v]) => `<dt>${esc(humanLabel(k))}</dt><dd>${esc(v)}</dd>`,
              )
              .join(
                "",
              )}</dl><p>Sources: ${o.sourceIds.map((id) => esc(m.sources.find((s) => s.id === id)?.title ?? id)).join("; ")}</p>${m.handoffs
              .filter((h) => h.opportunity_id === o.id)
              .map(
                (h) =>
                  `<p class="small">${esc(h.from_stage)} → ${esc(h.to_stage)} · ${esc(h.created_at)} · Human review: ${esc(h.note)}</p>`,
              )
              .join(
                "",
              )}<button data-copy-opportunity="${esc(o.id)}">Create revised report</button></details>`,
        )
        .join("") || empty("No opportunity reports yet."),
    ) +
    wfDetails(
      "5 · Record a reviewed handoff",
      `<form id="handoff-form" class="inline-form"><p class="wide small">Mason → Marisha → Alex → Boris → Ready for design. These are human-recorded review stages; agents never approve actions. Stale or unverified evidence blocks progression.</p>${wfSelect("id", "Opportunity", wfOptions(m.opportunities.filter((o) => !["READY", "REJECTED"].includes(o.stage))))}${wfSelect("stage", "Next stage", ["MARISHA", "ALEX", "BORIS", "READY", "REJECTED"].map((s) => `<option>${s}</option>`).join(""))}${wfText("note", "Review findings and handoff rationale", 4000)}<button class="primary">Record handoff</button></form>`,
    )
  );
}
function designPage() {
  const d = state.studio,
    c = d.settings;
  return (
    heading(
      "From reviewed brief to inspected asset.",
      "Mark → Jack → Garry. Human-approved generation; human QA. No publishing, scheduled execution or autonomous visual reviewer.",
    ) +
    `<div class="banner ${c.provider === "SIMULATION" ? "critical" : ""}">${c.provider === "SIMULATION" ? "SIMULATION — local test patterns, not AI designs; cannot pass production QA." : c.provider === "NONE" ? "INTEGRATION REQUIRED — choose an explicit simulator or configure an image provider." : "OPENAI — optional paid generation, only after approving and running each job."} ${d.providerAvailable ? "Provider available." : "Provider unavailable."}</div><div class="stats"><div class="stat"><small>BRIEFS</small><strong>${d.briefs.length}</strong></div><div class="stat"><small>QUEUED / APPROVED</small><strong>${d.jobs.filter((j) => ["QUEUED", "APPROVED"].includes(j.status)).length}</strong></div><div class="stat"><small>COMMITTED / LIMIT · USD CENTS</small><strong>${d.committedCents} / ${c.budget_cents}</strong></div><div class="stat"><small>ASSETS AWAITING QA</small><strong>${d.assets.filter((a) => a.status === "PENDING").length}</strong></div></div>` +
    wfDetails(
      "Generation controls",
      `<form id="design-settings-form" class="inline-form">${wfSelect("provider", "Image provider", ["NONE", "SIMULATION", "OPENAI"].map((p) => `<option ${c.provider === p ? "selected" : ""}>${p}</option>`).join(""))}${wfInput("dailyLimit", "Maximum dispatched designs per UTC day", "number", c.daily_limit)}${wfInput("budgetCents", "Cumulative reservation limit (USD cents)", "number", c.budget_cents)}${wfInput("reservationCents", "Reserve per job (USD cents; simulation = 0)", "number", c.reservation_cents)}${wfInput("maxIterations", "Maximum attempts per brief (1–10)", "number", c.max_iterations)}${wfInput("categories", "Approved categories (comma-separated)", "text", c.categories.join(", "))}<label class="wide consent"><input name="acknowledgeBilling" type="checkbox"> I understand reservations are planning estimates, not a provider billing cap. Actual charges require reconciliation; configure provider-side limits separately. Prompts go to OpenAI only when I explicitly run an approved live job.</label><button class="primary">Save generation controls</button></form>`,
      c.provider === "NONE",
    ) +
    wfDetails(
      "Create or revise a Design Brief",
      `<form id="design-brief-form" class="inline-form"><input type="hidden" name="parentId">${wfInput("title", "Brief title")}${wfSelect("opportunityId", "Reviewed opportunity", wfOptions(state.market.opportunities.filter((o) => o.stage === "READY" && o.evidenceReady)))}${d.briefFields.map((k) => wfText(k, humanLabel(k), 1000)).join("")}<label>Confidence (0–1)<input name="confidence" type="number" min="0" max="1" step="0.05" required></label><button class="primary">Save immutable brief</button></form>`,
    ) +
    panel(
      "Design briefs",
      d.briefs
        .map(
          (b) =>
            `<details class="panel-body"><summary>${esc(b.title)} · ${esc(b.created_at)}</summary><p class="small">${esc(b.id)} · ${b.parent_id ? "Revision of " + esc(b.parent_id) : "Original brief"}</p><dl>${Object.entries(
              b.body,
            )
              .map(
                ([k, v]) => `<dt>${esc(humanLabel(k))}</dt><dd>${esc(v)}</dd>`,
              )
              .join(
                "",
              )}</dl><button data-copy-brief="${esc(b.id)}">Revise brief</button></details>`,
        )
        .join("") ||
        empty("Complete the research workflow, then create a brief."),
    ) +
    wfDetails(
      "Queue a variant or revision",
      `<form id="generation-form" class="inline-form">${wfSelect("briefId", "Brief", wfOptions(d.briefs))}<label>Parent asset (only for a requested revision)<select name="parentAssetId">${wfOptions(
        d.assets
          .filter((a) => a.status === "REVISE")
          .map((a) => ({ ...a, title: "Version " + a.version + " · " + a.id })),
        "title",
        true,
      )}</select></label>${wfText("instruction", "Variant or structured revision instructions", 1200)}<p class="wide small">A revision is a new text-prompted generation. Parent pixels are not transmitted. Each job reserves budget immediately and needs approval of its exact prompt. No automatic retries.</p><button class="primary">Queue for approval</button></form>`,
    ) +
    panel(
      "Generation queue",
      d.jobs
        .map(
          (j) =>
            `<details class="panel-body"><summary>${esc(d.briefs.find((b) => b.id === j.brief_id)?.title)} · v${j.version} · ${badge(j.status)} ${j.provider === "SIMULATION" ? "SIMULATION" : ""}</summary><p class="small">Job ${esc(j.id)} · ${esc(j.provider)} / ${esc(j.payload.model)} · Reservation ${j.reserved_cents} USD cents</p><p class="small">Actual cost: ${j.provider === "SIMULATION" ? "0 (simulation)" : d.reconciliations.some((r) => r.job_id === j.id) ? esc(d.reconciliations.find((r) => r.job_id === j.id).actual_cents) + " USD cents, human-reconciled" : "Unknown until billing reconciliation"}</p><pre class="prompt-preview">${esc(j.payload.prompt)}</pre><p class="small">Parameters: ${esc(JSON.stringify(j.payload.parameters))} · Approval hash: ${esc(j.payload_hash)}<br>Approval ${j.expires_at ? esc(new Date(j.expires_at).toISOString()) : "not granted"} ${j.approvalExpired ? "(EXPIRED)" : ""}</p><div class="actions">${j.status === "QUEUED" || j.approvalExpired ? `<button data-design-action="approve" data-id="${esc(j.id)}" data-hash="${esc(j.payload_hash)}">Approve this exact brief, prompt & reservation (10 min)</button>` : ""}${j.status === "APPROVED" && !j.approvalExpired ? `<button class="primary" data-design-action="run" data-id="${esc(j.id)}">${j.provider === "SIMULATION" ? "Run simulation" : "Run paid generation"}</button>` : ""}${["QUEUED", "APPROVED"].includes(j.status) ? `<button data-design-action="cancel" data-id="${esc(j.id)}">Cancel queued job</button>` : ""}${j.status === "RUNNING" ? `<button data-design-action="recover" data-id="${esc(j.id)}">Recover if interrupted for 3+ minutes</button>` : ""}</div><p class="small">${esc(j.error_code ?? "")} ${j.status === "RECONCILIATION" ? "Check provider records before authorizing any replacement job." : ""}</p></details>`,
        )
        .join("") || empty("No generation jobs."),
    ) +
    panel(
      "Asset gallery · private storage",
      `<div class="asset-grid">${
        d.assets
          .map(
            (a) =>
              `<article class="asset-card"><a href="/api/design/assets/${esc(a.id)}" target="_blank" rel="noopener"><img loading="lazy" src="/api/design/assets/${esc(a.id)}" alt="${a.simulation ? "SIMULATION test pattern" : "Generated design awaiting human assessment"} version ${a.version}"></a><strong>${esc(d.briefs.find((b) => b.id === a.brief_id)?.title)} · v${a.version}</strong><p>${badge(a.status)} ${a.simulation ? badge("SIMULATION", "red") : ""}</p><p class="small">${a.width} × ${a.height} · ${a.alpha_channel ? "Alpha channel present; visible transparency needs review" : "RGB, no alpha channel"}</p><p class="small">Asset ${esc(a.id)}</p>${d.reviews
                .filter((r) => r.asset_id === a.id)
                .map((r) => `<p>Human QA: ${esc(r.note)}</p>`)
                .join("")}</article>`,
          )
          .join("") ||
        empty(
          "No generated assets. No sample images are passed off as live output.",
        )
      }</div>`,
    ) +
    wfDetails(
      "Garry QA · record human inspection",
      `<form id="design-review-form" class="inline-form">${wfSelect("id", "Unreviewed asset", wfOptions(d.assets.filter((a) => a.status === "PENDING").map((a) => ({ ...a, title: a.id + " · v" + a.version }))))}${wfSelect("verdict", "Verdict", "<option>REVISE</option><option>REJECT</option><option>PASS</option>")}<p class="wide small">Inspect the image above. Check only what you verified. PASS requires every check, fresh research, and a non-simulated, nonduplicate asset. This is not legal clearance or automatic visual QA.</p><div class="wide qa-grid">${d.qaChecks.map((k) => `<label class="consent"><input name="${k}" type="checkbox"> ${esc(humanLabel(k))} verified</label>`).join("")}</div>${wfText("note", "Findings / revision instructions / unresolved limitations", 4000)}<button class="primary">Record immutable QA review</button></form>`,
    ) +
    wfDetails(
      "Reconcile actual provider billing",
      `<form id="billing-form" class="inline-form">${wfSelect("id", "Finished or uncertain job", wfOptions(d.jobs.filter((j) => ["SUCCEEDED", "RECONCILIATION"].includes(j.status) && !d.reconciliations.some((r) => r.job_id === j.id)).map((j) => ({ ...j, title: j.id + " · " + j.status }))))}${wfInput("actualCents", "Actual billed amount (USD cents)", "number")}${wfText("evidence", "Provider billing evidence / outcome notes")}<p class="wide small">Uncertain jobs never retry. Commitments retain the larger of the original reservation or reported charge. Reconciliation does not claim a missing image succeeded.</p><button class="primary">Record billing evidence</button></form>`,
    )
  );
}
function bindWorkflows() {
  const utc = (v) => v + ":00.000Z";
  bindForm("source-form", "research/source", (x) => ({
    ...x,
    publishedAt: utc(x.publishedAt),
    retrievedAt: utc(x.retrievedAt),
    expiresAt: utc(x.expiresAt),
  }));
  bindForm("source-review-form", "research/verify");
  bindForm("trend-form", "research/trend", (x) => ({
    ...x,
    value: Number(x.value),
  }));
  bindForm("opportunity-form", "research/opportunity", (x) => ({
    ...x,
    confidence: Number(x.confidence),
    sourceIds: [
      ...$('#opportunity-form select[name="sourceIds"]').selectedOptions,
    ].map((o) => o.value),
  }));
  bindForm("handoff-form", "research/handoff");
  bindForm("design-settings-form", "design/settings", (x) => ({
    ...x,
    dailyLimit: Number(x.dailyLimit),
    budgetCents: Number(x.budgetCents),
    reservationCents: Number(x.reservationCents),
    maxIterations: Number(x.maxIterations),
    categories: x.categories
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    acknowledgeBilling: x.acknowledgeBilling === "on",
  }));
  bindForm("design-brief-form", "design/brief", (x) => ({
    ...x,
    confidence: Number(x.confidence),
  }));
  const form = $("#generation-form");
  if (form) form.dataset.requestKey = crypto.randomUUID();
  bindForm("generation-form", "design/queue", (x) => ({
    ...x,
    requestKey: form.dataset.requestKey,
  }));
  bindForm("design-review-form", "design/review", (x) => ({
    ...x,
    checks: Object.fromEntries(
      state.studio.qaChecks.map((k) => [k, x[k] === "on"]),
    ),
  }));
  bindForm("billing-form", "design/reconcile", (x) => ({
    ...x,
    actualCents: Number(x.actualCents),
  }));
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.copyOpportunity || b.dataset.copyBrief) {
      const isBrief = !!b.dataset.copyBrief,
        row = (isBrief ? state.studio.briefs : state.market.opportunities).find(
          (r) => r.id === (b.dataset.copyBrief || b.dataset.copyOpportunity),
        ),
        form = $(isBrief ? "#design-brief-form" : "#opportunity-form");
      for (const [key, value] of Object.entries({
        ...row.body,
        title: row.title,
        parentId: row.id,
        opportunityId: row.opportunity_id,
      })) {
        const element = form.elements.namedItem(key);
        if (element) element.value = value ?? "";
      }
      if (!isBrief)
        for (const option of form.elements.sourceIds.options)
          option.selected = row.sourceIds.includes(option.value);
      form.closest("details").open = true;
      form.scrollIntoView({ behavior: "smooth" });
      notify("Revision copied. Edit the content, then save as a new record.");
    }
    if (b.dataset.designAction) {
      b.disabled = true;
      if (b.dataset.designAction === "run")
        notify(
          "Generation started. This may take two minutes. Do not retry; use queue status if the request is interrupted.",
        );
      await api("design/" + b.dataset.designAction, {
        id: b.dataset.id,
        payloadHash: b.dataset.hash,
        confirm: true,
      });
      await refresh();
      notify("Design workflow updated.");
    }
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
