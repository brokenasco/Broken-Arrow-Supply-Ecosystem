let officeCleanup = () => {};
const officeUi = { floor: "executive", data: null, selected: null };
function pixelSprite(agent) {
  const seed = [...(agent.id || agent.agent)].reduce(
      (n, c) => n + c.charCodeAt(0),
      0,
    ),
    shirts = ["#4d93bd", "#bf6557", "#8b79b4", "#67947e", "#c1974a"],
    hair = ["#483a38", "#916041", "#d9b770", "#283842"],
    skin = ["#e2ac84", "#bd815e", "#805647"];
  return `<svg class="po-sprite" viewBox="0 0 40 38" aria-hidden="true" shape-rendering="crispEdges"><path fill="#263d48" d="M4 24h32v4H4zM7 28h3v8H7zM30 28h3v8h-3z"/><path fill="#bb9469" d="M3 22h34v4H3z"/><path fill="#384952" d="M24 8h12v11H24zM28 19h4v3h-4z"/><path fill="#92cdc0" d="M26 10h8v6h-8z"/><path fill="${hair[seed % 4]}" d="M9 5h10v3h3v8H7V8h2z"/><path fill="${skin[seed % 3]}" d="M10 9h10v10H10zM8 21h3v4H8zM20 21h3v4h-3z"/><path fill="#293849" d="M12 12h2v2h-2zM17 12h2v2h-2z"/><path fill="${shirts[seed % 5]}" d="M10 19h11v10H10z"/><path fill="#2a3546" d="M10 29h4v6h-4zM17 29h4v6h-4z"/><path fill="#e8d8a4" d="M26 23h8v2h-8z"/></svg>`;
}
function officePage() {
  return `<section class="po" id="pixel-office"><div class="po-top"><div><p class="po-kicker">BROKEN ARROW / OWNER ACCESS</p><h1>PIXEL OFFICE<span>One company. Every floor connected.</span></h1></div><a class="po-button" href="#overview">Classic dashboard ↗</a></div><div class="po-toolbar"><button id="po-meeting">＋ Call meeting</button><button id="po-coo">Talk to Борис</button><a href="#knowledge">▤ The Archive</a><a href="#resources">◴ Resources</a><button id="po-commands">⌘ Commands</button><button id="po-refresh">Refresh</button></div><p id="po-connection" role="status">Connecting to the company state…</p><div class="po-layout"><nav class="po-elevator" aria-label="Elevator" id="po-elevator"></nav><div id="po-building" class="po-building"></div></div><section id="po-attention" class="po-attention" tabindex="-1" aria-label="Owner attention queue"></section><dialog id="po-dialog" class="po-dialog"><button id="po-close" class="po-close" aria-label="Close office panel">×</button><p id="po-panel-error" role="alert"></p><div id="po-panel"></div></dialog></section>`;
}
function bindOffice() {
  officeCleanup();
  const root = document.querySelector("#pixel-office");
  if (!root) return;
  const find = (s) => root.querySelector(s),
    dialog = find("#po-dialog");
  let stopped = false,
    renderKey = "",
    timer,
    retry = 30000;
  const open = (html) => {
    find("#po-panel-error").textContent = "";
    find("#po-panel").innerHTML = html;
    if (!dialog.open) dialog.showModal();
  };
  const label = (s) => s.replaceAll("_", " ");
  function draw() {
    const d = officeUi.data;
    if (!d) return;
    const nextKey = JSON.stringify({
      ...d,
      asOf: null,
      selectedCellblock: officeUi.floor,
    });
    if (renderKey === nextKey) return;
    renderKey = nextKey;
    const focused = document.activeElement;
    const focusAgent = focused?.dataset?.poAgent,
      focusFloor = focused?.dataset?.poFloor;
    find(".po-top h1 span").textContent =
      "Connected cellblocks · Human authority retained";
    find("#po-elevator").setAttribute("aria-label", "Cellblock directory");
    if (!d.floors.some((f) => f.id === officeUi.floor))
      officeUi.floor = d.floors[0]?.id;
    find("#po-elevator").innerHTML =
      `<div class="po-lift-art" aria-hidden="true">▥</div><h2>CELLBLOCKS</h2>` +
      d.floors
        .map(
          (f, i) =>
            `<button data-po-floor="${esc(f.id)}" aria-current="${officeUi.floor === f.id ? "true" : "false"}"><b>${f.id === "executive" ? "W" : f.id === "security" ? "E" : d.floors.length - i}</b> ${esc(prisonRoomName(f))}${f.attentionCount ? ` <span aria-label="${f.attentionCount} items need attention">!</span>` : ""}</button>`,
        )
        .join("");
    find("#po-building").innerHTML = d.floors
      .map((f, i) => {
        const head = d.agents.find((a) => a.id === f.head),
          urgent = d.attention.some(
            (a) => a.department === f.id && a.severity === "URGENT",
          );
        return `<section id="po-floor-${esc(f.id)}" class="po-floor po-theme-${i % 5} ${officeUi.floor === f.id ? "po-selected" : ""}" aria-label="${esc(prisonRoomName(f))} — ${f.attentionCount} attention items"><div class="po-floor-heading"><div><small>${f.id === "executive" ? "WARDEN / COMPANY OVERVIEW" : `CELLBLOCK ${d.floors.length - i}`}</small><h2>${esc(prisonRoomName(f))}</h2></div><span>${f.paused ? "PAUSED" : `${f.agents.length} people`}</span></div><div class="po-room"><div class="po-windows" aria-hidden="true"><i></i><i></i><i></i><span>▥</span></div><div class="po-head"><span>${head ? `${esc(head.name)} · ${esc(head.title)}` : "Shared department workspace"}</span>${f.attentionCount ? `<button class="po-bubble ${urgent ? "po-urgent" : ""}" data-po-attention="${esc(f.id)}" aria-label="${esc(prisonRoomName(f))}: ${f.attentionCount} items need owner attention">${urgent ? "!!" : "!"}<small>${f.attentionCount}</small></button>` : ""}</div><div class="po-workers">${f.agents
          .map((id) => {
            const a = d.agents.find((a) => a.id === id);
            return `<button class="po-worker" data-po-agent="${esc(id)}" aria-label="${esc(a.name)}, ${esc(a.title)}, ${esc(label(a.status))}">${pixelSprite(a)}<strong>${esc(a.name)}</strong><span class="po-status po-${a.status.toLowerCase()}">${esc(label(a.status))}</span><small>${a.taskCount} current tasks</small></button>`;
          })
          .join(
            "",
          )}</div><div class="po-floor-links"><a href="#projects">▣ Task board</a><button data-po-dept-meeting="${esc(f.id)}">▦ Conference room</button>${f.id === "executive" ? `<span>${d.totals.reduce((n, t) => n + (t.status === "COMPLETE" ? t.n : 0), 0)} completed records</span>` : ""}</div></div></section>`;
      })
      .join("");
    find("#po-building").insertAdjacentHTML("afterbegin", prisonScene(d));
    for (const f of d.floors) {
      const section = find("#po-floor-" + CSS.escape(f.id));
      section.hidden = f.id !== officeUi.floor;
      const head = d.agents.find((a) => a.id === f.head);
      if (head)
        section.querySelector(".po-head > span").textContent =
          `${head.name} · ${head.id === d.coo ? "Warden" : head.id === "viktor" ? "Enforcer" : "Shot Caller"}`;
      if (head) {
        const worker = section.querySelector(
          `[data-po-agent="${CSS.escape(head.id)}"]`,
        );
        worker?.setAttribute(
          "aria-label",
          `${head.name}, ${head.id === d.coo ? "Warden" : head.id === "viktor" ? "Enforcer" : "Shot Caller"}, ${label(head.status)}`,
        );
      }
    }
    find("#po-attention").innerHTML =
      `<div class="po-floor-heading"><h2>OWNER ATTENTION</h2><a href="#notifications">All notifications ↗</a></div><p>Actions open the existing review screens. No bubble grants approval. Security coverage is limited to stored alerts.</p>` +
      (d.attention
        .map(
          (a) =>
            `<article class="po-alert"><span class="po-alert-mark">${a.severity === "URGENT" ? "!!" : "!"}</span><div><strong>${esc(a.summary)}</strong><p>${esc(a.department || "Company")} · ${esc(a.timestamp)}</p></div><a href="#${esc(a.route)}">${esc(a.action)} ↗</a></article>`,
        )
        .join("") ||
        '<p class="po-empty">No owner actions in the current snapshot. This does not certify security or integration health.</p>') +
      (d.truncated
        ? "<p>Snapshot is bounded. Open classic task and approval screens for complete history.</p>"
        : "");
    if (!dialog.open) {
      if (focusAgent)
        find(`[data-po-agent="${CSS.escape(focusAgent)}"]`)?.focus();
      else if (focusFloor)
        find(`[data-po-floor="${CSS.escape(focusFloor)}"]`)?.focus();
    }
  }
  async function load() {
    if (stopped || !root.isConnected) return;
    if (document.hidden) {
      timer = setTimeout(load, 30000);
      return;
    }
    try {
      officeUi.data = await api("office/state");
      if (stopped || !root.isConnected) return;
      draw();
      find("#po-connection").textContent =
        `Connected · ${officeUi.data.company.stopped ? "COMPANY PAUSED" : "Control plane available"} · ${new Date(officeUi.data.asOf).toLocaleTimeString()} · State-only visualization: zero AI tokens. No autonomous model runtime.`;
      retry = 30000;
    } catch (error) {
      if (stopped) return;
      find("#po-connection").textContent =
        `Disconnected / stale snapshot — ${error.message}. Classic controls remain available when the backend returns.`;
      retry = Math.min(retry * 2, 120000);
    }
    clearTimeout(timer);
    timer = setTimeout(load, retry);
  }
  function meetingForm(selected = []) {
    const d = officeUi.data;
    if (!d) return;
    open(
      `<h2>CALL A MEETING</h2><p>Human-led context review. Selected agents contribute stored task context; no model answers or paid inference are generated.</p><form id="po-start-form"><fieldset><legend>Participants</legend>${d.floors
        .map(
          (f) =>
            `<details><summary>${esc(prisonRoomName(f))}</summary><div class="po-participants">${f.agents
              .map((id) => {
                const a = d.agents.find((a) => a.id === id);
                return `<label><input type="checkbox" name="participants" value="${esc(id)}" ${selected.includes(id) ? "checked" : ""}>${esc(a.name)} · ${esc(a.title)}</label>`;
              })
              .join("")}</div></details>`,
        )
        .join(
          "",
        )}</fieldset>${wfText("topic", "Topic / owner question", 1500)}<button class="primary">Start context review</button></form><h3>Recent meetings</h3>${d.meetings.map((m) => `<button class="po-meeting-link" data-po-open-meeting="${esc(m.id)}">${esc(m.topic)} · ${esc(m.status)}</button>`).join("") || "<p>No meetings yet.</p>"}`,
    );
  }
  function meetingPanel(m) {
    officeUi.selected = m;
    open(
      `<h2>${esc(m.topic)}</h2><p>${esc(m.context.notice)} · ${esc(m.status)}</p><div class="po-conference"><div class="po-conference-table" aria-hidden="true"></div>${m.context.contributions.map((a) => `<div>${pixelSprite(a)}<span>${esc(a.name)}</span></div>`).join("")}</div><h3>Stored context at ${esc(m.context.asOf)}</h3>${m.context.contributions.map((a) => `<details><summary>${esc(a.name)} — ${esc(label(a.status))}</summary>${a.tasks.map((t) => `<p>${esc(t.title)} · ${esc(t.status)} · ${esc(t.id)}</p>`).join("") || "<p>No current task in this snapshot.</p>"}</details>`).join("")}<p><a href="#knowledge">Search the Archive for supporting evidence ↗</a></p>${m.status === "CLOSED" ? `<h3>Owner summary</h3><p>${esc(m.summary)}</p><h3>Owner decisions</h3><p>${esc(m.decisions)}</p>` : `<form id="po-close-meeting"><input type="hidden" name="id" value="${esc(m.id)}">${wfText("summary", "Owner summary", 3000)}${wfText("decisions", "Owner decisions (or none)", 3000)}<button class="primary">Save outcome and close review</button></form>`}<h3>Create a task from this review</h3><form id="po-create-task"><input type="hidden" name="id" value="${esc(m.id)}">${wfSelect("projectId", "Existing project", state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(""))}${wfSelect("agentId", "Participant responsible", m.context.contributions.map((a) => `<option value="${esc(a.agent)}">${esc(a.name)}</option>`).join(""))}${wfText("objective", "Owner-approved task objective", 2000)}<button class="primary" ${state.projects.length ? "" : "disabled"}>Create linked task</button><p>Task creation does not authorize paid execution, publishing or other external actions. ${state.projects.length ? "" : "Create a project in the classic Task Board first."}</p></form><h3>Linked tasks</h3>${m.tasks.map((t) => `<p>${esc(t.objective)} · ${esc(t.status)}</p>`).join("") || "<p>No tasks created.</p>"}`,
    );
  }
  const commands = () => {
    const d = officeUi.data;
    if (!d) return;
    open(
      `<h2>COMMANDS</h2><label>Find a command<input id="po-command-filter" type="search" placeholder="Cellblock, archive, approvals…"></label><div id="po-command-list">${[{ label: "Talk to Борис", kind: "coo" }, { label: "Call meeting", kind: "meeting" }, ...d.floors.map((f) => ({ label: "Go to " + prisonRoomName(f), floor: f.id })), ...["knowledge", "approvals", "projects", "resources", "notifications", "overview"].map((route) => ({ label: route === "overview" ? "Classic dashboard" : route === "knowledge" ? "Search Archive" : route, route }))].map((c) => `<button class="po-command" ${c.floor ? `data-po-floor="${esc(c.floor)}"` : c.route ? `data-po-route="${c.route}"` : `data-po-command="${c.kind}"`}>${esc(c.label)}</button>`).join("")}</div>`,
    );
    find("#po-command-filter").focus();
  };
  root.addEventListener("input", (event) => {
    if (event.target.id === "po-command-filter")
      for (const b of root.querySelectorAll(".po-command"))
        b.hidden = !b.textContent
          .toLowerCase()
          .includes(event.target.value.toLowerCase());
  });
  root.addEventListener("click", async (event) => {
    const b = event.target.closest(
      "button,[data-po-agent],[data-po-attention]",
    );
    if (!b) return;
    try {
      if (b.id === "po-close") {
        dialog.close();
        return;
      }
      if (b.id === "po-refresh") {
        clearTimeout(timer);
        await load();
        return;
      }
      if (b.id === "po-coo" || b.dataset.poCommand === "coo") {
        selectedAgent = officeUi.data?.coo || "boris";
        dialog.close();
        location.hash = "overview";
        return;
      }
      if (b.id === "po-commands") {
        commands();
        return;
      }
      if (b.dataset.poRoute) {
        dialog.close();
        location.hash = b.dataset.poRoute;
        return;
      }
      if (b.dataset.poFloor) {
        officeUi.floor = b.dataset.poFloor;
        dialog.close();
        draw();
        find("#po-floor-" + CSS.escape(officeUi.floor))?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
        return;
      }
      if (b.dataset.poAttention) {
        const floor = officeUi.data.floors.find(
          (f) => f.id === b.dataset.poAttention,
        );
        open(
          `<h2>${esc(floor.name)} · Owner attention</h2>${officeUi.data.attention
            .filter((a) => a.department === floor.id)
            .map(
              (a) =>
                `<article class="po-alert"><div><strong>${esc(a.summary)}</strong><p>${esc(a.timestamp)}</p><a href="#${esc(a.route)}">${esc(a.action)}</a></div></article>`,
            )
            .join("")}`,
        );
        return;
      }
      if (
        b.id === "po-meeting" ||
        b.dataset.poCommand === "meeting" ||
        b.dataset.poDeptMeeting
      ) {
        meetingForm(
          b.dataset.poDeptMeeting
            ? officeUi.data.floors.find((f) => f.id === b.dataset.poDeptMeeting)
                .agents
            : [officeUi.data.coo].filter(Boolean),
        );
        return;
      }
      if (b.dataset.poOpenMeeting) {
        meetingPanel(
          await api("office/meeting/get", { id: b.dataset.poOpenMeeting }),
        );
        return;
      }
      if (b.dataset.poAgent) {
        const a = officeUi.data.agents.find((a) => a.id === b.dataset.poAgent);
        open(
          `<h2>${esc(a.name)}</h2><p>${esc(a.title)} · ${esc(label(a.status))}</p><p>Model execution is not implied by this visual state.</p>${pixelSprite(a)}${a.tasks.map((t) => `<p>${esc(t.title)} · ${esc(t.status)}</p>`).join("") || "<p>No current task.</p>"}<button data-chat-agent="${esc(a.id)}">Talk to ${esc(a.name)}</button><p><a href="#resources">Resource details</a> · <a href="#projects">Task board</a></p>`,
        );
      }
      if (b.dataset.poAgent) {
        const a = officeUi.data.agents.find((a) => a.id === b.dataset.poAgent);
        const visualRole =
          a.id === officeUi.data.coo
            ? "Warden"
            : a.id === "viktor"
              ? "Enforcer"
              : officeUi.data.floors.some((f) => f.head === a.id)
                ? "Shot Caller"
                : a.title;
        find("#po-panel h2").insertAdjacentHTML(
          "afterend",
          `<p>${esc(visualRole)} · Display title only</p>`,
        );
        find("#po-panel").insertAdjacentHTML(
          "beforeend",
          `<section class="pr-hole"><h3>${a.quarantine ? "OWNER RELEASE" : "QUARANTINE CONTROL"}</h3><p>${a.quarantine ? `Hold ${esc(a.quarantine.id)} · ${esc(a.quarantine.created_at)}<br>${esc(a.quarantine.reason)}<br>Release removes only this hold. Other pauses and approvals remain in force.` : "Viktor’s Hole control. Stops new agent execution; dispatched requests cannot be undone. Tasks, messages, configuration and budgets are preserved."}</p><form id="po-quarantine-form"><input type="hidden" name="agent" value="${esc(a.id)}"><input type="hidden" name="requestId" value="${crypto.randomUUID()}"><input type="hidden" name="holdId" value="${esc(a.quarantine?.id || "")}">${wfText("reason", a.quarantine ? "Owner release reason" : "Owner quarantine reason", 1000)}<label><input type="checkbox" name="confirm" required> I confirm ${a.quarantine ? "release of this exact hold" : "quarantine of this agent"}.</label><button>${a.quarantine ? "Release exact hold" : "Place in the Hole"}</button></form></section>`,
        );
        find("#po-quarantine-form").dataset.previousHoldId =
          a.previousHoldId ?? "";
        const leader = officeUi.data.agents.find(
          (person) => person.id === a.manager,
        );
        find("#po-quarantine-form").insertAdjacentHTML(
          "beforebegin",
          `<p>Department: ${esc(a.department)} · Supervisor: ${esc(leader?.name ?? "Human owner")}</p><p>${a.quarantine ? `Initiating owner: ${esc(a.quarantine.created_by)}` : "Owner confirmation required."}</p><p>Restrictions retained: ${esc(a.restrictions?.join(", ") || "No ordinary pause recorded")}. Security and approval gates are evaluated separately.</p><p><a href="#audit">Audit history</a> · <a href="#notifications">Security alerts and incidents</a></p><h4>Outstanding operations</h4>${(a.operations ?? []).map((op) => `<article><p>${esc(op.kind)} · ${esc(op.state)} · ${esc(op.outcome)}<br>Operation: ${esc(op.id)}<br>Resource: ${esc(op.resource_id)}<br>Started: ${esc(op.started_at)} · Effect: ${esc(op.effect)}</p>${op.state === "RUNNING" && op.deadline_at < Date.now() ? `<form class="po-recover-operation"><input type="hidden" name="operationId" value="${esc(op.id)}"><label><input type="checkbox" name="confirm" required> Recover this expired operation without replay. External outcomes may remain unknown.</label><button>Recover expired operation</button></form>` : op.state === "UNKNOWN" ? `<a href="#${op.kind === "PRODUCT" ? "factory" : "studio"}">Open existing reconciliation controls</a>` : "<p>Waiting for the executing adapter to stop or return.</p>"}</article>`).join("") || "<p>No tracked outstanding operation.</p>"}${officeUi.data.legacyExecutionPending ? "<p role='alert'>Historical operation ownership is unavailable. A company migration safety block remains until existing work is reconciled.</p>" : ""}`,
        );
        if (officeUi.data.legacyMonitor)
          find("#po-quarantine-form").insertAdjacentHTML(
            "beforebegin",
            `<form class="po-recover-legacy"><input type="hidden" name="token" value="${esc(officeUi.data.legacyMonitor.token)}"><label><input type="checkbox" name="confirm" required> Fence the expired legacy monitor. This does not reverse a network read.</label><button>Recover legacy monitor</button></form>`,
          );
      }
    } catch (error) {
      if (dialog.open) find("#po-panel-error").textContent = error.message;
      else notify(error.message, true);
    }
  });
  root.addEventListener("submit", async (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (form.matches(".po-recover-operation,.po-recover-legacy")) {
        data.confirm = data.confirm === "on";
        await api(
          form.matches(".po-recover-legacy")
            ? "office/execution/recover-legacy-monitor"
            : "office/execution/recover",
          data,
        );
        dialog.close();
        notify(
          "Recovery recorded without replay. Refresh agent details to review remaining restrictions.",
        );
      } else if (form.id === "po-quarantine-form") {
        data.confirm = data.confirm === "on";
        data.previousHoldId = form.dataset.previousHoldId ?? "";
        await api(data.holdId ? "office/release" : "office/quarantine", data);
        notify(
          data.holdId
            ? "Exact hold released. Other restrictions remain in force."
            : "Quarantine recorded. Check outstanding operations for stopping or reconciliation status.",
        );
        dialog.close();
      } else if (form.getAttribute("id") === "po-start-form") {
        data.participants = new FormData(form).getAll("participants");
        meetingPanel(await api("office/meeting/start", data));
      } else if (form.getAttribute("id") === "po-close-meeting")
        meetingPanel(await api("office/meeting/close", data));
      else if (form.getAttribute("id") === "po-create-task") {
        await api("office/meeting/task", data);
        meetingPanel(await api("office/meeting/get", { id: data.id }));
        notify("Linked task created; external execution remains gated.");
      }
      clearTimeout(timer);
      await load();
    } catch (error) {
      if (dialog.open) find("#po-panel-error").textContent = error.message;
      else notify(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  const keyboard = (event) => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches("g[data-po-agent],g[data-po-attention]")
    ) {
      event.preventDefault();
      event.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      commands();
    }
  };
  const visibility = () => {
    root.classList.toggle("pr-inactive", document.hidden);
    if (!document.hidden) {
      clearTimeout(timer);
      load();
    }
  };
  document.addEventListener("keydown", keyboard);
  const observer = new IntersectionObserver((entries) => {
    root.classList.toggle("pr-offscreen", !entries[0].isIntersecting);
  });
  observer.observe(find("#po-building"));
  document.addEventListener("visibilitychange", visibility);
  officeCleanup = () => {
    observer.disconnect();
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("keydown", keyboard);
    document.removeEventListener("visibilitychange", visibility);
    if (dialog.open) dialog.close();
  };
  load();
}
