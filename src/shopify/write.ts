import { API_VERSION, domain, object, array, string } from "./client.ts";
import { minorUnits } from "./read.ts";
export type DraftInput = {
  title: string;
  descriptionHtml: string;
  handle: string;
  status: "DRAFT";
  vendor: string;
  productType: string;
  tags: string[];
  seo: { title: string; description: string };
  collections: string[];
  productOptions: {
    name: string;
    position: number;
    values: { name: string }[];
  }[];
  variants: {
    optionValues: { optionName: string; name: string }[];
    price: string;
    sku: string;
    inventoryPolicy: "DENY";
  }[];
};
export type WriteConfig = {
  companyId: string;
  domain: string;
  accessToken: string;
};
export type Identity = { domain: string; currency: string; scopes: string[] };
export type RemoteDraft = {
  id: string;
  handle: string;
  status: string;
  tags: string[];
  variants: {
    sku: string;
    price: string;
    selectedOptions: { name: string; value: string }[];
  }[];
};
export interface DraftWriter {
  identity(signal: AbortSignal): Promise<Identity>;
  collections(
    ids: string[],
    signal: AbortSignal,
  ): Promise<{ id: string; title: string; manual: boolean }[]>;
  lookup(handle: string, signal: AbortSignal): Promise<RemoteDraft | null>;
  create(input: DraftInput, signal: AbortSignal): Promise<RemoteDraft>;
}
export function writeConfig(
  env: NodeJS.ProcessEnv = process.env,
): WriteConfig | null {
  if (
    env.SHOPIFY_DRAFT_WRITES_ENABLED !== "true" ||
    !env.SHOPIFY_WRITE_COMPANY_ID ||
    !env.SHOPIFY_WRITE_SHOP_DOMAIN ||
    !env.SHOPIFY_WRITE_ACCESS_TOKEN
  )
    return null;
  return {
    companyId: env.SHOPIFY_WRITE_COMPANY_ID,
    domain: domain(env.SHOPIFY_WRITE_SHOP_DOMAIN),
    accessToken: env.SHOPIFY_WRITE_ACCESS_TOKEN,
  };
}
const fields =
  "id handle status tags variants(first:25) { nodes { sku price selectedOptions { name value } } pageInfo { hasNextPage } }";
