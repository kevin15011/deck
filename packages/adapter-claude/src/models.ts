import { createHash } from "node:crypto";
import { getDeveloperTeamCatalog } from "../../core/src/index";
import { safeClaudeModelId } from "./model-discovery";

export type ClaudeAssignments = Readonly<Record<string, string>>;
export type ClaudeEfforts = Readonly<Record<string, string>>;
export const CLAUDE_CAPABILITY_IDS = ["context-mode", "codebase-memory", "rtk", "serena", "context7", "web-search"] as const;
export type ClaudeCapabilityId = (typeof CLAUDE_CAPABILITY_IDS)[number];
const roles = new Set(getDeveloperTeamCatalog().map((agent) => agent.id));

export function normalizeClaudeAssignments(value: unknown): ClaudeAssignments {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Claude model assignments must be a role map.");
  const sorted: Record<string, string> = {};
  for (const [role, alias] of Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!roles.has(role) || !safeClaudeModelId(alias)) throw new Error("Unrecognized Claude role or unsafe model identifier.");
    sorted[role] = alias;
  }
  return Object.freeze(sorted);
}

export function normalizeClaudeCapabilities(value: unknown): readonly ClaudeCapabilityId[] {
  if (!Array.isArray(value) || value.some((entry) => !CLAUDE_CAPABILITY_IDS.includes(entry as ClaudeCapabilityId))) throw new Error("Unrecognized Claude capability selection.");
  return Object.freeze([...new Set(value as ClaudeCapabilityId[])].sort());
}

export function normalizeClaudeEfforts(value: unknown): ClaudeEfforts {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Claude effort selection must be a role map.");
  const sorted: Record<string, string> = {};
  for (const [role, level] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    if (!roles.has(role) || typeof level !== "string" || !["low", "medium", "high", "xhigh", "max"].includes(level)) throw new Error("Claude effort selection is invalid.");
    sorted[role] = level;
  }
  return sorted;
}

export function claudePluginName(assignments: ClaudeAssignments, capabilities: readonly ClaudeCapabilityId[] = []): string {
  const serialized = capabilities.length === 0 ? JSON.stringify(assignments) : JSON.stringify({ assignments, capabilities });
  return Object.keys(assignments).length === 0 && capabilities.length === 0
    ? "developer-team-v1" // existing content-only installations remain readable
    : `developer-team-v1-${createHash("sha256").update(serialized).digest("hex").slice(0, 16)}`;
}

export function claudeContentPluginName(assignments: ClaudeAssignments, capabilities: readonly ClaudeCapabilityId[], providerId: string | undefined, contentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Claude plugin content digest is invalid.");
  return `developer-team-v2-${createHash("sha256").update(JSON.stringify({ assignments, capabilities, providerId: providerId ?? null, contentHash })).digest("hex").slice(0, 16)}`;
}

export function claudeModelMetadata(assignments: ClaudeAssignments, capabilities: readonly ClaudeCapabilityId[] = [], providerId?: string, contentHash?: string, efforts: ClaudeEfforts = {}): string {
  const contentVersion = contentHash ? { contentHash, plugin: claudeContentPluginName(assignments, capabilities, providerId, contentHash) } : { plugin: claudePluginName(assignments, capabilities) };
  return JSON.stringify({ schema: Object.keys(efforts).length ? "deck-claude-models-v3" : contentHash ? "deck-claude-models-v2" : "deck-claude-models-v1", assignments, ...(Object.keys(efforts).length ? { efforts } : {}), ...(capabilities.length ? { capabilities } : {}), ...(providerId ? { providerId } : {}), ...contentVersion }, null, 2) + "\n";
}
