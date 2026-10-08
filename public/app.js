const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state,
  csrf = "",
  page = "overview",
  selectedAgent = "boris";
const pages = [
  ["overview", "◫", "Command center"],
  ["office", "▦", "Pixel Office"],
  ["shopify", "▣", "Shopify store"],
  ["analytics", "▥", "Analytics & reports"],
  ["experiments", "◇", "Experiments"],
  ["departments", "▦", "Departments"],
  ["agents", "♧", "AI workforce"],
  ["projects", "▤", "Projects & tasks"],
  ["approvals", "◇", "Approvals"],
  ["market", "⌕", "Market & product research"],
  ["studio", "▧", "Design Studio"],
  ["factory", "▣", "Product Factory"],
  ["marketing", "◷", "Marketing campaigns"],
  ["customers", "◎", "Customer intelligence"],
  ["technology", "⌘", "Technology & UX"],
  ["operations", "⚑", "Operations"],
  ["compliance", "◈", "Quality & Compliance"],
  ["learning", "↻", "Learning loop"],
  ["knowledge", "◇", "Shared knowledge"],
  ["resources", "◴", "AI Resource Center"],
  ["memos", "▤", "Memo Center"],
  ["automation", "◴", "Automation"],
  ["organization", "◈", "Organization effectiveness"],
  ["research", "⌕", "Research library"],
  ["memory", "▥", "Company memory"],
  ["notifications", "◉", "Notifications"],
  ["audit", "≡", "Audit log"],
  ["settings", "⚙", "Settings"],
];
function analyticsPage() {
  const a = state.analytics,
    d = a.data;
  const range = (p) =>
    `${p.start} → ${p.end} (end exclusive): ${p.covered}/${p.expected} days`;
  const comparisonPanel = (title, c) =>
    panel(
      title,
      `<div class="panel-body"><p>${esc(range(c.current))}</p><strong>${c.current.orders ?? "Unavailable"} orders · ${c.current.value === null ? "Unavailable" : esc(formatMoney(c.current.value, d.currency))} current order value</strong><p>Average order value: ${c.current.aov === null ? "Unavailable" : esc(formatMoney(c.current.aov, d.currency))}</p><p>Previous: ${esc(range(c.previous))}</p><p>${c.previous.orders ?? "Unavailable"} orders · Change: ${c.ordersChangePercent === null ? "Unavailable (coverage or zero baseline)" : esc(c.ordersChangePercent) + "%"}</p></div>`,
    );
  return (
    heading(
      "Evidence before strategy.",
      "Sofia · KPI definitions / Benjamin · analysis / Maria · recommendations. Human-triggered, rule-based workflows; no model connected.",
    ) +
    (d
      ? `<div class="banner ${d.stale ? "critical" : ""}">${d.stale ? "STALE — refresh Shopify. " : ""}Snapshot ${esc(d.asOf)} · ${esc(d.timezone)} · ${esc(d.currency)}<br>${esc(d.notes)}</div><div class="grid">${comparisonPanel("Last 7 completed days", d.week)}${comparisonPanel("Last completed calendar month", d.month)}</div>` +
        panel(
          "Review signals & strategy",
          `<div class="panel-body"><p>${esc(d.findings.join(" ") || (d.anomalyEligible ? "No order-count threshold crossed." : "Anomaly check unavailable: requires fresh data, eight complete days and at least 35 baseline orders."))}</p>${d.recommendations.map((r) => `<p>${esc(r)}</p>`).join("")}<form id="report-form"><button class="primary">Save evidence-based report</button></form></div>`,
        ) +
        panel(
          "Daily history · latest 90 days",
          `<div class="table-wrap"><table><thead><tr><th>STORE DATE</th><th>ORDERS</th><th>CURRENT VALUE</th><th>LAST OBSERVED</th></tr></thead><tbody>${d.days
            .slice()
            .reverse()
            .map(
              (r) =>
                `<tr><td>${esc(r.day)}</td><td>${r.orders}</td><td>${esc(formatMoney(r.value_minor, d.currency))}</td><td>${esc(r.as_of)}</td></tr>`,
            )
            .join("")}</tbody></table></div>`,
        )
      : empty(
          "INTEGRATION REQUIRED — sync Shopify to accumulate complete daily snapshots. No metrics are simulated.",
        )) +
    panel(
      "KPI definitions · version 1",
      a.kpis
        .map(
          (k) =>
            `<div class="row"><div><strong>${esc(k.name)}</strong><p>${esc(k.definition)}</p></div></div>`,
        )
        .join(""),
    ) +
    panel(
      "Saved reports · historical evidence",
      a.reports
        .map(
          (r) =>
            `<details class="panel-body"><summary>${esc(r.created_at)} · ${esc(r.body.asOf)} source cutoff</summary><p>${esc(r.body.method)}</p><p>${esc(r.body.notes)}</p><p>Weekly orders: ${r.body.week.current.orders ?? "Unavailable"} versus ${r.body.week.previous.orders ?? "Unavailable"}. Monthly orders: ${r.body.month.current.orders ?? "Unavailable"} versus ${r.body.month.previous.orders ?? "Unavailable"}.</p><p>${esc(r.body.findings.join(" "))}</p><p>${esc(r.body.recommendations.join(" "))}</p></details>`,
        )
        .join("") || empty("No reports saved."),
    )
  );
}
function experimentsPage() {
  const rows = state.analytics.experiments;
  return (
    heading(
      "Test a hypothesis.",
      "Maria’s experiment register. Human-reported evidence; no automatic execution, attribution or statistical significance claims.",
    ) +
    panel(
      "Register an experiment",
      `<form id="experiment-form" class="inline-form"><label>Title<input name="title" maxlength="160" required></label><label>KPI<select name="metric">${state.analytics.kpis.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}</select></label><label class="wide">Hypothesis<textarea name="hypothesis" maxlength="2000" required></textarea></label><label class="wide">Control, variant and assignment method<textarea name="variant" maxlength="2000" required></textarea></label><label class="wide">Success criterion and stopping rule<input name="target" maxlength="500" required></label><label>Start date<input type="date" name="startsOn" required></label><label>End date<input type="date" name="endsOn" required></label><button class="primary">Register experiment</button></form>`,
    ) +
    panel(
      "Experiment register",
      rows
        .map(
          (r) =>
            `<details class="panel-body"><summary>${esc(r.title)} · ${esc(r.status)}</summary><p>${esc(r.hypothesis)}</p><p>Control / variant: ${esc(r.variant)}</p><p>${esc(r.metric)} · ${esc(r.target)} · ${esc(r.starts_on)} → ${esc(r.ends_on)}</p><p>Baseline captured at registration: ${esc(r.baseline)}</p><p>Human-reported evidence: ${esc(r.evidence ?? "Not recorded")}</p><p>Conclusion / limitations: ${esc(r.conclusion ?? "Not recorded")}</p></details>`,
        )
        .join("") || empty("No experiments registered."),
    ) +
    panel(
      "Update lifecycle",
      `<form id="experiment-update" class="inline-form"><label>Experiment<select name="id" required>${rows
        .filter((r) => ["PLANNED", "RUNNING"].includes(r.status))
        .map(
          (r) =>
            `<option value="${esc(r.id)}">${esc(r.title)} (${r.status})</option>`,
        )
        .join(
          "",
        )}</select></label><label>Next state<select name="status"><option>RUNNING</option><option>COMPLETED</option><option>CANCELLED</option></select></label><label class="wide">Observed results and evidence (required to complete)<textarea name="evidence" maxlength="4000"></textarea></label><label class="wide">Conclusion and limitations (required to complete)<textarea name="conclusion" maxlength="2000"></textarea></label><button class="primary">Save transition</button></form>`,
    )
  );
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      $("#shell").hidden = true;
      $("#login").hidden = false;
    }
    throw new Error(data.error || "Request failed");
  }
  return data;
}
async function refresh() {
  state = await api("state");
  $("#login").hidden = true;
  $("#shell").hidden = false;
  render();
}
const agentName = (id) =>
  state.agents.find((a) => a.id === id)?.definition.name ?? id;
