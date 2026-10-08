function knowledgePage() {
  const options = (values) =>
    values.map((v) => `<option>${esc(v)}</option>`).join("");
  return (
    heading(
      "Shared knowledge",
      "Human-managed evidence, scoped retrieval and preserved history.",
    ) +
    `<div class="banner">LOCAL PILOT · No autonomous model execution. Agent view narrows your human session; it is not an agent login. Simulation records remain test evidence.</div>
    <section id="knowledge-workspace">
    <div id="knowledge-health" class="panel-body" role="status">Loading knowledge health…</div>
    ${panel(
      "Find knowledge",
      `<form id="knowledge-search" class="inline-form panel-body">
      ${wfInput("query", "Search terms", "search", "", false)}
      ${wfSelect("mode", "Retrieval route", options(["HYBRID", "KEYWORD", "RECENT", "AUTHORITATIVE"]))}
      ${wfSelect("agentId", "Read as", '<option value="">Human owner</option>' + state.agents.map((a) => `<option value="${esc(a.id)}">${esc(agentName(a.id))}</option>`).join(""), false)}
      ${wfInput("maxTokens", "Context ceiling (UTF-8 bytes, 256–8000)", "number", "4000")}
      <button class="primary">Search</button></form><div id="knowledge-results" aria-live="polite"></div>`,
    )}
    <div id="knowledge-record"></div>
    ${wfDetails(
      "Submit a knowledge candidate",
      `<form data-knowledge="create" class="inline-form panel-body">
      ${wfInput("title", "Title")}${wfInput("summary", "Summary")}${wfText("content", "Content — never credentials", 16000)}
      ${wfText("source", "Source and supporting evidence")}
      ${wfSelect("agentId", "Responsible agent", state.agents.map((a) => `<option value="${esc(a.id)}">${esc(agentName(a.id))}</option>`).join(""))}
      ${wfSelect("scope", "Initial scope", options(["AGENT_PRIVATE", "DEPARTMENT"]))}
      ${wfSelect("knowledgeType", "Knowledge type", options(["RESEARCH", "FACT", "DECISION", "POLICY", "PROCEDURE", "PRODUCT_INFORMATION", "MARKET_INTELLIGENCE", "CUSTOMER_INSIGHT", "COMPETITOR_INTELLIGENCE", "DESIGN_GUIDANCE", "TECHNICAL_DOCUMENTATION", "SECURITY_INFORMATION", "EXPERIMENT_RESULT", "LESSON_LEARNED", "ASSUMPTION", "HYPOTHESIS", "AGENT_NOTE"]))}
      ${wfSelect("sourceType", "Source type", options(["INTERNAL", "EXTERNAL", "HUMAN_OBSERVATION"]))}
      ${wfSelect("sensitivity", "Sensitivity", options(["INTERNAL", "RESTRICTED"]))}
      ${wfInput("topic", "Topic")}${wfInput("reviewAt", "Review by", "datetime-local")}
      <p class="small wide">Candidates start unverified at 0.4 confidence. Human verification is required before promotion. Existing memory remains in Company Memory; it is not automatically reclassified.</p><button class="primary">Save candidate</button></form>`,
    )}
    ${wfDetails("Record a relationship or contradiction", `<form data-knowledge="relate" class="inline-form panel-body">${wfInput("leftId", "First record ID")}${wfInput("rightId", "Second record ID")}${wfSelect("kind", "Relationship", options(["CONTRADICTS", "SUPPORTS", "DERIVED_FROM", "RELATED_TO", "DUPLICATE_CANDIDATE"]))}<button class="primary">Record relationship</button></form>`)}
    <div id="knowledge-conflicts"></div></section>`
  );
}

