import type { ModificationAuthorization } from "../../../../core/src/teams/developer/orchestrator-invariants";

export const EXECUTION_V1_PROMPT_FIXTURE = Object.freeze({
  basePrompt: "Frozen apply prompt fixture.",
  authorization: Object.freeze<ModificationAuthorization>({
    requestClassification: "Run SDD",
    userAuthorizedModification: true,
    sddChange: "developer-team-execution-convergence",
    taskArtifact: "openspec/changes/developer-team-execution-convergence/tasks.md",
    allowedTargets: ["packages/sdd-runtime/src/fixtures/execution-v1/**"],
    blockedTargets: ["openspec/changes/runner-capability-standardization/**"],
  }),
  sha256: "1df5d2d41948b800256c000514752af89e3b1109a325eded1ecfa66a34508f9b",
});
