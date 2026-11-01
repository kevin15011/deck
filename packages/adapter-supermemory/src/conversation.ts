import { redactMemoryCaptureContent as redactSupermemoryConversationContent } from "@deck/core/memory/capture-redaction";
import { createHash } from "node:crypto";

export { redactSupermemoryConversationContent };

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
export type SupermemoryConversationSource = "trusted-user-prompt" | "trusted-final-assistant" | "explicit-remember";
export type SupermemoryConversationDependency = "automatic" | "explicit-recall" | "explicit-remember" | "unobservable-external-mcp";

export type SupermemoryConversationIngestRequest = Readonly<{
  containerTag: string;
  customId: string;
  content: string;
  metadata: Readonly<{ role: SupermemoryConversationRole; capturedAt: string; source: SupermemoryConversationSource; dependency: SupermemoryConversationDependency }>;
  dreaming: "dynamic" | "instant";
}>;

export type SupermemoryConversationIngestResult =
  | Readonly<{ ok: true; request: SupermemoryConversationIngestRequest; diagnostics: readonly string[] }>
  | Readonly<{ ok: false; diagnostics: readonly string[] }>;

const CANONICAL_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function buildSupermemoryConversationIngest(input: {
  canonicalScope: string;
  sessionId: string;
  turn: Readonly<{ role: SupermemoryConversationRole; content: string; source: SupermemoryConversationSource; capturedAt?: string; dependency?: SupermemoryConversationDependency }>;
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
      metadata: {
        role: input.turn.role,
        capturedAt: input.turn.capturedAt ?? new Date(0).toISOString(),
        source: input.turn.source,
        dependency: input.turn.dependency ?? "automatic",
      },
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
