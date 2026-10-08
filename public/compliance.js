function compliancePage() {
  const c = state.compliance;
  return (
    heading(
      "Quality & Compliance",
      "Виктория · Human-operated reviews, independent holds and security escalation. Agents cannot approve or release holds.",
    ) +
    `<div class="banner ${c.holds.some((h) => h.status === "OPEN") ? "critical" : ""}">${c.holds.filter((h) => h.status === "OPEN").length} open company-wide holds · Content-review gate ${c.policy.requireReviews ? "ENABLED" : "DISABLED"} · Policy v${c.policy.version}. Destructive, publishing, refund and deployment tools remain unavailable.</div>` +
    wfDetails(
      "Open compliance hold / security escalation",
      `<form id="compliance-hold" class="inline-form">${wfSelect("category", "Category", ["SECURITY", "PRIVACY", "BRAND", "AUTHORITY", "DESTRUCTIVE"].map((v) => `<option>${v}</option>`).join(""))}${wfText("reason", "Reason and evidence", 3000)}<button class="primary">Block company work and escalate to CEO</button></form>`,
    ) +
    panel(
      "Compliance holds",
      c.holds
        .map(
          (h) =>
            `<article class="panel-body"><h3>${esc(h.category)} ${badge(h.status)}</h3><p>${esc(h.reason)}</p><p>${esc(h.id)} · ${esc(h.created_at)} · CEO remediation required</p></article>`,
        )
        .join("") || empty("No holds."),
    ) +
    wfDetails(
      "Privacy and brand policy",
      `<form id="compliance-policy" class="inline-form">${wfSelect("requireReviews", "Require compliance PASS before key transitions", `<option value="${c.policy.requireReviews}">${c.policy.requireReviews ? "Enabled" : "Disabled"}</option><option value="${!c.policy.requireReviews}">${c.policy.requireReviews ? "Disabled" : "Enabled"}</option>`)}<label class="wide">Prohibited brand terms, one per line<textarea name="terms" maxlength="2400">${esc(c.policy.terms.join("\n"))}</textarea></label><label class="wide">Brand guidelines<textarea name="brandGuidelines" required maxlength="4000">${esc(c.policy.brandGuidelines)}</textarea></label>${wfText("reason", "Policy change reason")}<label><input name="confirm" type="checkbox" required>I authorize this policy revision and expiration of pending approvals</label><button>Apply policy revision</button></form><p class="panel-body">The optional gate covers image dispatch, Shopify draft dispatch, marketing readiness, support draft review and Sarah assignment. Pattern scans are incomplete; humans must review privacy, consent, claims and IP. No legal clearance is implied.</p>`,
    ) +
    panel(
      "Artifacts and automated flags",
      c.artifacts
        .map(
          (a) =>
            `<article class="panel-body"><h3>${esc(a.kind)} · ${esc(a.id)}</h3><p>${a.flags.length ? esc(a.flags.join(" · ")) : "No configured pattern flags; human review still required."}</p><details><summary>Exact content to review</summary><pre>${esc(a.content)}</pre><p>Review hash ${esc(a.hash)}</p></details></article>`,
        )
        .join("") || empty("No reviewable artifacts."),
    ) +
    wfDetails(
      "Record content-bound compliance review",
      `<form id="compliance-review" class="inline-form">${wfSelect("artifact", "Artifact", c.artifacts.map((a) => `<option value="${a.kind}:${esc(a.id)}">${a.kind} · ${esc(a.id)}</option>`).join(""))}${wfSelect("verdict", "Verdict", "<option>BLOCK</option><option>PASS</option>")}${c.checks.map((k) => `<label><input name="${k}" type="checkbox">${esc(humanLabel(k))}</label>`).join("")}${wfText("note", "Review evidence and limitations", 3000)}<button>Record human review</button></form><p class="panel-body">BLOCK opens a company hold. PASS lasts seven days, binds this exact content and policy version, and never replaces execution approval.</p>`,
    ) +
    wfDetails(
      "Approve a hold-release plan",
      `<form id="compliance-release-plan" class="inline-form">${wfSelect(
        "id",
        "Open hold",
        c.holds
          .filter((h) => h.status === "OPEN")
          .map(
            (h) =>
              `<option value="${esc(h.id)}">${esc(h.category)} · ${esc(h.id)}</option>`,
          )
          .join(""),
      )}${wfText("remediation", "Remediation evidence", 4000)}<label><input name="confirm" type="checkbox" required>I approve this exact release plan for ten minutes</label><button>Approve release plan</button></form>`,
    ) +
    panel(
      "Release plans",
      c.releases
        .map(
          (r) =>
            `<article class="panel-body"><p>${esc(r.remediation)}</p><p>Hold ${esc(r.hold_id)} · ${r.consumed_at ? "CONSUMED" : Number(r.expires_at) <= Date.now() ? "EXPIRED" : "Awaiting explicit release"}</p>${!r.consumed_at && Number(r.expires_at) > Date.now() ? `<button data-compliance-release="${esc(r.id)}" data-hash="${esc(r.content_hash)}">Execute approved release</button>` : ""}</article>`,
        )
        .join("") || empty("No release plans."),
    ) +
    wfDetails(
      "Review an immutable audit range",
      `<form id="compliance-audit" class="inline-form">${wfInput("start", "First company sequence", "number")}${wfInput("end", "Last company sequence", "number")}${wfSelect("verdict", "Audit verdict", "<option>ESCALATE</option><option>NO_FINDINGS</option>")}${wfText("note", "Audit findings", 4000)}<button>Save audit review</button></form><p class="panel-body">Up to 1,000 records; company-filtered range and digest are preserved. ESCALATE opens a security hold. Use Audit log to inspect full records.</p>`,
    ) +
    panel(
      "Recent audit index",
      c.auditRows
        .map(
          (r) =>
            `<p class="panel-body">${r.sequence} · ${esc(r.action)} · ${esc(r.result)} · ${esc(r.created_at)}</p>`,
        )
        .join(""),
    ) +
    panel(
      "Review history",
      [
        ...c.reviews.map(
          (r) =>
            `<p class="panel-body">${esc(r.kind)} ${esc(r.artifact_id)} · ${esc(r.verdict)} · ${esc(r.note)} · policy v${r.policy_version}</p>`,
        ),
        ...c.auditReviews.map(
          (r) =>
            `<p class="panel-body">Audit ${r.start_sequence}–${r.end_sequence} · ${r.row_count} records · ${esc(r.verdict)} · ${esc(r.note)} · digest ${esc(r.digest)}</p>`,
        ),
      ].join("") || empty("No reviews."),
    )
  );
}
function bindCompliance() {
  bindForm("compliance-hold", "compliance/hold");
  bindForm("compliance-policy", "compliance/configure", (x) => ({
    ...x,
    requireReviews: x.requireReviews === "true",
    terms: x.terms
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean),
    confirm: x.confirm === "on",
  }));
  bindForm("compliance-review", "compliance/review", (x) => {
    const a = state.compliance.artifacts.find(
      (a) => a.kind + ":" + a.id === x.artifact,
    );
    return {
      ...x,
      kind: a.kind,
      id: a.id,
      contentHash: a.hash,
      checks: Object.fromEntries(
        state.compliance.checks.map((k) => [k, x[k] === "on"]),
      ),
    };
  });
  bindForm("compliance-release-plan", "compliance/release-request", (x) => ({
    ...x,
    confirm: x.confirm === "on",
  }));
  bindForm("compliance-audit", "compliance/audit-review", (x) => ({
    ...x,
    start: Number(x.start),
    end: Number(x.end),
  }));
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-compliance-release]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("compliance/release", {
      id: b.dataset.complianceRelease,
      contentHash: b.dataset.hash,
      confirm: true,
    });
    await refresh();
    notify("Hold released. Expired workflow approvals must be renewed.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
