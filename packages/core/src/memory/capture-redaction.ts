/** Shared secret handling for complete public sources and provider ingestion. */
const SECRET_PATTERNS: readonly { pattern: RegExp; replacement: string; reason: string }[] = [
  { pattern: /^(?:[A-Z_][A-Z0-9_]*=[^\n]*(?:\n|$)){2,}/gm, replacement: "[REDACTED_ENV_DUMP]\n", reason: "raw environment dump" },
  { pattern: /Authorization:\s*Bearer\s+[^\s]+/gi, replacement: "Authorization: Bearer [REDACTED]", reason: "authorization header" },
  { pattern: /Authorization:\s*Basic\s+[^\s]+/gi, replacement: "Authorization: Basic [REDACTED]", reason: "authorization header" },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED PRIVATE KEY]", reason: "private key" },
  { pattern: /\b(?:AWS_[A-Z0-9_]*|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)[A-Z0-9_]*)\s*=\s*[^\s]+/gi, replacement: "[REDACTED_ENV_CREDENTIAL]", reason: "environment credential" },
  { pattern: /"(?:authorization|x-api-key|x-supermemory-api-key)"\s*:\s*"[^"]*"/gi, replacement: "\"[REDACTED_HEADER]\":\"[REDACTED]\"", reason: "structured authorization header" },
  { pattern: /"(?:AWS_[A-Z0-9_]*|[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|PASSWORD|SECRET|CREDENTIAL)[A-Z0-9_]*)"\s*:\s*"[^"]*"/gi, replacement: "\"[REDACTED_KEY]\":\"[REDACTED]\"", reason: "structured credential" },
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, replacement: "[REDACTED_AWS_KEY]", reason: "cloud credential" },
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_TOKEN]", reason: "token-shaped credential" },
];

export function redactMemoryCaptureContent(content: string): { safe: boolean; content: string; diagnostics: readonly string[] } {
  let redacted = content;
  const reasons: string[] = [];
  for (const { pattern, replacement, reason } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) {
      reasons.push(`Redacted ${reason}.`);
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, replacement);
    }
  }
  return { safe: reasons.length === 0, content: redacted, diagnostics: reasons };
}
