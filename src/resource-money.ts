import { DomainError } from "./policy.ts";
export const USD = 1_000_000;
export function dollars(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(value)
  )
    throw new DomainError(
      "USD amount must be a decimal string with up to six decimal places",
    );
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * USD + Number(fraction.padEnd(6, "0"));
}
export function dollarText(micros: number) {
  return (micros / USD).toFixed(6);
}
export type Usage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  toolCalls: number;
};
export function usage(value: Record<string, unknown>): Usage {
  const result = {} as Usage;
  for (const key of [
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
    "toolCalls",
  ] as const) {
    const n = value[key] ?? 0;
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > 1_000_000_000
    )
      throw new DomainError("Invalid usage count");
    result[key] = n;
  }
  if (result.cachedInputTokens > result.inputTokens)
    throw new DomainError("Cached input is a subset of total input");
  return result;
}
export function calculateCost(price: Record<string, any>, counts: Usage) {
  const u = usage(counts);
  const numerator =
    BigInt(u.inputTokens - u.cachedInputTokens) *
      BigInt(price.input_micros_per_million) +
    BigInt(u.cachedInputTokens) * BigInt(price.cached_micros_per_million) +
    BigInt(u.outputTokens) * BigInt(price.output_micros_per_million) +
    BigInt(u.reasoningTokens) * BigInt(price.reasoning_micros_per_million);
  const total =
    (numerator + 999_999n) / 1_000_000n +
    BigInt(price.request_micros) +
    BigInt(u.toolCalls) * BigInt(price.tool_micros);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new DomainError("Cost exceeds safe accounting range");
  return Number(total);
}
export function budgetStatus(spent: number, limit: number) {
  const ratio = limit > 0 ? spent / limit : 1;
  return ratio >= 1
    ? "EXHAUSTED"
    : ratio >= 0.9
      ? "RED"
      : ratio >= 0.8
        ? "ORANGE"
        : ratio >= 0.6
          ? "YELLOW"
          : "GREEN";
}
