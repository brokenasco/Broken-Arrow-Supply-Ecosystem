import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.ts";
import { provision } from "../src/auth.ts";
import { CompanyService } from "../src/service.ts";
import {
  ShopifyService,
  shopifySummary,
  shopifyAnswer,
  shopifyConnection,
} from "../src/shopify/service.ts";
import {
  ShopifyClient,
  ShopifyError,
  domain,
  environmentConfig,
  BASE_SCOPES,
  API_VERSION,
  type Json,
  type ReadClient,
  type ShopifyConfig,
} from "../src/shopify/client.ts";
import { ShopifyReader, minorUnits } from "../src/shopify/read.ts";
import { queries, type QueryName } from "../src/shopify/queries.ts";
import { createApp } from "../src/server.ts";
import { startOfStoreWeek } from "../src/shopify/time.ts";

test("oversized and malformed provider responses cannot become successful reads", async () => {
  const config = {
    companyId: "c",
    domain: "fixture.myshopify.com",
    accessToken: "test-secret",
    customersEnabled: false,
  };
  const oversized = new ShopifyClient(
    config,
    async () => new Response("x".repeat(8 * 1024 * 1024 + 1)),
  );
  await assert.rejects(
    () => oversized.query("identity", {}, new AbortController().signal),
    /INVALID_RESPONSE/,
  );
  const malformed = new ShopifyClient(
    config,
    async () => new Response("{broken"),
  );
  await assert.rejects(
    () => malformed.query("identity", {}, new AbortController().signal),
    /INVALID_RESPONSE/,
  );
  assert.throws(
    () =>
      environmentConfig({
        SHOPIFY_COMPANY_ID: "c",
        SHOPIFY_SHOP_DOMAIN: config.domain,
        SHOPIFY_ACCESS_TOKEN: "token",
        SHOPIFY_CLIENT_ID: "client",
        SHOPIFY_CLIENT_SECRET: "secret",
      }),
    /AMBIGUOUS/,
  );
});

test("calendar-week boundaries follow store timezone across daylight saving changes", () => {
  assert.equal(
    startOfStoreWeek(new Date("2026-03-08T20:00:00Z"), "America/New_York"),
    "2026-03-02T05:00:00.000Z",
  );
  assert.equal(
    startOfStoreWeek(new Date("2026-03-09T20:00:00Z"), "America/New_York"),
    "2026-03-09T04:00:00.000Z",
  );
  assert.equal(
    startOfStoreWeek(new Date("2026-11-02T20:00:00Z"), "America/New_York"),
    "2026-11-02T05:00:00.000Z",
  );
});

