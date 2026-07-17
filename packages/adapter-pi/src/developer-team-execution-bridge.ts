import {
  createDeveloperTeamRunnerHostBridgeV1,
  type DeveloperTeamRunnerHostBridgeOptionsV1,
  type DeveloperTeamRunnerHostBridgeV1,
} from "@deck/sdd-runtime";

export type PiDeveloperTeamExecutionBridgeOptionsV1 = Omit<DeveloperTeamRunnerHostBridgeOptionsV1, "runnerId">;

export function createPiDeveloperTeamExecutionBridgeV1(options: PiDeveloperTeamExecutionBridgeOptionsV1): DeveloperTeamRunnerHostBridgeV1 {
  return createDeveloperTeamRunnerHostBridgeV1({ ...options, runnerId: "pi" });
}
