function memosPage() {
  return (
    heading(
      "Memo Center",
      "Executive correspondence · Preserved records · Human authority",
    ) +
    '<div class="banner">Owner-controlled executive records. Reports distinguish ledger observations from human assessments. Review alone grants no execution authority.</div><section id="executive-reporting"></section><section id="memo-center" aria-live="polite">Loading memos…</section>'
  );
}
function bindMemos() {
  bindExecutiveReports();
  const root = document.querySelector("#memo-center");
  if (!root) return;
  let catalogue,
    filter = {},
    selected = null;
  const sectionNames = {
    purpose: "1. Purpose",
    summary: "2. Executive summary",
    details: "3. Details",
    analysis: "4. Analysis",
    recommendation: "5. Recommendation",
    ownerAction: "6. Owner action",
    supportingData: "7. Supporting data",
  };
  const option = (v, label) =>
    `<option value="${esc(v)}">${esc(label || v)}</option>`;
  async function load() {
    const data = await api("memos/list?" + new URLSearchParams(filter));
    if (!root.isConnected) return;
    catalogue = data.catalogue;
    root.innerHTML = `<form id="memo-search" class="inline-form">${wfInput("query", "Search memo text or ID", "text", filter.query || "")}<label>Department<select name="department">${option("", "All departments")}${catalogue.departments.map((d) => option(d.id, d.name)).join("")}</select></label><label>Type<select name="type">${option("", "All types")}${catalogue.types.map((t) => option(t.code, t.name)).join("")}</select></label><label>Status<select name="status">${option("", "Active inbox")}${["UNREAD", "REVIEWED", "ACTION REQUIRED", "MODIFICATION REQUESTED", "CLOSED", "ARCHIVED"].map((s) => option(s)).join("")}</select></label><button>Search</button><button type="button" id="memo-new">Compose memo</button></form><p>Showing up to ${data.limit} matching records. ${data.items.filter((m) => m.status === "UNREAD").length} unread in this result.</p><div id="memo-list">${data.items.map((m) => `<article class="panel"><div class="panel-body"><small>${esc(m.id)} · ${esc(m.created_at)} · ${esc(m.status)}</small><h2>${esc(m.subject)}</h2><p>From ${esc(m.author_name)} · ${esc(m.author_role)} · ${esc(m.priority)}${m.action_required ? " · OWNER ACTION REQUIRED" : ""}</p><p>${esc(m.body.summary)}</p><button data-memo-open="${esc(m.id)}">Open memo</button></div></article>`).join("") || "<p>No matching memos.</p>"}</div><section id="memo-detail" tabindex="-1"></section>`;
    for (const key of ["department", "type", "status"])
      root.querySelector(`[name="${key}"]`).value = filter[key] || "";
  }
  async function open(id) {
    let m = await api("memos/get", { id });
    if (m.status === "UNREAD")
      m = await api("memos/review", {
        id,
        status: "REVIEWED",
        reason: "Owner opened the full memo",
      });
    if (!root.isConnected) return;
    await load();
    if (!root.isConnected) return;
    selected = m;
    const detail = root.querySelector("#memo-detail");
    detail.innerHTML = panel(
      "BROKEN ARROW AI · MEMORANDUM",
      `<div class="panel-body"><p><strong>${esc(m.id)}</strong><br>Date: ${esc(m.created_at)}<br>From: ${esc(m.author_name)}, ${esc(m.author_role)}<br>Department: ${esc(m.department_id)}<br>To: Human Owner<br>Classification: ${esc(m.priority)}<br>Status: ${esc(m.status)}</p><h2>${esc(m.subject)}</h2>${catalogue.sections.map((k) => `<h3>${esc(sectionNames[k])}</h3><p style="white-space:pre-wrap">${esc(m.body[k])}</p>`).join("")}<h3>8. Record information</h3><p>Submitted by authenticated human ${esc(m.created_by)} on behalf of the named sender. No generated agent assessment is implied.</p><h3>Related memos</h3>${m.related.map((r) => `<button data-memo-open="${esc(r.id)}">${esc(r.id)} · ${esc(r.subject)}</button>`).join("") || "<p>None.</p>"}<h3>Review history</h3>${m.history.map((h) => `<p>${esc(h.created_at)} · ${esc(h.status)} · ${esc(h.reason)}</p>`).join("")}<button data-memo-revise="REVISION">Create revision</button><button data-memo-revise="ADDENDUM">Create addendum</button></div>` +
        (m.status === "ARCHIVED"
          ? ""
          : `<form id="memo-review" class="inline-form"><label>Record review<select name="status">${["ACTION REQUIRED", "MODIFICATION REQUESTED", "CLOSED", "ARCHIVED"].map((s) => option(s)).join("")}</select></label>${wfText("reason", "Owner reason", 1500)}<label><input type="checkbox" name="confirmNoExecution" required> This review grants no spending or execution approval.</label><button>Record review</button></form>`),
    );
    detail.insertAdjacentHTML(
      "beforeend",
      `<p><button data-memo-export="docx" data-memo-id="${esc(m.id)}">Download Word</button> <button data-memo-export="pdf" data-memo-id="${esc(m.id)}">Download PDF</button></p>`,
    );
    await attachMemoBudgetDecision(detail, m.id, () => open(m.id));
    detail.focus();
    detail.scrollIntoView({ block: "start" });
  }
  function compose(relation) {
    const prior = relation ? selected : null,
      detail = root.querySelector("#memo-detail");
    detail.innerHTML = panel(
      prior ? `New ${relation.toLowerCase()}` : "Compose official memo",
      `<form id="memo-compose" class="inline-form">${prior ? `<input type="hidden" name="parentId" value="${esc(prior.parent_id || prior.id)}"><input type="hidden" name="relation" value="${relation}">` : ""}<label>Sender represented<select name="authorId">${catalogue.authors.map((a) => option(a.id, a.name + " — " + a.title)).join("")}</select></label><label>Type<select name="type">${catalogue.types.map((t) => option(t.code, t.name)).join("")}</select></label><label>Priority<select name="priority">${catalogue.priorities.map((p) => option(p)).join("")}</select></label>${wfInput("subject", "Subject", "text", prior?.subject || "")}${catalogue.sections.map((k) => wfText(k, sectionNames[k] + " (state DATA UNAVAILABLE when needed)", 4000)).join("")}<label><input type="checkbox" name="actionRequired"> Owner action required</label><p>Submission preserves this content permanently. Corrections require a revision or addendum.</p><button>Submit official record</button></form>`,
    );
    if (prior) {
      for (const k of [...catalogue.sections, "authorId", "type", "priority"])
        detail.querySelector(`[name="${k}"]`).value =
          prior.body[k] ?? prior[{ authorId: "author_id" }[k] || k];
      detail.querySelector('[name="actionRequired"]').checked =
        !!prior.action_required;
    }
    detail.focus();
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.memoExport) {
      downloadExecutiveMemo(b.dataset.memoId, b.dataset.memoExport).catch(
        (err) => notify(err.message),
      );
      return;
    }
    if (b.id === "memo-new") compose();
    else if (b.dataset.memoRevise) compose(b.dataset.memoRevise);
    else if (b.dataset.memoOpen)
      open(b.dataset.memoOpen).catch((err) => notify(err.message));
  });
  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target,
      values = Object.fromEntries(new FormData(form)),
      button = form.querySelector('button[type="submit"],button:not([type])');
    if (button) button.disabled = true;
    try {
      if (form.id === "memo-search") {
        filter = values;
        await load();
      } else if (form.id === "memo-compose") {
        const m = await api("memos/submit", {
          ...values,
          actionRequired: values.actionRequired === "on",
        });
        await load();
        await open(m.id);
      } else if (form.id === "memo-review") {
        await api("memos/review", {
          ...values,
          id: selected.id,
          confirmNoExecution: values.confirmNoExecution === "on",
        });
        await load();
        await open(selected.id);
      }
    } catch (err) {
      notify(err.message);
    } finally {
      if (button) button.disabled = false;
    }
  });
  load()
    .then(() => {
      const id = new URLSearchParams(location.hash.split("?")[1] || "").get(
        "memo",
      );
      if (id) return open(id);
    })
    .catch((err) => {
      if (root.isConnected)
        root.textContent = "Memo Center unavailable: " + err.message;
    });
}