const gid = (kind: string, n: number) => `gid://shopify/${kind}/${n}`;
const page = (nodes: unknown[], cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: !!cursor, endCursor: cursor },
});
const money = (amount: string) => ({
  shopMoney: { amount, currencyCode: "USD" },
});
function fixtureClient(): ReadClient & {
  calls: QueryName[];
  fail: QueryName | null;
  customers: boolean;
} {
  const calls: QueryName[] = [];
  return {
    calls,
    fail: null,
    customers: false,
    async query(name: QueryName, variables: Json) {
      calls.push(name);
      if (this.fail === name) throw new ShopifyError("SHOPIFY_UNAVAILABLE");
      const today = new Date().toISOString(),
        old = new Date(Date.now() - 15 * 86400000).toISOString(),
        recent = new Date(Date.now() - 86400000).toISOString();
      const order = (n: number, test = false, cancelled = false) => ({
        id: gid("Order", n),
        createdAt: recent,
        updatedAt: today,
        cancelledAt: cancelled ? recent : null,
        test,
        displayFinancialStatus: "PAID",
        displayFulfillmentStatus: "FULFILLED",
        currentTotalPriceSet: money("25.10"),
        totalRefundedSet: money("5.00"),
        lineItems: page(
          [
            {
              id: gid("LineItem", n),
              title: "Example shirt",
              quantity: 2,
              product: { id: gid("Product", 1) },
              variant: { id: gid("ProductVariant", 1) },
            },
          ],
          n === 1 ? "line-next" : null,
        ),
        refunds: [
          {
            id: gid("Refund", n),
            createdAt: recent,
            totalRefundedSet: money("5.00"),
          },
        ],
        fulfillments: [
          { id: gid("Fulfillment", n), status: "SUCCESS", createdAt: recent },
        ],
      });
      switch (name) {
        case "identity":
          return {
            shop: {
              name: "Synthetic fixture store",
              myshopifyDomain: "fixture.myshopify.com",
              currencyCode: "USD",
              ianaTimezone: "America/New_York",
            },
            currentAppInstallation: {
              accessScopes: [
                ...BASE_SCOPES,
                ...(this.customers ? ["read_customers"] : []),
              ].map((handle) => ({ handle })),
            },
          };
        case "products":
          return {
            products: page(
              [
                {
                  id: gid("Product", variables.cursor ? 2 : 1),
                  title: variables.cursor ? "Quiet product" : "Example shirt",
                  status: "ACTIVE",
                  createdAt: old,
                  updatedAt: today,
                },
              ],
              variables.cursor ? null : "product-next",
            ),
          };
        case "variants":
          return {
            productVariants: page([
              {
                id: gid("ProductVariant", 1),
                title: "Medium",
                sku: "SHIRT-M",
                product: { id: gid("Product", 1) },
                inventoryItem: { id: gid("InventoryItem", 1) },
              },
            ]),
          };
        case "inventory":
          return {
            inventoryItems: page([
              {
                id: gid("InventoryItem", 1),
                tracked: true,
                inventoryLevels: page(
                  [
                    {
                      location: { id: gid("Location", 1), name: "A" },
                      quantities: [{ name: "available", quantity: 1 }],
                    },
                  ],
                  "level-next",
                ),
              },
            ]),
          };
        case "levels":
          return {
            inventoryItem: {
              inventoryLevels: page([
                {
                  location: { id: gid("Location", 2), name: "B" },
                  quantities: [{ name: "available", quantity: 2 }],
                },
              ]),
            },
          };
        case "orders":
          return {
            orders: page([order(1), order(2, true), order(3, false, true)]),
          };
        case "lines":
          return {
            order: {
              lineItems: page([
                {
                  id: gid("LineItem", 4),
                  title: "Example shirt",
                  quantity: 1,
                  product: { id: gid("Product", 1) },
                  variant: { id: gid("ProductVariant", 1) },
                },
              ]),
            },
          };
        case "customers":
          return {
            customers: page([
              { id: gid("Customer", 1), createdAt: old, numberOfOrders: "3" },
            ]),
          };
      }
    },
  };
}
function fixture() {
  const db = openDatabase(":memory:");
  const account = provision(
    db,
    "phase2@example.test",
    "long-test-password-phase2",
    "Synthetic Phase 2 tests",
  );
  const p = { id: account.user, company_id: account.company, role: "CEO" };
  const client = fixtureClient();
  const config: ShopifyConfig = {
    companyId: account.company,
    domain: "fixture.myshopify.com",
    accessToken: "test-only-token-never-real",
    customersEnabled: false,
  };
  const deps = { config: () => config, client: () => client };
  const service = new ShopifyService(db, p, deps);
  return {
    db,
    p,
    client,
    config,
    deps,
    service,
    authorize: () =>
      service.authorize({
        domain: config.domain,
        customerAccess: false,
        authorizeReadAccess: true,
      }),
  };
}

