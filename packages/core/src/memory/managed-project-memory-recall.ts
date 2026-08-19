export type ManagedProjectMemoryRecallFailureReason =
  | "invalid-query"
  | "unavailable"
  | "auth-failed"
  | "transport-failed"
  | "malformed-response"
  | "no-match"
  | "rate-limited";

export type ManagedProjectMemoryRecallQueryParseResult =
  | Readonly<{ ok: true; query: string }>
  | Readonly<{ ok: false; reason: "invalid-query" }>;

const MAX_MANAGED_RECALL_QUERY_BYTES = 1_024;
const FAILURE_OPEN = "<DECK_MANAGED_PROJECT_MEMORY_RECALL_RESULT_JSON_V1>";
const FAILURE_CLOSE = "</DECK_MANAGED_PROJECT_MEMORY_RECALL_RESULT_JSON_V1>";

const HIGH_CONFIDENCE_SECRET_PATTERNS: readonly RegExp[] = [
  /^(?:[A-Z_][A-Z0-9_]*=[^\n]*(?:\n|$)){2,}/gm,
  /\b(?:DATABASE|POSTGRES(?:QL)?|MYSQL|MONGO(?:DB)?|REDIS|AMQP|LIBSQL|SQLITE)[_-]?(?:URL|URI|DSN)\s*=\s*\S+/i,
  /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|PASS(?:PHRASE)?|SECRET|CREDENTIAL|PRIVATE[_-]?KEY|AUTH(?:ORIZATION)?|COOKIE|SESSION|DSN|URI)[A-Z0-9_]*\s*=\s*\S+/i,
  /\b(?:password|passwd|api[_-]?key|token|secret|credential)\s*[:=]\s*\S+/i,
  /(?:^|\s)--(?:token|password|api-key|secret)\s+\S+/i,
  /Authorization:\s*(?:Bearer|Basic)\s+[^\s]+/i,
  /\b(?:Cookie|Set-Cookie):\s*[^\s=]+=[^\s]+/i,
  /"(?:authorization|x-api-key|x-supermemory-api-key)"\s*:\s*"[^"]*"/i,
  /"[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|PASS(?:PHRASE)?|SECRET|CREDENTIAL|PRIVATE[_-]?KEY|AUTH(?:ORIZATION)?|COOKIE|SESSION|DSN|URI)[A-Z0-9_]*"\s*:\s*"[^"]*"/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s]+/i,
  /\b(?:libsql|sqlite|file):\/\/(?:\/)?[^\s]*(?:\.db|\.sqlite|\.sqlite3)\b/i,
  /\bhttps?:\/\/[^\s/:]+:[^\s/@]+@/i,
  /(?:^|\s|["'`])(?:~|\/)?(?:Users|home|var|private|tmp)\/[^\s"'`]*(?:\.db|\.sqlite|\.sqlite3)\b/i,
  /\b[A-Za-z]:\\[^\s"'`]*(?:\.db|\.sqlite|\.sqlite3)\b/i,
];

export function containsHighConfidenceManagedRecallSecret(value: string): boolean {
  for (const pattern of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }
  return false;
}

export function parseManagedProjectMemoryRecallQuery(value: unknown): ManagedProjectMemoryRecallQueryParseResult {
  if (typeof value !== "string") return { ok: false, reason: "invalid-query" };
  if (Buffer.byteLength(value, "utf8") > MAX_MANAGED_RECALL_QUERY_BYTES) return { ok: false, reason: "invalid-query" };
  if (/\p{Cc}/u.test(value)) return { ok: false, reason: "invalid-query" };
  const query = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!query || Buffer.byteLength(query, "utf8") > MAX_MANAGED_RECALL_QUERY_BYTES) return { ok: false, reason: "invalid-query" };
  if (containsHighConfidenceManagedRecallSecret(value) || containsHighConfidenceManagedRecallSecret(query)) return { ok: false, reason: "invalid-query" };
  return { ok: true, query };
}

export function parseManagedProjectMemoryRecallToolInput(args: unknown): ManagedProjectMemoryRecallQueryParseResult {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { ok: false, reason: "invalid-query" };
  const keys = Object.keys(args as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== "query") return { ok: false, reason: "invalid-query" };
  return parseManagedProjectMemoryRecallQuery((args as Record<string, unknown>).query);
}

export function classifyManagedProjectMemoryRecallFailure(diagnostics: readonly string[] | undefined): ManagedProjectMemoryRecallFailureReason {
  const text = (diagnostics ?? []).join(" ");
  if (/no project-scoped adaptive memory matched|no match|not found/i.test(text)) return "no-match";
  if (/auth|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(text)) return "auth-failed";
  if (/reason=(?:transport_error|provider_http_error|timeout)|provider request failed|transport|timeout|timed out|aborted|http status|HTTP|\b5\d\d\b|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(text)) return "transport-failed";
  return "malformed-response";
}

export function renderManagedProjectMemoryRecallFailure(reason: ManagedProjectMemoryRecallFailureReason): string {
  const message = {
    "invalid-query": "Managed project memory recall was not performed because the query was empty, over 1024 UTF-8 bytes, malformed, included extra arguments, contained control characters, or resembled credential/secret material. Use a short non-sensitive project-history question.",
    unavailable: "Managed project memory recall was not performed because the Deck-managed runtime context was unavailable. Continue with OpenSpec, source, tests, and local evidence; do not claim prior project-memory knowledge from this result.",
    "auth-failed": "Managed project memory recall was not performed because managed loopback authentication failed. Continue with OpenSpec, source, tests, and local evidence; do not claim prior project-memory knowledge from this result.",
    "transport-failed": "Managed project memory recall was not performed because managed loopback or provider transport failed. Retry later if historical project memory is required; do not claim prior project-memory knowledge from this result.",
    "malformed-response": "Managed project memory recall was not used because the runtime response was missing a valid bounded advisory envelope. Continue with OpenSpec, source, tests, and local evidence; do not claim prior project-memory knowledge from this result.",
    "no-match": "Managed project memory recall found no matching project-scoped adaptive memory. Continue with OpenSpec, source, tests, and local evidence, or ask the user if historical context is required.",
    "rate-limited": "Managed project memory recall hit the local per-session rate limit. Wait briefly before retrying; continue with OpenSpec, source, tests, and local evidence without claiming prior project-memory knowledge from this result.",
  } satisfies Record<ManagedProjectMemoryRecallFailureReason, string>;
  return [
    FAILURE_OPEN,
    JSON.stringify({ ok: false, status: reason, retryable: reason !== "invalid-query", message: message[reason] }),
    FAILURE_CLOSE,
  ].join("\n");
}
