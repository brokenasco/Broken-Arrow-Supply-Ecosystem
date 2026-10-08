import type { DatabaseSync } from "node:sqlite";
import type { Principal } from "./service.ts";
import { audit, id, now, transaction } from "./db.ts";
import { DomainError, payloadHash } from "./policy.ts";
import { HumanWorkflow, field, choice, integer, iso } from "./workflow.ts";
import { DesignService } from "./design.ts";
import { minorUnits } from "./shopify/read.ts";
import { domain } from "./shopify/client.ts";
import {
  writeConfig,
  ShopifyDraftWriter,
  validateIdentity,
  matchesDraft,
  type WriteConfig,
  type DraftWriter,
  type DraftInput,
  type RemoteDraft,
} from "./shopify/write.ts";
export type ProductTemplate = {
  category: string;
  kind: "POSTER" | "SHIRT" | "MUG";
  currency: string;
  optionName: string;
  variants: { value: string; suffix: string; costMinor: number | null }[];
  costEvidence: string;
  costExpiresAt: string | null;
  placement: { x: number; y: number; width: number; height: number };
  printSpecification: string;
};
export type ProductPayload = {
  template: ProductTemplate;
  templateId: string;
  assetId: string;
  assetHash: string;
  briefId: string;
  mode: "SIMULATION" | "SHOPIFY";
  domain: string | null;
  connectionGeneration: number | null;
  currency: string;
  input: DraftInput;
  pricing: {
    variant: string;
    priceMinor: number;
    costMinor: number | null;
    contributionPercent: number | null;
    method: string;
  }[];
  media: string;
  printProvider: string;
};
export type ProductDependencies = {
  config?: () => WriteConfig | null;
  writer?: (config: WriteConfig) => DraftWriter;
};
export const printAreas = {
  POSTER: { x: 150, y: 100, width: 700, height: 800 },
  SHIRT: { x: 320, y: 310, width: 360, height: 400 },
  MUG: { x: 220, y: 330, width: 460, height: 340 },
} as const;
export const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function decimal(minor: number, currency: string) {
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  return (
    (BigInt(minor) / 10n ** BigInt(digits)).toString() +
    (digits
      ? "." +
        (BigInt(minor) % 10n ** BigInt(digits)).toString().padStart(digits, "0")
      : "")
  );
}
function amount(value: unknown, currency: string) {
  let n: number;
  try {
    n = minorUnits(field(value, "Price", 30), currency);
  } catch {
    throw new DomainError("Invalid price precision or amount for currency");
  }
  if (n <= 0 || n > 1000000000)
    throw new DomainError(
      "Price must be positive and at most one billion minor units",
    );
  return n;
}
function strings(value: unknown, name: string, max: number) {
  if (!Array.isArray(value) || value.length > max)
    throw new DomainError(`${name}: up to ${max} values required`);
  const list = value.map((v) => field(v, name, 100));
  if (new Set(list).size !== list.length)
    throw new DomainError(`Duplicate ${name}`);
  return list;
}
export function productState(db: DatabaseSync, company: string) {
  const c = db
    .prepare("SELECT * FROM product_write_connections WHERE company_id=?")
    .get(company);
  return {
    connection: c ?? null,
    printProvider: "INTEGRATION REQUIRED",
    templates: db
      .prepare(
        "SELECT * FROM product_templates WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({
        ...r,
        id: String(r.id),
        title: String(r.title),
        body: JSON.parse(String(r.body)) as ProductTemplate,
      })),
    proposals: db
      .prepare(
        "SELECT * FROM product_proposals WHERE company_id=? ORDER BY created_at DESC",
      )
      .all(company)
      .map((r) => ({
        ...r,
        id: String(r.id),
        status: String(r.status),
        payload_hash: String(r.payload_hash),
        payload: JSON.parse(String(r.payload)) as ProductPayload,
        approvalExpired:
          r.status === "APPROVED" && Number(r.expires_at) <= Date.now(),
      })),
    events: db
      .prepare(
        "SELECT * FROM product_events WHERE company_id=? ORDER BY created_at",
      )
      .all(company),
  };
}
export class ProductService extends HumanWorkflow {
  deps: ProductDependencies;
  constructor(db: DatabaseSync, p: Principal, deps: ProductDependencies = {}) {
    super(db, p);
    this.deps = deps;
  }
  config() {
    const c = (this.deps.config ?? writeConfig)();
    if (!c || c.companyId !== this.p.company_id)
      throw new DomainError(
        "INTEGRATION REQUIRED: separately configured Shopify draft-write credentials",
        409,
      );
    return { ...c, domain: domain(c.domain) };
  }
  writer() {
    const c = this.config();
    return {
      config: c,
      client: (this.deps.writer ?? ((c) => new ShopifyDraftWriter(c)))(c),
    };
  }
  connection() {
    return this.db
      .prepare("SELECT * FROM product_write_connections WHERE company_id=?")
      .get(this.p.company_id);
  }
  async authorize(input: Record<string, unknown>) {
    this.guard(["tyler", "alex"]);
    if (input.confirm !== true)
      throw new DomainError(
        "Explicit authorization of write_products for DRAFT creation required",
      );
    const { client, config } = this.writer();
    if (field(input.domain, "Shopify domain", 253) !== config.domain)
      throw new DomainError("Domain must match server configuration");
    const before = this.connection()?.generation ?? 0;
    let identity;
    try {
      identity = await client.identity(AbortSignal.timeout(20000));
      validateIdentity(identity, config.domain);
    } catch {
      throw new DomainError(
        "Could not verify draft-write shop and least-privilege scopes",
        502,
      );
    }
    return this.mutate(
      "products.write_authorized",
      config.domain,
      ["tyler", "alex"],
      () => {
        if ((this.connection()?.generation ?? 0) !== before)
          throw new DomainError("Connection changed during verification", 409);
        this.db
          .prepare(
            "INSERT INTO product_write_connections VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(company_id) DO UPDATE SET domain=excluded.domain,currency=excluded.currency,scopes=excluded.scopes,enabled=1,generation=excluded.generation,verified_at=excluded.verified_at,authorized_by=excluded.authorized_by",
          )
          .run(
            this.p.company_id,
            config.domain,
            identity.currency,
            JSON.stringify(identity.scopes),
            Number(before) + 1,
            now(),
            this.p.id,
          );
        return { ok: true };
      },
    );
  }
  disconnect() {
    return transaction(this.db, () => {
      this.authenticate();
      this.db
        .prepare(
          "UPDATE product_write_connections SET enabled=0,generation=generation+1 WHERE company_id=?",
        )
        .run(this.p.company_id);
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "products.write_disabled",
        "products",
      );
      return { ok: true };
    });
  }
  template(input: Record<string, unknown>) {
    return this.mutate(
      "products.template_created",
      "products",
      ["tyler"],
      () => {
        const kind = choice(
            input.kind,
            ["POSTER", "SHIRT", "MUG"],
            "mockup kind",
          ),
          currency = field(input.currency, "Currency", 3).toUpperCase();
        if (!Intl.supportedValuesOf("currency").includes(currency))
          throw new DomainError("Supported ISO currency required");
        const optionName = field(input.optionName, "Variant option", 40);
        if (
          !Array.isArray(input.variants) ||
          !input.variants.length ||
          input.variants.length > 20
        )
          throw new DomainError("1–20 template variants required");
        const variants = input.variants.map((v) => {
          if (!v || typeof v !== "object")
            throw new DomainError("Invalid variant");
          const r = v as Record<string, unknown>,
            suffix = field(r.suffix, "SKU suffix", 24);
          if (!/^[A-Z0-9-]+$/.test(suffix))
            throw new DomainError(
              "SKU suffix requires uppercase letters, numbers or hyphens",
            );
          return {
            value: field(r.value, "Variant value", 50),
            suffix,
            costMinor:
              r.costMinor === null || r.costMinor === undefined
                ? null
                : integer(r.costMinor, "Cost minor units", 0, 1000000000),
          };
        });
        if (
          new Set(variants.map((v) => v.value.toLowerCase())).size !==
            variants.length ||
          new Set(variants.map((v) => v.suffix)).size !== variants.length
        )
          throw new DomainError(
            "Variant values and SKU suffixes must be unique",
          );
        const hasCost = variants.some((v) => v.costMinor !== null),
          costEvidence = hasCost
            ? field(input.costEvidence, "Cost evidence and exclusions", 2000)
            : "Unknown",
          costExpiresAt = hasCost
            ? iso(input.costExpiresAt, "Cost review due")
            : null;
        if (costExpiresAt && Date.parse(costExpiresAt) <= Date.now())
          throw new DomainError("Cost evidence must have a future review date");
        const area = printAreas[kind];
        const p = input.placement as Record<string, unknown> | undefined;
        const placement = p
          ? {
              x: integer(p.x, "Placement x", 0, 1000),
              y: integer(p.y, "Placement y", 0, 1000),
              width: integer(p.width, "Placement width", 1, 1000),
              height: integer(p.height, "Placement height", 1, 1000),
            }
          : { ...area };
        if (
          placement.x < area.x ||
          placement.y < area.y ||
          placement.x + placement.width > area.x + area.width ||
          placement.y + placement.height > area.y + area.height
        )
          throw new DomainError(
            "Placement must remain inside the template print area",
          );
        const body: ProductTemplate = {
          kind,
          currency,
          optionName,
          variants,
          costEvidence,
          costExpiresAt,
          placement,
          category: field(input.category, "Product category", 80),
          printSpecification: field(
            input.printSpecification,
            "Print specification and limitations",
            2000,
          ),
        };
        const template = id();
        this.db
          .prepare("INSERT INTO product_templates VALUES(?,?,?,?,?)")
          .run(
            template,
            this.p.company_id,
            field(input.title, "Template title", 160),
            JSON.stringify(body),
            now(),
          );
        return { id: template };
      },
    );
  }
  asset(assetId: string, simulation: boolean) {
    const a = this.db
      .prepare("SELECT * FROM design_assets WHERE company_id=? AND id=?")
      .get(this.p.company_id, assetId);
    if (!a) throw new DomainError("Asset not found", 404);
    if (simulation) {
      if (!a.simulation || a.status === "REJECT")
        throw new DomainError(
          "Simulation requires a non-rejected simulation asset",
          409,
        );
    } else if (
      a.simulation ||
      a.status !== "PASS" ||
      !this.db
        .prepare(
          "SELECT id FROM design_reviews WHERE company_id=? AND asset_id=? AND verdict='PASS' AND content_hash=?",
        )
        .get(this.p.company_id, assetId, String(a.content_hash))
    )
      throw new DomainError(
        "Shopify drafts require a real asset with matching human QA PASS",
        409,
      );
    new DesignService(this.db, this.p).evidence(String(a.brief_id));
    return a;
  }
  proposal(input: Record<string, unknown>) {
    const key = field(input.requestKey, "Request key", 80);
    return this.mutate(
      "products.proposal_created",
      key,
      ["tyler", "alex"],
      () => {
        const inputHash = payloadHash(input),
          old = this.db
            .prepare(
              "SELECT id,input_hash FROM product_proposals WHERE company_id=? AND request_key=?",
            )
            .get(this.p.company_id, key);
        if (old) {
          if (old.input_hash !== inputHash)
            throw new DomainError(
              "Request key already used for different product content",
              409,
            );
          return { id: String(old.id) };
        }
        const templateId = field(input.templateId, "Template", 80),
          assetId = field(input.assetId, "Asset", 80),
          mode = choice(input.mode, ["SIMULATION", "SHOPIFY"], "mode"),
          row = this.db
            .prepare(
              "SELECT body FROM product_templates WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, templateId);
        if (!row) throw new DomainError("Template not found", 404);
        const template = JSON.parse(String(row.body)) as ProductTemplate,
          asset = this.asset(assetId, mode === "SIMULATION");
        const brief = this.db
          .prepare("SELECT body FROM design_briefs WHERE company_id=? AND id=?")
          .get(this.p.company_id, String(asset.brief_id))!;
        if (
          JSON.parse(String(brief.body)).productCategory !== template.category
        )
          throw new DomainError(
            "Template category must match the design brief",
            409,
          );
        this.costFresh(template);
        const parent = input.parentId
          ? field(input.parentId, "Parent proposal", 80)
          : null;
        if (
          parent &&
          !this.db
            .prepare(
              "SELECT id FROM product_proposals WHERE company_id=? AND id=?",
            )
            .get(this.p.company_id, parent)
        )
          throw new DomainError("Parent proposal not found", 404);
        const connection = mode === "SHOPIFY" ? this.connection() : null;
        if (
          mode === "SHOPIFY" &&
          (!connection?.enabled || connection.currency !== template.currency)
        )
          throw new DomainError(
            "Authorize a draft-write shop with the same currency first",
            409,
          );
        const prices = Array.isArray(input.variantPrices)
          ? input.variantPrices
          : [];
        if (prices.length !== template.variants.length)
          throw new DomainError(
            "Supply a price choice for every template variant",
          );
        const target =
          input.targetMarginPercent === null ||
          input.targetMarginPercent === undefined
            ? null
            : integer(
                input.targetMarginPercent,
                "Target contribution percentage",
                0,
                95,
              );
        const proposal = id(),
          prefix = "CO-" + proposal.replaceAll("-", "").toUpperCase();
        const pricing = template.variants.map((v) => {
          const r = prices.find((p) => p && p.value === v.value);
          if (!r) throw new DomainError("Variant price is missing");
          const manual = typeof r.price === "string" && r.price.trim() !== "";
          let priceMinor;
          if (manual) priceMinor = amount(r.price, template.currency);
          else {
            if (v.costMinor === null || target === null || v.costMinor === 0)
              throw new DomainError(
                "Manual positive price or reliable positive cost and target required",
              );
            priceMinor = Math.ceil((v.costMinor * 100) / (100 - target));
            if (!Number.isSafeInteger(priceMinor) || priceMinor > 1000000000)
              throw new DomainError("Calculated price exceeds limit");
          }
          return {
            variant: v.value,
            priceMinor,
            costMinor: v.costMinor,
            contributionPercent:
              v.costMinor === null
                ? null
                : Math.round(((priceMinor - v.costMinor) / priceMinor) * 1000) /
                  10,
            method: manual
              ? "Human-entered price"
              : "Cost / (1 − target); excludes unrecorded fees, shipping and taxes",
          };
        });
        const collections = strings(input.collections ?? [], "Collections", 10);
        if (
          collections.some((c) => !/^gid:\/\/shopify\/Collection\/\d+$/.test(c))
        )
          throw new DomainError("Valid Shopify collection IDs required");
        if (mode === "SIMULATION" && collections.length)
          throw new DomainError("Simulation cannot target Shopify collections");
        const tags = strings(input.tags ?? [], "Tags", 15);
        const title = field(input.title, "Product title", 160),
          description = field(input.description, "Product description", 4000);
        const draft: DraftInput = {
          title,
          descriptionHtml:
            "<p>" + xml(description).replace(/\n/g, "<br>") + "</p>",
          handle: "company-os-" + proposal,
          status: "DRAFT",
          vendor: field(input.vendor, "Vendor", 100),
          productType: template.category,
          tags: [...tags, "company-os:" + proposal],
          seo: {
            title: field(input.seoTitle ?? title.slice(0, 70), "SEO title", 70),
            description: field(
              input.seoDescription ?? description.slice(0, 160),
              "SEO description",
              160,
            ),
          },
          collections,
          productOptions: [
            {
              name: template.optionName,
              position: 1,
              values: template.variants.map((v) => ({ name: v.value })),
            },
          ],
          variants: template.variants.map((v, i) => ({
            sku: prefix + "-" + v.suffix,
            price: decimal(pricing[i].priceMinor, template.currency),
            optionValues: [{ optionName: template.optionName, name: v.value }],
            inventoryPolicy: "DENY",
          })),
        };
        const payload: ProductPayload = {
          template,
          templateId,
          assetId,
          assetHash: String(asset.content_hash),
          briefId: String(asset.brief_id),
          mode,
          domain: connection ? String(connection.domain) : null,
          connectionGeneration: connection
            ? Number(connection.generation)
            : null,
          currency: template.currency,
          input: draft,
          pricing,
          media:
            "Private local placement proof only; Shopify export currently excludes media. Upload production mockups after print-provider review.",
          printProvider:
            "INTEGRATION REQUIRED; no fulfillment or print order is created",
        };
        this.db
          .prepare(
            "INSERT INTO product_proposals VALUES(?,?,?,?,?,?,?,?,?,?,?,'PROPOSED',NULL,NULL,NULL,NULL,NULL,NULL,NULL,?)",
          )
          .run(
            proposal,
            this.p.company_id,
            templateId,
            assetId,
            parent,
            key,
            inputHash,
            mode,
            title,
            JSON.stringify(payload),
            payloadHash(payload),
            now(),
          );
        this.event(
          proposal,
          "PROPOSED",
          "Human-authored product package; DRAFT only",
        );
        return { id: proposal };
      },
    );
  }
  costFresh(template: ProductTemplate) {
    if (
      template.costExpiresAt &&
      Date.parse(template.costExpiresAt) <= Date.now()
    )
      throw new DomainError(
        "Cost evidence expired; create a refreshed template and proposal",
        409,
      );
  }
  row(proposal: string) {
    const r = this.db
      .prepare("SELECT * FROM product_proposals WHERE company_id=? AND id=?")
      .get(this.p.company_id, proposal);
    if (!r) throw new DomainError("Product proposal not found", 404);
    return r;
  }
  validate(row: ReturnType<ProductService["row"]>) {
    const p = JSON.parse(String(row.payload)) as ProductPayload;
    if (payloadHash(p) !== row.payload_hash)
      throw new DomainError("Product integrity failure", 409);
    this.asset(p.assetId, p.mode === "SIMULATION");
    this.costFresh(p.template);
    if (p.mode === "SHOPIFY") {
      const c = this.connection(),
        config = this.config();
      if (
        !c?.enabled ||
        c.domain !== p.domain ||
        config.domain !== p.domain ||
        Number(c.generation) !== p.connectionGeneration ||
        c.currency !== p.currency
      )
        throw new DomainError(
          "Write authorization changed; create a new proposal",
          409,
        );
    }
    return p;
  }
  event(proposal: string, action: string, detail: string) {
    this.db
      .prepare("INSERT INTO product_events VALUES(?,?,?,?,?,?,?)")
      .run(id(), this.p.company_id, proposal, action, detail, this.p.id, now());
  }
  approve(input: Record<string, unknown>) {
    const proposal = field(input.id, "Proposal", 80);
    return this.mutate(
      "products.proposal_approved",
      proposal,
      ["tyler", "alex", "garry"],
      () => {
        const r = this.row(proposal);
        if (
          !["PROPOSED", "BLOCKED"].includes(String(r.status)) &&
          !(r.status === "APPROVED" && Number(r.expires_at) <= Date.now())
        )
          throw new DomainError("Proposal is not awaiting approval", 409);
        if (
          r.consumed_at ||
          input.confirm !== true ||
          input.payloadHash !== r.payload_hash
        )
          throw new DomainError(
            "Exact unconsumed product payload must be explicitly approved",
            409,
          );
        this.validate(r);
        this.db
          .prepare(
            "UPDATE product_proposals SET status='APPROVED',approved_by=?,expires_at=?,error_code=NULL WHERE company_id=? AND id=?",
          )
          .run(this.p.id, Date.now() + 600000, this.p.company_id, proposal);
        this.event(
          proposal,
          "APPROVED",
          "Human CEO approved exact payload for ten minutes",
        );
        return { ok: true };
      },
    );
  }
  async dispatch(input: Record<string, unknown>) {
    const proposal = field(input.id, "Proposal", 80);
    const execution = new ExecutionControl(this.db, this.p);
    let operation = "";
    const p = this.mutate(
      "products.preflight_started",
      proposal,
      ["tyler", "alex", "garry"],
      () => {
        const r = this.row(proposal);
        if (
          r.status !== "APPROVED" ||
          r.consumed_at ||
          Number(r.expires_at) <= Date.now()
        )
          throw new DomainError("Unexpired single-use approval required", 409);
        if (
          this.db
            .prepare(
              "SELECT id FROM product_proposals WHERE company_id=? AND status IN('CHECKING','DISPATCHING','RECONCILIATION') AND mode='SHOPIFY'",
            )
            .get(this.p.company_id)
        )
          throw new DomainError(
            "Resolve pending or uncertain Shopify work first",
            409,
          );
        const p = this.validate(r);
        operation = execution.begin({
          kind: "PRODUCT",
          resourceId: proposal,
          agents: ["tyler", "alex", "garry"],
          requestKey: "product:" + proposal + ":" + id(),
          effect: p.mode === "SHOPIFY" ? "WRITE" : "READ",
          timeoutMs: 180000,
        });
        this.db
          .prepare(
            "UPDATE product_proposals SET status='CHECKING',started_at=? WHERE company_id=? AND id=?",
          )
          .run(now(), this.p.company_id, proposal);
        return p;
      },
    );
    let remote: RemoteDraft | null = null,
      dispatched = false;
    const watch = execution.watch(operation);
    try {
      execution.checkpoint(operation);
      let writer: DraftWriter | undefined;
      if (p.mode === "SHOPIFY") {
        writer = this.writer().client;
        const signal = AbortSignal.any([
          watch.signal,
          AbortSignal.timeout(45000),
        ]);
        const identity = await writer.identity(signal);
        execution.checkpoint(operation);
        this.guard(["tyler", "alex", "garry"]);
        validateIdentity(identity, p.domain!);
        if (identity.currency !== p.currency)
          throw new Error("CURRENCY_CHANGED");
        const collections = await writer.collections(
          p.input.collections,
          signal,
        );
        if (
          collections.length !== p.input.collections.length ||
          p.input.collections.some(
            (id) => !collections.some((c) => c.id === id && c.manual),
          )
        )
          throw new Error("COLLECTIONS_INVALID");
        this.guard(["tyler", "alex", "garry"]);
        execution.checkpoint(operation);
        if (await writer.lookup(p.input.handle, signal))
          throw new Error("HANDLE_ALREADY_EXISTS");
      }
      this.mutate(
        "products.dispatch_authorized",
        proposal,
        ["tyler", "alex", "garry"],
        () => {
          execution.checkpoint(operation);
          const r = this.row(proposal);
          if (
            r.status !== "CHECKING" ||
            r.consumed_at ||
            Number(r.expires_at) <= Date.now()
          )
            throw new DomainError(
              "Approval or job changed during preflight",
              409,
            );
          this.validate(r);
          this.db
            .prepare(
              "UPDATE product_proposals SET status='DISPATCHING',consumed_at=? WHERE company_id=? AND id=?",
            )
            .run(now(), this.p.company_id, proposal);
          this.event(
            proposal,
            "DISPATCHING",
            p.mode === "SIMULATION"
              ? "Local simulation only"
              : "Exactly one draft creation request; no publish operation",
          );
        },
      );
      dispatched = true;
      if (writer) {
        remote = await writer.create(
          p.input,
          AbortSignal.any([watch.signal, AbortSignal.timeout(45000)]),
        );
        if (!matchesDraft(remote, p.input, p.currency))
          throw new Error("DRAFT_RESULT_MISMATCH");
      }
      return transaction(this.db, () => {
        this.authenticate();
        if (this.row(proposal).status !== "DISPATCHING")
          throw new DomainError("Dispatch state changed", 409);
        const status = p.mode === "SIMULATION" ? "SIMULATED" : "DRAFT_CREATED";
        this.db
          .prepare(
            "UPDATE product_proposals SET status=?,remote_id=?,finished_at=? WHERE company_id=? AND id=?",
          )
          .run(status, remote?.id ?? null, now(), this.p.company_id, proposal);
        this.event(
          proposal,
          status,
          p.mode === "SIMULATION"
            ? "No external product created"
            : "Remote DRAFT and variant contract verified; media/print setup still pending",
        );
        audit(
          this.db,
          this.p.company_id,
          this.p.id,
          "products.draft_result_recorded",
          proposal,
        );
        execution.finish(operation, "COMPLETE", "DRAFT_RECEIPT_RECORDED");
        return { status, id: remote?.id ?? null };
      });
    } catch {
      transaction(this.db, () => {
        this.authenticate();
        execution.finish(
          operation,
          dispatched && p.mode === "SHOPIFY" ? "UNKNOWN" : "STOPPED",
          dispatched ? "WRITE_OUTCOME_UNCERTAIN" : "PREFLIGHT_STOPPED",
        );
        const row = this.row(proposal);
        if (["CHECKING", "DISPATCHING"].includes(String(row.status))) {
          const uncertain = dispatched || !!row.consumed_at;
          this.db
            .prepare(
              "UPDATE product_proposals SET status=?,remote_id=?,error_code=?,finished_at=? WHERE company_id=? AND id=?",
            )
            .run(
              uncertain ? "RECONCILIATION" : "BLOCKED",
              remote?.id ?? null,
              uncertain ? "WRITE_OUTCOME_UNCERTAIN" : "PREFLIGHT_FAILED",
              now(),
              this.p.company_id,
              proposal,
            );
          this.event(
            proposal,
            uncertain ? "RECONCILIATION" : "BLOCKED",
            uncertain
              ? "Do not retry. Inspect Shopify and reconcile by the unique handle."
              : "No product mutation sent; fix prerequisites and explicitly approve again.",
          );
          audit(
            this.db,
            this.p.company_id,
            this.p.id,
            "products.dispatch_failed",
            proposal,
            "FAILED",
          );
        }
      });
      throw new DomainError(
        dispatched
          ? "Shopify outcome requires reconciliation; no automatic retry."
          : "Product preflight failed; no product mutation was sent.",
        502,
      );
    } finally {
      watch.dispose();
    }
  }
  cancel(input: Record<string, unknown>) {
    const proposal = field(input.id, "Proposal", 80);
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(proposal);
      if (
        !["PROPOSED", "APPROVED", "BLOCKED"].includes(String(r.status)) ||
        r.consumed_at
      )
        throw new DomainError(
          "Only undispatched proposals may be cancelled",
          409,
        );
      this.db
        .prepare(
          "UPDATE product_proposals SET status='CANCELLED',finished_at=? WHERE company_id=? AND id=?",
        )
        .run(now(), this.p.company_id, proposal);
      this.event(proposal, "CANCELLED", "Human cancelled before dispatch");
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "products.proposal_cancelled",
        proposal,
      );
      return { ok: true };
    });
  }
  recover(input: Record<string, unknown>) {
    const proposal = field(input.id, "Proposal", 80);
    return transaction(this.db, () => {
      this.authenticate();
      const r = this.row(proposal);
      if (
        !["CHECKING", "DISPATCHING"].includes(String(r.status)) ||
        Date.now() - Date.parse(String(r.started_at)) < 180000
      )
        throw new DomainError(
          "Only interrupted work older than three minutes can be recovered",
          409,
        );
      const status = r.consumed_at ? "RECONCILIATION" : "BLOCKED";
      this.db
        .prepare(
          "UPDATE product_proposals SET status=?,error_code='INTERRUPTED',finished_at=? WHERE company_id=? AND id=?",
        )
        .run(status, now(), this.p.company_id, proposal);
      this.event(proposal, status, "Recovered interrupted work without retry");
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "products.recovered",
        proposal,
      );
      return { status };
    });
  }
  async reconcile(input: Record<string, unknown>) {
    this.authenticate();
    const proposal = field(input.id, "Proposal", 80),
      r = this.row(proposal),
      p = JSON.parse(String(r.payload)) as ProductPayload;
    if (r.status !== "RECONCILIATION" || p.mode !== "SHOPIFY")
      throw new DomainError("Uncertain Shopify proposal required", 409);
    const { client, config } = this.writer();
    if (config.domain !== p.domain)
      throw new DomainError("Original shop credentials required", 409);
    let found: RemoteDraft | null;
    try {
      const identity = await client.identity(AbortSignal.timeout(20000));
      validateIdentity(identity, p.domain!);
      if (identity.currency !== p.currency) throw new Error("CURRENCY_CHANGED");
      found = await client.lookup(p.input.handle, AbortSignal.timeout(20000));
    } catch {
      throw new DomainError("Read-only reconciliation failed", 502);
    }
    return transaction(this.db, () => {
      this.authenticate();
      if (this.row(proposal).status !== "RECONCILIATION")
        throw new DomainError("Proposal state changed", 409);
      const verified =
        found !== null && matchesDraft(found, p.input, p.currency);
      if (verified)
        for (const op of this.db
          .prepare(
            "SELECT id FROM execution_operations WHERE company_id=? AND kind='PRODUCT' AND resource_id=? AND state='UNKNOWN'",
          )
          .all(this.p.company_id, proposal))
          new ExecutionControl(this.db, this.p).finish(
            String(op.id),
            "COMPLETE",
            "DRAFT_RECEIPT_RECONCILED",
          );
      if (verified)
        this.db
          .prepare(
            "UPDATE product_proposals SET status='DRAFT_CREATED',remote_id=?,finished_at=?,error_code=NULL WHERE company_id=? AND id=?",
          )
          .run(found!.id, now(), this.p.company_id, proposal);
      this.event(
        proposal,
        verified ? "DRAFT_RECONCILED" : "STILL_UNCERTAIN",
        verified
          ? "Read-only lookup verified exact draft and variants"
          : "No matching draft verified. Missing result is not proof no write occurred. Do not retry.",
      );
      audit(
        this.db,
        this.p.company_id,
        this.p.id,
        "products.reconciliation_checked",
        proposal,
      );
      return { verified };
    });
  }
  mockup(proposal: string) {
    this.authenticate();
    const r = this.row(field(proposal, "Proposal", 80)),
      p = JSON.parse(String(r.payload)) as ProductPayload;
    const asset = this.db
      .prepare("SELECT content FROM design_assets WHERE company_id=? AND id=?")
      .get(this.p.company_id, p.assetId);
    if (!asset) throw new DomainError("Asset not found", 404);
    const image = Buffer.from(asset.content as Uint8Array).toString("base64"),
      v = p.template.placement;
    const shape =
      p.template.kind === "POSTER"
        ? '<rect x="130" y="80" width="740" height="840" rx="8" fill="white" stroke="#374f46" stroke-width="18"/>'
        : p.template.kind === "SHIRT"
          ? '<path d="M300 180 L420 140 Q500 240 580 140 L700 180 L870 330 L750 450 L700 390 L700 900 L300 900 L300 390 L250 450 L130 330 Z" fill="white" stroke="#374f46" stroke-width="8"/>'
          : '<path d="M700 310 C940 230 940 760 700 680" fill="none" stroke="#374f46" stroke-width="45"/><rect x="190" y="270" width="540" height="480" rx="60" fill="white" stroke="#374f46" stroke-width="10"/>';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1080" viewBox="0 0 1000 1080"><rect width="1000" height="1080" fill="#e9eee9"/>${shape}<image x="${v.x}" y="${v.y}" width="${v.width}" height="${v.height}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${image}"/><text x="500" y="985" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#243e33">${p.mode === "SIMULATION" ? "SIMULATION · " : ""}PLACEMENT PROOF · NOT A PRINT-PROVIDER MOCKUP</text><text x="500" y="1030" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#243e33">${xml(String(r.title).slice(0, 70))}</text></svg>`;
  }
}
import { ExecutionControl } from "./execution-control.ts";
