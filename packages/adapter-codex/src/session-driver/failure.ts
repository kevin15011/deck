import { sanitizeTurnFailure, type TurnFailure } from "@deck/core/session/failure";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const UNKNOWN: TurnFailure = { category: "unknown", origin: "unknown", certainty: "inferred" };

/** Codex 0.162.1 CodexErrorInfo variants, verified via local generated app-server schema. */
export function classifyCodexFailure(input: unknown): TurnFailure | undefined {
  const info = object(input).codexErrorInfo;
  if (info === undefined || info === null) return;
  const categories: Partial<Record<string, TurnFailure["category"]>> = {
    serverOverloaded: "provider-overloaded", flexUnavailable: "provider-unavailable", usageLimitExceeded: "quota",
    rateLimitExceeded: "rate-limit", contextWindowExceeded: "context-limit",
  };
  if (typeof info === "string") {
    const category = Object.hasOwn(categories, info) ? categories[info] : undefined;
    if (category) return { category, origin: "provider", certainty: "reported", code: info };
    if (info === "unauthorized" || info === "badRequest") return { category: info === "unauthorized" ? "authentication" : "rejection", origin: "unknown", certainty: "reported", code: info };
    if (info === "sessionBudgetExceeded") return { category: "quota", origin: "runner", certainty: "reported", code: info };
    return { ...UNKNOWN };
  }
  const structured = object(info);
  if (Object.keys(structured).length !== 1) return { ...UNKNOWN };
  // Other/future variants carry no evidence this version understands.
  for (const code of ["httpConnectionFailed", "responseStreamConnectionFailed", "responseStreamDisconnected", "responseTooManyFailedAttempts"]) {
    if (!Object.hasOwn(structured, code)) continue;
    const payload = structured[code];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ...UNKNOWN };
    const httpStatus = object(payload).httpStatusCode;
    const validStatus = typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599;
    const category: TurnFailure["category"] = validStatus && httpStatus === 429 ? "rate-limit"
      : validStatus && (httpStatus === 401 || httpStatus === 403) ? "authentication"
      : validStatus && httpStatus >= 500 ? "provider-unavailable" : code === "responseTooManyFailedAttempts" ? "unknown" : "network";
    return sanitizeTurnFailure({ category, origin: validStatus ? "provider" : "unknown", certainty: validStatus ? "inferred" : "reported", code, httpStatus: validStatus ? httpStatus : undefined });
  }
  return { ...UNKNOWN };
}

/** Only a nonretrying error notification for the exact known live turn may serve as fallback. */
export function codexNotificationFailure(params: unknown, scope: { threadId?: string; turnId?: string }): TurnFailure | undefined {
  const p = object(params);
  if (!scope.threadId || !scope.turnId || p.threadId !== scope.threadId || p.turnId !== scope.turnId || p.willRetry !== false) return;
  return classifyCodexFailure(p.error);
}
