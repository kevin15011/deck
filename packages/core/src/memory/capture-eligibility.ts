export type AdaptiveMemoryCaptureSource = "trusted-user-prompt" | "trusted-final-assistant" | "explicit-remember";

export type AdaptiveMemoryCaptureEligibilityReason =
  | "eligible"
  | "unsupported_source"
  | "empty_content"
  | "trivial_operational_text"
  | "raw_log_or_test_output"
  | "stack_trace"
  | "diff_or_patch"
  | "source_dump"
  | "tool_chatter"
  | "environment_dump"
  | "external_or_official_artifact"
  | "secret_detected"
  | "no_high_signal_category";

export type AdaptiveMemoryCaptureEligibility =
  | Readonly<{ eligible: true; content: string; reason: "eligible"; diagnostics: readonly string[] }>
  | Readonly<{ eligible: false; reason: Exclude<AdaptiveMemoryCaptureEligibilityReason, "eligible">; diagnostics: readonly string[] }>;

const SUPPORTED_CAPTURE_SOURCES: ReadonlySet<string> = new Set(["trusted-user-prompt", "trusted-final-assistant", "explicit-remember"]);

const TRIVIAL_TEXT = /^(?:ok(?:ay)?|done|thanks?|thank you|continue|go on|yes|no|run tests?|retry|proceed|sounds good|ship it|looks good)[.!?\s]*$/i;
const ENV_DUMP_LINE = /^\s*(?:[A-Z_][A-Z0-9_]*|[a-z_][a-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[a-z0-9_]*)=[^\n]+$/gm;
const HIGH_CONFIDENCE_SECRET = /(?:\bsk-[A-Za-z0-9_-]{8,}\b|\b(?:password|passphrase|secret|api[_-]?key|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?id|session|cookie|dsn|private[_-]?key|database[_-]?uri|[a-z0-9_]+[_-]uri)\b\s*[:=]\s*["'][^"']{4,}["']|\b(?:password|passphrase|secret|api[_-]?key|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|session[_-]?id|session|cookie|dsn|private[_-]?key|database[_-]?uri|[a-z0-9_]+[_-]uri)\b\s*[:=]\s*[^\s,;"'{}\[\]]{4,}|["'](?:password|passphrase|secret|api[_-]?key|token|access[_-]?token|auth[_-]?token|refresh[_-]?token|session|cookie|dsn|private[_-]?key|database[_-]?uri|[a-z0-9_]+[_-]uri)["']\s*[:=]\s*["'][^"']{4,}["']|--(?:password|passphrase|secret|api-key|token|access-token|auth-token|cookie|session|dsn)\s+[^\s]+|[a-z][a-z0-9+.-]*:\/\/[^\s\/@:]+:[^\s\/@]+@|(?:sqlite|file|libsql):\/\/(?:\/)?[^\s,;"'{}\[\]]*(?:\.db|\.sqlite|\.sqlite3)\b|\/(?:Users|home|var|private|tmp)\/[^\s,;"'{}\[\]]*(?:\.db|\.sqlite|\.sqlite3)\b|^(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|PASSPHRASE|SECRET|API[_-]?KEY|TOKEN|SESSION|COOKIE|DSN|DATABASE[_-]?(?:URL|URI)|REDIS[_-]?(?:URL|URI)|MONGO(?:DB)?[_-]?(?:URL|URI)|PRIVATE[_-]?KEY|URI)[A-Z0-9_]*\s*=\s*[^\s]+|(?:Cookie|Set-Cookie|Session|X-Api-Key|Authorization)\s*:\s*[^\n]+|\b(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|AZURE_CLIENT_SECRET)\s*=\s*[^\s]+)/gim;
const STACK_TRACE_LINE = /^\s*(?:at\s+\S+\s+\(|File "[^"]+", line \d+|\w+(?:Error|Exception):\s+.+)/gm;
const TEST_OUTPUT = /(?:^|\n)\s*(?:FAIL|FAILED|PASS|✓|✗|×)\s+[^\n]+|Ran \d+ tests?|\b\d+\s+(?:pass|fail|failed|passed)\b|Expected:\s*[\s\S]*?Received:/i;
const TOOL_CHATTER = /(?:<\/?(?:function|tool|functions\.|multi_tool_use)|MCP error|tool_use|recipient_name|stderr|stdout|exit code|\$\s*(?:bun|npm|pnpm|yarn|git|pytest|cargo|go test)\b)/i;
const OFFICIAL_OR_EXTERNAL_ARTIFACT = /(?:OFFICIAL CONTEXT|ADAPTIVE CONTEXT|OpenSpec|openspec\/changes|##\s+(?:ADDED|MODIFIED|REMOVED)\s+Requirements|retrieved from|search results?|https?:\/\/\S+.*https?:\/\/\S+)/is;
const HIGH_SIGNAL_PATTERNS: Readonly<Record<AdaptiveMemoryCaptureSource, readonly RegExp[]>> = {
  "explicit-remember": [/.{1,}/],
  "trusted-user-prompt": [
    /\b(?:correction|correcting|preference|prefer|decision|decided|convention|constraint|requirement|must|never|root cause|confirmed discovery|discovered|resolution|resolved|important limitation|limitation)\b/i,
    /^\s*remember\s+(?:that|this)\b/i,
  ],
  "trusted-final-assistant": [
    /\b(?:implemented|fixed|changed|updated|removed|added|verified|validated|confirmed|resolved|captured|root cause|remaining risk|important limitation|limitation|final outcome|shipped)\b/i,
  ],
};

export function evaluateAdaptiveMemoryCaptureEligibility(input: {
  source: string;
  content: string;
}): AdaptiveMemoryCaptureEligibility {
  if (!SUPPORTED_CAPTURE_SOURCES.has(input.source)) {
    return rejected("unsupported_source", "Capture source is not trusted for adaptive-memory ingestion.");
  }

  const content = normalizeCaptureCandidate(input.content);
  if (!content) return rejected("empty_content", "Capture skipped because content is empty after normalization.");

  const inspection = stripQuoteAndFenceMarkers(content);
  const lines = inspection.split("\n").map((line) => line.trim()).filter(Boolean);
  const words = inspection.split(/\s+/).filter(Boolean);

  const envLines = [...inspection.matchAll(ENV_DUMP_LINE)].length;
  if (matchesHighConfidenceSecret(inspection)) return rejected("secret_detected", "Capture skipped because content contains high-confidence secret material.");
  if (envLines >= 2) return rejected("environment_dump", "Capture skipped because content is shaped like an environment dump.");
  if (/^\s*diff --git\b/m.test(inspection) || patchLineRatio(lines) >= 0.35 && lines.length >= 6) {
    return rejected("diff_or_patch", "Capture skipped because content is shaped like a diff or patch.");
  }
  if (stackTraceLineCount(inspection) >= 2) return rejected("stack_trace", "Capture skipped because content is shaped like a stack trace.");
  if (TEST_OUTPUT.test(inspection) && lines.length >= 3) return rejected("raw_log_or_test_output", "Capture skipped because content is shaped like raw test or log output.");
  if (TOOL_CHATTER.test(inspection) && (lines.length >= 2 || words.length <= 40)) return rejected("tool_chatter", "Capture skipped because content is shaped like tool chatter rather than user-visible knowledge.");
  if (OFFICIAL_OR_EXTERNAL_ARTIFACT.test(inspection) && lines.length >= 3) return rejected("external_or_official_artifact", "Capture skipped because content is shaped like provider, web, or OpenSpec artifact content.");
  if (looksLikeSourceDump(lines)) return rejected("source_dump", "Capture skipped because content is shaped like a source-code dump.");
  if (words.length < 6 || TRIVIAL_TEXT.test(inspection)) return rejected("trivial_operational_text", "Capture skipped because content is trivial operational text.");
  if (!hasHighSignalCategory(input.source as AdaptiveMemoryCaptureSource, inspection)) {
    return rejected("no_high_signal_category", "Capture skipped because content is not a durable high-signal memory category.");
  }

  return { eligible: true, content, reason: "eligible", diagnostics: [] };
}

function rejected(reason: Exclude<AdaptiveMemoryCaptureEligibilityReason, "eligible">, diagnostic: string): AdaptiveMemoryCaptureEligibility {
  return { eligible: false, reason, diagnostics: [diagnostic] };
}

function normalizeCaptureCandidate(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "").trim();
}

function stripQuoteAndFenceMarkers(content: string): string {
  return content
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*```[a-z0-9_-]*\s*$/gim, "")
    .trim();
}

function patchLineRatio(lines: readonly string[]): number {
  if (lines.length === 0) return 0;
  const patchLines = lines.filter((line) => /^(?:\+{1,3}|-{1,3}|@@\s|Index: |={7,})/.test(line)).length;
  return patchLines / lines.length;
}

function stackTraceLineCount(content: string): number {
  return [...content.matchAll(STACK_TRACE_LINE)].length;
}

function looksLikeSourceDump(lines: readonly string[]): boolean {
  if (lines.length < 5) return false;
  const codeLike = lines.filter((line) =>
    /^(?:import|export|const|let|var|function|class|interface|type|def|async\s+function)\b/.test(line)
    || /[{};]$/.test(line)
    || /^\s*(?:if|for|while|switch|try|catch)\s*\(/.test(line),
  ).length;
  return codeLike / lines.length >= 0.45;
}

function hasHighSignalCategory(source: AdaptiveMemoryCaptureSource, content: string): boolean {
  return (HIGH_SIGNAL_PATTERNS[source] ?? []).some((pattern) => pattern.test(content));
}

function matchesHighConfidenceSecret(content: string): boolean {
  HIGH_CONFIDENCE_SECRET.lastIndex = 0;
  const matched = HIGH_CONFIDENCE_SECRET.test(content);
  HIGH_CONFIDENCE_SECRET.lastIndex = 0;
  return matched;
}