test("Shopify target validation prevents arbitrary hosts, redirects and unconfigured access", () => {
  assert.equal(domain(" Fixture.myshopify.com "), "fixture.myshopify.com");
  for (const value of [
    "localhost",
    "https://fixture.myshopify.com",
    "fixture.myshopify.com.evil.test",
    "fixture.myshopify.com/path",
    "user@fixture.myshopify.com",
  ])
    assert.throws(() => domain(value));
  assert.equal(environmentConfig({}), null);
  assert.equal(
    environmentConfig({
      SHOPIFY_COMPANY_ID: "c",
      SHOPIFY_SHOP_DOMAIN: "fixture.myshopify.com",
    }),
    null,
  );
  const f = fixture();
  try {
    assert.throws(
      () =>
        new ShopifyService(f.db, f.p, { config: () => null }).authorize({
          domain: f.config.domain,
          customerAccess: false,
          authorizeReadAccess: true,
        }),
      /INTEGRATION REQUIRED/,
    );
    assert.throws(
      () =>
        f.service.authorize({
          domain: f.config.domain,
          customerAccess: false,
          authorizeReadAccess: false,
        }),
      /authorization/,
    );
    assert.throws(
      () =>
        f.service.authorize({
          domain: "other.myshopify.com",
          customerAccess: false,
          authorizeReadAccess: true,
        }),
      /match/,
    );
  } finally {
    f.db.close();
  }
});
test("sync normalizes all pages and resources, excludes test/cancelled orders from metrics, and records provenance", async () => {
  const f = fixture();
  try {
    f.authorize();
    const result = await f.service.sync();
    assert.equal(result.counts.products, 2);
    assert.equal(result.counts.orders, 3);
    assert.equal(result.counts.inventory, 2);
    assert.equal(result.counts.refunds, 3);
    assert.equal(result.counts.fulfillments, 3);
    assert.ok(f.client.calls.includes("lines"));
    assert.ok(f.client.calls.includes("levels"));
    assert.ok(!f.client.calls.includes("customers"));
    const s = shopifySummary(f.db, f.p.company_id);
    assert.equal(s.connection?.status, "READY");
    assert.equal(s.data?.orderCount, 1);
    assert.equal(s.data?.currentOrderTotalMinor, 2510);
    assert.equal(s.data?.topProducts[0].units, 3);
    assert.equal(s.data?.lowInventory[0].available, 3);
    assert.equal(s.data?.zeroSalesProducts[0].title, "Quiet product");
    assert.equal(s.data?.stale, false);
    assert.match(
      shopifyAnswer(
        f.db,
        f.p.company_id,
        "What sold best in the last 7 days?",
      )!,
      /3 units ordered/,
    );
    assert.match(
      shopifyAnswer(f.db, f.p.company_id, "What products are low?")!,
      /3 available/,
    );
    assert.match(
      shopifyAnswer(f.db, f.p.company_id, "What is underperforming?")!,
      /not proven underperformance/,
    );
    assert.match(
      shopifyAnswer(f.db, f.p.company_id, "How many orders were placed?")!,
      /1 non-test/,
    );
    assert.equal(
      f.db
        .prepare(
          "SELECT COUNT(*) n FROM audit_logs WHERE action='shopify.sync_completed'",
        )
        .get()?.n,
      1,
    );
    assert.equal(
      f.db
        .prepare("SELECT mode FROM stores WHERE id=?")
        .get(s.connection!.storeId)?.mode,
      "LIVE",
    );
    assert.equal(
      f.db.prepare("SELECT mode FROM companies").get()?.mode,
      "DEMO",
    );
  } finally {
    f.db.close();
  }
});
test("repeated full sync replaces cache without duplicating orders or refund records", async () => {
  const f = fixture();
  try {
    f.authorize();
    await f.service.sync();
    await f.service.sync();
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_orders").get()?.n,
      3,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_refunds").get()?.n,
      3,
    );
    assert.equal(shopifySummary(f.db, f.p.company_id).runs.length, 2);
  } finally {
    f.db.close();
  }
});
test("failed read and failed database commit preserve the entire prior snapshot", async () => {
  const f = fixture();
  try {
    f.authorize();
    await f.service.sync();
    const success = shopifyConnection(f.db, f.p.company_id)?.last_success_at;
    f.client.fail = "orders";
    await assert.rejects(() => f.service.sync(), /SHOPIFY_UNAVAILABLE/);
    assert.equal(
      shopifyConnection(f.db, f.p.company_id)?.last_success_at,
      success,
    );
    assert.equal(shopifySummary(f.db, f.p.company_id).data?.counts.orders, 3);
    assert.equal(shopifySummary(f.db, f.p.company_id).data?.stale, true);
    f.client.fail = null;
    f.db.exec(
      "CREATE TRIGGER reject_snapshot BEFORE INSERT ON shopify_orders BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END;",
    );
    await assert.rejects(() => f.service.sync(), /SYNC_FAILED/);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_products").get()?.n,
      2,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_orders").get()?.n,
      3,
    );
  } finally {
    f.db.close();
  }
});
test("scope checks reject missing scopes, excess scopes and a mismatched store before reading business data", async () => {
  for (const mode of ["missing", "extra", "domain"]) {
    const f = fixture();
    try {
      const original = f.client.query.bind(f.client);
      f.client.query = async (name, vars, signal) => {
        const value = await original(name, vars, signal);
        if (name === "identity") {
          if (mode === "domain")
            (value.shop as Json).myshopifyDomain = "other.myshopify.com";
          else
            (value.currentAppInstallation as Json).accessScopes = (
              mode === "extra"
                ? [...BASE_SCOPES, "write_products"]
                : ["read_products"]
            ).map((handle) => ({ handle }));
        }
        return value;
      };
      f.authorize();
      await assert.rejects(
        () => f.service.sync(),
        new RegExp(
          mode === "missing"
            ? "MISSING_SCOPES"
            : mode === "extra"
              ? "EXCESS_SCOPES"
              : "STORE_IDENTITY_MISMATCH",
        ),
      );
      assert.deepEqual(f.client.calls, ["identity"]);
      assert.equal(shopifySummary(f.db, f.p.company_id).data, null);
    } finally {
      f.db.close();
    }
  }
});
test("customer data requires both server opt-in and CEO authorization; disabling access clears cached summaries", async () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.service.authorize({
          domain: f.config.domain,
          customerAccess: true,
          authorizeReadAccess: true,
        }),
      /disabled/,
    );
    f.config.customersEnabled = true;
    f.client.customers = true;
    f.service.authorize({
      domain: f.config.domain,
      customerAccess: true,
      authorizeReadAccess: true,
    });
    await f.service.sync();
    assert.ok(f.client.calls.includes("customers"));
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_customers").get()?.n,
      1,
    );
    f.authorize();
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_customers").get()?.n,
      0,
    );
    assert.doesNotMatch(
      queries.customers,
      /email|phone|address|firstName|lastName/,
    );
  } finally {
    f.db.close();
  }
});
test("tenant ownership and authenticated human identity are enforced for connection controls", async () => {
  const f = fixture();
  try {
    f.authorize();
    await f.service.sync();
    const other = provision(
      f.db,
      "other-phase2@example.test",
      "other-long-phase2-password",
      "Other tenant",
    );
    const p = { id: other.user, company_id: other.company, role: "CEO" };
    assert.equal(shopifySummary(f.db, p.company_id).data, null);
    assert.throws(
      () => new ShopifyService(f.db, { ...f.p, id: "boris" }),
      /CEO/,
    );
    assert.throws(
      () =>
        new ShopifyService(f.db, p, f.deps).authorize({
          domain: f.config.domain,
          customerAccess: false,
          authorizeReadAccess: true,
        }),
      /INTEGRATION REQUIRED/,
    );
    assert.equal(new CompanyService(f.db, p).state().shopify.runs.length, 0);
  } finally {
    f.db.close();
  }
});
test("emergency stop and disconnect during an in-flight read prevent snapshot commit", async () => {
  for (const action of ["stop", "disconnect"]) {
    const f = fixture();
    try {
      f.authorize();
      const original = f.client.query.bind(f.client);
      f.client.query = async (name, vars, signal) => {
        const result = await original(name, vars, signal);
        if (name === "orders") {
          if (action === "stop")
            new CompanyService(f.db, f.p).control("company", "company", true);
          else f.service.disconnect();
        }
        return result;
      };
      await assert.rejects(
        () => f.service.sync(),
        /COMPANY_PAUSED|SYNC_CANCELLED/,
      );
      assert.equal(shopifySummary(f.db, f.p.company_id).data, null);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) n FROM shopify_orders").get()?.n,
        0,
      );
      if (action === "stop")
        await assert.rejects(() => f.service.sync(), /paused/);
      else
        assert.equal(
          shopifyConnection(f.db, f.p.company_id)?.status,
          "DISCONNECTED",
        );
    } finally {
      f.db.close();
    }
  }
});
test("concurrent sync is denied by durable lease and expired lease recovers visibly", async () => {
  const f = fixture();
  try {
    f.authorize();
    f.db
      .prepare(
        "UPDATE shopify_connections SET status='SYNCING',active_run='old',lease_until=? WHERE company_id=?",
      )
      .run(Date.now() + 10000, f.p.company_id);
    await assert.rejects(() => f.service.sync(), /already running/);
    f.db
      .prepare(
        "UPDATE shopify_connections SET lease_until=0 WHERE company_id=?",
      )
      .run(f.p.company_id);
    await f.service.sync();
    assert.equal(shopifyConnection(f.db, f.p.company_id)?.status, "READY");
  } finally {
    f.db.close();
  }
});
test("malformed money, pagination loops and inconsistent currency fail closed", async () => {
  assert.equal(minorUnits("12.34", "USD"), 1234);
  assert.equal(minorUnits("125", "JPY"), 125);
  assert.equal(minorUnits("1.234", "KWD"), 1234);
  assert.throws(() => minorUnits("1.001", "USD"), /MONEY_PRECISION/);
  assert.throws(() => minorUnits("9007199254740992", "JPY"), /MONEY_OVERFLOW/);
  assert.throws(() => minorUnits("-1", "USD"), /INVALID_MONEY/);
  const looping: ReadClient = {
    query: async () => ({ products: page([], "same") }),
  };
  await assert.rejects(
    () =>
      new ShopifyReader(looping, new AbortController().signal).collect(
        "products",
        "products",
      ),
    /PAGINATION_LOOP/,
  );
  const f = fixture();
  try {
    const original = f.client.query.bind(f.client);
    f.client.query = async (name, vars, signal) => {
      const value = await original(name, vars, signal);
      if (name === "orders") {
        const o = ((value.orders as Json).nodes as Json[])[0];
        ((o.currentTotalPriceSet as Json).shopMoney as Json).currencyCode =
          "EUR";
      }
      return value;
    };
    f.authorize();
    await assert.rejects(() => f.service.sync(), /CURRENCY_MISMATCH/);
  } finally {
    f.db.close();
  }
});
test("disconnected and stale snapshots do not masquerade as fresh live state", async () => {
  const f = fixture();
  try {
    assert.match(
      shopifyAnswer(f.db, f.p.company_id, "What sold best?")!,
      /INTEGRATION REQUIRED/,
    );
    f.authorize();
    await f.service.sync();
    const future = new Date(Date.now() + 86400000);
    assert.equal(
      shopifySummary(f.db, f.p.company_id, future).data?.stale,
      true,
    );
    assert.equal(
      shopifySummary(f.db, f.p.company_id, future).data?.todayOrders,
      null,
    );
    f.service.disconnect();
    assert.equal(shopifySummary(f.db, f.p.company_id).data, null);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM shopify_orders").get()?.n,
      3,
    );
  } finally {
    f.db.close();
  }
});
test("client uses pinned read-only queries, blocks arbitrary operations, and never follows credential redirects", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    seen.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ data: { shop: {} } }), {
      headers: { "x-shopify-api-version": API_VERSION },
    });
  };
  const client = new ShopifyClient(
    {
      companyId: "c",
      domain: "fixture.myshopify.com",
      accessToken: "test-secret",
      customersEnabled: false,
    },
    fetcher,
  );
  await client.query("identity", {}, new AbortController().signal);
  assert.match(seen[0].url, /\/2026-07\/graphql.json$/);
  assert.equal(seen[0].init.redirect, "error");
  assert.equal(
    (seen[0].init.headers as Record<string, string>)["X-Shopify-Access-Token"],
    "test-secret",
  );
  for (const query of Object.values(queries)) assert.match(query, /^query /);
  await assert.rejects(
    () =>
      client.query("mutation" as QueryName, {}, new AbortController().signal),
    /QUERY_NOT_ALLOWED/,
  );
});
test("transport retries throttles but redacts raw errors and rejects version drift", async () => {
  let calls = 0;
  const waits: number[] = [];
  const config = {
    companyId: "c",
    domain: "fixture.myshopify.com",
    accessToken: "test-secret",
    customersEnabled: false,
  };
  const client = new ShopifyClient(
    config,
    async () =>
      ++calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "1" } })
        : new Response(JSON.stringify({ data: { shop: {} } })),
    async (ms) => {
      waits.push(ms);
    },
  );
  await client.query("identity", {}, new AbortController().signal);
  assert.equal(calls, 2);
  assert.equal(waits[0], 1000);
  const bad = new ShopifyClient(
    config,
    async () =>
      new Response(
        JSON.stringify({
          data: { partial: "discard" },
          errors: [{ message: "private customer email / test-secret" }],
        }),
      ),
  );
  await assert.rejects(
    () => bad.query("identity", {}, new AbortController().signal),
    (e) =>
      e instanceof ShopifyError &&
      e.code === "GRAPHQL_ERROR" &&
      !e.message.includes("private"),
  );
  const drift = new ShopifyClient(
    config,
    async () =>
      new Response("{}", { headers: { "x-shopify-api-version": "2027-01" } }),
  );
  await assert.rejects(
    () => drift.query("identity", {}, new AbortController().signal),
    /API_VERSION_MISMATCH/,
  );
  const auth = new ShopifyClient(
    config,
    async () => new Response("{}", { status: 401 }),
  );
  await assert.rejects(
    () => auth.query("identity", {}, new AbortController().signal),
    /AUTHENTICATION_FAILED/,
  );
});
test("client credentials are exchanged server-side and cached only in client memory", async () => {
  let tokenCalls = 0,
    queryCalls = 0;
  const client = new ShopifyClient(
    {
      companyId: "c",
      domain: "fixture.myshopify.com",
      clientId: "test-id",
      clientSecret: "test-secret",
      customersEnabled: false,
    },
    async (url, init) => {
      if (String(url).endsWith("/access_token")) {
        tokenCalls++;
        assert.match(String(init?.body), /grant_type=client_credentials/);
        return new Response(
          JSON.stringify({ access_token: "ephemeral-test", expires_in: 86399 }),
        );
      }
      queryCalls++;
      return new Response(JSON.stringify({ data: { shop: {} } }));
    },
  );
  await client.query("identity", {}, new AbortController().signal);
  await client.query("identity", {}, new AbortController().signal);
  assert.equal(tokenCalls, 1);
  assert.equal(queryCalls, 2);
  assert.doesNotMatch(JSON.stringify(client), /test-secret|ephemeral/);
});
test("Shopify API routes require session, CSRF and explicit authorization and expose no credentials", async () => {
  const f = fixture(),
    origin = "http://127.0.0.1:3100",
    app = createApp(f.db, origin, false, f.deps);
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const post = (
    path: string,
    body: object,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/api/shopify/sync", {})).status, 401);
    const response = await post("/api/login", {
      email: "phase2@example.test",
      password: "long-test-password-phase2",
    });
    const cookie = response.headers.get("set-cookie")!.split(";")[0],
      login = (await response.json()) as { csrf: string };
    const headers = { Cookie: cookie, "X-CSRF-Token": login.csrf };
    assert.equal(
      (await post("/api/shopify/sync", {}, { Cookie: cookie })).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/api/shopify/authorize",
          {
            domain: f.config.domain,
            customerAccess: false,
            authorizeReadAccess: true,
          },
          headers,
        )
      ).status,
      200,
    );
    assert.equal((await post("/api/shopify/sync", {}, headers)).status, 200);
    const state = await (
      await fetch(base + "/api/state", { headers: { Cookie: cookie } })
    ).text();
    assert.doesNotMatch(state, /test-only-token-never-real/);
    assert.match(state, /LIVE_SHOPIFY/);
    const answer = (await (
      await post(
        "/api/chat",
        { message: "How many orders were placed?" },
        headers,
      )
    ).json()) as { reply: string };
    assert.match(answer.reply, /1 non-test/);
    assert.equal(
      (await post("/api/shopify/disconnect", {}, headers)).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    f.db.close();
  }
});

