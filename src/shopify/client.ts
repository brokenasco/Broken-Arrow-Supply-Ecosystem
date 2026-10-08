import { setTimeout as delay } from "node:timers/promises";
import { queries, type QueryName } from "./queries.ts";
export class ShopifyError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export type Json = Record<string, unknown>;
export function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ShopifyError("INVALID_RESPONSE");
  return value as Json;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ShopifyError("INVALID_RESPONSE");
  return value;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || value.length > 10000)
    throw new ShopifyError("INVALID_RESPONSE");
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw new ShopifyError("INVALID_RESPONSE");
  return value;
}
export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ShopifyError("INVALID_RESPONSE");
  return value;
}
export function domain(value: string): string {
  const result = value.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(result) ||
    result.length > 253
  )
    throw new ShopifyError("INVALID_SHOP_DOMAIN");
  return result;
}
export type ShopifyConfig = {
  companyId: string;
  domain: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  customersEnabled: boolean;
};
export function environmentConfig(
  env: NodeJS.ProcessEnv = process.env,
): ShopifyConfig | null {
  if (
    env.SHOPIFY_ACCESS_TOKEN &&
    (env.SHOPIFY_CLIENT_ID || env.SHOPIFY_CLIENT_SECRET)
  )
    throw new ShopifyError("AMBIGUOUS_CREDENTIAL_CONFIGURATION");
  if (!env.SHOPIFY_COMPANY_ID || !env.SHOPIFY_SHOP_DOMAIN) return null;
  if (
    !env.SHOPIFY_ACCESS_TOKEN &&
    !(env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET)
  )
    return null;
  return {
    companyId: env.SHOPIFY_COMPANY_ID,
    domain: domain(env.SHOPIFY_SHOP_DOMAIN),
    accessToken: env.SHOPIFY_ACCESS_TOKEN,
    clientId: env.SHOPIFY_CLIENT_ID,
    clientSecret: env.SHOPIFY_CLIENT_SECRET,
    customersEnabled: env.SHOPIFY_CUSTOMERS_ENABLED === "true",
  };
}
export const API_VERSION = "2026-07";
export const BASE_SCOPES = ["read_products", "read_inventory", "read_orders"];
async function boundedJson(
  response: Response,
  maxBytes: number,
): Promise<Json> {
  if (!response.body) throw new ShopifyError("INVALID_RESPONSE");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ShopifyError("RESPONSE_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof ShopifyError) throw error;
    throw new ShopifyError("INVALID_RESPONSE");
  } finally {
    reader.releaseLock();
  }
}
export interface ReadClient {
  query(name: QueryName, variables: Json, signal: AbortSignal): Promise<Json>;
}
export class ShopifyClient implements ReadClient {
  #config: ShopifyConfig;
  #fetch: typeof fetch;
  #token?: { value: string; expires: number };
  #wait: (ms: number, signal: AbortSignal) => Promise<unknown>;
  constructor(
    config: ShopifyConfig,
    fetcher: typeof fetch = fetch,
    wait = (ms: number, signal: AbortSignal) =>
      delay(ms, undefined, { signal }),
  ) {
    this.#config = { ...config, domain: domain(config.domain) };
    this.#fetch = fetcher;
    this.#wait = wait;
  }
  async #request(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      });
    } catch {
      throw new ShopifyError(
        signal.aborted ? "SYNC_CANCELLED" : "NETWORK_OR_TIMEOUT",
      );
    }
  }
  async #credential(signal: AbortSignal): Promise<string> {
    if (this.#config.accessToken) return this.#config.accessToken;
    if (this.#token && this.#token.expires > Date.now() + 60000)
      return this.#token.value;
    if (!this.#config.clientId || !this.#config.clientSecret)
      throw new ShopifyError("INTEGRATION_REQUIRED");
    const response = await this.#request(
      `https://${this.#config.domain}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.#config.clientId,
          client_secret: this.#config.clientSecret,
        }).toString(),
      },
      signal,
    );
    if (!response.ok) throw new ShopifyError("TOKEN_EXCHANGE_FAILED");
    let data: Json;
    try {
      data = await boundedJson(response, 65536);
    } catch {
      throw new ShopifyError("INVALID_TOKEN_RESPONSE");
    }
    const expires = integer(data.expires_in);
    if (expires < 60 || expires > 86400)
      throw new ShopifyError("INVALID_TOKEN_RESPONSE");
    this.#token = {
      value: string(data.access_token),
      expires: Date.now() + expires * 1000,
    };
    return this.#token.value;
  }
  async query(
    name: QueryName,
    variables: Json,
    signal: AbortSignal,
  ): Promise<Json> {
    if (!Object.hasOwn(queries, name))
      throw new ShopifyError("QUERY_NOT_ALLOWED");
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      const token = await this.#credential(signal);
      const response = await this.#request(
        `https://${this.#config.domain}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify({ query: queries[name], variables }),
        },
        signal,
      );
      if (response.status === 401) {
        this.#token = undefined;
        throw new ShopifyError("AUTHENTICATION_FAILED");
      }
      if (response.status === 403) throw new ShopifyError("ACCESS_DENIED");
      if (response.status === 429 || response.status >= 500) {
        if (attempt === 2)
          throw new ShopifyError(
            response.status === 429 ? "THROTTLED" : "SHOPIFY_UNAVAILABLE",
          );
        const retry = Number(response.headers.get("retry-after") ?? 0);
        await this.#wait(
          Math.min(
            10000,
            Math.max(
              500 * 2 ** attempt,
              Number.isFinite(retry) ? retry * 1000 : 0,
            ),
          ),
          signal,
        );
        continue;
      }
      if (!response.ok) throw new ShopifyError("SHOPIFY_HTTP_ERROR");
      const served = response.headers.get("x-shopify-api-version");
      if (served && served !== API_VERSION)
        throw new ShopifyError("API_VERSION_MISMATCH");
      let data: Json;
      try {
        data = await boundedJson(response, 8 * 1024 * 1024);
      } catch {
        throw new ShopifyError("INVALID_RESPONSE");
      }
      if (data.errors) {
        const errors = array(data.errors);
        const throttled =
          errors.length > 0 &&
          errors.every(
            (e) => object(object(e).extensions ?? {}).code === "THROTTLED",
          );
        if (throttled && attempt < 2) {
          const ext = object(data.extensions ?? {}),
            cost = object(ext.cost ?? {}),
            status = object(cost.throttleStatus ?? {});
          const needed =
            Number(cost.requestedQueryCost ?? 100) -
            Number(status.currentlyAvailable ?? 0);
          const rate = Number(status.restoreRate ?? 50);
          await this.#wait(
            Math.min(
              10000,
              Math.max(1000, (needed / Math.max(rate, 1)) * 1000),
            ),
            signal,
          );
          continue;
        }
        // Never return Shopify's raw error text: it can echo private query data.
        throw new ShopifyError(throttled ? "THROTTLED" : "GRAPHQL_ERROR");
      }
      return object(data.data);
    }
    throw new ShopifyError("RETRY_EXHAUSTED");
  }
}
