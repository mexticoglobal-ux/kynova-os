export type CheckStatus = "PASS" | "FAIL" | "NOT RUN";
export type CheckResult = { name: string; status: CheckStatus; detail: string };
export type SentRequest = { method: string; url: string; body: string | undefined; as: string };

export function runChecks(options?: {
  env?: Record<string, string | undefined>;
  args?: string[];
  fetchImpl?: typeof fetch;
  out?: (text: string) => void;
  ask?: (question: string) => Promise<string>;
}): Promise<{ results: CheckResult[]; sent: SentRequest[] }>;
