import {
  createDeveloperTeamRunnerHostBridgeV1,
  type DeveloperTeamRunnerHostBridgeOptionsV1,
  type DeveloperTeamRunnerHostBridgeV1,
} from "@deck/sdd-runtime";

export type CodexDeveloperTeamExecutionBridgeOptionsV1 = Omit<DeveloperTeamRunnerHostBridgeOptionsV1, "runnerId">;

/** Bind the shared trusted host contract to Codex's runner identity. */
export function createCodexDeveloperTeamExecutionBridgeV1(
  options: CodexDeveloperTeamExecutionBridgeOptionsV1,
): DeveloperTeamRunnerHostBridgeV1 {
  return createDeveloperTeamRunnerHostBridgeV1({ ...options, runnerId: "codex" });
}
