// The limits that travel between KOE and the AI Gateway: how often to retry, how long to wait between attempts and when the circuit breaker opens. KOE holds the
// company's choice and hands it over; the Gateway applies it. A shared contract, so neither side needs to import the other's catalog. Nothing here calls anything.

export type GatewayLimits = {
  retry: { maxAttempts: number; backoffMs: readonly number[] };
  breaker: { failureThreshold: number; cooldownMs: number };
};
export const GATEWAY_LIMIT_DEFAULTS: GatewayLimits = { retry: { maxAttempts: 2, backoffMs: [200, 800] }, breaker: { failureThreshold: 3, cooldownMs: 60_000 } };
/** The hard ceiling: no company may configure beyond it. */
export const GATEWAY_CEILINGS = { maxAttempts: 4 } as const;

export function validateGatewayLimits(limits: GatewayLimits): string[] {
  const issues: string[] = [];
  const positive = (value: number) => Number.isInteger(value) && value > 0;
  if (!positive(limits.retry.maxAttempts) || limits.retry.maxAttempts > GATEWAY_CEILINGS.maxAttempts) issues.push("intentos");
  if (limits.retry.backoffMs.some((value) => !Number.isInteger(value) || value < 0)) issues.push("espera entre intentos");
  if (!positive(limits.breaker.failureThreshold) || !positive(limits.breaker.cooldownMs)) issues.push("cortacircuitos");
  return issues;
}