test("Phase 3 captures complete days, isolates currency, and preserves history on failed sync", async () => {
  const { analyticsState } = await import("../src/analytics.ts");
  const f = fixture();
  try {
    f.authorize();
    await f.service.sync();
    const first = analyticsState(f.db, f.p.company_id);
    assert.ok(first.data);
    assert.ok(first.data.days.length >= 28);
    assert.equal(first.data.month.previous.complete, false);
    await f.service.sync();
    const original = JSON.stringify(
      analyticsState(f.db, f.p.company_id).data?.days,
    );
    assert.equal(
      analyticsState(f.db, f.p.company_id).data?.days.length,
      first.data.days.length,
    );
    f.db.exec(
      "CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_days BEGIN SELECT RAISE(ABORT,'blocked'); END;",
    );
    await assert.rejects(() => f.service.sync());
    assert.equal(
      JSON.stringify(
        analyticsState(f.db, f.p.company_id).data?.days.map((d) => ({
          ...d,
          source_run: "",
        })),
      ),
      JSON.stringify(
        JSON.parse(original).map((d: any) => ({ ...d, source_run: "" })),
      ),
    );
    f.db
      .prepare(
        "UPDATE shopify_connections SET currency='EUR' WHERE company_id=?",
      )
      .run(f.p.company_id);
    assert.equal(analyticsState(f.db, f.p.company_id).data?.days.length, 0);
    f.service.disconnect();
    assert.equal(analyticsState(f.db, f.p.company_id).data, null);
  } finally {
    f.db.close();
  }
});

