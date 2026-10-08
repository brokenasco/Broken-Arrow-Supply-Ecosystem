// Original vector pixel art. Geometry and cosmetic motion never invoke AI.
function prisonRoomName(f) {
  return f.id === "executive"
    ? "Warden office"
    : f.id === "security"
      ? "Enforcer office"
      : f.name + " cellblock";
}
function prisonStateBadge(a) {
  if (a.quarantine)
    return a.status === "QUARANTINE_PENDING" ? "STOPPING" : "HELD";
  if (a.restrictions?.length) return "PAUSED";
  return (
    {
      IDLE: "IDLE",
      WORKING: "WORK",
      THINKING: "…",
      WAITING: "WAIT",
      WAITING_FOR_AGENT: "WAIT",
      WAITING_FOR_OWNER: "OWNER",
      NEEDS_APPROVAL: "!",
      BLOCKED: "BLOCK",
      COMPLETE: "✓",
      ERROR: "ERROR",
      OFFLINE: "OFF",
      IN_MEETING: "MEET",
    }[a.status] ?? "UNKNOWN"
  );
}
function prisonScene(data) {
  const floors = [...data.floors].sort((a, b) => a.id.localeCompare(b.id));
  const rooms = [
    {
      id: "warden",
      name: "WARDEN",
      agents: data.agents.filter((a) => a.id === data.coo),
    },
    {
      id: "enforcer",
      name: "ENFORCER",
      agents: data.agents.filter((a) => a.id === "viktor"),
    },
    {
      id: "hole",
      name: "HOLE",
      agents: data.agents.filter((a) => a.quarantine),
    },
    ...floors
      .filter((f) =>
        data.agents.some(
          (a) =>
            a.department === f.id && a.id !== data.coo && a.id !== "viktor",
        ),
      )
      .map((f) => ({
        id: f.id,
        name: f.id.toUpperCase(),
        head: f.head,
        agents: data.agents.filter(
          (a) =>
            a.department === f.id && a.id !== data.coo && a.id !== "viktor",
        ),
        attention: f.attentionCount,
      })),
  ];
  const rows = Math.ceil(rooms.length / 3),
    W = 240,
    H = 200,
    origin = rows * H * 0.8 + 35;
  const point = (x, y, z = 0) => [
    origin + (x - y) * 0.8,
    85 + (x + y) * 0.4 - z,
  ];
  const p = (x, y, z = 0) => point(x, y, z).join(",");
  const poly = (pts, fill, cls = "") =>
    `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="#20272b" stroke-width="2" class="${cls}"/>`;
  const wall = (x, y, dx, dy) =>
    poly(
      [p(x, y), p(x + dx, y + dy), p(x + dx, y + dy, 62), p(x, y, 62)],
      "url(#prison-brick)",
    );
  const art = rooms
    .map((r, i) => {
      const x = (i % 3) * W,
        y = Math.floor(i / 3) * H;
      let s = poly(
        [p(x, y), p(x + W, y), p(x + W, y + H), p(x, y + H)],
        i < 3 ? "#555348" : "#444c4e",
      );
      // Each cell shares exact boundaries with its neighbors; no gaps or bridges.
      for (let t = 40; t < W; t += 40)
        s += `<path d="M${p(x + t, y)} L${p(x + t, y + H)}" stroke="#626867" stroke-width="1"/>`;
      for (let t = 40; t < H; t += 40)
        s += `<path d="M${p(x, y + t)} L${p(x + W, y + t)}" stroke="#626867" stroke-width="1"/>`;
      s += wall(x, y, W, 0) + wall(x, y, 0, H);
      s += `<path d="M${p(x + 5, y + 4, 55)} L${p(x + W - 5, y + 4, 55)}" stroke="#969582" stroke-width="3"/><path d="M${p(x + 5, y + 4, 51)} L${p(x + W - 5, y + 4, 51)}" stroke="#373f3d" stroke-width="2"/>`;
      const sign = point(x + W / 2, y, 35);
      s += `<g transform="translate(${sign[0]} ${sign[1]})"><rect x="-76" y="-13" width="152" height="23" fill="#202a30" stroke="#be9c5c"/><text text-anchor="middle" y="3" fill="#edcf90" font-size="12" font-weight="bold">${esc(r.name)}</text></g>`;
      const lamp = point(x + 20, y + 10, 52);
      s += `<rect class="pr-lamp" x="${lamp[0]}" y="${lamp[1]}" width="13" height="6" fill="#ffd187"/>`;
      // Fixed wall cabinet and reinforced door.
      s += poly(
        [
          p(x + 5, y + 100, 5),
          p(x + 5, y + 147, 5),
          p(x + 5, y + 147, 49),
          p(x + 5, y + 100, 49),
        ],
        "#273239",
      );
      for (let bar = 0; bar < 5; bar++)
        s += `<path d="M${p(x + 5, y + 104 + bar * 9, 7)} L${p(x + 5, y + 104 + bar * 9, 47)}" stroke="#9a9c8c" stroke-width="3"/>`;
      const members = r.agents;
      members.forEach((a, j) => {
        if ((r.id !== "hole" && a.quarantine) || j >= 6) return;
        const ax = x + 65 + (j % 3) * 63,
          ay = y + 70 + Math.floor(j / 3) * 55,
          at = point(ax, ay);
        const role =
          a.id === data.coo
            ? "Warden"
            : a.id === "viktor"
              ? "Enforcer"
              : data.floors.some((f) => f.head === a.id)
                ? "Shot Caller"
                : a.title;
        if (r.id !== "hole")
          s += poly(
            [
              p(ax - 18, ay - 18, 16),
              p(ax + 26, ay - 18, 16),
              p(ax + 26, ay + 5, 16),
              p(ax - 18, ay + 5, 16),
            ],
            "#927851",
          );
        if (r.id !== "hole") {
          s += poly(
            [
              p(ax + 9, ay - 17, 17),
              p(ax + 28, ay - 17, 17),
              p(ax + 28, ay - 17, 35),
              p(ax + 9, ay - 17, 35),
            ],
            "#26343a",
          );
          s += poly(
            [
              p(ax + 11, ay - 17, 21),
              p(ax + 25, ay - 17, 21),
              p(ax + 25, ay - 17, 32),
              p(ax + 11, ay - 17, 32),
            ],
            a.status === "OFFLINE" ? "#3b4749" : "#73948a",
          );
        }
        const color = ["#b69a65", "#758e9a", "#889276", "#a57861"][
          [...a.id].reduce((n, c) => n + c.charCodeAt(0), 0) % 4
        ];
        const badge = prisonStateBadge(a);
        s += `<g aria-hidden="true" transform="translate(${at[0]} ${at[1] - 48})"><rect x="-22" y="-10" width="44" height="14" fill="${a.quarantine ? "#6e482e" : "#26323b"}" stroke="#bfa36b"/><text y="0" text-anchor="middle" fill="#ffe1a2" font-size="9">${esc(badge)}</text></g>`;
        s += `<g class="pr-person ${!a.quarantine && a.status === "WORKING" ? "pr-working" : ""}" data-po-agent="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.name + ", " + role + ", " + a.status)}" transform="translate(${at[0]} ${at[1]})"><title>${esc(a.name)} · ${esc(role)} · ${esc(a.status)}</title><ellipse cy="5" rx="12" ry="4" fill="#202629"/><path fill="#202830" d="M-8 -1h6v8h-6zM3 -1h6v8H3z"/><path fill="${color}" d="M-10 -20h20v21h-20z"/><path fill="#bf9773" d="M-7 -34h14v15H-7z"/><path fill="#393531" d="M-9 -37h17v7H-9zM-9 -31h4v8h-4z"/><path fill="#242c31" d="M-2 -28h2v3h-2zM5 -28h2v3H5z"/><path class="pr-arm" fill="${color}" d="M-14 -19h5v15h-5zM9 -19h5v15H9z"/><text text-anchor="middle" y="22" fill="#f7ead2" font-size="10">${esc(a.name.split(" ")[0])}</text></g>`;
      });
      if (members.length > 6) {
        const at = point(x + W / 2, y + H - 15);
        s += `<text x="${at[0]}" y="${at[1]}" text-anchor="middle" fill="#efd39e" font-size="13">+${members.length - 6} · see roster</text>`;
      }
      if (r.attention) {
        const at = point(x + W - 25, y + 25, 40);
        s += `<g data-po-attention="${esc(r.id)}" role="button" tabindex="0" aria-label="${esc(r.name)}: ${r.attention} owner attention items"><rect x="${at[0] - 14}" y="${at[1] - 20}" width="28" height="26" fill="#e8bd72"/><text x="${at[0]}" y="${at[1]}" text-anchor="middle" fill="#202830" font-size="20">!</text></g>`;
      }
      if (r.id === "hole" && !members.length) {
        const at = point(x + W / 2, y + H / 2);
        s += `<text x="${at[0]}" y="${at[1]}" text-anchor="middle" fill="#d7c9ae" font-size="13">EMPTY · 0 HELD</text>`;
      }
      // Low cutaway front bars keep occupants visible.
      s += `<path d="M${p(x, y + H, 15)} L${p(x + W, y + H, 15)}" stroke="#b0a98d" stroke-width="3"/>`;
      for (let t = 0; t <= W; t += 20)
        s += `<path d="M${p(x + t, y + H)} L${p(x + t, y + H, 22)}" stroke="#9e9f8c" stroke-width="3"/>`;
      return `<g>${s}</g>`;
    })
    .join("");
  return `<div class="pr-scene-wrap"><svg class="pr-scene" viewBox="0 0 ${origin + 3 * W * 0.8 + 40} ${100 + (3 * W + rows * H) * 0.4}" role="group" aria-label="Connected isometric cellblocks. Warden and Enforcer offices are adjacent; Hole is beside them."><defs><pattern id="prison-brick" width="28" height="14" patternUnits="userSpaceOnUse"><rect width="28" height="14" fill="#62675e"/><path d="M0 0h28M0 14h28M14 0v14" stroke="#454d49" stroke-width="2"/></pattern></defs>${art}</svg></div><section class="pr-hole"><h2>THE HOLE · ${data.agents.filter((a) => a.quarantine).length} HELD</h2><p>Viktor · Enforcer. Owner-authorized holds; no autonomous detection. Incoming work is preserved.</p>${
    data.agents
      .filter((a) => a.quarantine)
      .map(
        (a) =>
          `<button data-po-agent="${esc(a.id)}">${esc(a.name)} · ${a.status === "QUARANTINE_PENDING" ? "Quarantine pending — stopping / reconciliation required" : "Quarantined"}</button>`,
      )
      .join("") || "<p>Empty. No agents held.</p>"
  }</section>`;
}
