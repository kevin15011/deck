/**
 * Redaction and sanitization of untrusted runner text (XR-1.3, design section 12).
 * Rules ported from the Pi subagent `clean()` (read-only reference); no Pi import.
 */

const WORK_BOUND = 256 * 1024;

/** Strip terminal control sequences and bidi controls, redact secrets, then cap length. */
export function redactText(text: string, cap = 12000): string {
  return text
    .slice(0, WORK_BOUND)
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\b(?:Bearer|Basic)\s+[^\s",;}]+/gi, "[redacted authorization]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*[^\r\n,}]+/gi, "Authorization: [redacted]")
    .replace(
      /(["']?\b[\w.-]*(?:api[_-]?key|access[_-]?key|token|password|passwd|secret(?:[_-][\w-]+)?|authorization)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}]+)/gi,
      "$1[redacted]",
    )
    .slice(0, cap);
}
