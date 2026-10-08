function marketingPage() {
  const m = state.marketing;
  return (
    heading(
      "Marketing campaigns",
      "Катерина · Plan, review and measure. Internal drafts only; no sending, publishing or paid spending.",
    ) +
    `<div class="banner">${esc(m.integration)}. READY means an internally approved plan, never a launched campaign.</div>` +
    wfDetails(
      "Create campaign or revision",
      `<form id="campaign-form" class="inline-form">${wfInput("title", "Campaign name")}${wfSelect("parentId", "Revision of", wfOptions(m.campaigns, "title", true)).replace(" required", "")}${wfSelect("productId", "Product package", wfOptions(state.factory.proposals))}<label class="wide">Fresh verified research sources<select name="sourceIds" multiple required>${wfOptions(state.market.sources.filter((s) => s.fresh && s.status === "VERIFIED"))}</select></label>${wfSelect("channel", "Channel", "<option>EMAIL</option><option>SOCIAL</option><option>LANDING_PAGE</option><option>PAID_AD</option>")}${wfInput("startDate", "Start date (UTC)", "date")}${wfInput("endDate", "End date (UTC)", "date")}${wfInput("budgetMinor", "Proposed budget in currency minor units", "number", "0")}${m.fields.map((k) => wfText(k, humanLabel(k), 1200)).join("")}${wfSelect("copyMode", "Copy source", "<option>TEMPLATE</option><option>HUMAN</option>")}<label class="wide">Copy (required for HUMAN)<textarea name="copy" maxlength="4000"></textarea></label>${wfText("variantB", "A/B variant B copy", 4000)}${["variantA", "emailSubject", "emailPreheader", "socialDraft", "landingHeadline"].map((k) => `<label class="wide">${esc(humanLabel(k))} (optional override)<textarea name="${k}" maxlength="${k === "emailPreheader" ? 200 : ["emailSubject", "landingHeadline"].includes(k) ? 160 : 4000}"></textarea></label>`).join("")}<p class="wide small">Template mode assembles product title + value proposition + CTA; variant A defaults to the main copy. Email subject and landing headline use the campaign title. Review and revise every claim before any external use. No autonomous model is connected.</p><button class="primary">Save immutable campaign draft</button></form>`,
      !m.campaigns.length,
    ) +
    panel(
      "Campaign calendar · UTC",
      `<div class="panel-body">${
        [...m.campaigns]
          .sort((a, b) => a.body.startDate.localeCompare(b.body.startDate))
          .map(
            (c) =>
              `<p><strong>${esc(c.body.startDate)} → ${esc(c.body.endDate)}</strong> · ${esc(c.title)} · ${esc(c.body.channel)} · ${badge(c.status)} ${c.body.simulation ? "SIMULATION" : ""}</p>`,
          )
          .join("") || "No campaign plans."
      }</div>`,
    ) +
    panel(
      "Plans and channel drafts",
      m.campaigns
        .map(
          (c) =>
            `<article class="panel-body"><h3>${esc(c.title)} ${badge(c.status)} ${badge(c.body.risk)}</h3><p>${c.body.simulation ? "SIMULATION · " : ""}${esc(c.body.productTitle)} · Proposed ${esc(formatMoney(c.body.budgetMinor, c.body.currency))}</p><p>${esc(c.body.availability)}</p><h4>Copy · ${esc(c.body.copyLabel)}</h4><p>${esc(c.body.copy)}</p><details><summary>Review full plan, channel drafts, SEO and A/B design</summary><pre>${esc(JSON.stringify(c.body, null, 2))}</pre><p>Content hash ${esc(c.content_hash)}</p></details>${c.status === "DRAFT" || c.approvalExpired ? `<button data-campaign-action="approve" data-id="${esc(c.id)}" data-hash="${esc(c.content_hash)}" data-red="${c.body.risk === "RED"}">${c.body.risk === "RED" ? "Approve RED plan/budget review only — no spending" : "Approve exact internal plan"} · 10 minutes</button>` : ""}${c.status === "APPROVED" && !c.approvalExpired ? `<button data-campaign-action="ready" data-id="${esc(c.id)}">Mark ready internally (does not launch)</button>` : ""}${!["COMPLETED", "CANCELLED"].includes(c.status) ? `<button data-campaign-action="cancel" data-id="${esc(c.id)}">Cancel plan</button>` : ""}</article>`,
        )
        .join("") || empty("No campaigns yet."),
    ) +
    wfDetails(
      "Record final measurement and lessons",
      `<form id="campaign-results" class="inline-form">${wfSelect("id", "Ready campaign", wfOptions(m.campaigns.filter((c) => c.status === "READY")))}${wfInput("periodStart", "Measurement start", "date")}${wfInput("periodEnd", "Measurement end", "date")}${["aVisitors", "aConversions", "bVisitors", "bConversions", "spendMinor", "revenueMinor"].map((k) => wfInput(k, humanLabel(k) + (k.endsWith("Minor") ? " (currency minor units)" : ""), "number", "0")).join("")}${wfText("evidence", "Aggregate evidence (no personal data)", 4000)}${wfText("attribution", "Attribution method and limitations")}${wfText("actualResult", "Actual KPI result")}${wfText("lessons", "Lessons learned")}<p class="wide small">Visitors and conversions count unique exposed/converting people per variant. Save only final aggregates: results are immutable. Missing exposure produces an unavailable rate, not zero.</p><button class="primary">Save results and complete plan</button></form>`,
    ) +
    panel(
      "Measurement history",
      m.results
        .map(
          (r) =>
            `<article class="panel-body"><h3>${esc(m.campaigns.find((c) => c.id === r.campaign_id)?.title)}</h3><p>${esc(r.body.label)}</p><p>A conversion: ${r.body.a.rate === null ? "Unavailable" : (r.body.a.rate * 100).toFixed(2) + "%"} · B conversion: ${r.body.b.rate === null ? "Unavailable" : (r.body.b.rate * 100).toFixed(2) + "%"} · ROAS: ${r.body.roas === null ? "Unavailable" : r.body.roas.toFixed(2)}</p><p>${esc(r.body.interpretation)}</p><p>${esc(r.body.actualResult)}</p><p>Lessons: ${esc(r.body.lessons)}</p><details><summary>Evidence and aggregates</summary><pre>${esc(JSON.stringify(r.body, null, 2))}</pre></details></article>`,
        )
        .join("") || empty("No measured results."),
    )
  );
}
function bindMarketing() {
  const form = $("#campaign-form");
  if (form) form.dataset.requestKey = crypto.randomUUID();
  bindForm("campaign-form", "marketing/create", (x) => ({
    ...Object.fromEntries(
      Object.entries(x).filter(
        ([k, v]) =>
          ![
            "variantA",
            "emailSubject",
            "emailPreheader",
            "socialDraft",
            "landingHeadline",
          ].includes(k) || v.trim(),
      ),
    ),
    requestKey: form.dataset.requestKey,
    budgetMinor: Number(x.budgetMinor),
    sourceIds: [...form.elements.sourceIds.selectedOptions].map((o) => o.value),
  }));
  bindForm("campaign-results", "marketing/measure", (x) => ({
    ...x,
    a: { visitors: Number(x.aVisitors), conversions: Number(x.aConversions) },
    b: { visitors: Number(x.bVisitors), conversions: Number(x.bConversions) },
    spendMinor: Number(x.spendMinor),
    revenueMinor: Number(x.revenueMinor),
  }));
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-campaign-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("marketing/" + b.dataset.campaignAction, {
      id: b.dataset.id,
      contentHash: b.dataset.hash,
      confirm: true,
      acknowledgeRed: b.dataset.red === "true",
    });
    await refresh();
    notify("Internal campaign workflow updated; nothing sent or launched.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
