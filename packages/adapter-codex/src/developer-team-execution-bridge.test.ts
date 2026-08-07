import { test } from "bun:test";
import {
  assertBridgeAdapterError,
  assertBridgeAuthorizationReplay,
  assertBridgeAuthorizationTamper,
  assertBridgeCapabilityMismatch,
  assertBridgeGitMismatch,
  assertBridgeLegacy,
  assertBridgeMissingAuthorization,
  assertBridgeNonDelegatingAction,
  assertBridgeRevisedDossierHistory,
  assertBridgeShadow,
  assertBridgeTaskMismatch,
  assertBridgeUnsupportedHook,
  assertBridgeValidActive,
} from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { runDeveloperTeamConvergenceE2EV1 } from "../../sdd-runtime/src/testing/developer-team-convergence-fixture";
import { createCodexDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";

test("Codex bridge delegates a valid active repair once", async () => assertBridgeValidActive("codex", createCodexDeveloperTeamExecutionBridgeV1));
test("Codex bridge rejects missing authority with zero effects", async () => assertBridgeMissingAuthorization("codex", createCodexDeveloperTeamExecutionBridgeV1));
test("Codex bridge rejects Git authority mismatch", async () => assertBridgeGitMismatch("codex", createCodexDeveloperTeamExecutionBridgeV1));
test("Codex bridge preserves shadow and legacy behavior", async () => {
  await assertBridgeShadow("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeLegacy("codex", createCodexDeveloperTeamExecutionBridgeV1);
});
test("Codex bridge rejects non-delegating, task, capability, adapter, and unsupported-hook paths", async () => {
  await assertBridgeNonDelegatingAction("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeTaskMismatch("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeCapabilityMismatch("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeAdapterError("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeUnsupportedHook("codex", createCodexDeveloperTeamExecutionBridgeV1);
});
test("Codex bridge rejects replay and tamper", async () => {
  await assertBridgeAuthorizationReplay("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await assertBridgeAuthorizationTamper("codex", createCodexDeveloperTeamExecutionBridgeV1);
});
test("Codex bridge preserves dossier history and registry convergence", async () => {
  await assertBridgeRevisedDossierHistory("codex", createCodexDeveloperTeamExecutionBridgeV1);
  await runDeveloperTeamConvergenceE2EV1("codex", createCodexDeveloperTeamExecutionBridgeV1);
});
