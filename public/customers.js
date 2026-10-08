function customersPage() {
  const c = state.customers;
  const options = wfOptions(c.evidence.filter((e) => e.fresh));
  return (
    heading(
      "Customer intelligence",
      "Oliver · Николай · Jessica · Андрей. Human-reviewed evidence and draft-only support.",
    ) +
    `<div class="banner">Use redacted observations only. No customer messages, order lookups or refunds are executed. Automated contact-pattern checks are incomplete; human redaction is required.</div>` +
    wfDetails(
      "1 · Capture Voice of Customer",
      `<form id="voc-form" class="inline-form">${wfInput("title", "Evidence title")}${wfSelect("kind", "Evidence type", ["REVIEW", "SURVEY", "COMPLAINT", "SUPPORT", "PURCHASE_PATTERN"].map((x) => `<option>${x}</option>`).join(""))}${wfSelect("simulation", "Data mode", '<option value="true">SIMULATION</option><option value="false">Human-entered real evidence</option>')}${wfText("excerpt", "Redacted observation", 4000)}${wfText("provenance", "Source, method and authorized-use basis")}${wfInput("theme", "Normalized complaint theme")}${wfInput("observedAt", "Observed (UTC)", "datetime-local")}${wfInput("expiresAt", "Review due (UTC)", "datetime-local")}<label><input name="redacted" type="checkbox" required>Names, contact details, order identifiers and sensitive details removed</label><label><input name="authorized" type="checkbox" required>Authorized to use this observation for this purpose</label><button class="primary">Record evidence</button></form>`,
      !c.evidence.length,
    ) +
    panel(
      "Evidence library",
      c.evidence
        .map(
          (e) =>
            `<article class="panel-body"><h3>${esc(e.title)} ${badge(e.status)} ${e.fresh ? "" : " · NOT USABLE"}</h3>${e.body ? `<p>${e.body.simulation ? "SIMULATION" : "HUMAN-ENTERED"} · ${esc(e.body.kind)} · ${esc(e.body.theme)}</p><p>${esc(e.body.excerpt)}</p><p>Keyword suggestion: ${esc(e.suggestion.category)} · ${esc(e.suggestion.priority)}; human classification required.</p><p>${esc(e.body.provenance)} · Review due ${esc(e.body.expiresAt)}</p>` : "<p>Withdrawn from use; not erased from storage.</p>"}${e.status !== "WITHDRAWN" ? `<button data-customer-action="withdraw" data-id="${esc(e.id)}">Withdraw from use</button>` : ""}</article>`,
        )
        .join("") || empty("No observations."),
    ) +
    wfDetails(
      "2 · Review evidence",
      `<form id="voc-review" class="inline-form">${wfSelect("id", "Evidence", wfOptions(c.evidence.filter((e) => e.status !== "WITHDRAWN")))}${wfSelect("status", "Review", "<option>VERIFIED</option><option>DISPUTED</option>")}${wfText("note", "Verification evidence and caveats")}<button>Save review</button></form>`,
    ) +
    wfDetails(
      "3 · Create persona or insight version",
      `<form id="persona-form" class="inline-form">${wfSelect("kind", "Document kind", "<option>PERSONA</option><option>INSIGHT</option>")}${wfInput("title", "Document name")}${wfSelect("parentId", "Previous version", wfOptions(c.documents, "title", true)).replace(" required", "")}<label class="wide">Supporting evidence<select name="sourceIds" multiple required>${options}</select></label>${wfInput("confidence", "Confidence (0–1)", "text", "0.5")}${wfText("observed", "Observed attributes / findings", 4000)}${wfText("inferred", "Inferred attributes / hypothesis", 4000)}${wfText("limitations", "Evidence gaps and limitations")}${c.personaFields.map((k) => `<label class="wide">${esc(humanLabel(k))} (persona only; state observed/inferred/unknown)<textarea name="${k}" maxlength="1000"></textarea></label>`).join("")}<label class="wide">Recommendation (insight only)<textarea name="recommendation" maxlength="2000"></textarea></label><button>Create immutable version</button></form>`,
    ) +
    panel(
      "Personas & insights",
      c.documents
        .map(
          (d) =>
            `<article class="panel-body"><h3>${esc(d.title)} · ${esc(d.kind)} v${d.version}</h3><p>${esc(d.created_at)}</p>${d.usable ? `<p>${d.body.simulation ? "SIMULATION" : "HUMAN-REVIEWED EVIDENCE"} · Confidence ${esc(d.body.confidence)}</p><p>Observed: ${esc(d.body.observed)}</p><p>Inferred: ${esc(d.body.inferred)}</p><details><summary>Attributes, limitations and evidence</summary><pre>${esc(JSON.stringify({ ...d.body, sourceIds: d.sourceIds }, null, 2))}</pre></details>` : "<p>Unavailable: supporting evidence is stale, disputed or withdrawn.</p>"}</article>`,
        )
        .join("") || empty("No persona or insight versions."),
    ) +
    panel(
      "Recurring complaints · last 30 days",
      `<div class="panel-body"><p>At least 3 fresh verified observations sharing the same human-assigned theme. Counts are records, not unique customers; repeated reports may overlap.</p>${c.complaints.map((g) => `<p>${g.simulation ? "SIMULATION" : "HUMAN-ENTERED"} · ${esc(g.theme)} · ${g.count} observations</p>`).join("") || "No theme meets the threshold."}</div>`,
    ) +
    wfDetails(
      "4 · Classify support",
      `<form id="support-form" class="inline-form">${wfSelect("evidenceId", "Support / complaint evidence", wfOptions(c.evidence.filter((e) => e.fresh && ["SUPPORT", "COMPLAINT"].includes(e.body.kind))))}${wfSelect("category", "Category", c.supportCategories.map((x) => `<option>${x}</option>`).join(""))}${wfSelect("priority", "Priority", "<option>NORMAL</option><option>ESCALATE</option>")}${wfText("rationale", "Human classification rationale")}<button>Open classified case</button></form>`,
    ) +
    panel(
      "Support queue · DRAFT ONLY",
      c.cases
        .map(
          (s) =>
            `<article class="panel-body"><h3>${esc(s.category)} · ${esc(s.priority)} ${badge(s.status)}</h3><p>${s.simulation ? "SIMULATION · " : ""}${esc(s.rationale)}</p><p>Case ${esc(s.id)} ${s.usable ? "" : "· EVIDENCE UNAVAILABLE"}</p>${s.usable && s.status === "OPEN" ? `<button data-customer-action="draft" data-id="${esc(s.id)}">Generate template response draft</button>` : ""}</article>`,
        )
        .join("") || empty("No cases."),
    ) +
    wfDetails(
      "5 · Write or review response draft",
      `<form id="support-write" class="inline-form">${wfSelect(
        "id",
        "Open case",
        c.cases
          .filter((s) => s.usable && s.status === "OPEN")
          .map(
            (s) =>
              `<option value="${esc(s.id)}">${esc(s.category)} · ${esc(s.id)}</option>`,
          )
          .join(""),
      )}${wfText("body", "Human-written response draft", 4000)}<button>Save new draft</button></form><form id="support-review" class="inline-form">${wfSelect(
        "id",
        "Unreviewed draft",
        c.drafts
          .filter((d) => d.status === "DRAFT" && d.body)
          .map((d) => `<option value="${esc(d.id)}">${esc(d.id)}</option>`)
          .join(""),
      )}${wfSelect("status", "Draft review", "<option>REVIEWED</option><option>REJECTED</option>")}${wfText("note", "Review note")}<button>Record review (does not send)</button></form>`,
    ) +
    panel(
      "Response drafts",
      c.drafts
        .map(
          (d) =>
            `<article class="panel-body"><h3>DRAFT ONLY · ${badge(d.status)}</h3><p>${esc(d.id)}</p><p>${esc(d.body || "Unavailable: evidence not usable")}</p><p>${esc(d.review_note)}</p></article>`,
        )
        .join("") || empty("No drafts."),
    ) +
    wfDetails(
      "6 · Close local case",
      `<form id="support-close" class="inline-form">${wfSelect(
        "id",
        "Case",
        c.cases
          .filter((s) => s.status === "OPEN")
          .map(
            (s) =>
              `<option value="${esc(s.id)}">${esc(s.category)} · ${esc(s.id)}</option>`,
          )
          .join(""),
      )}${wfText("note", "Resolution evidence (no personal data)")}<button>Record local closure</button></form>`,
    ) +
    panel(
      "Support analytics",
      `<div class="panel-body"><p>${esc(c.analytics.label)}</p><p>${c.analytics.simulationCases} SIMULATION cases · ${c.analytics.realEvidenceCases} human-entered real-evidence cases</p><p>${c.analytics.open} open · ${c.analytics.closed} closed · ${c.analytics.escalated} open escalations</p>${c.analytics.byCategory.map((x) => `<p>${esc(x.category)}: ${x.count}</p>`).join("")}</div>`,
    )
  );
}
function bindCustomers() {
  const f = $("#voc-form");
  if (f) f.dataset.key = crypto.randomUUID();
  bindForm("voc-form", "customers/capture", (x) => ({
    ...x,
    requestKey: f.dataset.key,
    simulation: x.simulation === "true",
    redacted: x.redacted === "on",
    authorized: x.authorized === "on",
    observedAt: x.observedAt + ":00.000Z",
    expiresAt: x.expiresAt + ":00.000Z",
  }));
  bindForm("voc-review", "customers/review-evidence");
  bindForm("persona-form", "customers/document", (x) => ({
    ...x,
    confidence: Number(x.confidence),
    sourceIds: [...$("#persona-form").elements.sourceIds.selectedOptions].map(
      (o) => o.value,
    ),
  }));
  bindForm("support-form", "customers/support");
  bindForm("support-write", "customers/draft", (x) => ({
    ...x,
    mode: "HUMAN",
  }));
  bindForm("support-review", "customers/review-draft", (x) => ({
    ...x,
    contentHash: state.customers.drafts.find((d) => d.id === x.id)
      ?.content_hash,
  }));
  bindForm("support-close", "customers/close");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-customer-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("customers/" + b.dataset.customerAction, {
      id: b.dataset.id,
      mode: "TEMPLATE",
    });
    await refresh();
    notify("Customer workflow updated. No external action executed.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
