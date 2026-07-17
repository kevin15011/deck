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
import { createPiDeveloperTeamExecutionBridgeV1 } from "./developer-team-execution-bridge";

test("D-BRIDGE-01 Pi valid active targeted repair delegates once", async () => assertBridgeValidActive("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-02 Pi missing authorization denies with zero delegation", async () => assertBridgeMissingAuthorization("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-03 Pi Git mismatch denies with zero delegation", async () => assertBridgeGitMismatch("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-04 Pi shadow preserves legacy authority", async () => assertBridgeShadow("pi", createPiDeveloperTeamExecutionBridgeV1));
test("EG8-BRIDGE-14 Pi shadow emits one safe comparison", async () => assertBridgeShadowTelemetry("pi", createPiDeveloperTeamExecutionBridgeV1));
test("EG8-BRIDGE-15 Pi telemetry failure cannot change shadow authority", async () => assertBridgeShadowTelemetryFailure("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-05 Pi legacy execution remains exact", async () => assertBridgeLegacy("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-06 Pi non-delegating decision has zero runner calls", async () => assertBridgeNonDelegatingAction("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-07 Pi task mismatch is invalid evidence", async () => assertBridgeTaskMismatch("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-08 Pi capability mismatch is not authorized", async () => assertBridgeCapabilityMismatch("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-09 Pi adapter error has no fallback retry", async () => assertBridgeAdapterError("pi", createPiDeveloperTeamExecutionBridgeV1));
test("D-BRIDGE-10 Pi unsupported hook denies active execution", async () => assertBridgeUnsupportedHook("pi", createPiDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-11 Pi rejects authorization replay after one effect", async () => assertBridgeAuthorizationReplay("pi", createPiDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-12 Pi rejects a tampered proof with zero effects", async () => assertBridgeAuthorizationTamper("pi", createPiDeveloperTeamExecutionBridgeV1));
test("G-BRIDGE-13 Pi carries validated dossier revision history", async () => assertBridgeRevisedDossierHistory("pi", createPiDeveloperTeamExecutionBridgeV1));
test("EG8-E2E-03 Pi crosses repair, staged Verify, fresh Review, and registry commit", async () => runDeveloperTeamConvergenceE2EV1("pi", createPiDeveloperTeamExecutionBridgeV1));
