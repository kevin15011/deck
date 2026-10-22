import { sanitizeTurnFailure, type TurnFailure } from "@deck/core/session/failure";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Claude's structured API fields, never its assistant/result prose. Origin is not runner identity. */
export function classifyClaudeFailure(input: unknown): TurnFailure | undefined {
  const m = object(input), status = m.api_error_status;
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  const quota = m.api_error === "usage_limit_reached";
  const rateLimit = m.error === "rate_limit";
  if (httpStatus === undefined && !quota && !rateLimit) return;
  const firstParty = m.api_error_origin === "first_party";
  const category: TurnFailure["category"] = quota ? "quota" : rateLimit || httpStatus === 429 ? "rate-limit"
    : httpStatus === 401 || httpStatus === 403 ? "authentication"
    : firstParty && httpStatus === 529 ? "provider-overloaded"
    : firstParty && httpStatus !== undefined && httpStatus >= 500 ? "provider-unavailable"
    : httpStatus === 400 || httpStatus === 422 ? "rejection" : "unknown";
  const info = object(object(m.api_error_params).rate_limit_info);
  const reset = info.resetsAt;
  const resetAt = (category === "quota" || category === "rate-limit") && info.status === "rejected"
    && typeof reset === "number" && Number.isFinite(reset) && reset > 0 && reset <= 253402300799
    ? new Date(reset * 1000).toISOString() : undefined;
  return sanitizeTurnFailure({ category, origin: firstParty ? "provider" : "unknown", certainty: quota || rateLimit ? "reported" : "inferred",
    ...(quota ? { code: "usage_limit_reached" } : rateLimit ? { code: "rate_limit" } : {}),
    ...(firstParty ? { provider: "anthropic" } : {}), httpStatus, resetAt });
}
