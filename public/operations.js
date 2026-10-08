function operationsPage() {
  const o = state.operations;
  return (
    heading(
      "Operations",
      "Rachel · Сергей. Durable event inbox, internal alerts and incident escalation.",
    ) +
    `<div class="banner">Events are observations, not current Shopify truth. No refunds, stock changes, fulfillment actions or external messages are performed. Process the inbox manually; emergency stop blocks processing.</div>` +
    wfDetails(
      "Webhook authorization",
      `<p class="panel-body">${o.connection?.enabled ? esc(o.connection.domain) + " · Reception enabled" : "Reception disabled"} · Requires company-pinned server webhook configuration and Shopify subscription setup.</p><form id="ops-authorize" class="inline-form">${wfInput("domain", "Exact configured myshopify.com domain")}<label><input name="confirm" type="checkbox" required>Authorize signed event reception and minimized storage</label><button>Authorize reception</button></form><button data-ops-action="disconnect">Disable reception</button>`,
    ) +
    wfDetails(
      "Create a local simulation event",
      `<form id="ops-simulate" class="inline-form">${wfSelect("kind", "Scenario", ["LOW_INVENTORY", "FULFILLMENT_FAILURE", "CANCELLATION", "REFUND", "PRODUCT_CHANGE", "ORDER"].map((s) => `<option>${s}</option>`).join(""))}<button>Insert SIMULATION event</button></form>`,
    ) +
    panel(
      "Event inbox",
      `<div class="panel-body"><button data-ops-action="process">Process up to 50 pending events</button><p>${o.events.filter((e) => e.status === "RECEIVED").length} pending</p></div>` +
        o.events
          .map(
            (e) =>
              `<article class="panel-body"><h3>${esc(e.topic)} ${badge(e.status)}</h3><p>${e.simulation ? "SIMULATION" : "SIGNED SHOPIFY RECEIPT"} · ${esc(e.domain)} · ${esc(e.created_at)}</p><details><summary>Minimized event envelope</summary><pre>${esc(JSON.stringify(e.body, null, 2))}</pre><p>Event ID: ${esc(e.event_id)}</p></details></article>`,
          )
          .join(""),
    ) +
    panel(
      "Operations & inventory alerts",
      o.alerts
        .map(
          (a) =>
            `<article class="panel-body"><h3>${a.simulation ? "SIMULATION · " : ""}${esc(a.kind)} ${badge(a.severity)}</h3><p>${esc(a.message)}</p><p>Alert ${esc(a.id)}</p></article>`,
        )
        .join("") || empty("No alerts."),
    ) +
    wfDetails(
      "Open incident from an alert",
      `<form id="ops-incident" class="inline-form">${wfSelect(
        "alertId",
        "Alert",
        o.alerts
          .filter((a) => !o.incidents.some((i) => i.alert_id === a.id))
          .map(
            (a) =>
              `<option value="${esc(a.id)}">${a.simulation ? "SIMULATION · " : ""}${esc(a.kind)} · ${esc(a.id)}</option>`,
          )
          .join(""),
      )}${wfText("note", "Triage note")}<button>Open incident · Сергей</button></form>`,
    ) +
    panel(
      "Incident queue",
      o.incidents
        .map(
          (i) =>
            `<article class="panel-body"><h3>${o.alerts.find((a) => a.id === i.alert_id)?.simulation ? "SIMULATION · " : ""}${badge(i.status)} · ${esc(i.owner)}</h3><p>${esc(i.note)}</p><p>Incident ${esc(i.id)} · ${esc(i.updated_at)}</p></article>`,
        )
        .join("") || empty("No incidents."),
    ) +
    wfDetails(
      "Escalate or resolve incident",
      `<form id="ops-transition" class="inline-form">${wfSelect(
        "id",
        "Incident",
        o.incidents
          .filter((i) => i.status !== "RESOLVED")
          .map(
            (i) =>
              `<option value="${esc(i.id)}">${esc(i.status)} · ${esc(i.id)}</option>`,
          )
          .join(""),
      )}${wfSelect("status", "Action", "<option>ESCALATED</option><option>RESOLVED</option>")}${wfSelect("owner", "Escalation owner", "<option>rachel</option><option>ceo</option>")}${wfText("note", "Escalation reason or resolution evidence")}<button>Record internal incident update</button></form>`,
    )
  );
}
function bindOperations() {
  bindForm("ops-authorize", "operations/authorize", (x) => ({
    ...x,
    confirm: x.confirm === "on",
  }));
  bindForm("ops-simulate", "operations/simulate");
  bindForm("ops-incident", "operations/incident");
  bindForm("ops-transition", "operations/transition");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-ops-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("operations/" + b.dataset.opsAction, {});
    await refresh();
    notify("Operations updated. No external business action executed.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
