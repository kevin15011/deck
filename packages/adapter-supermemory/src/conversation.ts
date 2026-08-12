import { createHash } from "node:crypto";

export const OFFICIAL_SUPERMEMORY_TRANSPORT_CAPABILITIES = Object.freeze({
  evidenceDate: "2026-08-11",
  sources: [
    "https://supermemory.ai/docs/concepts/how-it-works",
    "https://supermemory.ai/docs/quickstart",
    "https://supermemory.ai/docs/concepts/filtering",
    "https://supermemory.ai/docs/concepts/user-profiles",
    "https://supermemory.ai/docs/recall/search",
  ],
  stableCustomId: "supported",
  dynamicDreaming: "supported",
  immutableContainerScope: "supported",
  profileRetrieval: "supported",
  hybridSearch: "supported",
  migrationEnumeration: "not-locally-proven",
  oauthDelegation: "runner-native-only",
} as const);

export type SupermemoryConversationRole = "user" | "assistant" | "system" | "tool";

export type SupermemoryConversationIngestRequest = Readonly<{
  containerTag: string;
  customId: string;
  content: string;
  metadata: Readonly<{ role: SupermemoryConversationRole; capturedAt: string }>;
  dreaming: "dynamic" | "instant";
}>;

export type SupermemoryConversationIngestResult =
  | Readonly<{ ok: true; request: SupermemoryConversationIngestRequest; diagnostics: readonly string[] }>
  | Readonly<{ ok: false; diagnostics: readonly string[] }>;

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

const CANONICAL_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function redactSupermemoryConversationContent(content: string): { safe: boolean; content: string; diagnostics: readonly string[] } {
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

export function buildSupermemoryConversationIngest(input: {
  canonicalScope: string;
  sessionId: string;
  turn: Readonly<{ role: SupermemoryConversationRole; content: string; capturedAt?: string }>;
  dreaming?: "dynamic" | "instant";
}): SupermemoryConversationIngestResult {
  const canonicalScope = input.canonicalScope.trim();
  const sessionId = input.sessionId.trim();
  if (!CANONICAL_SCOPE.test(canonicalScope)) return { ok: false, diagnostics: ["Canonical Supermemory scope is required."] };
  if (!sessionId) return { ok: false, diagnostics: ["Stable session identity is required."] };
  const redacted = redactSupermemoryConversationContent(input.turn.content);
  return {
    ok: true,
    request: {
      containerTag: canonicalScope,
      customId: `deck_conversation_${stableDigest(`${canonicalScope}:${sessionId}`)}`,
      content: redacted.content,
      metadata: { role: input.turn.role, capturedAt: input.turn.capturedAt ?? new Date(0).toISOString() },
      dreaming: input.dreaming ?? "dynamic",
    },
    diagnostics: redacted.diagnostics,
  };
}

export function boundSupermemoryRetrievalItems(input: {
  items: readonly { id: string; content: string }[];
  maxItems?: number;
  maxTokens?: number;
}): { items: readonly { id: string; content: string }[]; maxTokens: number; rerank: false; rewriteQuery: false } {
  const maxItems = Math.min(input.maxItems ?? 5, 5);
  const maxTokens = Math.min(input.maxTokens ?? 1500, 1500);
  let used = 0;
  const items: { id: string; content: string }[] = [];
  for (const item of input.items.slice(0, maxItems)) {
    const remaining = maxTokens - used;
    if (remaining <= 0) break;
    const words = item.content.split(/\s+/).filter(Boolean);
    const content = words.slice(0, remaining).join(" ");
    used += Math.min(words.length, remaining);
    items.push({ id: item.id, content });
  }
  return { items, maxTokens, rerank: false, rewriteQuery: false };
}

export function classifySupermemoryMigrationInventory(input: {
  destinationScope: string;
  records: readonly { id: string; sourceContainerTag: string; content: string; sourceIdentity?: string }[];
}): {
  dryRun: true;
  copyAvailable: false;
  remoteDeletionAvailable: false;
  summary: { confirmed: number; unrelated: number; duplicate: number; ambiguous: number };
  examples: readonly { id: string; classification: "confirmed" | "unrelated" | "duplicate" | "ambiguous"; contentHash: string }[];
} {
  const destinationScope = input.destinationScope.trim();
  if (!CANONICAL_SCOPE.test(destinationScope)) throw new Error("canonical destination scope is required");
  const destinationHint = destinationScope.replace(/^sm_project_v1_/, "");
  const seen = new Set<string>();
  const examples: { id: string; classification: "confirmed" | "unrelated" | "duplicate" | "ambiguous"; contentHash: string }[] = [];
  const summary = { confirmed: 0, unrelated: 0, duplicate: 0, ambiguous: 0 };
  for (const record of input.records) {
    const identity = record.sourceIdentity ?? record.id;
    const contentHash = stableDigest(normalizeMigrationContent(record.content));
    const duplicateKey = `${identity}:${contentHash}`;
    const source = record.sourceContainerTag.toLowerCase();
    let classification: "confirmed" | "unrelated" | "duplicate" | "ambiguous";
    if (seen.has(duplicateKey)) classification = "duplicate";
    else if (source === destinationScope.toLowerCase()) classification = "duplicate";
    else if (destinationHint && source.replace(/[^a-z0-9]+/g, "_").includes(destinationHint)) classification = "confirmed";
    else if (/(^|[_:-])deck($|[_:-])/i.test(record.sourceContainerTag)) classification = "ambiguous";
    else classification = "unrelated";
    seen.add(duplicateKey);
    summary[classification] += 1;
    examples.push({ id: stableDigest(record.id), classification, contentHash });
  }
  return { dryRun: true, copyAvailable: false, remoteDeletionAvailable: false, summary, examples };
}

function stableDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function normalizeMigrationContent(value: string): string {
  return value.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join("\n").toLowerCase();
}
