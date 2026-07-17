import {
  createDeveloperTeamRunnerHostBridgeV1,
  type DeveloperTeamRunnerHostBridgeOptionsV1,
  type DeveloperTeamRunnerHostBridgeV1,
} from "@deck/sdd-runtime";

export type OpenCodeDeveloperTeamExecutionBridgeOptionsV1 = Omit<DeveloperTeamRunnerHostBridgeOptionsV1, "runnerId">;

export function createOpenCodeDeveloperTeamExecutionBridgeV1(options: OpenCodeDeveloperTeamExecutionBridgeOptionsV1): DeveloperTeamRunnerHostBridgeV1 {
  return createDeveloperTeamRunnerHostBridgeV1({ ...options, runnerId: "opencode" });
}
