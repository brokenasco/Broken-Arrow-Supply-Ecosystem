function resourcesPage() {
  return (
    heading(
      "AI Resource Center",
      "Dollar budgets · Token measurements · Human financial control",
    ) +
    '<div class="banner">Paid image dispatch now requires a central budget reservation and configured pricing. Image billing is reconciled in Design Studio; unresolved charges retain reservations. Historical calls before this integration are not backfilled. Ledger coverage is not a complete provider invoice. Simulation is not paid usage.</div><section id="resource-center" aria-live="polite">Loading resources…</section>'
  );
}
function bindResources() {
  const root = document.querySelector("#resource-center");
  if (!root) return;
  const money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(n / 1000000);
  const refreshResources = async () => {
    const r = await api("resources/overview");
    if (!root.isConnected) return;
    const totals = r.departments.reduce(
      (a, d) => ({
        budget: a.budget + d.budgetMicros,
        spent: a.spent + d.spentMicros,
        reserved: a.reserved + d.reservedMicros,
        tokens: a.tokens + d.tokens,
        calls: a.calls + d.calls,
      }),
      { budget: 0, spent: 0, reserved: 0, tokens: 0, calls: 0 },
    );
    root.innerHTML =
      `<div class="stats"><div class="stat"><small>${esc(r.month)} BUDGET · UTC</small><strong>${money(totals.budget)}</strong><p>$5 default per department; no rollover</p></div><div class="stat"><small>RECORDED COST</small><strong>${money(totals.spent)}</strong><p>Usage-based or explicitly estimated; inspect ledger</p></div><div class="stat"><small>RESERVED</small><strong>${money(totals.reserved)}</strong><p>Available ${money(totals.budget - totals.spent - totals.reserved)}</p></div><div class="stat"><small>RECORDED TOKENS</small><strong>${totals.tokens.toLocaleString()}</strong><p>${totals.calls} recorded requests · Cache savings unavailable</p></div></div>` +
      r.departments
        .map((d) =>
          wfDetails(
            `${d.name} · ${money(d.spentMicros)} / ${money(d.budgetMicros)} · ${d.status}`,
            `<div class="panel-body"><label>${esc(d.name)} recorded budget utilization <progress max="${Math.max(d.budgetMicros, 1)}" value="${Math.min(Math.max(d.spentMicros, 0), Math.max(d.budgetMicros, 1))}"></progress></label><p>Remaining after reservations: ${money(d.remainingMicros)} · ${d.tokens} reported tokens. Current active billable workers share the budget equally.</p></div>` +
              d.workers
                .map((w) =>
                  wfDetails(
                    `${w.name} · ${money(w.spentMicros)} used · ${w.status}`,
                    `<div class="panel-body"><p>Allocation ${money(w.allocationMicros)} · Reserved ${money(w.reservedMicros)} · Remaining ${money(w.remainingMicros)} · ${w.tokens} tokens</p><p>${w.nonBillable ? "Non-billable" : w.active ? "Active billable worker" : "Inactive / paused worker"}</p></div><form data-resource="agent-settings" class="inline-form"><input type="hidden" name="agentId" value="${esc(w.id)}"><label><input type="checkbox" name="nonBillable" ${w.nonBillable ? "checked" : ""}> Non-billable deterministic worker</label><label><input type="checkbox" name="confirm" required> I authorize recalculating equal allocations.</label><button>Save billing participation</button></form>`,
                  ),
                )
                .join("") +
              `<form data-resource="override" class="inline-form"><input type="hidden" name="departmentId" value="${esc(d.id)}"><input type="hidden" name="month" value="${esc(r.month)}">${wfInput("limitUsd", "This month's department limit (USD)", "text", String(d.budgetMicros / 1000000))}${wfText("reason", "Owner justification", 1500)}<label class="wide"><input type="checkbox" name="confirm" required> I explicitly authorize this month's limit. It expires next month.</label><button>Confirm monthly override</button></form>`,
          ),
        )
        .join("") +
      panel(
        "Recent immutable cost ledger",
        r.ledger.length
          ? r.ledger
              .map(
                (l) =>
                  `<article class="panel-body"><strong>${esc(agentName(l.agent_id))} · ${money(l.cost_micros)}</strong><p>${esc(l.provider)} / ${esc(l.model_id)} · ${esc(l.usage_status)} · ${esc(l.outcome)}</p><p>Request ${esc(l.request_id)} · Task ${esc(l.task_id)} · ${esc(l.budget_month)}<br>Input ${l.input_tokens ?? "unavailable"}, cached subset ${l.cached_input_tokens ?? "unavailable"}, output ${l.output_tokens ?? "unavailable"}, separate reasoning ${l.reasoning_tokens ?? "unavailable"}. Estimated ${money(l.estimated_micros)}.</p></article>`,
              )
              .join("")
          : empty(
              "No usage has been recorded in the new ledger. This does not mean the provider account has no charges.",
            ),
      ) +
      panel(
        "Active reservations and incidents",
        r.reservations
          .map(
            (h) =>
              `<p class="panel-body">${esc(h.agent_id)} · ${esc(h.state)} · ${money(h.estimated_micros)} · ${esc(h.budget_month)}</p>`,
          )
          .join("") +
          r.incidents
            .map(
              (i) =>
                `<p class="panel-body">${esc(i.agent_id)} · ${esc(i.reason)}</p>`,
            )
            .join("") || empty("No ledger reservations or resource incidents."),
      ) +
      wfDetails(
        "Owner model-pricing registry",
        `<div class="panel-body"><p>Prices are not prefilled from assumptions. Each saved revision preserves previous rates. Input counts include the cached subset; reasoning must be separate only when separately billed. Image modalities require an adapter with the corresponding pricing dimensions before integration.</p>${r.pricing.map((p) => `<p>${esc(p.provider)} / ${esc(p.model_id)} · ${esc(p.effective_at)} · ${p.active ? "Active revision" : "Disabled revision"}<br>Input ${money(p.input_micros_per_million)}, cached ${money(p.cached_micros_per_million)}, output ${money(p.output_micros_per_million)} per million tokens · ${esc(p.pricing_source)}</p>`).join("")}</div><form data-resource="pricing" class="inline-form">${wfInput("provider", "Provider")}${wfInput("modelId", "Exact model ID")}${wfInput("displayName", "Display name")}${wfInput("inputUsdPerMillion", "Input USD per million")}${wfInput("cachedUsdPerMillion", "Cached input USD per million")}${wfInput("outputUsdPerMillion", "Output USD per million")}${wfInput("separateReasoningUsdPerMillion", "Separate reasoning USD per million", "text", "0")}${wfInput("requestUsd", "Per-request USD", "text", "0")}${wfInput("toolUsd", "Per-tool-call USD", "text", "0")}${wfInput("effectiveAt", "Effective date", "datetime-local")}${wfText("source", "Verified pricing source and billing convention", 2000)}<label><input name="active" type="checkbox" checked> Enable this revision</label><label><input name="confirm" type="checkbox" required> I have verified these rates and authorize this revision.</label><button>Save pricing revision</button></form>`,
      ) +
      wfDetails(
        "Task cost ceilings",
        `<form data-resource="task-limits" class="inline-form">${wfSelect("taskId", "Existing task", state.tasks.map((t) => `<option value="${esc(t.id)}">${esc(t.objective)}</option>`).join(""))}${wfInput("maxCostUsd", "Maximum task cost (USD)")}${wfInput("maxCalls", "Maximum model calls", "number", "5")}<label><input type="checkbox" name="confirm" required> I authorize this task ceiling; it grants no dispatch permission.</label><button>Save task ceiling</button></form>`,
      ) +
      panel(
        "Monthly cost history",
        r.historicalMonths
          .map(
            (m) =>
              `<p class="panel-body">${esc(m.budget_month)} · ${money(m.cost_micros)} · ${m.tokens ?? "Unknown"} tokens</p>`,
          )
          .join("") ||
          empty("Historical entries will remain here across calendar resets."),
      );
  };
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-resource]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      for (const key of ["confirm", "active", "nonBillable"])
        if (form.elements.namedItem(key)) body[key] = body[key] === "on";
      if (body.maxCalls) body.maxCalls = Number(body.maxCalls);
      if (body.effectiveAt)
        body.effectiveAt = new Date(body.effectiveAt).toISOString();
      await api("resources/" + form.dataset.resource, body);
      notify("Owner resource setting recorded.");
      await refreshResources();
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  refreshResources().catch((error) => {
    if (root.isConnected)
      root.textContent = "Resource data unavailable: " + error.message;
  });
}
