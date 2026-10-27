import type { RunnerAdapter } from "@deck/core";
import type { ClaudeSessionMcpAdapter } from "../../../packages/adapter-claude/src/runner-adapter";
import { ClaudeSkillsError } from "../../../packages/adapter-claude/src/session-skills";

/** Claude owns materialization; other runners retain their native global skill loaders. */
export async function prepareSessionNativeSkills(adapter: RunnerAdapter | undefined) {
  if (adapter?.runnerId !== "claude") return undefined;
  const claude = adapter as Partial<ClaudeSessionMcpAdapter>;
  if (!claude.prepareSessionNativeSkills) throw new ClaudeSkillsError();
  return claude.prepareSessionNativeSkills();
}
