function learningPage() {
  const l = state.learning;
  const campaigns = state.marketing.campaigns.filter(
    (c) => c.status === "COMPLETED",
  );
  const docs = state.customers.documents.filter((d) => d.usable);
  return (
    heading(
      "Learning loop",
      "Research → design → QA → product → marketing → evidence → strategy → memory → research. Human-operated; no autonomous learning.",
    ) +
    `<div class="banner">Publishing: UNAVAILABLE · Product drafts do not establish publication. Campaign results are human-reported; no causal winner is inferred. Simulation stays separate from real evidence.</div>` +
    wfDetails(
      "Propose an evidence-backed lesson",
      `<form id="learning-propose" class="inline-form">${wfInput("title", "Lesson title")}${wfSelect("campaignId", "Completed campaign", campaigns.map((c) => `<option value="${esc(c.id)}">${esc(c.title)} · ${c.body.simulation ? "SIMULATION" : "HUMAN-REPORTED"}</option>`).join(""))}${wfSelect("customerDocumentId", "Customer evidence document", docs.map((d) => `<option value="${esc(d.id)}">${esc(d.title)} · ${d.body.simulation ? "SIMULATION" : "HUMAN-REPORTED"}</option>`).join(""))}${l.fields.map((k) => wfText(k, humanLabel(k))).join("")}<label>Confidence 0–1<input name="confidence" type="number" step="0.01" min="0" max="1" required></label>${wfInput("reviewAt", "Review by (UTC ISO timestamp)")}<label><input type="checkbox" name="relevanceConfirmed" required>I reviewed the relevance of this customer evidence to this campaign</label><button class="primary">Save learning proposal</button></form><p class="panel-body">A completed product draft and campaign measurement, current research sources and fresh verified customer evidence are required. Fields are human-authored hypotheses. Do not enter personal data.</p>`,
    ) +
    panel(
      "Lessons and research handoffs",
      l.cycles
        .map((r) => {
          const b = r.body,
            e = b?.evidence;
          return `<article class="panel-body"><h3>${esc(r.title)} ${badge(r.status)}</h3><p>${esc(r.id)} · ${b ? esc(b.label) : "Evidence unavailable — review hidden"}</p>${b ? `<p><strong>Observed:</strong> ${esc(b.observed)}</p><p><strong>Interpretation:</strong> ${esc(b.interpretation)}</p><p><strong>Limitations:</strong> ${esc(b.limitations)}</p><p><strong>Strategy:</strong> ${esc(b.strategy)}</p><p><strong>Next research:</strong> ${esc(b.researchQuestion)}</p><p><strong>Success criterion:</strong> ${esc(b.successCriterion)} · Confidence ${b.confidence} · Review ${esc(b.reviewAt)}</p><details><summary>Evidence and complete lineage</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details>` : ""}<p>${r.memory_id ? `Memory candidate ${esc(r.memory_id)} · Research question ${esc(r.research_id)} · NEEDS VERIFICATION` : ""}</p>${r.status === "PROPOSED" || (r.status === "APPROVED" && Number(r.expires_at) <= Date.now()) ? `<button data-learning-action="approve" data-id="${esc(r.id)}" data-hash="${esc(r.content_hash)}">Approve exact lesson for ten minutes</button>` : ""}${r.status === "APPROVED" && Number(r.expires_at) > Date.now() ? `<button data-learning-action="promote" data-id="${esc(r.id)}" data-hash="${esc(r.content_hash)}">Create memory candidate and research question</button>` : ""}${["PROPOSED", "APPROVED"].includes(r.status) ? `<button data-learning-action="cancel" data-id="${esc(r.id)}">Cancel lesson</button>` : ""}</article>`;
        })
        .join("") ||
        empty(
          "No lessons yet. Complete a campaign measurement and customer insight first.",
        ),
    ) +
    wfDetails(
      "Link the next research opportunity",
      `<form id="learning-followup" class="inline-form">${wfSelect(
        "id",
        "Queued lesson",
        l.cycles
          .filter((c) => c.status === "RESEARCH_QUEUED")
          .map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`)
          .join(""),
      )}${wfSelect("opportunityId", "New research opportunity", state.market.opportunities.map((o) => `<option value="${esc(o.id)}">${esc(o.title)}</option>`).join(""))}${wfText("note", "How the lesson informed research")}<button>Link research follow-up</button></form><p class="panel-body">Create the next opportunity in Market & product research after the handoff, then link it here. Normal evidence and review controls still apply.</p>`,
    ) +
    panel(
      "Completed research links",
      l.followups
        .map(
          (f) =>
            `<p class="panel-body">Lesson ${esc(f.cycle_id)} → Opportunity ${esc(f.opportunity_id)} · ${esc(f.note)}</p>`,
        )
        .join("") || empty("No research follow-ups linked."),
    )
  );
}
function bindLearning() {
  bindForm("learning-propose", "learning/propose", (x) => ({
    ...x,
    requestKey: crypto.randomUUID(),
    confidence: Number(x.confidence),
    relevanceConfirmed: x.relevanceConfirmed === "on",
  }));
  bindForm("learning-followup", "learning/followup");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-learning-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("learning/" + b.dataset.learningAction, {
      id: b.dataset.id,
      contentHash: b.dataset.hash,
      confirm: true,
    });
    await refresh();
    notify("Learning workflow saved. No external action performed.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
