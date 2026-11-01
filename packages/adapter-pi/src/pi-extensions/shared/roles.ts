import { ROLE_TOOL_POLICY } from "@deck/core/session/role-tool-policy";
/**
 * Role vocabulary shared by every Deck Pi extension. Pure and dependency-free so it can be bundled into each
 * extension (the bundles must not import anything outside `pi-extensions/`).
 */
export const DECK_AGENT_PREFIX = "deck-";
export const LEAD_ROLE = "lead";

/** Roles that never mutate the workspace. Enforced by `--tools` (subagent tool) and by the tool-policy extension. */
export const READ_ONLY_ROLES: readonly string[] = ROLE_TOOL_POLICY.readOnlyRoles.map(role => role.replace(/^deck-/, ""));

/** `deck-investigate` / `investigate` -> `investigate`. Empty input is the lead. */
export function normalizeRole(value: string | undefined): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (!trimmed) return LEAD_ROLE;
  return trimmed.startsWith(DECK_AGENT_PREFIX) ? trimmed.slice(DECK_AGENT_PREFIX.length) : trimmed;
}

export function isReadOnlyRole(value: string | undefined): boolean {
  return READ_ONLY_ROLES.includes(normalizeRole(value));
}

/** Agent ids a lead may delegate to. The lead itself is never a delegation target. */
export function isDelegableAgentId(agentId: string): boolean {
  return agentId.startsWith(DECK_AGENT_PREFIX) && normalizeRole(agentId) !== LEAD_ROLE;
}

/** No role excludes automatic recall or explicit read operations. */
export const MEMORY_SEARCH_DENIED_ROLES: readonly string[] = [];

/** Explicit memory tools a role is offered: search unless the policy skips it, save only for write-capable roles. */
export function memoryToolsForRole(value: string | undefined): { search: boolean; save: boolean } {
  const role = normalizeRole(value);
  return { search: !MEMORY_SEARCH_DENIED_ROLES.includes(role), save: !READ_ONLY_ROLES.includes(role) };
}
