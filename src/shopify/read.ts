import {
  array,
  object,
  string,
  integer,
  bool,
  ShopifyError,
  BASE_SCOPES,
  type Json,
  type ReadClient,
} from "./client.ts";
import type { QueryName } from "./queries.ts";
export function timestamp(value: unknown): string {
  const v = string(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v)))
    throw new ShopifyError("INVALID_TIMESTAMP");
  return new Date(v).toISOString();
}
function gid(value: unknown): string {
  const v = string(value);
  if (!/^gid:\/\/shopify\/[A-Za-z]+\/\d+$/.test(v))
    throw new ShopifyError("INVALID_ID");
  return v;
}
function optionalString(value: unknown) {
  return value == null ? null : string(value);
}
export function minorUnits(amount: string, currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !/^\d+(\.\d+)?$/.test(amount))
    throw new ShopifyError("INVALID_MONEY");
  const digits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.slice(digits).replace(/0/g, ""))
    throw new ShopifyError("MONEY_PRECISION");
  const value =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ShopifyError("MONEY_OVERFLOW");
  return Number(value);
}
function money(value: unknown) {
  const m = object(object(value).shopMoney),
    currency = string(m.currencyCode);
  return { currency, minor: minorUnits(string(m.amount), currency) };
}
export type Product = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type Variant = {
  id: string;
  productId: string;
  title: string;
  sku: string | null;
  itemId: string;
};
export type Inventory = {
  itemId: string;
  locationId: string;
  locationName: string;
  tracked: boolean;
  available: number;
};
export type Line = {
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  title: string;
  quantity: number;
};
export type Order = {
  id: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  financialStatus: string | null;
  fulfillmentStatus: string;
  currency: string;
  total: number;
  refunded: number;
};
export type Refund = {
  id: string;
  orderId: string;
  createdAt: string;
  currency: string;
  amount: number;
};
export type Fulfillment = {
  id: string;
  orderId: string;
  createdAt: string;
  status: string;
};
export type Customer = { id: string; createdAt: string; orderCount: number };
export type Snapshot = {
  shop: { name: string; domain: string; currency: string; timezone: string };
  scopes: string[];
  products: Product[];
  variants: Variant[];
  inventory: Inventory[];
  orders: Order[];
  lines: Line[];
  refunds: Refund[];
  fulfillments: Fulfillment[];
  customers: Customer[];
  from: string;
  to: string;
};
export class ShopifyReader {
  #client: ReadClient;
  #signal: AbortSignal;
  #guard: () => void;
  #requests = 0;
  constructor(
    client: ReadClient,
    signal: AbortSignal,
    guard: () => void = () => {},
  ) {
    this.#client = client;
    this.#signal = signal;
    this.#guard = guard;
  }
  async query(name: QueryName, variables: Json = {}) {
    this.#guard();
    this.#signal.throwIfAborted();
    if (++this.#requests > 1000) throw new ShopifyError("SYNC_LIMIT_EXCEEDED");
    return this.#client.query(name, variables, this.#signal);
  }
  async collect(
    name: QueryName,
    key: string,
    variables: Json = {},
    parent?: string,
    initial?: unknown,
  ): Promise<Json[]> {
    const result: Json[] = [],
      seen = new Set<string>();
    let cursor: string | null = null,
      first = initial;
    for (let page = 0; page < 200; page++) {
      const data =
        first !== undefined
          ? null
          : await this.query(name, { ...variables, cursor });
      const connection = object(
        first !== undefined
          ? first
          : parent
            ? object(data![parent])[key]
            : data![key],
      );
      first = undefined;
      result.push(...array(connection.nodes).map(object));
      if (result.length > 20000) throw new ShopifyError("SYNC_LIMIT_EXCEEDED");
      const info = object(connection.pageInfo);
      if (!bool(info.hasNextPage)) return result;
      cursor = string(info.endCursor);
      if (!cursor || seen.has(cursor))
        throw new ShopifyError("PAGINATION_LOOP");
      seen.add(cursor);
    }
    throw new ShopifyError("SYNC_LIMIT_EXCEEDED");
  }
  async snapshot(
    expectedDomain: string,
    customers: boolean,
    to = new Date().toISOString(),
  ): Promise<Snapshot> {
    const identity = await this.query("identity"),
      shop = object(identity.shop);
    const scopes = array(
      object(identity.currentAppInstallation).accessScopes,
    ).map((s) => string(object(s).handle));
    const allowed = [...BASE_SCOPES, ...(customers ? ["read_customers"] : [])];
    if (scopes.some((s) => !allowed.includes(s)))
      throw new ShopifyError("EXCESS_SCOPES");
    if (allowed.some((s) => !scopes.includes(s)))
      throw new ShopifyError("MISSING_SCOPES");
    if (string(shop.myshopifyDomain).toLowerCase() !== expectedDomain)
      throw new ShopifyError("STORE_IDENTITY_MISMATCH");
    const currency = string(shop.currencyCode),
      timezone = string(shop.ianaTimezone);
    if (!/^[A-Z]{3}$/.test(currency))
      throw new ShopifyError("INVALID_CURRENCY");
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      throw new ShopifyError("INVALID_TIMEZONE");
    }
    const from = new Date(Date.parse(to) - 30 * 86400000).toISOString();
    const result: Snapshot = {
      shop: {
        name: string(shop.name),
        domain: expectedDomain,
        currency,
        timezone,
      },
      scopes,
      from,
      to,
      products: [],
      variants: [],
      inventory: [],
      orders: [],
      lines: [],
      refunds: [],
      fulfillments: [],
      customers: [],
    };
    for (const p of await this.collect("products", "products"))
      result.products.push({
        id: gid(p.id),
        title: string(p.title),
        status: string(p.status),
        createdAt: timestamp(p.createdAt),
        updatedAt: timestamp(p.updatedAt),
      });
    for (const v of await this.collect("variants", "productVariants"))
      result.variants.push({
        id: gid(v.id),
        productId: gid(object(v.product).id),
        title: string(v.title),
        sku: optionalString(v.sku),
        itemId: gid(object(v.inventoryItem).id),
      });
    for (const item of await this.collect("inventory", "inventoryItems")) {
      for (const level of await this.collect(
        "levels",
        "inventoryLevels",
        { id: gid(item.id) },
        "inventoryItem",
        item.inventoryLevels,
      )) {
        const location = object(level.location),
          available = array(level.quantities)
            .map(object)
            .find((q) => q.name === "available");
        if (!available) throw new ShopifyError("MISSING_INVENTORY_QUANTITY");
        result.inventory.push({
          itemId: gid(item.id),
          tracked: bool(item.tracked),
          locationId: gid(location.id),
          locationName: string(location.name),
          available: integer(available.quantity),
        });
      }
    }
    const orderNodes = await this.collect("orders", "orders", {
      query: `created_at:>='${from}' created_at:<='${to}'`,
    });
    for (const o of orderNodes) {
      const orderId = gid(o.id),
        total = money(o.currentTotalPriceSet),
        refund = money(o.totalRefundedSet);
      if (total.currency !== currency || refund.currency !== currency)
        throw new ShopifyError("CURRENCY_MISMATCH");
      const createdAt = timestamp(o.createdAt);
      if (createdAt < from || createdAt > to)
        throw new ShopifyError("ORDER_WINDOW_MISMATCH");
      result.orders.push({
        id: orderId,
        createdAt,
        updatedAt: timestamp(o.updatedAt),
        cancelledAt: o.cancelledAt == null ? null : timestamp(o.cancelledAt),
        test: bool(o.test),
        financialStatus: optionalString(o.displayFinancialStatus),
        fulfillmentStatus: string(o.displayFulfillmentStatus),
        currency,
        total: total.minor,
        refunded: refund.minor,
      });
      for (const l of await this.collect(
        "lines",
        "lineItems",
        { id: orderId },
        "order",
        o.lineItems,
      )) {
        const quantity = integer(l.quantity);
        if (quantity < 0) throw new ShopifyError("INVALID_QUANTITY");
        result.lines.push({
          id: gid(l.id),
          orderId,
          productId: l.product == null ? null : gid(object(l.product).id),
          variantId: l.variant == null ? null : gid(object(l.variant).id),
          title: string(l.title),
          quantity,
        });
      }
      for (const raw of array(o.refunds)) {
        const r = object(raw),
          amount = money(r.totalRefundedSet);
        if (amount.currency !== currency)
          throw new ShopifyError("CURRENCY_MISMATCH");
        result.refunds.push({
          id: gid(r.id),
          orderId,
          createdAt: timestamp(r.createdAt),
          currency: amount.currency,
          amount: amount.minor,
        });
      }
      for (const raw of array(o.fulfillments)) {
        const f = object(raw);
        result.fulfillments.push({
          id: gid(f.id),
          orderId,
          createdAt: timestamp(f.createdAt),
          status: string(f.status),
        });
      }
    }
    if (customers)
      for (const c of await this.collect("customers", "customers")) {
        const count = string(c.numberOfOrders);
        if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)))
          throw new ShopifyError("INVALID_CUSTOMER_COUNT");
        result.customers.push({
          id: gid(c.id),
          createdAt: timestamp(c.createdAt),
          orderCount: Number(count),
        });
      }
    // Catch referential inconsistencies caused by catalog changes during pagination.
    const products = new Set(result.products.map((p) => p.id));
    if (result.variants.some((v) => !products.has(v.productId)))
      throw new ShopifyError("CATALOG_CHANGED_DURING_SYNC");
    return result;
  }
}
