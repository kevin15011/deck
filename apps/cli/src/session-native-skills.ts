import type { RunnerAdapter, NormalizedDeckConfig } from "@deck/core";
import type { ClaudeSessionMcpAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { ClaudeSkillsError, validateClaudeSessionIntent } from "../../../packages/adapter-claude/src/session-skills";

/** Claude owns materialization; other runners retain their native global skill loaders. */
export async function prepareSessionNativeSkills(adapter: RunnerAdapter | undefined, config?: NormalizedDeckConfig, onVerificationFailure?: (check: string) => void) {
  if (adapter?.runnerId !== "claude") return undefined;
  const claude = adapter as Partial<ClaudeSessionMcpAdapter>;
  if (!claude.prepareSessionNativeSkills) throw new ClaudeSkillsError();
  try {
    const descriptor = await claude.prepareSessionNativeSkills(config);
    for (const finding of descriptor.preparation ?? []) if (finding.kind === "W") onVerificationFailure?.(`${finding.code}: ${finding.message}`);
    if (config) validateClaudeSessionIntent(descriptor, config);
    return descriptor;
  } catch (error) {
    if (error instanceof ClaudeSkillsError) onVerificationFailure?.(error.check);
    throw error;
  }
}

/** Preparation errors must include a recovery path before a runner is spawned. */
export async function prepareSessionNativeRole(adapter: RunnerAdapter, roleId: string, config?: NormalizedDeckConfig, onWarning?: (message: string) => void) {
  try {
    if (!adapter.prepareSessionNativeRole) throw new Error("native-role-verifier-unavailable");
    const role = await adapter.prepareSessionNativeRole(roleId, config);
    for (const finding of role.preparation ?? []) if (finding.kind === "W") onWarning?.(`${finding.code}: ${finding.message}`);
    return role;
  } catch (cause) {
    if (adapter.runnerId === "codex") throw new Error("codex-session-preparation-blocked: The role or hook trust boundary could not be validated after preparation. Review the preserved conflicting item or unsafe path, then retry.", { cause });
    throw new Error(`${adapter.runnerId}-session-skills-unverified: The installed team could not be verified against this Deck build. Reinstall the ${adapter.runnerId === "codex" ? "Codex" : adapter.runnerId} team from Review & Install, then retry the session.`, { cause });
  }
}
