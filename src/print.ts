// Print fulfillment is a separate provider boundary. Phase 6 never submits orders.
export interface PrintOnDemandProvider {
  readonly name: string;
  quote(
    input: { templateId: string; variant: string; quantity: number },
    signal: AbortSignal,
  ): Promise<
    | {
        available: true;
        unitCostMinor: number;
        currency: string;
        expiresAt: string;
        evidence: string;
      }
    | { available: false; reason: "INTEGRATION REQUIRED" }
  >;
  productionPackage(
    input: { assetId: string; templateId: string },
    signal: AbortSignal,
  ): Promise<
    | { available: true; reference: string }
    | { available: false; reason: "INTEGRATION REQUIRED" }
  >;
}
export class UnconfiguredPrintProvider implements PrintOnDemandProvider {
  name = "UNCONFIGURED";
  async quote() {
    return {
      available: false as const,
      reason: "INTEGRATION REQUIRED" as const,
    };
  }
  async productionPackage() {
    return {
      available: false as const,
      reason: "INTEGRATION REQUIRED" as const,
    };
  }
}
