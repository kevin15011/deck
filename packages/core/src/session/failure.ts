/** Safe, additive explanation of a failed turn. No field authorizes replay or proves retry exhaustion. */
export const TURN_FAILURE_CATEGORIES = [
  "provider-overloaded", "provider-unavailable", "rate-limit", "quota", "authentication", "rejection",
  "context-limit", "network", "runner-process", "deck", "unknown",
] as const;
export type TurnFailure = {
  category: typeof TURN_FAILURE_CATEGORIES[number];
  origin: "provider" | "runner" | "deck" | "unknown";
  certainty: "reported" | "inferred";
  code?: string;
  provider?: string;
  httpStatus?: number;
  /** UTC ISO timestamp converted from structured native reset evidence, never parsed from prose/headers. */
  resetAt?: string;
};

/** Exact local transport evidence only. Never classify arbitrary error prose. */
export const RUNNER_TRANSPORT_FAILURES = {
  'codex-rpc-frame-too-large': 'oversized',
  'codex-rpc-invalid-frame': 'malformed',
  'claude-line-too-long': 'oversized',
  'opencode-sse-frame-too-large': 'oversized',
  'opencode-sse-invalid-frame': 'malformed',
  'opencode-http-body-too-large': 'oversized',
  'opencode-http-invalid-body': 'malformed',
} as const;
export function runnerTransportFailure(code: unknown): TurnFailure | undefined {
  return typeof code === 'string' && Object.hasOwn(RUNNER_TRANSPORT_FAILURES, code)
    ? {category:'deck',origin:'deck',certainty:'reported',code} : undefined;
}

/** Startup failed before a handle could be returned, and native drain is unproven.
 * The host must retain ownership until this explicit cleanup barrier succeeds.
 * The callback is local adapter state, never native input or serialized metadata. */
export class DriverStartupCleanupError extends Error {
  constructor(readonly close: () => Promise<void>, readonly failure?: TurnFailure) { super('runner-startup-cleanup-failed'); }
}

// This is a serialization allowlist, not a native protocol classifier. Adapters own interpretation.
const CODES = new Set([
  ...Object.keys(RUNNER_TRANSPORT_FAILURES),
  "serverOverloaded", "flexUnavailable", "usageLimitExceeded", "rateLimitExceeded", "contextWindowExceeded", "sessionBudgetExceeded", "unauthorized", "badRequest",
  "httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts",
  "rate_limit", "usage_limit_reached", "ProviderAuthError", "ContextOverflowError", "ContentFilterError", "APIError",
]);
const PROVIDERS = new Set(["openai", "anthropic"]);
const ORIGINS = new Set(["provider", "runner", "deck", "unknown"]);
const CERTAINTIES = new Set(["reported", "inferred"]);

/** Drop malformed optional metadata without ever preventing a terminal event. Copy only safe fields. */
export function sanitizeTurnFailure(input: unknown): TurnFailure | undefined {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return;
    const value = input as Record<string, unknown>;
    if (!(TURN_FAILURE_CATEGORIES as readonly unknown[]).includes(value.category)
      || !ORIGINS.has(value.origin as string) || !CERTAINTIES.has(value.certainty as string)) return;
    const failure: TurnFailure = { category: value.category as TurnFailure["category"], origin: value.origin as TurnFailure["origin"], certainty: value.certainty as TurnFailure["certainty"] };
    if (typeof value.code === "string" && CODES.has(value.code)) failure.code = value.code;
    if (typeof value.provider === "string" && PROVIDERS.has(value.provider)) failure.provider = value.provider;
    if (typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus) && value.httpStatus >= 400 && value.httpStatus <= 599) failure.httpStatus = value.httpStatus;
    if (typeof value.resetAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.resetAt)
      && Number.isFinite(Date.parse(value.resetAt)) && new Date(value.resetAt).toISOString() === value.resetAt) failure.resetAt = value.resetAt;
    return failure;
  } catch { return undefined; }
}
