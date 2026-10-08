export type ProviderResult<T> =
  | { ok: true; value: T; costCents: number; externalId: string }
  | {
      ok: false;
      code: "INTEGRATION REQUIRED" | "FAILED" | "RECONCILIATION REQUIRED";
      message: string;
    };
export interface Provider<I, O> {
  execute(input: I, signal: AbortSignal): Promise<ProviderResult<O>>;
}
export interface LLMProvider extends Provider<
  { messages: { role: string; content: string }[]; outputSchema: object },
  { proposal: unknown }
> {}
// Image adapters return bytes; the authenticated design service owns private
// persistence, approval consumption, budget reservations and QA state.
export type { ImageProvider as ImageGenerationProvider } from "./images.ts";
export type { PrintOnDemandProvider } from "./print.ts";
export interface EmailProvider extends Provider<
  { approvedCampaignId: string },
  { deliveryId: string }
> {}
export interface SearchProvider extends Provider<
  { query: string },
  { sources: { url: string; retrievedAt: string; text: string }[] }
> {}
export interface AnalyticsProvider extends Provider<
  { storeId: string; from: string; to: string },
  { metrics: Record<string, number | null> }
> {}
export interface SocialMediaProvider extends Provider<
  { approvedPostId: string },
  { postId: string }
> {}
export interface AdvertisingProvider extends Provider<
  { approvedCampaignId: string; budgetCents: number },
  { campaignId: string }
> {}
export interface StorageProvider extends Provider<
  { assetId: string; contentType: string },
  { location: string }
> {}
export class UnconfiguredProvider<I, O> implements Provider<I, O> {
  async execute(_input: I, _signal: AbortSignal): Promise<ProviderResult<O>> {
    return {
      ok: false,
      code: "INTEGRATION REQUIRED",
      message: "Configure and validate this provider before execution.",
    };
  }
}
