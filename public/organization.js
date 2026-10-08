function organizationPage() {
  const o = state.organization,
    m = o.current,
    pct = (v) => (v === null ? "Unavailable" : (v * 100).toFixed(1) + "%"),
    num = (v) => (v === null ? "Unavailable" : Number(v).toFixed(2));
  const recommendations = (r) =>
    r.recommendations
      .map(
        (x) =>
          `<article class="panel-body"><h3>${esc(humanLabel(x.id.replaceAll("-", " ")))}</h3><p>${esc(x.reason)}</p><p>${esc(x.action)} · Review owner ${esc(agentName(x.owner))}</p><p class="small">Evidence IDs: ${esc(x.evidenceIds.join(", ") || "Aggregate activity count only")}</p></article>`,
      )
      .join("") ||
    empty(
      "No configured review threshold crossed. This does not establish organization effectiveness.",
    );
  return (
    heading(
      "Organization effectiveness",
      "Boris review workspace · Source-backed workflow metrics and human assessments. No autonomous employee scoring or policy changes.",
    ) +
    `<div class="banner">${esc(m.label)} · Last ${m.window.days} days · Snapshot ${esc(m.asOf)}. Simulation and provider records stay separate. Missing evidence is unavailable, not zero performance.</div>` +
    `<div class="stats"><div class="stat"><small>OPEN WORK RECORDS</small><strong>${m.backlog.total}</strong><p>${m.backlog.over24Hours} older than 24 hours</p></div><div class="stat"><small>FRESH VERIFIED SOURCES</small><strong>${m.research.freshVerified}/${m.research.sources}</strong><p>Human verification coverage</p></div><div class="stat"><small>AUTOMATION RUNS</small><strong>${m.automation.runs}</strong><p>${m.automation.failed} failed · ${m.automation.blocked} blocked</p></div><div class="stat"><small>PROVIDER TOOL USE</small><strong>—</strong><p>Call/token ledger unavailable</p></div></div>` +
    panel(
      "Design quality and cost coverage",
      m.design
        .map(
          (d) =>
            `<p class="panel-body"><strong>${d.simulation ? "SIMULATION" : "PROVIDER ASSETS"} QA</strong> · ${d.current.passed}/${d.current.reviewed} human reviews passed (${pct(d.current.passRate)}) · Previous ${d.previous.passed}/${d.previous.reviewed} (${pct(d.previous.passRate)}) · Change ${d.changePercentagePoints === null ? "Unavailable: fewer than five reviews per period" : num(d.changePercentagePoints) + " percentage points"}<br>${esc(d.comparisonNote)}</p>`,
        )
        .join("") +
        m.costs
          .map(
            (c) =>
              `<p class="panel-body"><strong>${esc(c.provider)}</strong> · ${c.successful}/${c.attempts} attempted jobs succeeded · ${c.reconciled}/${c.attempts} billing records reconciled · Reported actual cents ${c.reportedActualCents ?? "Unavailable"} · Reserved cents ${c.reservedCents} · Cost per successful output (cents) ${num(c.costPerSuccessfulOutputCents)}<br>${esc(c.note)}</p>`,
          )
          .join(""),
    ) +
    panel(
      "Research quality coverage",
      `<p class="panel-body">${m.research.verified} verified · ${m.research.disputed} disputed · ${m.research.stale} stale · ${m.research.sources} retrieved in this window.<br>${esc(m.research.note)}</p>`,
    ) +
    panel(
      "Campaign results",
      m.campaign
        .map(
          (c) =>
            `<p class="panel-body"><strong>${esc(c.label)}</strong> · ${esc(c.campaignId)}<br>A: ${c.a.conversions}/${c.a.visitors} (${pct(c.a.rate)}) · B: ${c.b.conversions}/${c.b.visitors} (${pct(c.b.rate)}) · ROAS ${num(c.roas)} · ${esc(c.currency)}<br>${esc(c.interpretation)}</p>`,
        )
        .join("") ||
        empty("No measured campaigns in this result-recording window."),
    ) +
    wfDetails(
      "Workflow inventory and bottlenecks",
      `<p class="panel-body">${esc(m.backlog.note)}</p>${m.backlog.oldest.map((b) => `<p class="panel-body">${esc(b.workflow)} · ${esc(b.id)} · ${esc(b.status)} · ${b.ageHours.toFixed(1)} hours since creation</p>`).join("") || empty("No open work.")}<p class="panel-body">Automation failure rate ${pct(m.automation.failureRate)} · Blocked rate ${pct(m.automation.blockedRate)}. Blocked controls are not successful runs and are not treated as software failures.</p>`,
    ) +
    wfDetails(
      "Workforce assignments and usefulness evidence",
      `<p class="panel-body">Assignment counts do not demonstrate autonomous usefulness. Human assessments below bind to a saved report.</p><div class="table-wrap"><table><thead><tr><th>WORKFLOW OWNER</th><th>ASSIGNED</th><th>COMPLETE</th><th>FAILED</th><th>AUTONOMOUS USEFULNESS</th></tr></thead><tbody>${m.workforce.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.assigned}</td><td>${a.completed}</td><td>${a.failed}</td><td>Not measured</td></tr>`).join("")}</tbody></table></div>`,
    ) +
    wfDetails(
      "Repetition and activity signals",
      `<p class="panel-body">${m.repeatedInstructions.length} repeated-instruction groups. Intentional iterations are not automatically duplicate waste.</p>${m.repeatedInstructions.map((g) => `<p class="panel-body">${g.count} jobs · ${esc(g.jobIds.join(", "))}</p>`).join("")}<p class="panel-body">${m.activity.totalEvents} audit events · ${m.activity.eventsPerDay.toFixed(1)}/day. ${esc(m.activity.note)}</p>${m.activity.byAction.map((a) => `<p class="panel-body">${esc(a.action)} · ${a.count}</p>`).join("")}`,
    ) +
    panel("Review recommendations", recommendations(m)) +
    wfDetails(
      "Save an immutable organization report",
      `<form id="organization-report" class="inline-form">${wfSelect("windowDays", "Reporting window", '<option value="30">30 days</option><option value="7">7 days</option><option value="90">90 days</option>')}<button class="primary">Save report snapshot</button></form>`,
    ) +
    panel(
      "Saved reports",
      o.reports
        .map(
          (r) =>
            `<article class="panel-body"><h3>${esc(r.body.asOf)} · ${r.body.window.days} days</h3><p>${esc(r.id)} · ${r.body.recommendations.length} review recommendations</p><details><summary>Exact report and source identifiers</summary><pre>${esc(JSON.stringify(r.body, null, 2))}</pre><p>SHA-256 ${esc(r.content_hash)}</p></details></article>`,
        )
        .join("") || empty("Save a report before recording an assessment."),
    ) +
    wfDetails(
      "Record human usefulness assessment",
      `<form id="organization-agent-review" class="inline-form">${wfSelect("reportId", "Assessment report", o.reports.map((r) => `<option value="${esc(r.id)}">${esc(r.body.asOf)} · ${r.body.window.days} days</option>`).join(""))}${wfSelect("subjectId", "Workflow owner", m.workforce.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join(""))}${wfSelect("verdict", "Usefulness verdict", "<option>NEEDS_EVIDENCE</option><option>USEFUL</option><option>REWORK</option>")}${wfText("note", "Usefulness evidence and limitations", 3000)}<button>Record human assessment</button></form>`,
    ) +
    wfDetails(
      "Triage a saved recommendation",
      `<form id="organization-recommendation-review" class="inline-form">${wfSelect("subject", "Saved recommendation", o.reports.flatMap((r) => r.body.recommendations.map((c) => `<option value="${esc(r.id)}:${esc(c.id)}">${esc(r.body.asOf)} · ${esc(c.id)}</option>`)).join(""))}${wfSelect("verdict", "Recommendation decision", "<option>ACCEPT_FOR_REVIEW</option><option>DISMISS</option>")}${wfText("note", "Decision evidence and limitations", 3000)}<button>Record review decision</button></form><p class="panel-body">Acceptance queues human consideration only. Permissions, security controls, budgets, schedules and approvals are not changed.</p>`,
    ) +
    panel(
      "Human assessment history",
      o.reviews
        .map(
          (r) =>
            `<p class="panel-body">${esc(r.subject_kind)} · ${esc(r.subject_id)} · ${esc(r.verdict)} · ${esc(r.note)}<br>Report ${esc(r.report_id)} · ${esc(r.created_at)}</p>`,
        )
        .join("") || empty("No human assessments recorded."),
    )
  );
}
function bindOrganization() {
  bindForm("organization-report", "organization/report", (x) => ({
    ...x,
    windowDays: Number(x.windowDays),
  }));
  bindForm("organization-agent-review", "organization/review", (x) => ({
    ...x,
    subjectKind: "AGENT",
    contentHash: state.organization.reports.find((r) => r.id === x.reportId)
      ?.content_hash,
  }));
  bindForm("organization-recommendation-review", "organization/review", (x) => {
    const [reportId, subjectId] = x.subject.split(":");
    return {
      ...x,
      reportId,
      subjectId,
      subjectKind: "RECOMMENDATION",
      contentHash: state.organization.reports.find((r) => r.id === reportId)
        ?.content_hash,
    };
  });
}
