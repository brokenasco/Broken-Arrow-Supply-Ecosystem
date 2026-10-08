function factoryPage() {
  const f = state.factory;
  const buttons = (r) =>
    ["PROPOSED", "BLOCKED"].includes(r.status) || r.approvalExpired
      ? `<button data-product-action="approve" data-id="${esc(r.id)}" data-hash="${esc(r.payload_hash)}">Approve exact package for 10 minutes</button>`
      : r.status === "APPROVED"
        ? `<button data-product-action="dispatch" data-id="${esc(r.id)}">${r.payload.mode === "SIMULATION" ? "Run simulation" : "Create Shopify DRAFT"}</button>`
        : r.status === "RECONCILIATION"
          ? `<button data-product-action="reconcile" data-id="${esc(r.id)}">Check Shopify outcome</button>`
          : ["CHECKING", "DISPATCHING"].includes(r.status)
            ? `<button data-product-action="recover" data-id="${esc(r.id)}">Recover interrupted work after 3 minutes</button>`
            : "";
  return (
    heading(
      "Product Factory",
      "Tyler · Human-authored product packages and approved draft creation. Publishing is unavailable.",
    ) +
    `<div class="banner">Private placement proofs only. Shopify drafts exclude images; production mockups and print fulfillment require a provider integration.</div>` +
    wfDetails(
      "1 · Create a reusable template",
      `<form id="product-template" class="inline-form">${wfInput("title", "Template title")}${wfInput("category", "Exact design brief category")}${wfSelect("kind", "Placement proof shape", "<option>POSTER</option><option>SHIRT</option><option>MUG</option>")}${wfInput("currency", "Currency", "text", "USD")}${wfInput("optionName", "Variant option", "text", "Size")}${wfText("variantsText", "Variants: one per line, value | SKU suffix | cost in minor units (optional)")}${wfInput("costEvidence", "Cost evidence and exclusions", "text", "", false)}${wfInput("costExpiresAt", "Cost review due (UTC)", "datetime-local", "", false)}${wfText("printSpecification", "Print dimensions, materials and limitations")}<button class="primary">Save immutable template</button></form>`,
      !f.templates.length,
    ) +
    wfDetails(
      "2 · Build a product package",
      `<form id="product-proposal" class="inline-form">${wfSelect("templateId", "Template", wfOptions(f.templates))}${wfSelect("assetId", "Design asset", state.studio.assets.map((a) => `<option value="${esc(a.id)}">${esc(a.id)} · ${a.simulation ? "SIMULATION" : esc(a.status)}</option>`).join(""))}${wfSelect("mode", "Destination", "<option>SIMULATION</option><option>SHOPIFY</option>")}${wfInput("title", "Product title")}${wfInput("vendor", "Vendor")}${wfText("description", "Product description", 4000)}${wfInput("seoTitle", "SEO title (70 characters)")}${wfInput("seoDescription", "SEO description (160 characters)")}${wfInput("tags", "Tags, comma separated", "text", "", false)}${wfInput("collections", "Manual collection GIDs, comma separated", "text", "", false)}${wfInput("targetMarginPercent", "Target contribution % for calculated prices", "number", "", false)}<div id="variant-prices" class="wide"></div><button class="primary">Create reviewable package</button></form>`,
    ) +
    panel(
      "Product pipeline",
      f.proposals
        .map(
          (r) =>
            `<article class="panel-body"><h3>${esc(r.title)} · ${badge(r.status)}</h3><p>${esc(r.payload.mode)} · ${esc(r.payload.currency)} · ${esc(r.payload.domain || "Local only")}</p><img src="/api/products/mockup/${encodeURIComponent(r.id)}" alt="Private placement proof for ${esc(r.title)}" width="280"><p>${esc(r.payload.media)}</p><details><summary>Review exact package and pricing</summary><pre>${esc(JSON.stringify(r.payload, null, 2))}</pre><p>SHA-256 ${esc(r.payload_hash)}</p></details>${buttons(r)}${["PROPOSED", "APPROVED", "BLOCKED"].includes(r.status) ? `<button data-product-action="cancel" data-id="${esc(r.id)}">Cancel</button>` : ""}<p>${esc(r.error_code || "")} ${esc(r.remote_id || "")}</p></article>`,
        )
        .join("") || empty("No product packages yet."),
    ) +
    wfDetails(
      "Shopify draft-write authorization",
      `<p class="panel-body">${f.connection?.enabled ? esc(f.connection.domain) + " · Enabled" : "Disabled"} · Separate server credentials with write_products are required.</p><form id="product-authorize" class="inline-form">${wfInput("domain", "Exact myshopify.com domain")}<label><input type="checkbox" name="confirm" required>Authorize draft creation for this shop</label><button>Verify and authorize</button></form><button data-product-action="disconnect">Disable draft writes</button>`,
    ) +
    panel(
      "Workflow history",
      f.events
        .map(
          (e) =>
            `<p class="panel-body">${esc(e.created_at)} · ${esc(e.action)} · ${esc(e.detail)}</p>`,
        )
        .join("") || empty("No events."),
    )
  );
}
function bindProducts() {
  bindForm("product-template", "products/template", (x) => ({
    ...x,
    variants: x.variantsText
      .split("\n")
      .filter((v) => v.trim())
      .map((v) => {
        const [value, suffix, cost] = v.split("|").map((s) => s.trim());
        return { value, suffix, costMinor: cost ? Number(cost) : null };
      }),
    costExpiresAt: x.costExpiresAt ? x.costExpiresAt + ":00.000Z" : null,
  }));
  const form = $("#product-proposal");
  if (form) {
    form.dataset.requestKey = crypto.randomUUID();
    const prices = () => {
      const t = state.factory.templates.find(
        (t) => t.id === form.elements.templateId.value,
      );
      $("#variant-prices").innerHTML = t
        ? t.body.variants
            .map((v, i) =>
              wfInput(
                "price" + i,
                `${v.value} price (${t.body.currency}); blank = calculate`,
                "text",
                "",
                false,
              ),
            )
            .join("")
        : "";
    };
    form.elements.templateId.addEventListener("change", prices);
    prices();
  }
  bindForm("product-proposal", "products/proposal", (x) => ({
    ...x,
    requestKey: form.dataset.requestKey,
    tags: x.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    collections: x.collections
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    targetMarginPercent:
      x.targetMarginPercent === "" ? null : Number(x.targetMarginPercent),
    variantPrices: state.factory.templates
      .find((t) => t.id === x.templateId)
      .body.variants.map((v, i) => ({ value: v.value, price: x["price" + i] })),
  }));
  bindForm("product-authorize", "products/authorize", (x) => ({
    ...x,
    confirm: x.confirm === "on",
  }));
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-product-action]");
  if (!b) return;
  b.disabled = true;
  try {
    await api("products/" + b.dataset.productAction, {
      id: b.dataset.id,
      payloadHash: b.dataset.hash,
      confirm: true,
    });
    await refresh();
    notify("Product workflow updated.");
  } catch (error) {
    notify(error.message);
    b.disabled = false;
  }
});
