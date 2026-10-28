import type { RunnerAdapter, NormalizedDeckConfig } from "@deck/core";
import type { ClaudeSessionMcpAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { ClaudeSkillsError, validateClaudeSessionIntent } from "../../../packages/adapter-claude/src/session-skills";

/** Claude owns materialization; other runners retain their native global skill loaders. */
export async function prepareSessionNativeSkills(adapter: RunnerAdapter | undefined, config?: NormalizedDeckConfig, onVerificationFailure?: (check: string) => void) {
  if (adapter?.runnerId !== "claude") return undefined;
  const claude = adapter as Partial<ClaudeSessionMcpAdapter>;
  if (!claude.prepareSessionNativeSkills) throw new ClaudeSkillsError();
  try {
    const descriptor = await claude.prepareSessionNativeSkills();
    if (config) validateClaudeSessionIntent(descriptor, config);
    return descriptor;
  } catch (error) {
    if (error instanceof ClaudeSkillsError) onVerificationFailure?.(error.check);
    throw error;
  }
}

/** Preparation errors must include a recovery path before a runner is spawned. */
export async function prepareSessionNativeRole(adapter: RunnerAdapter, roleId: string) {
  try {
    if (!adapter.prepareSessionNativeRole) throw new Error("native-role-verifier-unavailable");
    return await adapter.prepareSessionNativeRole(roleId);
  } catch (cause) {
    throw new Error(`The installed ${adapter.runnerId} team could not be verified against this Deck build. Reinstall this runner’s team from Review & Install, then retry the session.`, { cause });
  }
}
