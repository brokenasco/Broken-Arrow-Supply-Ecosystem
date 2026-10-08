import { assertComplianceClear } from "../compliance-gates.ts";
import { captureDays } from "../analytics.ts";
import type { DatabaseSync } from "node:sqlite";
import { audit, id, now, transaction } from "../db.ts";
import { DomainError } from "../policy.ts";
import type { Principal } from "../service.ts";
import {
  domain,
  environmentConfig,
  ShopifyClient,
  ShopifyError,
  BASE_SCOPES,
  API_VERSION,
  type ShopifyConfig,
  type ReadClient,
} from "./client.ts";
import { ShopifyReader, type Snapshot } from "./read.ts";
import { startOfStoreWeek } from "./time.ts";
export type ShopifyDependencies = {
  config?: () => ShopifyConfig | null;
  client?: (config: ShopifyConfig) => ReadClient;
};
type Connection = {
  company_id: string;
  store_id: string;
  domain: string;
  status: string;
  customer_access: number;
  scopes: string;
  currency: string | null;
  timezone: string | null;
  generation: number;
  active_run: string | null;
  lease_until: number | null;
  last_success_at: string | null;
  window_start: string | null;
  window_end: string | null;
  error_code: string | null;
};
const tables = [
  "shopify_order_lines",
  "shopify_refunds",
  "shopify_fulfillments",
  "shopify_orders",
  "shopify_variants",
  "shopify_inventory",
  "shopify_products",
  "shopify_customers",
] as const;
function authenticatedCEO(db: DatabaseSync, p: Principal) {
  if (
    p.role !== "CEO" ||
    !db
      .prepare(
        "SELECT id FROM users WHERE id=? AND company_id=? AND role='CEO'",
      )
      .get(p.id, p.company_id)
  )
    throw new DomainError("CEO authority required", 403);
}
export function shopifyConnection(
  db: DatabaseSync,
  company: string,
): Connection | undefined {
  return db
    .prepare("SELECT * FROM shopify_connections WHERE company_id=?")
    .get(company) as Connection | undefined;
}
export class ShopifyService {
  #db: DatabaseSync;
  #p: Principal;
  #deps: ShopifyDependencies;
  constructor(db: DatabaseSync, p: Principal, deps: ShopifyDependencies = {}) {
    authenticatedCEO(db, p);
    this.#db = db;
    this.#p = p;
    this.#deps = deps;
  }
  #config() {
    let config: ShopifyConfig | null;
    try {
      config = (this.#deps.config ?? environmentConfig)();
    } catch {
      throw new DomainError("Invalid server-side Shopify configuration", 409);
    }
    if (!config || config.companyId !== this.#p.company_id)
      throw new DomainError(
        "INTEGRATION REQUIRED: configure Shopify credentials for this company on the server",
        409,
      );
    return config;
  }
  authorize(input: Record<string, unknown>) {
    assertComplianceClear(this.#db, this.#p.company_id);
    if (input.authorizeReadAccess !== true)
      throw new DomainError("Explicit CEO read-access authorization required");
    if (
      typeof input.domain !== "string" ||
      typeof input.customerAccess !== "boolean"
    )
      throw new DomainError("Store domain and customer access choice required");
    let shop: string;
    try {
      shop = domain(input.domain);
    } catch {
      throw new DomainError("Use an exact *.myshopify.com store domain");
    }
    const config = this.#config();
    if (shop !== config.domain)
      throw new DomainError(
        "Store does not match the server configuration",
        403,
      );
    if (input.customerAccess && !config.customersEnabled)
      throw new DomainError("Customer access is disabled on the server", 403);
    return transaction(this.#db, () => {
      const existing = shopifyConnection(this.#db, this.#p.company_id);
      if (
        existing?.status === "SYNCING" &&
        Number(existing.lease_until) > Date.now()
      )
        throw new DomainError("A sync is already running", 409);
      if (existing && existing.domain !== shop)
        throw new DomainError(
          "This company is bound to another store. Store migration requires administrator review.",
          409,
        );
      const store = existing?.store_id ?? id();
      if (existing?.active_run)
        this.#db
          .prepare(
            "UPDATE shopify_sync_runs SET status='FAILED',finished_at=?,error_code='LEASE_EXPIRED' WHERE id=? AND company_id=? AND status='RUNNING'",
          )
          .run(now(), existing.active_run, this.#p.company_id);
      if (!existing)
        this.#db
          .prepare(
            "INSERT INTO stores(id,company_id,name,mode,status) VALUES(?,?,?,?,?)",
          )
          .run(store, this.#p.company_id, shop, "LIVE", "AUTHORIZED");
      this.#db
        .prepare(
          `INSERT INTO shopify_connections(company_id,store_id,domain,status,customer_access,authorized_by,authorized_at) VALUES(?,?,?,'AUTHORIZED',?,?,?) ON CONFLICT(company_id) DO UPDATE SET status='AUTHORIZED',customer_access=excluded.customer_access,authorized_by=excluded.authorized_by,authorized_at=excluded.authorized_at,generation=generation+1,active_run=NULL,lease_until=NULL,error_code=NULL`,
        )
        .run(
          this.#p.company_id,
          store,
          shop,
          Number(input.customerAccess),
          this.#p.id,
          now(),
        );
      if (!input.customerAccess)
        this.#db
          .prepare(
            "DELETE FROM shopify_customers WHERE company_id=? AND store_id=?",
          )
          .run(this.#p.company_id, store);
      this.#db
        .prepare(
          "UPDATE stores SET status='AUTHORIZED' WHERE company_id=? AND id=?",
        )
        .run(this.#p.company_id, store);
      audit(
        this.#db,
        this.#p.company_id,
        this.#p.id,
        "shopify.read_access_authorized",
        store,
        "SUCCESS",
        {
          domain: shop,
          scopes: [
            ...BASE_SCOPES,
            ...(input.customerAccess ? ["read_customers"] : []),
          ],
          customerAccess: input.customerAccess,
        },
      );
      return {
        ok: true,
        status: "AUTHORIZED",
        message:
          "Read access authorized locally. Run sync to verify the Shopify installation and scopes.",
      };
    });
  }
  disconnect() {
    return transaction(this.#db, () => {
      const c = shopifyConnection(this.#db, this.#p.company_id);
      if (!c) throw new DomainError("No Shopify connection", 404);
      if (c.active_run)
        this.#db
          .prepare(
            "UPDATE shopify_sync_runs SET status='CANCELLED',finished_at=?,error_code='DISCONNECTED' WHERE id=? AND company_id=? AND status='RUNNING'",
          )
          .run(now(), c.active_run, this.#p.company_id);
      this.#db
        .prepare(
          "UPDATE shopify_connections SET status='DISCONNECTED',generation=generation+1,active_run=NULL,lease_until=NULL WHERE company_id=?",
        )
        .run(this.#p.company_id);
      this.#db
        .prepare(
          "UPDATE stores SET status='DISCONNECTED' WHERE company_id=? AND id=?",
        )
        .run(this.#p.company_id, c.store_id);
      audit(
        this.#db,
        this.#p.company_id,
        this.#p.id,
        "shopify.disconnected",
        c.store_id,
      );
      return { ok: true };
    });
  }
  async sync() {
    const config = this.#config(),
      run = id(),
      company = this.#p.company_id,
      db = this.#db;
    const c = transaction(db, () => {
      assertComplianceClear(db, company);
      const connection = shopifyConnection(db, company);
      if (!connection || connection.status === "DISCONNECTED")
        throw new DomainError("Authorize Shopify read access first", 409);
      if (connection.domain !== config.domain)
        throw new DomainError("Store configuration mismatch", 403);
      if (connection.customer_access && !config.customersEnabled)
        throw new DomainError("Reauthorize with customer access disabled", 403);
      if (
        db.prepare("SELECT stopped FROM companies WHERE id=?").get(company)
          ?.stopped
      )
        throw new DomainError("Company is paused; sync is blocked", 409);
      if (
        connection.status === "SYNCING" &&
        Number(connection.lease_until) > Date.now()
      )
        throw new DomainError("A sync is already running", 409);
      if (connection.active_run)
        db.prepare(
          "UPDATE shopify_sync_runs SET status='FAILED',finished_at=?,error_code='LEASE_EXPIRED' WHERE id=? AND company_id=? AND status='RUNNING'",
        ).run(now(), connection.active_run, company);
      db.prepare(
        "INSERT INTO shopify_sync_runs(id,company_id,store_id,status,started_at) VALUES(?,?,?,'RUNNING',?)",
      ).run(run, company, connection.store_id, now());
      db.prepare(
        "UPDATE shopify_connections SET status='SYNCING',active_run=?,lease_until=?,error_code=NULL WHERE company_id=?",
      ).run(run, Date.now() + 180000, company);
      audit(
        db,
        company,
        this.#p.id,
        "shopify.sync_started",
        connection.store_id,
        "SUCCESS",
        { run },
      );
      return connection;
    });
    const guard = () => {
      assertComplianceClear(db, company);
      const current = shopifyConnection(db, company);
      if (
        !current ||
        current.generation !== c.generation ||
        current.active_run !== run ||
        current.status !== "SYNCING" ||
        Number(current.lease_until) <= Date.now()
      )
        throw new ShopifyError("SYNC_CANCELLED");
      if (
        db.prepare("SELECT stopped FROM companies WHERE id=?").get(company)
          ?.stopped
      )
        throw new ShopifyError("COMPANY_PAUSED");
    };
    try {
      const client = (this.#deps.client ?? ((cfg) => new ShopifyClient(cfg)))(
        config,
      );
      const snapshot = await new ShopifyReader(
        client,
        AbortSignal.timeout(120000),
        guard,
      ).snapshot(c.domain, Boolean(c.customer_access));
      const counts = {
        products: snapshot.products.length,
        variants: snapshot.variants.length,
        orders: snapshot.orders.length,
        inventory: snapshot.inventory.length,
        refunds: snapshot.refunds.length,
        fulfillments: snapshot.fulfillments.length,
        customers: snapshot.customers.length,
      };
      transaction(db, () => {
        guard();
        this.#replace(c.store_id, snapshot);
        captureDays(db, company, c.store_id, run, snapshot);
        db.prepare(
          "UPDATE shopify_connections SET status='READY',scopes=?,currency=?,timezone=?,last_success_at=?,window_start=?,window_end=?,active_run=NULL,lease_until=NULL,error_code=NULL WHERE company_id=?",
        ).run(
          JSON.stringify(snapshot.scopes),
          snapshot.shop.currency,
          snapshot.shop.timezone,
          now(),
          snapshot.from,
          snapshot.to,
          company,
        );
        db.prepare(
          "UPDATE stores SET name=?,status='READY' WHERE company_id=? AND id=?",
        ).run(snapshot.shop.name, company, c.store_id);
        db.prepare(
          "UPDATE shopify_sync_runs SET status='SUCCESS',finished_at=?,counts=? WHERE id=? AND company_id=?",
        ).run(now(), JSON.stringify(counts), run, company);
        audit(
          db,
          company,
          this.#p.id,
          "shopify.sync_completed",
          c.store_id,
          "SUCCESS",
          { run, counts, from: snapshot.from, to: snapshot.to },
        );
      });
      return { ok: true, counts };
    } catch (error) {
      const code = error instanceof ShopifyError ? error.code : "SYNC_FAILED";
      transaction(db, () => {
        const current = shopifyConnection(db, company);
        db.prepare(
          "UPDATE shopify_sync_runs SET status='FAILED',finished_at=?,error_code=? WHERE id=? AND company_id=? AND status='RUNNING'",
        ).run(now(), code, run, company);
        if (current?.active_run === run) {
          db.prepare(
            "UPDATE shopify_connections SET status='ERROR',error_code=?,active_run=NULL,lease_until=NULL WHERE company_id=?",
          ).run(code, company);
          db.prepare(
            "UPDATE stores SET status='ERROR' WHERE company_id=? AND id=?",
          ).run(company, c.store_id);
        }
        audit(
          db,
          company,
          this.#p.id,
          "shopify.sync_failed",
          c.store_id,
          "FAILED",
          { run, code },
        );
        const message = `Shopify sync failed (${code}). Review the Shopify store page; the last successful cache was preserved.`;
        if (
          !db
            .prepare(
              "SELECT id FROM notifications WHERE company_id=? AND message=? AND read=0",
            )
            .get(company, message)
        )
          db.prepare("INSERT INTO notifications VALUES(?,?,?,?,?,?)").run(
            id(),
            company,
            "WARNING",
            message,
            0,
            now(),
          );
      });
      throw new DomainError(
        `Shopify sync failed: ${code}. The previous successful snapshot was preserved.`,
        502,
      );
    }
  }
  #replace(store: string, s: Snapshot) {
    const db = this.#db,
      company = this.#p.company_id;
    for (const table of tables)
      db.prepare(`DELETE FROM ${table} WHERE company_id=? AND store_id=?`).run(
        company,
        store,
      );
    const insert = (
      table: (typeof tables)[number],
      rows: (string | number | null)[][],
    ) => {
      if (!rows.length) return;
      const statement = db.prepare(
        `INSERT INTO ${table} VALUES(${Array(rows[0].length + 2)
          .fill("?")
          .join(",")})`,
      );
      for (const row of rows) statement.run(company, store, ...row);
    };
    insert(
      "shopify_products",
      s.products.map((p) => [
        p.id,
        p.title,
        p.status,
        p.createdAt,
        p.updatedAt,
      ]),
    );
    insert(
      "shopify_variants",
      s.variants.map((v) => [v.id, v.productId, v.title, v.sku, v.itemId]),
    );
    insert(
      "shopify_inventory",
      s.inventory.map((i) => [
        i.itemId,
        i.locationId,
        i.locationName,
        Number(i.tracked),
        i.available,
      ]),
    );
    insert(
      "shopify_orders",
      s.orders.map((o) => [
        o.id,
        o.createdAt,
        o.updatedAt,
        o.cancelledAt,
        Number(o.test),
        o.financialStatus,
        o.fulfillmentStatus,
        o.currency,
        o.total,
        o.refunded,
      ]),
    );
    insert(
      "shopify_order_lines",
      s.lines.map((l) => [
        l.id,
        l.orderId,
        l.productId,
        l.variantId,
        l.title,
        l.quantity,
      ]),
    );
    insert(
      "shopify_refunds",
      s.refunds.map((r) => [
        r.id,
        r.orderId,
        r.createdAt,
        r.currency,
        r.amount,
      ]),
    );
    insert(
      "shopify_fulfillments",
      s.fulfillments.map((f) => [f.id, f.orderId, f.status, f.createdAt]),
    );
    insert(
      "shopify_customers",
      s.customers.map((c) => [c.id, c.createdAt, c.orderCount]),
    );
  }
}
export function shopifySummary(
  db: DatabaseSync,
  company: string,
  at = new Date(),
  period: "rolling7" | "thisWeek" = "rolling7",
) {
  const c = shopifyConnection(db, company);
  const runs = db
    .prepare(
      "SELECT id,status,started_at,finished_at,error_code,counts FROM shopify_sync_runs WHERE company_id=? ORDER BY started_at DESC LIMIT 10",
    )
    .all(company);
  const base = {
    connection: c
      ? {
          domain: c.domain,
          status: c.status,
          customerAccess: Boolean(c.customer_access),
          scopes: JSON.parse(c.scopes) as string[],
          lastSuccessAt: c.last_success_at,
          errorCode: c.error_code,
          storeId: c.store_id,
          currency: c.currency,
          timezone: c.timezone,
          windowStart: c.window_start,
          windowEnd: c.window_end,
        }
      : null,
    apiVersion: API_VERSION,
    runs,
  };
  if (!c?.last_success_at || !c.window_end || c.status === "DISCONNECTED")
    return { ...base, data: null };
  const args = [company, c.store_id];
  const end = new Date(c.window_end),
    weekStart =
      period === "thisWeek"
        ? startOfStoreWeek(at, c.timezone ?? "UTC")
        : new Date(end.getTime() - 7 * 86400000).toISOString();
  const orders = db
    .prepare(
      "SELECT * FROM shopify_orders WHERE company_id=? AND store_id=? AND test=0 AND cancelled_at IS NULL",
    )
    .all(...args);
  const week = orders.filter((o) => String(o.created_at) >= weekStart);
  const total = week.reduce((sum, o) => sum + Number(o.current_total_minor), 0);
  if (!Number.isSafeInteger(total))
    throw new DomainError("Metric exceeds safe money range", 500);
  const products = db
    .prepare(
      `SELECT p.id,p.title,p.status,p.created_at,COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN l.quantity ELSE 0 END),0) units FROM shopify_products p LEFT JOIN shopify_order_lines l ON l.company_id=p.company_id AND l.store_id=p.store_id AND l.product_id=p.id LEFT JOIN shopify_orders o ON o.company_id=l.company_id AND o.store_id=l.store_id AND o.id=l.order_id AND o.test=0 AND o.cancelled_at IS NULL AND o.created_at>=? WHERE p.company_id=? AND p.store_id=? GROUP BY p.id ORDER BY units DESC,p.title`,
    )
    .all(weekStart, ...args);
  const low = db
    .prepare(
      `SELECT v.id,v.title variant,p.title product,v.sku,SUM(i.available) available FROM shopify_variants v JOIN shopify_products p ON p.company_id=v.company_id AND p.store_id=v.store_id AND p.id=v.product_id JOIN shopify_inventory i ON i.company_id=v.company_id AND i.store_id=v.store_id AND i.item_id=v.inventory_item_id WHERE v.company_id=? AND v.store_id=? AND i.tracked=1 AND p.status='ACTIVE' GROUP BY v.id HAVING SUM(i.available)<=5 ORDER BY available,p.title LIMIT 50`,
    )
    .all(...args);
  const counts: Record<string, number> = {};
  for (const table of [
    "products",
    "variants",
    "orders",
    "inventory",
    "refunds",
    "fulfillments",
    "customers",
  ])
    counts[table] = Number(
      db
        .prepare(
          `SELECT COUNT(*) n FROM shopify_${table} WHERE company_id=? AND store_id=?`,
        )
        .get(...args)?.n,
    );
  const recent = db
    .prepare(
      "SELECT id,created_at,financial_status,fulfillment_status,currency,current_total_minor,refunded_minor,test,cancelled_at FROM shopify_orders WHERE company_id=? AND store_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(...args);
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: c.timezone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  const todayCovered = formatDate(at) === formatDate(end);
  return {
    ...base,
    data: {
      source: "LIVE_SHOPIFY",
      stale:
        at.getTime() - Date.parse(c.last_success_at) > 60 * 60 * 1000 ||
        ["ERROR", "AUTHORIZED"].includes(c.status),
      asOf: c.last_success_at,
      counts,
      catalog: products.slice(0, 100),
      weekStart,
      weekEnd: c.window_end,
      orderCount: week.length,
      currentOrderTotalMinor: total,
      averageOrderTotalMinor: week.length
        ? Math.round(total / week.length)
        : null,
      todayOrders: todayCovered
        ? orders.filter(
            (o) =>
              formatDate(new Date(String(o.created_at))) === formatDate(at),
          ).length
        : null,
      topProducts: products.filter((p) => Number(p.units) > 0).slice(0, 10),
      zeroSalesProducts: products
        .filter(
          (p) =>
            p.status === "ACTIVE" &&
            Number(p.units) === 0 &&
            String(p.created_at) <= weekStart,
        )
        .slice(0, 20),
      lowInventory: low,
      recentOrders: recent,
      customerAccess: Boolean(c.customer_access),
      notes: `Orders: non-test, non-cancelled, created ${period === "thisWeek" ? "since Monday in the store timezone" : "in the trailing 7 days"} ending at the sync cutoff. Current order value includes tax/shipping and unpaid orders; it is not recognized revenue. Units are quantities ordered, not net of returns. Low stock means tracked available quantity ≤5 across locations. Zero observed sales is a review signal, not proof of underperformance.`,
    },
  };
}
export function shopifyAnswer(
  db: DatabaseSync,
  company: string,
  message: string,
): string | null {
  if (
    !/sold|sell|best|low|stock|inventory|orders?|underperform|sales|revenue|refund|fulfill/i.test(
      message,
    )
  )
    return null;
  const thisWeek = /this week/i.test(message);
  const summary = shopifySummary(
      db,
      company,
      new Date(),
      thisWeek ? "thisWeek" : "rolling7",
    ),
    d = summary.data,
    c = summary.connection;
  if (!d || !c)
    return "INTEGRATION REQUIRED — No usable Shopify snapshot. Authorize read access and complete a sync on the Shopify page. No sales or stock figures can be verified yet.";
  if (/last month|yesterday|last week|this month|year/i.test(message))
    return "That calendar period is not supported by the Phase 2 status assistant. Ask about the last 7 days, current low stock, or recent orders. Full historical comparisons arrive in Phase 3.";
  if (d.weekStart > d.weekEnd)
    return "The stored snapshot does not cover this week. Sync Shopify before requesting current-week figures.";
  const prefix = `Shopify ${c.domain}, snapshot ${d.asOf}${d.stale ? " (STALE / refresh required)" : ""}. ${thisWeek ? "This week (Monday start, store timezone)" : "Trailing 7 days"}: ${d.weekStart} to ${d.weekEnd}. `;
  const days = message.match(/\b(\d+)\s+days?\b/i);
  if (days && days[1] !== "7")
    return "This status assistant supports the last 7 days, this week, today’s order count, and current inventory. Other periods require a later analytics increment.";
  if (/today/i.test(message) && /orders?/i.test(message))
    return (
      `Shopify ${c.domain}, snapshot ${d.asOf}${d.stale ? " (STALE)" : ""}. ` +
      (d.todayOrders === null
        ? "The snapshot does not cover today. Sync before requesting today’s order count."
        : `${d.todayOrders} non-test, non-cancelled orders created today in ${c.timezone}, through the snapshot cutoff.`)
    );
  if (/low|stock|inventory/i.test(message))
    return (
      prefix +
      (d.counts.inventory === 0
        ? "No inventory balances were returned; low-stock status is unavailable."
        : d.lowInventory.length
          ? d.lowInventory
              .slice(0, 10)
              .map(
                (p) => `${p.product} / ${p.variant}: ${p.available} available`,
              )
              .join("; ")
          : "No tracked active variants at or below 5 available units in this snapshot.") +
      " Quantities are summed across locations; no supplier or replenishment estimate is inferred."
    );
  if (/underperform|weak/i.test(message))
    return (
      prefix +
      (d.zeroSalesProducts.length
        ? "Active products created before this window with zero observed units: " +
          d.zeroSalesProducts
            .slice(0, 10)
            .map((p) => p.title)
            .join(", ")
        : "No active products meet the zero-sales review rule.") +
      " This is a review signal, not proven underperformance; exposure and traffic are unavailable."
    );
  if (/best|sold|sell/i.test(message))
    return (
      prefix +
      (d.topProducts.length
        ? d.topProducts
            .map((p) => `${p.title}: ${p.units} units ordered`)
            .join("; ")
        : "No product units observed in eligible orders.") +
      " Test and cancelled orders excluded; units are not net of returns."
    );
  if (/refund|fulfill/i.test(message))
    return (
      prefix +
      `${d.counts.refunds} refund records and ${d.counts.fulfillments} fulfillment records attached to the cached 30-day order cohort. These are records, not a calendar-period refund rate; older-order events are outside coverage.`
    );
  return (
    prefix + `${d.orderCount} non-test, non-cancelled orders placed. ${d.notes}`
  );
}
