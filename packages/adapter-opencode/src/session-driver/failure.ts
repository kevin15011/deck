import { sanitizeTurnFailure, type TurnFailure } from "@deck/core/session/failure";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Message-domain NamedError schemas verified in the local 1.19.1 executable. No prose heuristics. */
export function classifyOpenCodeFailure(input: unknown): TurnFailure {
  const unknown: TurnFailure = { category: "unknown", origin: "unknown", certainty: "inferred" };
  const error = object(input), data = object(error.data);
  if (typeof data.message !== "string") return unknown;
  if (error.name === "ProviderAuthError" && typeof data.providerID === "string") {
    return sanitizeTurnFailure({ category: "authentication", origin: "provider", certainty: "reported", code: error.name, provider: data.providerID })!;
  }
  if (error.name === "ContextOverflowError") {
    // Also constructed locally during compaction. Its schema exposes no structured origin.
    return { category: "context-limit", origin: "unknown", certainty: "reported", code: error.name };
  }
  if (error.name === "ContentFilterError") {
    return { category: "rejection", origin: "provider", certainty: "reported", code: error.name };
  }
  if (error.name !== "APIError" || typeof data.isRetryable !== "boolean") return unknown;
  const status = data.statusCode;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status > 599) return unknown;
  return { category: status === 429 ? "rate-limit" : status === 401 || status === 403 ? "authentication"
    : status >= 500 ? "provider-unavailable" : status === 400 || status === 422 ? "rejection" : "unknown",
    origin: "provider", certainty: "inferred", code: "APIError", httpStatus: status };
}
