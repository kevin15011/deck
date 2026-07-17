import { describe, expect, test } from "bun:test";
import { sha256Digest } from "../contracts/canonical";
import { EXECUTION_V1_FIXTURES } from "../fixtures/execution-v1";
import { runOrchestratorPipeline } from "../orchestrator/orchestrator-pipeline";
import {
  composeDeveloperTeamExecutionV1,
  runProductionExecutionDecisionPipelineV1,
} from "./execution-composition";

const legacyInput = EXECUTION_V1_FIXTURES.pipelineInputs[0]!;

describe("host-facing execution composition", () => {
  test("keeps the legacy orchestrator independent from execution modules", async () => {
    const source = await Bun.file(new URL("../orchestrator/orchestrator-pipeline.ts", import.meta.url)).text();
    expect(source).not.toContain("../execution/");
  });

  test("returns the unchanged legacy result for an explicit no-dossier request", () => {
    const result = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: "legacy",
      dossier: { kind: "none" },
      legacyInput,
      authority: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
      gitSafety: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
      governance: { kind: "none" },
      effectBinding: { kind: "none" },
    });

    expect(result.authoritative).toBe("legacy");
    expect(result.legacy).toEqual(runOrchestratorPipeline(legacyInput));
    expect([result.plan.decision, result.plan.replay()]).toEqual([undefined, undefined]);
  });

  test("emits a legacy replay record whose digest verifies its complete payload", () => {
    const result = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: "legacy",
      dossier: { kind: "none" },
      legacyInput,
      authority: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
      gitSafety: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
      governance: { kind: "none" },
      effectBinding: { kind: "none" },
    });
    const { inputDigest, ...payload } = result.plan.replayRecord;
    expect(inputDigest).toBe(sha256Digest(payload));
  });

  test("rejects legacy admission when mandatory mode fields are omitted", () => {
    const result = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: "legacy",
      dossier: { kind: "none" },
      legacyInput,
    });
    expect([result.plan.reasonCode, result.comparison.reasonCode, result.legacy]).toEqual(["invalid-evidence", "invalid-evidence", undefined]);
  });

  test("rejects shadow admission without a legacy comparison input", () => {
    const result = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: "shadow",
      dossier: { kind: "execution-dossier-v1", value: {} },
      authority: { state: "missing", rationaleCode: "AUTHZ_MISSING" },
      gitSafety: { state: "not-required", policyDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      governance: { kind: "none" },
      effectBinding: { kind: "none" },
    });

    expect([result.plan.reasonCode, result.comparison.reasonCode, result.legacy]).toEqual(["invalid-evidence", "invalid-evidence", undefined]);
  });

  test("keeps the production-named facade as an exact compatibility alias", () => {
    expect(runProductionExecutionDecisionPipelineV1).toBe(composeDeveloperTeamExecutionV1);
  });

  test("keeps the pure control plane independent from the effect adapter", async () => {
    const source = await Bun.file(new URL("./execution-control-plane.ts", import.meta.url)).text();
    expect(source).not.toContain("./execution-adapter-port");
  });
});