const deptName = (id) =>
  ({
    executive: "Executive office",
    marketing: "Marketing",
    product: "Product",
    technology: "Technology",
    analytics: "Analytics & strategy",
    customers: "Customer intelligence",
    operations: "Operations",
    compliance: "Quality & compliance",
  })[id] ?? id;
const badge = (label, kind = "") =>
  `<span class="status ${kind}">${esc(label)}</span>`;
const empty = (message) => `<div class="empty">${esc(message)}</div>`;
const heading = (title, sub) =>
  `<div class="heading"><div><div class="eyebrow">EXECUTIVE WORKSPACE</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="date">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</div></div>`;
const panel = (title, body, link = "") =>
  `<section class="panel"><div class="panel-head"><h2>${title}</h2>${link}</div>${body}</section>`;
const agentOptions = () =>
  state.agents
    .map(
      (a) =>
        `<option value="${a.id}" ${a.id === selectedAgent ? "selected" : ""}>${esc(a.definition.name)} · ${esc(a.definition.title)}</option>`,
    )
    .join("");
function chat() {
  return panel(
    '<div class="chat-intro"><div class="avatar">Б</div><div>Ask ' +
      esc(agentName(selectedAgent)) +
      "<p>Status assistant · No model connected</p></div></div>",
    `<div class="chat-messages">${
      state.messages
        .filter((m) => m.agent_id === selectedAgent)
        .map(
          (m) =>
            `<div class="message ${m.role === "CEO" ? "ceo" : ""}"><small>${m.role === "CEO" ? "YOU" : esc(agentName(selectedAgent))}</small>${esc(m.body)}</div>`,
        )
        .join("") ||
      empty(
        "Your executive briefing starts here. Ask about company status, tasks or pending approvals.",
      )
    }</div><form id="chat-form" class="chat-form"><label class="small">Message ${esc(agentName(selectedAgent))}<textarea name="message" placeholder="What needs my attention today?" required maxlength="3000"></textarea></label><button class="primary">Send message →</button></form><div class="chips"><button data-prompt="Give me a company status briefing">Company briefing</button><button data-prompt="Show pending approvals">Pending approvals</button></div>`,
  );
}
function overview() {
  const open = state.tasks.filter(
      (t) => !["COMPLETE", "CANCELLED"].includes(t.status),
    ).length,
    pending = state.approvals.filter(
      (a) => a.state === "PENDING" && a.expires_at > Date.now(),
    ).length;
  return (
    heading(
      "A clear view of your company.",
      "Your people, priorities and decisions, in one place.",
    ) +
    `<div class="stats">${[
      [
        "ORDERS TODAY",
        state.shopify.data?.todayOrders ?? "—",
        state.shopify.data
          ? "Shop timezone · As of last sync"
          : "Shopify sync required",
      ],
      ["ACTIVE TASKS", open, "Durable work · Execution disabled"],
      ["AWAITING YOUR APPROVAL", pending, "You have the final say"],
      ["AI WORKFORCE", state.agents.length, "Registered employees · 0 running"],
    ]
      .map(
        ([label, value, foot]) =>
          `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div><section class="panel brief"><div class="panel-body"><div class="eyebrow">FROM THE EXECUTIVE OFFICE</div><h2>The organization is ready.<br>Let’s establish the foundations.</h2><p>Your company structure and control plane are in place. Start by defining goals and building company memory. Visit Shopify store to authorize reads, sync records and inspect data coverage.</p><div class="signature"><div class="avatar">Б</div><div>Борис<small class="small"> · Chief Operating Officer</small></div></div></div></section>${panel(
      "Department overview",
      state.departments
        .filter((d) => d.id !== "executive")
        .map(
          (d) =>
            `<div class="row"><div class="row-title"><div class="department-icon">${esc(deptName(d.id)[0])}</div><div><strong>${esc(deptName(d.id))}</strong><small>${state.agents.filter((a) => a.department === d.id).length} employees · Schedules disabled</small></div></div>${badge(d.paused ? "PAUSED" : "READY FOR SETUP", d.paused ? "red" : "")}</div>`,
        )
        .join(""),
      '<a href="#departments">View organization ↗</a>',
    )}${panel(
      "Current priorities",
      state.tasks
        .slice(-4)
        .reverse()
        .map(
          (t) =>
            `<div class="row"><div><strong>${esc(t.objective)}</strong><small>${esc(agentName(t.agent_id))}</small></div>${badge(t.status, "blue")}</div>`,
        )
        .join("") ||
        empty("No tasks yet. Create a project and assign the first objective."),
      '<a href="#projects">View projects ↗</a>',
    )}</div><div>${chat()}${panel("Connection health", ["Shopify", "Language model", "Image generation"].map((x) => `<div class="row"><strong>${x}</strong>${badge(x === "Shopify" ? state.integrations.shopify : "NOT CONNECTED")}</div>`).join(""))}${panel("Human control", '<div class="panel-body"><p class="small muted">External writes are disabled. All consequential proposals need CEO review. Pause any department or employee, or stop the entire company.</p><a class="small" href="#settings">Review operating boundaries →</a></div>')}</div></div>`
  );
}
function directory() {
  return (
    heading(
      "Your AI workforce.",
      "Specialized roles, shared memory and clear lines of authority.",
    ) +
    `<div class="toolbar"><input id="agent-search" aria-label="Search agents" placeholder="Search people, roles or departments…"></div><div class="directory">${state.agents.map((a) => `<article class="agent-card" data-search="${esc((a.definition.name + " " + a.definition.title + " " + a.department).toLowerCase())}"><div class="agent-top"><div class="avatar">${esc(a.definition.name.slice(0, 2))}</div>${badge(a.paused ? "PAUSED" : "REGISTERED", a.paused ? "red" : "")}</div><h3>${esc(a.definition.name)}</h3><p>${esc(a.definition.title)}<br>${esc(deptName(a.department))}</p><div class="small muted">Reports to ${esc(a.definition.manager === "ceo" ? "CEO" : agentName(a.definition.manager))}</div><div class="actions"><button data-profile="${a.id}">View profile</button><button data-control="agent" data-target="${a.id}" data-paused="${!a.paused}">${a.paused ? "Resume" : "Pause"}</button></div></article>`).join("")}</div>`
  );
}
function coordinationPanel() {
  const eligible = state.tasks.filter(
    (t) => !["COMPLETE", "FAILED", "CANCELLED"].includes(t.status),
  );
  return panel(
    "Structured task handoff",
    `<p class="panel-body">Owner-authored delegation follows the parent agent’s reporting authority. Recipients retain pending work while held. This creates a blocked task record, not paid execution or approval.</p><form id="handoff-form" class="inline-form"><input type="hidden" name="requestId" value="${crypto.randomUUID()}"><label class="wide">Parent task<select name="parentTaskId" required>${eligible.map((t) => `<option value="${esc(t.id)}">${esc(agentName(t.agent_id))}: ${esc(t.objective)}</option>`).join("")}</select></label><label class="wide">Receiving agent<select name="agentId">${agentOptions()}</select></label><label class="wide">Objective<textarea name="objective" required maxlength="2000"></textarea></label><label class="wide">Expected output<textarea name="expectedOutput" required maxlength="2000"></textarea></label><button ${eligible.length ? "" : "disabled"}>Record handoff</button></form><button data-handoff-history>View recent handoffs</button><div id="handoff-history"></div>`,
  );
}
function projects() {
  return (
    heading(
      "Move objectives into action.",
      "Work is stored durably. Tasks stay blocked until a worker and provider are configured.",
    ) +
    `<div class="grid"><div>${panel("Projects", state.projects.map((p) => `<div class="row"><div><strong>${esc(p.name)}</strong><small>${esc(p.objective)}</small></div>${badge(p.status)}</div>`).join(""))}${panel("Task register", `<div class="table-wrap"><table><thead><tr><th>OBJECTIVE / PROJECT</th><th>OWNER</th><th>STATE</th><th></th></tr></thead><tbody>${state.tasks.map((t) => `<tr><td>${esc(t.objective)}<small>${esc(state.projects.find((p) => p.id === t.project_id)?.name)}</small></td><td>${esc(agentName(t.agent_id))}</td><td>${badge(t.status, "blue")}</td><td>${!["CANCELLED", "COMPLETE"].includes(t.status) ? `<button data-cancel="${t.id}">Cancel</button>` : ""}</td></tr>`).join("")}</tbody></table>${!state.tasks.length ? empty("No tasks assigned.") : ""}</div>`)}</div><div>${panel("Create a project", `<form id="project-form" class="inline-form"><label class="wide">Project name<input name="name" required maxlength="120"></label><label class="wide">Business objective<textarea name="objective" required maxlength="2000"></textarea></label><button class="primary">Create project</button></form>`)}${panel("Assign a task", `<form id="task-form" class="inline-form"><label class="wide">Project<select name="projectId">${state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label><label class="wide">Employee<select name="agentId">${agentOptions()}</select></label><label class="wide">Objective<textarea name="objective" required maxlength="2000"></textarea></label><button class="primary">Save task</button></form>`)}</div></div>`
  );
}
function approvals() {
  return (
    heading(
      "Decisions stay with you.",
      "Approval records intent. No external action is executed by this foundation.",
    ) +
    `<div class="grid"><div>${panel(
      "Approval queue",
      state.approvals
        .slice()
        .reverse()
        .map(
          (a) =>
            `<div class="approval">${badge(a.risk, a.risk === "RED" ? "red" : "")} ${badge(a.state === "PENDING" && a.expires_at <= Date.now() ? "EXPIRED" : a.state, "blue")}<p>${esc(JSON.parse(a.payload).summary)}</p><div class="memory-meta">${esc(agentName(a.agent_id))} · ${esc(a.tool)}<br>Expires ${esc(new Date(a.expires_at).toLocaleString())}<br>Proposal fingerprint: ${esc(a.payload_hash.slice(0, 16))}</div>${a.state === "PENDING" && a.expires_at > Date.now() ? `<div class="actions"><button class="primary" data-decision="APPROVED" data-id="${a.id}">Approve proposal</button><button data-decision="REJECTED" data-id="${a.id}">Reject</button></div>` : ""}</div>`,
        )
        .join("") || empty("No proposals waiting for review."),
    )}</div><div>${panel("Record a proposal", `<form id="approval-form" class="inline-form"><label class="wide">Proposing employee<select name="agentId">${agentOptions()}</select></label><label>Risk<select name="risk"><option>YELLOW</option><option>RED</option></select></label><label>Proposed action<input name="tool" required placeholder="product.publish" maxlength="100"></label><label class="wide">Exact proposal<textarea name="summary" required maxlength="2000"></textarea></label><p class="small muted wide">For planning and review only. A grant, configured adapter and final policy check are separately required for execution.</p><button class="primary">Submit for review</button></form>`)}</div></div>`
  );
}
function memory(research = false) {
  const records = research ? state.research : state.memory;
  return (
    heading(
      research ? "Research with a source." : "Institutional knowledge.",
      "Evidence, uncertainty and review dates travel with every finding.",
    ) +
    `<div class="toolbar"><input id="memory-search" aria-label="Search knowledge" placeholder="Search title, evidence or category…"></div><div class="grid"><div>${panel(research ? "Research library" : "Company memory", records.map((m) => `<article class="memory-card" data-search="${esc((m.title + " " + m.body + " " + m.category + " " + m.evidence).toLowerCase())}">${badge(m.classification)} ${badge(new Date(m.review_at) < new Date() ? "REVIEW DUE" : m.status, "blue")}<h3>${esc(m.title)}</h3><p>${esc(m.body)}</p><div class="memory-meta">Evidence: ${esc(m.evidence)}<br>Confidence: ${Math.round(m.confidence * 100)}% · ${esc(m.category)}<br>Review: ${esc(new Date(m.review_at).toLocaleDateString(undefined, { timeZone: "UTC" }))}${m.source_url ? `<br><a href="${esc(m.source_url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}</div></article>`).join("") || empty("No findings recorded. Add evidence-backed knowledge to begin."))}</div><div>${panel("Add a knowledge candidate", `<form id="memory-form" class="inline-form"><input type="hidden" name="research" value="${research}"><label class="wide">Title<input name="title" required maxlength="160"></label><label class="wide">Finding<textarea name="body" required maxlength="10000"></textarea></label><label>Classification<select name="classification"><option>HYPOTHESIS</option><option>OBSERVATION</option><option>FACT</option><option>RECOMMENDATION</option></select></label><label>Category<input name="category" required placeholder="brand, market, product…" maxlength="80"></label><label class="wide">Supporting evidence<textarea name="evidence" required maxlength="4000"></textarea></label><label class="wide">Source URL<input name="sourceUrl" type="url"></label><label>Source date<input name="sourceDate" type="date"></label><label>Review date<input name="reviewAt" type="date" required></label><label>Confidence (0–1)<input name="confidence" type="number" min="0" max="1" step="0.05" value="0.5" required></label><p class="small muted wide">New knowledge starts as NEEDS VERIFICATION, including claims classified as facts.</p><button class="primary">Save candidate</button></form>`)}</div></div>`
  );
}
function departments() {
  return (
    heading(
      "One coordinated organization.",
      "Department heads report to Борис. Quality & Compliance reports directly to you.",
    ) +
    state.departments
      .map((d) =>
        panel(
          esc(deptName(d.id)),
          state.agents
            .filter((a) => a.department === d.id)
            .map(
              (a) =>
                `<div class="row"><div><strong>${esc(a.definition.name)}</strong><small>${esc(a.definition.title)} · Reports to ${esc(a.definition.manager === "ceo" ? "CEO" : agentName(a.definition.manager))}</small></div><button data-profile="${a.id}">View profile</button></div>`,
            )
            .join(""),
          `<button data-control="department" data-target="${d.id}" data-paused="${!d.paused}">${d.paused ? "Resume department" : "Pause department"}</button>`,
        ),
      )
      .join("")
  );
}
function formatMoney(minor, currency) {
  if (minor == null || !currency) return "—";
  const format = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  });
  return format.format(
    minor / 10 ** format.resolvedOptions().maximumFractionDigits,
  );
}
function shopifyPage() {
  const s = state.shopify,
    c = s.connection,
    d = s.data;
  const connection = panel(
    "Read-only connection",
    `<div class="panel-body"><p class="small">${c ? esc(c.domain) : "No store authorized"} ${badge(c?.status ?? "INTEGRATION REQUIRED", c?.status === "ERROR" ? "red" : "")}</p><p class="small muted">API ${esc(s.apiVersion)} · Products, inventory, recent orders, refunds and fulfillment. No Shopify writes.</p>${c?.errorCode ? `<div class="banner critical">Last sync failed: ${esc(c.errorCode)}. Previous data was preserved.</div>` : ""}${c?.lastSuccessAt ? `<p class="small">Last successful sync: ${esc(new Date(c.lastSuccessAt).toLocaleString())}<br>Store timezone: ${esc(c.timezone)} · Currency: ${esc(c.currency)}</p>` : ""}${c ? `<p class="small muted">Verified scopes: ${esc(c.scopes.join(", ") || "Not yet verified")}</p><div class="actions"><button class="primary" data-shopify-action="sync" ${c.status === "DISCONNECTED" || state.company.stopped ? "disabled" : ""}>Sync now</button> <button data-shopify-action="refresh">Refresh status</button> <button data-shopify-action="disconnect" ${c.status === "DISCONNECTED" ? "disabled" : ""}>Disconnect locally</button></div>` : ""}</div>`,
  );
  const setup = panel(
    "Authorize store reads",
    `<form id="shopify-form" class="inline-form"><p class="small muted wide">Configure server-side credentials first using SHOPIFY.md. No tokens are entered here. Company ID for configuration: <code>${esc(state.company.id)}</code></p><label class="wide">Shopify domain<input name="domain" placeholder="your-store.myshopify.com" value="${esc(c?.domain ?? "")}" required maxlength="253"></label><label class="wide">Customer summaries<select name="customerAccess"><option value="false">Disabled — no customer queries</option><option value="true">Allow minimal customer summaries (server opt-in required)</option></select></label><label class="wide consent"><input name="authorizeReadAccess" type="checkbox" required> I authorize read_products, read_inventory and read_orders for this store, plus read_customers only if selected above. No writes are authorized.</label><p class="small muted wide">Customer summaries exclude names, email, phone, addresses and message content. Disconnecting here stops local access; revoke app scopes separately in Shopify.</p><button class="primary">Authorize read access</button></form>`,
  );
  let data = empty(
    "Complete a successful sync to see verified store data. No numbers are invented while disconnected.",
  );
  if (d) {
    data = `<div class="banner ${d.stale ? "critical" : ""}">${d.stale ? "STALE SNAPSHOT — refresh required. " : "LIVE SHOPIFY DATA — "}${esc(d.notes)}<br>Coverage: ${esc(c.windowStart)} to ${esc(c.windowEnd)}. Store catalog and inventory reflect fetch time; Shopify does not supply a cross-resource transactional snapshot.</div><div class="stats">${[
      ["ORDERS · LAST 7 DAYS", d.orderCount],
      [
        "CURRENT ORDER VALUE",
        formatMoney(d.currentOrderTotalMinor, c.currency),
      ],
      [
        "AVERAGE ORDER VALUE",
        formatMoney(d.averageOrderTotalMinor, c.currency),
      ],
      ["CACHED PRODUCTS", d.counts.products],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat"><div class="stat-label">${k}</div><div class="stat-value">${esc(v)}</div><div class="stat-foot">As of ${esc(new Date(d.asOf).toLocaleString())}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div>${panel("Best-selling products · Units ordered", d.topProducts.length ? `<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>UNITS</th></tr></thead><tbody>${d.topProducts.map((p) => `<tr><td>${esc(p.title)}</td><td>${p.units}</td></tr>`).join("")}</tbody></table></div>` : empty("No product units observed in eligible orders."))}${panel("Recent orders · 30-day cohort", `<div class="table-wrap"><table><thead><tr><th>CREATED</th><th>ORDER VALUE</th><th>PAYMENT / FULFILLMENT</th><th>REFUNDED</th></tr></thead><tbody>${d.recentOrders.map((o) => `<tr><td>${esc(new Date(o.created_at).toLocaleString())}${o.test ? "<small>TEST ORDER</small>" : ""}${o.cancelled_at ? "<small>CANCELLED</small>" : ""}</td><td>${esc(formatMoney(o.current_total_minor, o.currency))}</td><td>${esc(o.financial_status ?? "UNKNOWN")}<small>${esc(o.fulfillment_status)}</small></td><td>${esc(formatMoney(o.refunded_minor, o.currency))}</td></tr>`).join("")}</tbody></table></div>`)}</div><div>${panel("Low inventory · 5 or fewer available", d.lowInventory.map((i) => `<div class="row"><div><strong>${esc(i.product)}</strong><small>${esc(i.variant)} · ${esc(i.sku ?? "No SKU")}</small></div>${badge(i.available + " available", Number(i.available) <= 0 ? "red" : "")}</div>`).join("") || empty(d.counts.inventory === 0 ? "No inventory balances returned; availability is unknown." : "No tracked active variants meet the low-stock threshold."))}${panel("Products to review · Zero observed sales", d.zeroSalesProducts.map((p) => `<div class="row"><strong>${esc(p.title)}</strong>${badge("REVIEW")}</div>`).join("") || empty("No eligible active products with zero observed units."))}${panel("Coverage & privacy", `<div class="panel-body"><p class="small">${d.counts.orders} orders · ${d.counts.refunds} refund records · ${d.counts.fulfillments} fulfillment records · ${d.counts.inventory} item/location balances</p><p class="small">Customer summaries: ${d.customerAccess ? d.counts.customers + " records (minimal fields)" : "disabled; no customer queries"}</p><p class="small muted">Refunds and fulfillments belong to orders created in the cached 30-day window. Older-order events are not included. Conversion, traffic, margins and customer acquisition costs remain unavailable.</p></div>`)}</div></div>`;
  }
  return (
    heading(
      "Your store, grounded in evidence.",
      "Verified reads, clear coverage and fresh data. Every sync is initiated by you.",
    ) +
    `<div class="grid"><div>${connection}</div><div>${setup}</div></div>` +
    data +
    (d
      ? panel(
          "Catalog · First 100 products",
          `<div class="table-wrap"><table><thead><tr><th>PRODUCT</th><th>STATUS</th><th>UNITS · LAST 7 DAYS</th></tr></thead><tbody>${d.catalog.map((p) => `<tr><td>${esc(p.title)}</td><td>${badge(p.status)}</td><td>${p.units}</td></tr>`).join("")}</tbody></table></div>`,
        )
      : "") +
    panel(
      "Sync history",
      s.runs
        .map(
          (r) =>
            `<div class="row"><div><strong>${esc(new Date(r.started_at).toLocaleString())}</strong><small>${esc(r.error_code ?? (r.counts ? "Snapshot committed" : "Read in progress"))}</small></div>${badge(r.status, r.status === "FAILED" ? "red" : "")}</div>`,
        )
        .join("") || empty("No syncs have been attempted."),
    )
  );
}
function render() {
  officeCleanup();
  page = location.hash.slice(1).split("?")[0] || "overview";
  if (!pages.some((p) => p[0] === page)) page = "overview";
  $("#company-label").textContent = state.company.name;
  $(".demo-badge").textContent = state.shopify?.data
    ? "LIVE SHOPIFY SNAPSHOT · READ ONLY"
    : "DEMO · NO LIVE SHOPIFY DATA";
  $("footer span").textContent =
    "Phase 14 · Human-reviewed workflows · Publishing disabled";
  $("#page-title").textContent = pages.find((p) => p[0] === page)[2];
  $("#nav").innerHTML = pages
    .map(
      ([key, icon, label]) =>
        `<a href="#${key}" class="${page === key ? "active" : ""}"><span>${icon}</span>${label}${key === "approvals" ? `<b>${state.approvals.filter((a) => a.state === "PENDING" && a.expires_at > Date.now()).length}</b>` : ""}</a>`,
    )
    .join("");
  $("#stop").textContent = state.company.stopped
    ? "Resume company"
    : "Emergency stop";
  const banner = state.company.stopped
    ? '<div class="banner critical">Company paused. New agent actions are blocked. Records and CEO controls remain available.</div>'
    : "";
  let content;
  if (page === "overview") content = overview();
  else if (page === "shopify") content = shopifyPage();
  else if (page === "analytics") content = analyticsPage();
  else if (page === "market") content = marketPage();
  else if (page === "studio") content = designPage();
  else if (page === "factory") content = factoryPage();
  else if (page === "marketing") content = marketingPage();
  else if (page === "customers") content = customersPage();
  else if (page === "technology") content = technologyPage();
  else if (page === "operations") content = operationsPage();
  else if (page === "compliance") content = compliancePage();
  else if (page === "learning") content = learningPage();
  else if (page === "knowledge") content = knowledgePage();
  else if (page === "memos") content = memosPage();
  else if (page === "resources") content = resourcesPage();
  else if (page === "office") content = officePage();
  else if (page === "automation") content = automationPage();
  else if (page === "organization") content = organizationPage();
  else if (page === "experiments") content = experimentsPage();
  else if (page === "agents") content = directory();
  else if (page === "departments") content = departments();
  else if (page === "projects") content = projects() + coordinationPanel();
  else if (page === "approvals") content = approvals();
  else if (page === "memory" || page === "research")
    content = memory(page === "research");
  else if (page === "notifications")
    content =
      heading(
        "Your attention, prioritized.",
        "System notices and decisions requiring your review.",
      ) +
      panel(
        "Notifications",
        state.notifications
          .slice()
          .reverse()
          .map(
            (n) =>
              `<div class="row"><div><strong>${esc(n.message)}</strong><small>${esc(new Date(n.created_at).toLocaleString())}</small></div>${badge(n.priority)}</div>`,
          )
          .join(""),
      );
  else if (page === "audit")
    content =
      heading(
        "An accountable organization.",
        "Latest 300 audit events. Decisions and state changes remain in the database.",
      ) +
      `<div class="toolbar"><input id="audit-search" aria-label="Filter audit" placeholder="Filter actor, action, resource or result…"></div>` +
      panel(
        "Audit trail",
        `<div class="table-wrap"><table><thead><tr><th>TIME</th><th>ACTOR</th><th>ACTION</th><th>RESOURCE</th><th>RESULT</th></tr></thead><tbody>${state.audit.map((a) => `<tr data-search="${esc((a.actor + " " + a.action + " " + a.resource + " " + a.result).toLowerCase())}"><td>${esc(new Date(a.created_at).toLocaleString())}</td><td>${esc(agentName(a.actor === state.company.id ? "company" : a.actor))}</td><td>${esc(a.action)}</td><td>${esc(a.resource)}</td><td>${badge(a.result, a.result === "FAILED" ? "red" : "")}</td></tr>`).join("")}</tbody></table></div>`,
      );
  else
    content =
      heading(
        "Operating boundaries.",
        "Safe defaults are enforced on the server.",
      ) +
      panel(
        "Foundation configuration",
        `<div class="panel-body"><p class="small">Mode: <strong>${state.shopify.data ? "Local workspace · Live Shopify cache" : "DEMO / no synced Shopify data"}</strong></p><p class="small">Autonomous schedules: <strong>Disabled</strong></p><p class="small">Provider budgets: <strong>$0 · no paid execution</strong></p><p class="small">Shopify scopes: <strong>${esc(state.shopify.connection?.scopes.join(", ") || "None verified")}</strong></p><p class="small">Customer communications: <strong>Draft only</strong></p><p class="small">YELLOW / RED actions: <strong>CEO approval required</strong></p><p class="small">Session: <strong>8 hours, server-side, HttpOnly</strong></p><p class="small muted">Configure Shopify reads on the Shopify store page. AI providers, hosted authentication, advanced budgets and schedules remain disabled. No API credentials are collected by this screen.</p></div>`,
      );
  $("#content").innerHTML = banner + content;
  bindWorkflows();
  bindProducts();
  bindMarketing();
  bindCustomers();
  bindTechnology();
  bindOperations();
  bindCompliance();
  bindLearning();
  bindKnowledge();
  bindResources();
  bindOffice();
  bindMemos();
  bindAutomation();
  bindOrganization();
  bindForm("report-form", "analytics/report");
  bindForm("experiment-form", "experiments");
  bindForm("experiment-update", "experiments/update");
  bindForm("project-form", "projects");
  bindForm("task-form", "tasks");
  bindForm("handoff-form", "organization/delegate");
  bindForm("approval-form", "approvals");
  bindForm("memory-form", "memory", (x) => ({
    ...x,
    research: x.research === "true",
    confidence: Number(x.confidence),
  }));
  bindForm("chat-form", "chat", (x) => ({ ...x, agentId: selectedAgent }));
  bindForm("shopify-form", "shopify/authorize", (x) => ({
    domain: x.domain,
    customerAccess: x.customerAccess === "true",
    authorizeReadAccess: x.authorizeReadAccess === "on",
  }));
  for (const selector of ["#agent-search", "#memory-search", "#audit-search"]) {
    const input = $(selector);
    if (input)
      input.addEventListener("input", () => {
        document
          .querySelectorAll("[data-search]")
          .forEach(
            (el) =>
              (el.hidden = !el.dataset.search.includes(
                input.value.toLowerCase(),
              )),
          );
      });
  }
  const messages = $(".chat-messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}
function bindForm(id, path, transform = (x) => x) {
  const form = $("#" + id);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await api(path, transform(Object.fromEntries(new FormData(form))));
      await refresh();
      if (path !== "chat") notify("Saved.");
    } catch (error) {
      notify(error.message);
      button.disabled = false;
    }
  });
}
function profile(id) {
  const a = state.agents.find((a) => a.id === id),
    d = a.definition;
  $("#profile-content").innerHTML =
    `<div class="eyebrow">${esc(deptName(a.department))}</div><h1>${esc(d.name)}</h1><p class="muted">${esc(d.title)}</p>${badge(a.paused ? "PAUSED" : "REGISTERED")}<dl class="profile-list">${Object.entries(
      {
        Mission: d.mission,
        "Reports to": d.manager === "ceo" ? "CEO" : agentName(d.manager),
        Tools: d.tools.join(", "),
        "Read permissions": d.readPermissions.join(", "),
        "Write permissions": d.writePermissions.join(", "),
        "Prohibited actions": d.prohibitedActions.join(", "),
        Escalation: d.escalationTarget,
        KPIs: d.kpis.join(", "),
        "Memory access": d.memoryAccess.join(", "),
        "Approval requirements": d.approvalRequirements.join("; "),
        Schedule: d.schedules.cadence + " (disabled)",
        "Model / integrations": "Not configured",
        "Budget allocation":
          "See AI Resource Center for the current monthly allocation and spending",
        "Task history":
          state.tasks
            .filter((t) => t.agent_id === id)
            .map((t) => t.objective + " — " + t.status)
            .join("; ") || "No tasks yet",
      },
    )
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
      .join(
        "",
      )}</dl><button data-config-history="${esc(id)}">Configuration history and constitution</button><div id="configuration-history"></div><button class="primary" data-chat-agent="${id}">Message ${esc(d.name)}</button>`;
  $("#profile").showModal();
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b) return;
  try {
    if (b.hasAttribute("data-handoff-history")) {
      b.disabled = true;
      try {
        const handoffs = await api("organization/handoffs", {}),
          target = $("#handoff-history");
        if (target && b.isConnected)
          target.innerHTML = `<p>Latest 200 handoffs. Owner authorization records task creation only.</p>${handoffs.map((h) => `<article class="panel-body"><strong>${esc(h.objective)}</strong><p>${esc(agentName(h.sender))} → ${esc(agentName(h.recipient))} · ${esc(h.status)}</p><p>Task ${esc(h.task_id)} · Parent ${esc(h.parent_task_id)}<br>${esc(h.expected_output)}<br>${esc(h.created_at)} · Configuration v${esc(h.sender_version)} / v${esc(h.recipient_version)}</p></article>`).join("") || "<p>No handoffs recorded.</p>"}`;
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (b.dataset.configHistory) {
      b.disabled = true;
      try {
        const configuration = await api("organization/configuration", {
          agentId: b.dataset.configHistory,
        });
        const target = $("#configuration-history");
        if (target && b.isConnected)
          target.innerHTML = `<h2>Configuration v${esc(configuration.current.version)}</h2><p>Recorded history begins at adoption; earlier changes are not reconstructed. Read-only. Model execution remains disabled.</p><ul>${configuration.history.map((v) => `<li>v${esc(v.version)} · ${esc(v.created_at)} · ${esc(v.provenance)}</li>`).join("")}</ul><h2>Company Constitution v${esc(configuration.constitution.version)}</h2><ol>${configuration.constitution.rules.map((rule) => `<li>${esc(rule)}</li>`).join("")}</ol>`;
      } finally {
        b.disabled = false;
      }
      return;
    }
    if (b.dataset.shopifyAction) {
      b.disabled = true;
      if (b.dataset.shopifyAction !== "refresh") {
        if (b.dataset.shopifyAction === "sync")
          notify(
            "Reading Shopify. Previous snapshot stays available until the entire sync succeeds.",
          );
        await api("shopify/" + b.dataset.shopifyAction, {});
      }
      await refresh();
      notify("Shopify status updated.");
      return;
    }
    if (b.dataset.profile) {
      profile(b.dataset.profile);
      return;
    }
    if (b.dataset.chatAgent) {
      selectedAgent = b.dataset.chatAgent;
      $("#profile").close();
      location.hash = "overview";
      render();
      return;
    }
    if (b.dataset.prompt) {
      $("#chat-form textarea").value = b.dataset.prompt;
      $("#chat-form").requestSubmit();
      return;
    }
    if (b.dataset.control) {
      b.disabled = true;
      await api("control", {
        kind: b.dataset.control,
        target: b.dataset.target,
        paused: b.dataset.paused === "true",
      });
      await refresh();
      notify("Control updated.");
    }
    if (b.dataset.cancel) {
      b.disabled = true;
      await api("tasks/cancel", { id: b.dataset.cancel });
      await refresh();
    }
    if (b.dataset.decision) {
      b.disabled = true;
      await api("approvals/decide", {
        id: b.dataset.id,
        decision: b.dataset.decision,
      });
      await refresh();
      notify("Decision recorded. No external action executed.");
    }
  } catch (error) {
    b.disabled = false;
    notify(error.message);
  }
});
$("#stop").addEventListener("click", async () => {
  try {
    await api("control", {
      kind: "company",
      target: "company",
      paused: !state.company.stopped,
    });
    await refresh();
    notify(
      state.company.stopped
        ? "Company stopped. Records preserved."
        : "Company resumed. Individual pauses remain in effect.",
    );
  } catch (e) {
    notify(e.message);
  }
});
$("#close-profile").addEventListener("click", () => $("#profile").close());
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = e.target.querySelector("button");
  button.disabled = true;
  try {
    const result = await api(
      "login",
      Object.fromEntries(new FormData(e.target)),
    );
    csrf = result.csrf;
    e.target.reset();
    await refresh();
  } catch (error) {
    notify(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("logout", {});
    state = null;
    csrf = "";
    $("#shell").hidden = true;
    $("#login").hidden = false;
  } catch (error) {
    notify(error.message);
  }
});
window.addEventListener("hashchange", () => {
  if (state) render();
  window.scrollTo({ top: 0, behavior: "instant" });
});
(async () => {
  try {
    const result = await api("session");
    csrf = result.csrf;
    await refresh();
  } catch (error) {
    if (error.message !== "Sign in required") notify(error.message);
  }
})();