export const draftQueries = {
  identity:
    "query DraftIdentity { shop { myshopifyDomain currencyCode } currentAppInstallation { accessScopes { handle } } }",
  collections:
    "query DraftCollections($ids:[ID!]!) { nodes(ids:$ids) { ... on Collection { id title ruleSet { appliedDisjunctively } } } }",
  lookup: `query DraftLookup($handle:String!) { productByIdentifier(identifier:{handle:$handle}) { ${fields} } }`,
  create: `mutation CompanyCreateDraft($input:ProductSetInput!) { productSet(input:$input,synchronous:true) { product { ${fields} } userErrors { code field } } }`,
} as const;
export function validateIdentity(identity: Identity, expectedDomain: string) {
  if (
    identity.domain !== expectedDomain ||
    !/^[A-Z]{3}$/.test(identity.currency) ||
    !identity.scopes.includes("write_products") ||
    identity.scopes.some(
      (s) => !["write_products", "read_products"].includes(s),
    )
  )
    throw new Error("WRITE_IDENTITY_OR_SCOPES_REJECTED");
}
function remote(value: unknown): RemoteDraft {
  const p = object(value),
    v = object(p.variants);
  if (
    object(v.pageInfo).hasNextPage !== false ||
    !/^gid:\/\/shopify\/Product\/\d+$/.test(string(p.id))
  )
    throw new Error("INVALID_DRAFT_RESPONSE");
  return {
    id: string(p.id),
    handle: string(p.handle),
    status: string(p.status),
    tags: array(p.tags).map(string),
    variants: array(v.nodes).map((v) => {
      const r = object(v);
      return {
        sku: string(r.sku),
        price: string(r.price),
        selectedOptions: array(r.selectedOptions).map((o) => {
          const x = object(o);
          return { name: string(x.name), value: string(x.value) };
        }),
      };
    }),
  };
}
export function matchesDraft(
  actual: RemoteDraft,
  expected: DraftInput,
  currency: string,
) {
  return (
    actual.status === "DRAFT" &&
    actual.handle === expected.handle &&
    expected.tags.every((t) => actual.tags.includes(t)) &&
    actual.variants.length === expected.variants.length &&
    expected.variants.every((v) =>
      actual.variants.some(
        (a) =>
          a.sku === v.sku &&
          minorUnits(a.price, currency) === minorUnits(v.price, currency) &&
          a.selectedOptions.length === v.optionValues.length &&
          v.optionValues.every((o) =>
            a.selectedOptions.some(
              (s) => s.name === o.optionName && s.value === o.name,
            ),
          ),
      ),
    )
  );
}
export class ShopifyDraftWriter implements DraftWriter {
  #config: WriteConfig;
  #fetch: typeof fetch;
  constructor(config: WriteConfig, transport: typeof fetch = fetch) {
    this.#config = { ...config, domain: domain(config.domain) };
    this.#fetch = transport;
  }
  async #request(
    name: keyof typeof draftQueries,
    variables: object,
    signal: AbortSignal,
  ) {
    const r = await this.#fetch(
      `https://${this.#config.domain}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.#config.accessToken,
        },
        body: JSON.stringify({ query: draftQueries[name], variables }),
      },
    );
    if (
      !r.ok ||
      r.headers.get("x-shopify-api-version") !== API_VERSION ||
      !r.body
    )
      throw new Error("SHOPIFY_DRAFT_REQUEST_FAILED");
    const reader = r.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024)
          throw new Error("SHOPIFY_DRAFT_RESPONSE_TOO_LARGE");
        parts.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const json = object(JSON.parse(Buffer.concat(parts).toString("utf8")));
    if (json.errors) throw new Error("SHOPIFY_DRAFT_GRAPHQL_FAILED");
    return object(json.data);
  }
  async identity(signal: AbortSignal) {
    const r = await this.#request("identity", {}, signal),
      shop = object(r.shop);
    return {
      domain: string(shop.myshopifyDomain),
      currency: string(shop.currencyCode),
      scopes: array(object(r.currentAppInstallation).accessScopes).map((s) =>
        string(object(s).handle),
      ),
    };
  }
  async collections(ids: string[], signal: AbortSignal) {
    if (!ids.length) return [];
    const r = await this.#request("collections", { ids }, signal);
    return array(r.nodes).map((n) => {
      const c = object(n);
      return {
        id: string(c.id),
        title: string(c.title),
        manual: c.ruleSet === null,
      };
    });
  }
  async lookup(handle: string, signal: AbortSignal) {
    const r = await this.#request("lookup", { handle }, signal);
    return r.productByIdentifier === null
      ? null
      : remote(r.productByIdentifier);
  }
  async create(input: DraftInput, signal: AbortSignal) {
    // Never accept arbitrary GraphQL, existing product identifiers or publish flags.
    const keys = [
      "title",
      "descriptionHtml",
      "handle",
      "status",
      "vendor",
      "productType",
      "tags",
      "seo",
      "collections",
      "productOptions",
      "variants",
    ];
    if (
      input.status !== "DRAFT" ||
      Object.keys(input).some((k) => !keys.includes(k)) ||
      !/^company-os-[a-f0-9-]{36}$/.test(input.handle) ||
      !input.variants.length ||
      input.variants.length > 20
    )
      throw new Error("INVALID_DRAFT_INPUT");
    const exact = (value: object, allowed: string[]) =>
      Object.keys(value).every((k) => allowed.includes(k));
    if (
      !exact(input.seo, ["title", "description"]) ||
      input.productOptions.some(
        (o) =>
          !exact(o, ["name", "position", "values"]) ||
          o.values.some((v) => !exact(v, ["name"])),
      ) ||
      input.variants.some(
        (v) =>
          !exact(v, ["optionValues", "price", "sku", "inventoryPolicy"]) ||
          v.inventoryPolicy !== "DENY" ||
          v.optionValues.some((o) => !exact(o, ["optionName", "name"])),
      )
    )
      throw new Error("INVALID_DRAFT_INPUT");
    const r = object(
      (await this.#request("create", { input }, signal)).productSet,
    );
    if (array(r.userErrors).length)
      throw new Error("SHOPIFY_DRAFT_USER_ERRORS");
    return remote(r.product);
  }
}
