function technologyPage() {
  const t = state.technology,
    obs = t.observations.filter((o) => o.fresh);
  const selectSources = () =>
    `<label class="wide">Fresh observations<select name="sourceIds" multiple required>${wfOptions(obs)}</select></label>`;
  return (
    heading(
      "Technology & UX",
      "Дмитрий · Sarah · Wilhelm. Storefront checks, UX evidence and approved internal improvements.",
    ) +
    `<div class="banner">${esc(t.label)} HTTP timings are not Core Web Vitals. Markup signals and manual reviews are not accessibility certification.</div>` +
    wfDetails(
      "Check configured storefront homepage",
      `<form id="site-monitor" class="inline-form">${wfInput("hostname", "Exact configured hostname")}<label><input name="confirm" type="checkbox" required>Run one public HTTPS homepage read</label><button>Run HTTP check</button></form><p class="panel-body">Server configuration required. No cookies or credentials; no redirects. Last run: ${esc(t.monitor?.status || "None")}</p>`,
    ) +
    wfDetails(
      "Record UX, mobile and accessibility evidence",
      `<form id="ux-observation" class="inline-form">${wfInput("title", "Observation title")}${wfSelect("mode", "Evidence mode", "<option>SIMULATION</option><option>HUMAN</option>")}${wfInput("page", "Page URL (recorded only)", "url")}${wfInput("device", "Device / browser / viewport")}${wfInput("observedAt", "Observed (UTC)", "datetime-local")}${wfInput("expiresAt", "Review due within 31 days (UTC)", "datetime-local")}${wfText("method", "Method and evidence", 4000)}${wfText("findings", "Findings and limitations", 4000)}${t.checks.map((k) => wfSelect(k, humanLabel(k), "<option>NOT_TESTED</option><option>PASS</option><option>FAIL</option>")).join("")}<button>Record immutable observation</button></form>`,
      !t.observations.length,
    ) +
    panel(
      "Health and UX observations",
      t.observations
        .map(
          (o) =>
            `<article class="panel-body"><h3>${esc(o.title)} ${badge(o.fresh ? "FRESH" : "STALE")}</h3><p>${esc(o.body.mode)} · ${esc(o.body.page)} · ${esc(o.body.observedAt)}</p>${o.body.result ? `<p>HTTP ${o.body.result.status} · ${o.body.result.durationMs} ms · ${o.body.result.bytes} bytes</p>` : `<p>${esc(o.body.findings)}</p>`}<details><summary>Evidence and check results</summary><pre>${esc(JSON.stringify(o.body, null, 2))}</pre></details></article>`,
        )
        .join("") || empty("No observations."),
    ) +
    wfDetails(
      "Create UX Recommendation Report",
      `<form id="ux-report" class="inline-form">${wfInput("title", "Report title")}${wfSelect("parentId", "Revision of", wfOptions(t.reports, "title", true)).replace(" required", "")}${selectSources()}${t.fields.map((k) => wfText(k, humanLabel(k))).join("")}${wfSelect("priority", "Priority", "<option>MEDIUM</option><option>LOW</option><option>HIGH</option><option>CRITICAL</option>")}${wfInput("confidence", "Confidence (0–1)", "text", "0.5")}<button>Create immutable report</button></form>`,
    ) +
    panel(
      "Web improvement pipeline",
      t.reports
        .map(
          (r) =>
            `<article class="panel-body"><h3>${esc(r.title)} ${badge(r.status)}</h3><p>${r.body.simulation ? "SIMULATION · " : ""}${esc(r.body.priority)} · Sarah · Confidence ${esc(r.body.confidence)}</p><p>${esc(r.body.problem)}</p><details><summary>Review exact recommendation and implementation plan</summary><pre>${esc(JSON.stringify({ ...r.body, sourceIds: r.sourceIds }, null, 2))}</pre><p>${esc(r.content_hash)}</p></details>${r.status === "PROPOSED" || r.approvalExpired ? `<button data-ux-action="approve" data-id="${esc(r.id)}" data-hash="${esc(r.content_hash)}">Approve internal plan · 10 minutes</button>` : ""}${r.status === "APPROVED" && !r.approvalExpired ? `<button data-ux-action="assign" data-id="${esc(r.id)}">Assign to Sarah (no deployment)</button>` : ""}${!["CANCELLED", "VALIDATED", "REWORK"].includes(r.status) ? `<button data-ux-action="cancel" data-id="${esc(r.id)}">Cancel</button>` : ""}</article>`,
        )
        .join("") || empty("No reports."),
    ) +
    wfDetails(
      "Record implementation validation",
      `<form id="ux-validation" class="inline-form">${wfSelect("id", "Assigned report", wfOptions(t.reports.filter((r) => r.status === "IN_PROGRESS")))}${selectSources()}${wfSelect("verdict", "Result", "<option>REWORK</option><option>VALIDATED</option>")}${wfInput("changeReference", "Local branch / PR / change reference")}${wfText("testEvidence", "Test results and limitations", 4000)}${wfText("rollbackEvidence", "Rollback verification")}${wfText("outcome", "Measured outcome")}<button>Record human validation</button></form>`,
    ) +
    panel(
      "Validation history",
      t.validations
        .map(
          (v) =>
            `<article class="panel-body"><h3>${esc(t.reports.find((r) => r.id === v.report_id)?.title)} · ${esc(v.body.verdict)}</h3><p>${esc(v.body.label)}</p><pre>${esc(JSON.stringify(v.body, null, 2))}</pre></article>`,
        )
        .join("") || empty("No validation records."),
    )
  );
}
function bindTechnology() {
  bindForm("site-monitor", "technology/monitor", (x) => ({
    ...x,
    confirm: x.confirm === "on",
  }));
  bindForm("ux-observation", "technology/observation", (x) => ({
    ...x,
    observedAt: x.observedAt + ":00.000Z",
    expiresAt: x.expiresAt + ":00.000Z",
    checks: Object.fromEntries(state.technology.checks.map((k) => [k, x[k]])),
  }));
  bindForm("ux-report", "technology/report", (x) => ({
    ...x,
    confidence: Number(x.confidence),
    sourceIds: [...$("#ux-report").elements.sourceIds.selectedOptions].map(
      (o) => o.value,
    ),
  }));
  bindForm("ux-validation", "technology/validate", (x) => ({
    ...x,
    sourceIds: [...$("#ux-validation").elements.sourceIds.selectedOptions].map(
      (o) => o.value,
    ),
  }));
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ux-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("technology/" + b.dataset.uxAction, {
      id: b.dataset.id,
      contentHash: b.dataset.hash,
      confirm: true,
    });
    await refresh();
    notify("Internal technology workflow updated. No deployment performed.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