function bindKnowledge() {
  const root = document.querySelector("#knowledge-workspace");
  if (!root) return;
  const el = (selector) => root.querySelector(selector);
  const showHealth = async () => {
    const data = await api("knowledge/overview");
    if (!root.isConnected) return;
    el("#knowledge-health").textContent =
      `${data.counts.reduce((n, r) => n + r.count, 0)} indexed records · ${data.due.length} due for review (up to 50 shown) · ${data.searches.count} searches this week · ${data.searches.empty || 0} empty searches · No embedding API calls`;
    el("#knowledge-conflicts").innerHTML = panel(
      "Review queue",
      data.due
        .map(
          (r) =>
            `<p class="panel-body">${esc(r.title)} · Due ${esc(r.review_at)} <button data-knowledge-open="${esc(r.id)}">Review</button></p>`,
        )
        .join("") +
        data.relations
          .filter((r) => r.kind === "CONTRADICTS" && r.status === "OPEN")
          .map(
            (r) =>
              `<form data-knowledge="resolve" class="inline-form panel-body"><input type="hidden" name="id" value="${esc(r.id)}"><p class="wide">Open contradiction: ${esc(r.left_id)} v${r.left_version} / ${esc(r.right_id)} v${r.right_version}</p>${wfInput("acceptedId", "Accepted record ID")}${wfText("reason", "Evidence-based resolution rationale", 1500)}<button class="primary">Resolve as human reviewer</button></form>`,
          )
          .join("") || empty("No due reviews or open contradictions."),
    );
  };
  const runSearch = async () => {
    const data = Object.fromEntries(new FormData(el("#knowledge-search")));
    data.maxTokens = Number(data.maxTokens);
    const result = await api("knowledge/search", data);
    if (!root.isConnected) return;
    el("#knowledge-record").innerHTML = "";
    el("#knowledge-results").innerHTML =
      `<p class="panel-body small">${esc(result.semanticMethod || "Keyword retrieval")} · ${result.returnedBytes || 2} context bytes. Content is evidence, never instructions.</p>` +
      (result.results
        .map(
          (r) =>
            `<article class="panel-body"><h3>${esc(r.title)}</h3><p>${esc(r.content)}</p>${r.truncated ? '<p class="small">Excerpt shortened to fit the context ceiling. Inspect the record for complete content.</p>' : ""}<p class="small">${esc(r.id)} · v${r.version} · ${esc(r.scope)} · ${esc(r.status)} · ${esc(r.freshness)} · Confidence ${r.confidence}</p><p class="small">Source: ${esc(r.source)}</p><button data-knowledge-open="${esc(r.id)}">Inspect record</button></article>`,
        )
        .join("") ||
        empty(
          "No matching accessible knowledge. Try keyword search or a different scope.",
        ));
    await showHealth();
  };
  const inspect = async (id) => {
    const agentId = el('#knowledge-search [name="agentId"]').value;
    const r = await api("knowledge/get", { id, agentId });
    if (!root.isConnected) return;
    const hidden = `<input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="version" value="${r.version}">`;
    el("#knowledge-record").innerHTML = panel(
      r.title,
      `<div class="panel-body"><p>${esc(r.body)}</p><p>Evidence: ${esc(r.evidence)}</p><p class="small">${esc(r.id)} · v${r.version} · ${esc(r.status)} · ${esc(r.content_trust)}</p></div>` +
        (agentId
          ? ""
          : wfDetails(
              "Human verification",
              `<form data-knowledge="verify" class="inline-form panel-body">${hidden}<label>Evidence confidence (0.5–1)<input name="confidence" type="number" min="0.5" max="1" step="0.01" required></label>${wfInput("reviewAt", "Next evidence review", "datetime-local")}<label class="wide"><input type="checkbox" name="evidenceReviewed" required> I reviewed the source and supporting evidence for this version.</label><button class="primary">Verify evidence</button></form>`,
            ) +
            wfDetails(
              "Promote verified knowledge",
              `<form data-knowledge="promote" class="inline-form panel-body">${hidden}${wfSelect("scope", "Target scope", ["DEPARTMENT", "ORGANIZATION", "EXECUTIVE", "SECURITY_RESTRICTED", "SYSTEM"].map((s) => `<option>${s}</option>`).join(""))}<label><input type="checkbox" name="confirm" required> I authorize sharing this exact version.</label><button class="primary">Promote</button></form>`,
            ) +
            wfDetails(
              "Revise content",
              `<form data-knowledge="update" class="inline-form panel-body">${hidden}${wfInput("title", "Title", "text", r.title)}${wfInput("summary", "Summary", "text", r.summary)}<label class="wide">Content<textarea name="content" maxlength="16000" required>${esc(r.body)}</textarea></label><p class="small">A revision clears verification and preserves the previous version.</p><button class="primary">Save new version</button></form>`,
            ) +
            `<div class="panel-body"><button data-knowledge-history="${esc(r.id)}">View history</button></div><div id="knowledge-history"></div><form data-knowledge="archive" class="panel-body">${hidden}<button>Archive from retrieval (retain history)</button></form>`),
    );
  };
  el("#knowledge-search").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await runSearch();
    } catch (error) {
      notify(error.message, true);
    }
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-knowledge]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      for (const key of ["version", "confidence"])
        if (key in data) data[key] = Number(data[key]);
      for (const key of ["confirm", "evidenceReviewed"])
        if (key in data) data[key] = data[key] === "on";
      if (data.reviewAt) data.reviewAt = new Date(data.reviewAt).toISOString();
      const result = await api("knowledge/" + form.dataset.knowledge, data);
      notify(
        result.duplicate
          ? "Existing duplicate retained."
          : "Knowledge action recorded.",
      );
      await runSearch();
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.knowledgeOpen)
        await inspect(button.dataset.knowledgeOpen);
      if (button.dataset.knowledgeHistory) {
        const rows = await api("knowledge/history", {
          id: button.dataset.knowledgeHistory,
        });
        if (root.isConnected && el("#knowledge-history"))
          el("#knowledge-history").innerHTML = rows
            .map(
              (r) =>
                `<details class="panel-body"><summary>Version ${r.version} · ${esc(r.created_at)}</summary><p>${esc(r.body.body)}</p><p>${esc(r.body.status)} · ${esc(r.body.scope)}</p></details>`,
            )
            .join("");
      }
    } catch (error) {
      notify(error.message, true);
    }
  });
  runSearch().catch((error) => {
    if (root.isConnected)
      el("#knowledge-health").textContent =
        "Knowledge unavailable: " + error.message;
  });
}