test("Phase 3 reports retain evidence and stop controls gate analysis", async () => {
  const { AnalyticsService, analyticsState } =
    await import("../src/analytics.ts");
  const f = fixture();
  try {
    const a = new AnalyticsService(f.db, f.p);
    assert.throws(() => a.report(), /Sync/);
    f.authorize();
    await f.service.sync();
    const r = a.report();
    assert.ok(r.id);
    assert.equal(analyticsState(f.db, f.p.company_id).reports.length, 1);
    f.db
      .prepare(
        "UPDATE agents SET paused=1 WHERE company_id=? AND id='benjamin'",
      )
      .run(f.p.company_id);
    assert.throws(() => a.report(), /paused/);
    assert.throws(
      () => new AnalyticsService(f.db, { ...f.p, id: "fake" }),
      /authority/,
    );
    assert.equal(analyticsState(f.db, "other").reports.length, 0);
  } finally {
    f.db.close();
  }
});

test("Phase 3 anomaly thresholds require coverage, volume and fresh data; monthly coverage accumulates", async () => {
  const { analyticsState, localDay, shiftDay } =
    await import("../src/analytics.ts");
  const f = fixture();
  try {
    f.authorize();
    await f.service.sync();
    const c = shopifyConnection(f.db, f.p.company_id)!;
    const today = localDay(c.window_end!, c.timezone!);
    f.db
      .prepare(
        "UPDATE analytics_days SET orders=10,value_minor=1000 WHERE company_id=?",
      )
      .run(f.p.company_id);
    f.db
      .prepare(
        "UPDATE analytics_days SET orders=0 WHERE company_id=? AND day=?",
      )
      .run(f.p.company_id, shiftDay(today, -1));
    assert.equal(analyticsState(f.db, f.p.company_id).data?.findings.length, 1);
    assert.equal(
      analyticsState(
        f.db,
        f.p.company_id,
        new Date(Date.parse(c.window_end!) + 7200000),
      ).data?.findings.length,
      0,
    );
    f.db
      .prepare("UPDATE analytics_days SET orders=1 WHERE company_id=?")
      .run(f.p.company_id);
    assert.equal(
      analyticsState(f.db, f.p.company_id).data?.anomalyEligible,
      false,
    );
    const run = f.db
      .prepare("SELECT id FROM shopify_sync_runs WHERE company_id=?")
      .get(f.p.company_id)!;
    const month = today.slice(0, 7) + "-01",
      prev = shiftDay(month, -1).slice(0, 7) + "-01",
      prior = shiftDay(prev, -1).slice(0, 7) + "-01";
    for (let d = prior; d < month; d = shiftDay(d, 1))
      f.db
        .prepare(
          "INSERT OR REPLACE INTO analytics_days VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          f.p.company_id,
          c.store_id,
          c.currency!,
          c.timezone!,
          d,
          10,
          1000,
          String(run.id),
          c.window_end!,
        );
    assert.equal(
      analyticsState(f.db, f.p.company_id).data?.month.previous.complete,
      true,
    );
    assert.equal(
      analyticsState(f.db, f.p.company_id).data?.month.current.complete,
      true,
    );
    f.db
      .prepare("DELETE FROM analytics_days WHERE company_id=? AND day=?")
      .run(f.p.company_id, prior);
    assert.equal(
      analyticsState(f.db, f.p.company_id).data?.month.previous.orders,
      null,
    );
  } finally {
    f.db.close();
  }
});
