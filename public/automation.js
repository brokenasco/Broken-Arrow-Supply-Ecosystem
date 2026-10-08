function automationPage() {
  const a = state.automation;
  return (
    heading(
      "Bounded automation",
      "Explicit human authorization, internal drafts and evidence checks. Each run retains its outcome and audit trail.",
    ) +
    `<div class="banner">Background timer ${a.workerEnabled ? "ENABLED" : "DISABLED"} · External spend $0 · No automatic approvals, paid generation, Shopify writes, publishing or campaign sending. A running local server is required.</div>` +
    panel(
      "Available workflows",
      a.kinds
        .map(
          (k) =>
            `<p class="panel-body"><strong>${esc(humanLabel(k.toLowerCase().replaceAll("_", " ")))}</strong> · ${esc(a.descriptions[k])}</p>`,
        )
        .join(""),
    ) +
    wfDetails(
      "Create a bounded schedule",
      `<form id="automation-create" class="inline-form">${wfInput("title", "Schedule title")}${wfSelect("kind", "Workflow", a.kinds.map((k) => `<option>${k}</option>`).join(""))}${wfInput("startsAt", "First run (UTC ISO timestamp)")}${wfInput("endsAt", "Authorization ends (UTC ISO timestamp)")}${wfInput("intervalHours", "Interval hours (1–168)", "number", "24")}${wfInput("dailyLimit", "Maximum runs per UTC day", "number", "1")}${wfInput("maxRuns", "Maximum total runs", "number", "7")}${wfText("valueMetric", "Measurable value")}${wfText("successCriterion", "Success criterion")}<label class="wide">Workflow payload (JSON)<textarea name="payload" required maxlength="20000">{}</textarea></label><p class="wide small">Reviews, reports and inventory projections use {}. Proposal workflows use the same inputs as their existing creation forms; request keys are generated per run. Invalid inputs pause the schedule without partial output. See AUTOMATION.md for payload examples. Paid/provider dispatch is not available.</p><label><input name="acknowledgeLimits" type="checkbox" required>I authorize only the described internal work with zero external spend</label><button class="primary">Create schedule for review</button></form>`,
    ) +
    `<form id="automation-tick" class="panel-body"><button>Process due authorized schedules now</button><p>At most ten due schedules. No catch-up burst or automatic retry. Failed or blocked schedules pause for review.</p></form>` +
    panel(
      "Schedules",
      a.schedules
        .map(
          (s) =>
            `<article class="panel-body"><h3>${esc(s.title)} ${badge(s.status)}</h3><p>${esc(a.descriptions[s.kind])}</p><p>Next eligible run ${esc(new Date(Number(s.next_run_at)).toISOString())} · Authorization end ${esc(s.body.endsAt)}</p><p>Every ${s.body.intervalHours} hours · ${s.body.dailyLimit}/day · ${s.body.maxRuns} total · External budget $0</p><p>Value: ${esc(s.body.valueMetric)} · Success: ${esc(s.body.successCriterion)}</p><details><summary>Exact schedule and payload</summary><pre>${esc(JSON.stringify(s.body, null, 2))}</pre><p>SHA-256 ${esc(s.content_hash)}</p></details>${["DRAFT", "PAUSED"].includes(s.status) || (s.status === "APPROVED" && Number(s.approval_expires_at) <= Date.now()) ? `<button data-automation-action="approve" data-id="${esc(s.id)}" data-hash="${esc(s.content_hash)}">Approve exact schedule for ten minutes</button>` : ""}${s.status === "APPROVED" && Number(s.approval_expires_at) > Date.now() ? `<button data-automation-action="enable" data-id="${esc(s.id)}" data-hash="${esc(s.content_hash)}">Enable approved schedule</button>` : ""}${!["EXPIRED", "EXHAUSTED", "PAUSED"].includes(s.status) ? `<button data-automation-action="pause" data-id="${esc(s.id)}">Pause schedule</button>` : ""}</article>`,
        )
        .join("") ||
        empty("No schedules. Nothing runs until explicitly authorized."),
    ) +
    panel(
      "Run history and measurable output",
      a.runs
        .map(
          (r) =>
            `<article class="panel-body"><h3>${badge(r.status)} ${esc(r.created_at)}</h3><p>Schedule ${esc(r.schedule_id)} · Due ${esc(new Date(Number(r.due_at)).toISOString())} · External spend $0</p><pre>${esc(JSON.stringify(r.output, null, 2))}</pre></article>`,
        )
        .join("") || empty("No runs yet. No value or success is assumed."),
    )
  );
}
function bindAutomation() {
  bindForm("automation-create", "automation/create", (x) => ({
    ...x,
    payload: JSON.parse(x.payload),
    intervalHours: Number(x.intervalHours),
    dailyLimit: Number(x.dailyLimit),
    maxRuns: Number(x.maxRuns),
    budgetCents: 0,
    acknowledgeLimits: x.acknowledgeLimits === "on",
  }));
  bindForm("automation-tick", "automation/tick");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-automation-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("automation/" + b.dataset.automationAction, {
      id: b.dataset.id,
      contentHash: b.dataset.hash,
      confirm: true,
    });
    await refresh();
    notify("Automation controls saved. External execution remains gated.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