async function downloadExecutiveMemo(id, format) {
  const response = await fetch("/api/memos/export", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ id, format }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Export failed");
  }
  const blob = await response.blob(),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download =
    response.headers
      .get("Content-Disposition")
      ?.match(/filename="([^"]+)"/)?.[1] || id + "." + format;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function bindExecutiveReports() {
  const root = document.querySelector("#executive-reporting");
  if (!root) return;
  let active;
  async function load() {
    const data = await api("memos/reporting");
    if (!root.isConnected) return;
    root.innerHTML = wfDetails(
      "Reporting and evaluations",
      `<div class="panel-body"><p>Completed periods only. Closing preserves evidence and generates department memos once. Unsettled reservations block a financial close.</p></div><form data-executive="close-period" class="inline-form">${wfInput("period", "Completed month or quarter (YYYY-MM / YYYY-Q1)", "text")}<button>Close period and generate memos</button></form><form data-executive="reporting-settings" class="inline-form">${wfInput("startMonth", "First reporting month", "month", data.settings?.start_month || new Date().toISOString().slice(0, 7))}<label><input name="enabled" type="checkbox" ${data.settings?.enabled ? "checked" : ""}> Automatically generate completed monthly and quarterly reports</label><label><input name="confirm" type="checkbox" required> Authorize bounded internal reporting under my account</label><button>Save reporting schedule</button></form><p>${esc(data.settings?.last_error || "No reporting error recorded.")}</p><div>${data.reports.map((r) => `<p><a href="#memos?memo=${encodeURIComponent(r.memo_id)}">${esc(r.period)} · ${esc(r.department_id)} · ${esc(r.memo_id)}</a> <button data-executive-evidence="${esc(r.memo_id)}">Evidence / evaluate</button></p>`).join("") || "<p>No closed reports.</p>"}</div><h3>Evaluation history</h3>${data.evaluations.map((e) => `<p>${esc(e.created_at)} · ${esc(e.agent_id)} · ${esc(e.rating)} · ${esc(e.rationale)}</p>`).join("") || "<p>No supported ratings recorded.</p>"}<section id="executive-evidence"></section>`,
    );
    const catalogue = (await api("memos/list")).catalogue;
    root.insertAdjacentHTML(
      "beforeend",
      wfDetails(
        "Propose permanent budget policy",
        `<form data-executive="budget-propose" class="inline-form"><p>This prepares a separate owner decision. It does not change budgets. Default allocations remain equal unless you explicitly propose all worker amounts. Decisions expire after ten minutes.</p>${wfSelect("departmentId", "Department", catalogue.departments.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join(""))}${wfInput("effectiveMonth", "Effective future month", "month")}${wfInput("limitUsd", "Monthly department budget USD", "text", "5.00")}${wfText("reason", "Evidence, workload and justification", 3000)}<label>Optional explicit worker allocations (JSON; empty array keeps equal shares)<textarea name="allocations" rows="3">[]</textarea></label><p>Format: [{"agentId":"agent-id","usd":"1.25"}]. Include every active billable worker; amounts must total the department budget.</p><button>Create decision memo</button></form>`,
      ),
    );
  }
  root.addEventListener("click", async (event) => {
    const b = event.target.closest("[data-executive-evidence]");
    if (!b) return;
    try {
      active = await api("memos/evidence", { id: b.dataset.executiveEvidence });
      const e = active.evidence,
        subjects =
          active.kind === "QUARTER"
            ? e.agents.filter((a) => a.agentId === e.leader)
            : e.agents;
      root.querySelector("#executive-evidence").innerHTML =
        `<h3>${esc(active.period)} evidence</h3><p>${esc(e.coverage)}</p><div class="table-wrap"><table><thead><tr><th>Agent</th><th>Assigned</th><th>Completed</th><th>Cost USD</th><th>Tokens</th></tr></thead><tbody>${e.agents.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.assigned}</td><td>${a.completed}</td><td>${(a.spentMicros / 1e6).toFixed(6)}</td><td>${a.tokens ?? "Unavailable"}</td></tr>`).join("")}</tbody></table></div><details><summary>Supporting record IDs</summary>${e.agents.map((a) => `<p>${esc(a.name)}: ${esc(a.evidenceIds.join(", ") || "No qualifying records")}</p>`).join("")}</details><form data-executive="evaluate" class="inline-form"><input name="memoId" type="hidden" value="${esc(active.memo_id)}"><input name="contentHash" type="hidden" value="${esc(active.content_hash)}">${wfSelect("agentId", "Evaluation subject", subjects.map((a) => `<option value="${esc(a.agentId)}">${esc(a.name)}</option>`).join(""))}${wfSelect("rating", "Human evidence-based rating", ["Exceptional", "Exceeds Expectations", "Meets Expectations", "Needs Improvement", "Unsatisfactory"].map((v) => `<option>${v}</option>`).join(""))}${wfText("rationale", "Evidence and limitations", 3000)}${wfText("evidenceIds", "Supporting record IDs, comma separated", 2000)}<button>Record immutable evaluation</button></form>`;
    } catch (err) {
      notify(err.message);
    }
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-executive]");
    if (!form) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (form.dataset.executive === "budget-propose") {
      try {
        data.allocations = JSON.parse(String(data.allocations));
      } catch {
        notify("Worker allocations must be valid JSON.");
        return;
      }
    }
    if (form.dataset.executive === "evaluate")
      data.evidenceIds = String(data.evidenceIds)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (form.dataset.executive === "reporting-settings") {
      data.enabled = data.enabled === "on";
      data.confirm = data.confirm === "on";
    }
    const b = form.querySelector("button");
    b.disabled = true;
    try {
      const result = await api("memos/" + form.dataset.executive, data);
      if (form.dataset.executive === "budget-propose") {
        location.hash = "memos?memo=" + encodeURIComponent(result.memo_id);
        return;
      }
      await load();
      notify("Executive records saved.");
    } catch (err) {
      notify(err.message);
    } finally {
      b.disabled = false;
    }
  });
  load().catch((err) => {
    root.textContent = "Reporting unavailable: " + err.message;
  });
}

async function attachMemoBudgetDecision(root, id, refresh) {
  const proposal = await api("memos/budget-proposal", { id });
  if (!proposal || !root.isConnected) return;
  const section = document.createElement("section");
  section.className = "panel";
  section.innerHTML = `<div class="panel-body"><h3>Bound financial decision · ${esc(proposal.status)}</h3><p>Effective ${esc(proposal.body.effectiveMonth)} · ${esc(proposal.body.departmentId)} · $${(proposal.body.limitMicros / 1e6).toFixed(6)} monthly. Expires ${esc(proposal.expires_at)}.</p><p>${esc(proposal.decision_reason || "Approval changes the department's default budget beginning in the specified future month. Paid requests remain subject to all existing controls.")}</p>${proposal.status === "PENDING" ? `<form class="inline-form">${wfSelect("decision", "Owner decision", ["APPROVED", "DENIED", "MODIFICATION REQUESTED", "INFORMATION REQUESTED"].map((v) => `<option>${v}</option>`).join(""))}${wfText("reason", "Decision reason", 1000)}<label><input name="confirm" type="checkbox" required> I confirm the exact proposed policy, amounts, workers and effective month.</label><button>Record financial decision</button></form>` : ""}</div>`;
  section.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const form = event.target,
      data = Object.fromEntries(new FormData(form)),
      button = form.querySelector("button");
    button.disabled = true;
    try {
      await api("memos/budget-decision", {
        ...data,
        memoId: id,
        contentHash: proposal.content_hash,
        confirm: data.confirm === "on",
      });
      await refresh();
    } catch (err) {
      notify(err.message);
    } finally {
      button.disabled = false;
    }
  });
  root.append(section);
}
