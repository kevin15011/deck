import { test } from "bun:test";
import {
  assertBridgeAdapterError,
  assertBridgeCapabilityMismatch,
  assertBridgeGitMismatch,
  assertBridgeLegacy,
  assertBridgeMissingAuthorization,
  assertBridgeNonDelegatingAction,
  assertBridgeShadow,
  assertBridgeShadowTelemetry,
  assertBridgeShadowTelemetryFailure,
  assertBridgeTaskMismatch,
  assertBridgeAuthorizationReplay,
  assertBridgeAuthorizationTamper,
  assertBridgeRevisedDossierHistory,
  assertBridgeUnsupportedHook,
  assertBridgeValidActive,
} from "../../sdd-runtime/src/testing/developer-team-runner-host-fixture";
import { runDeveloperTeamConvergenceE2EV1 } from "../../sdd-runtime/src/testing/developer-team-convergence-fixture";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";

test("D-BRIDGE-01 OpenCode valid active targeted repair delegates once", async () => assertBridgeValidActive("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-02 OpenCode missing authorization denies with zero delegation", async () => assertBridgeMissingAuthorization("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-03 OpenCode Git mismatch denies with zero delegation", async () => assertBridgeGitMismatch("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-04 OpenCode shadow preserves legacy authority", async () => assertBridgeShadow("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("EG8-BRIDGE-14 OpenCode shadow emits one safe comparison", async () => assertBridgeShadowTelemetry("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("EG8-BRIDGE-15 OpenCode telemetry failure cannot change shadow authority", async () => assertBridgeShadowTelemetryFailure("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-05 OpenCode legacy execution remains exact", async () => assertBridgeLegacy("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-06 OpenCode non-delegating decision has zero runner calls", async () => assertBridgeNonDelegatingAction("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-07 OpenCode task mismatch is invalid evidence", async () => assertBridgeTaskMismatch("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-08 OpenCode capability mismatch is not authorized", async () => assertBridgeCapabilityMismatch("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-09 OpenCode adapter error has no fallback retry", async () => assertBridgeAdapterError("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-10 OpenCode unsupported hook denies active execution", async () => assertBridgeUnsupportedHook("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-11 OpenCode rejects authorization replay after one effect", async () => assertBridgeAuthorizationReplay("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-12 OpenCode rejects a tampered proof with zero effects", async () => assertBridgeAuthorizationTamper("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-13 OpenCode carries validated dossier revision history", async () => assertBridgeRevisedDossierHistory("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
test("EG8-E2E-02 OpenCode crosses repair, staged Verify, fresh Review, and registry commit", async () => runDeveloperTeamConvergenceE2EV1("opencode", createOpenCodeDeveloperTeamExecutionBridgeV1));
