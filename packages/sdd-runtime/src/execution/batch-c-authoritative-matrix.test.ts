import { expect, test } from "bun:test";

import * as publicApi from "../index";

import {
  buildApplyBatchContractV1,
  buildFailureManifestV1,
  computeFailureDeltaV1,
  createExecutionDossierV1,
} from "../index";

import type { ApplyBatchContractV1 } from "../contracts/apply-batch";

import type { ExecutionDossierV1 } from "../contracts/execution-dossier";

import type {
  FailureFindingInputV1,
  FailureRootCause,
  FailureSeverity,
} from "../contracts/failure-manifest";

import type {
  RepairFailureEntry,
  RepairIncident,
} from "../contracts/repair-incident";

import { EXECUTION_V1_FIXTURES } from "../fixtures/execution-v1";

import { runOrchestratorPipeline } from "../orchestrator/orchestrator-pipeline";

import {
  assertBatchCContract,
  type BatchCContractObservation,
} from "./batch-c-assertions";

import {
  capabilityDescriptorDigestV1,
  executeTargetedRepairV1,
  type TargetedRepairCapabilityDescriptorV1,
} from "./execution-adapter-port";

import {
  composeDeveloperTeamExecutionV1,
  runProductionExecutionDecisionPipelineV1,
  type DeveloperTeamExecutionCompositionResultV1,
} from "./execution-composition";

import {
  replayExecutionDecisionV1,
  type ExecutionAuthorityStateV1,
  type GitSafetyStateV1,
  type TerminalGovernanceContextV1,
} from "./execution-control-plane";
import { sha, legacyInput, makeBatch, batch, FindingSpec, DossierOptions, CompositionOptions, finding, manifest, dossierFixtures, dossier, buildDossier, authorized, gitNotRequired, compositionInput, compose, descriptor, boundTargeted, observe, incident, governance } from './batch-c-authoritative-matrix-fixture';



test("C-ARCH-01 legacy orchestrator has no execution import", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  const source = await Bun.file(new URL("../orchestrator/orchestrator-pipeline.ts", import.meta.url)).text();
  expect(source).not.toContain("../execution/");
});


test("C-ARCH-02 host composition records legacy and kernel results", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(result.legacy).toEqual(runOrchestratorPipeline(legacyInput));
  expect(result.comparison).toEqual({ legacyOutcome: result.legacy?.outcome, v1Action: "targeted_repair", inputDigest: result.plan.inputDigest });
  const missingGovernance = compositionInput();
  delete missingGovernance.governance;
  expect(composeDeveloperTeamExecutionV1(missingGovernance).plan.reasonCode).toBe("invalid-evidence");
  expect(compose({ governance: { kind: "unknown" } as any }).plan.reasonCode).toBe("invalid-evidence");
});


test("C-ARCH-03 compatibility facade is not host reachability evidence", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(runProductionExecutionDecisionPipelineV1).toBe(composeDeveloperTeamExecutionV1);
  const repair = await Bun.file(new URL("../../../../openspec/changes/developer-team-execution-convergence/spec-repair-batch-c.md", import.meta.url)).text();
  const tasks = await Bun.file(new URL("../../../../openspec/changes/developer-team-execution-convergence/tasks.md", import.meta.url)).text();
  expect([repair.includes("HO-BC-TO-BD-HOST-REACHABILITY-v1"), tasks.includes("RQH-BC-001 mandatory host-reachability")]).toEqual([true, true]);
});


test("C-AUTH-01 omitted authority is invalid evidence", async () => {
  const input = compositionInput();
  delete input.authority;
  const result = composeDeveloperTeamExecutionV1(input);
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
});


test("C-AUTH-02 missing authority stops distinctly", async () => {
  const result = compose({ authority: { state: "missing", rationaleCode: "AUTHZ_MISSING" } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["AUTHZ_MISSING"], terminal: "permit", digest: "replay-equivalent", authority: "missing", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-AUTH-03 invalid authority stops distinctly", async () => {
  const result = compose({ authority: { state: "invalid", rationaleCode: "AUTHZ_INVALID", rejectionCode: "expired", reference: null } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["AUTHZ_INVALID"], terminal: "permit", digest: "replay-equivalent", authority: "invalid", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-AUTH-04 malformed accepted authority is rejected", async () => {
  const result = compose({ authority: { state: "authorized", capabilityDigest: sha("c"), reference: { validation: "rejected" } } });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
});


test("C-GIT-01 omitted Git safety is invalid evidence", async () => {
  const input = compositionInput();
  delete input.gitSafety;
  const result = composeDeveloperTeamExecutionV1(input);
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
});


test("C-GIT-02 confirmation-required Git state stops", async () => {
  const result = compose({ gitSafety: { state: "confirmation-required", commandDigest: sha("e"), rationaleCode: "GIT_SAFETY_CONFIRMATION_REQUIRED" } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["GIT_SAFETY_CONFIRMATION_REQUIRED"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "confirmation-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-GIT-03 invalid Git state stops", async () => {
  const result = compose({ gitSafety: { state: "invalid", rationaleCode: "GIT_SAFETY_CONFIRMATION_INVALID" } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["GIT_SAFETY_CONFIRMATION_INVALID"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "invalid", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-GIT-04 destructive capability without confirmation is denied", async () => {
  const { result, capability } = boundTargeted({}, { destructive: true });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } }, legacy: "not-applicable" });
});


test("C-GIT-05 mismatched destructive command digest is denied", async () => {
  const confirmed: GitSafetyStateV1 = { state: "confirmed", commandDigest: sha("f"), confirmationReceiptDigest: sha("a") };
  const { result, capability } = boundTargeted({}, { destructive: true, gitSafety: confirmed });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "confirmed", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "modification-not-authorized" } }, legacy: "not-applicable" });
});


test("C-GIT-06 matching destructive confirmation permits one invocation", async () => {
  const confirmed: GitSafetyStateV1 = { state: "confirmed", commandDigest: sha("e"), confirmationReceiptDigest: sha("a") };
  const { result, capability } = boundTargeted({}, { destructive: true, gitSafety: confirmed });
  assertBatchCContract(await observe(result, capability), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "confirmed", effect: { count: 1, target: "packages/sdd-runtime", result: { invoked: true } }, legacy: "not-applicable" });
});


test("C-RISK-01 positive shrink leaving critical implementation risk escalates", async () => {
  const remaining = { key: "critical", severity: "critical" as const };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["HIGH_RISK_REPAIR_FORBIDDEN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-02 positive shrink leaving high implementation risk escalates", async () => {
  const remaining = { key: "high", severity: "high" as const };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["HIGH_RISK_REPAIR_FORBIDDEN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-03 positive shrink leaving low security risk escalates", async () => {
  const remaining = { key: "security", root: "security" as const, severity: "low" as const, isSecurityRelevant: true };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["SECURITY_REGRESSION"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-04 positive shrink leaving low data-loss risk escalates", async () => {
  const remaining = { key: "data-loss", category: "data-loss", severity: "low" as const };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["PROTECTED_RISK_DATA_LOSS"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-05 authorization risk obeys authority stop precedence", async () => {
  const remaining = { key: "authorization", root: "authorization" as const, severity: "low" as const };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining], authority: { state: "invalid", rationaleCode: "AUTHZ_INVALID", rejectionCode: "scope", reference: null } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["AUTHZ_INVALID"], terminal: "permit", digest: "replay-equivalent", authority: "invalid", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-06 Git-safety risk obeys Git stop precedence", async () => {
  const remaining = { key: "git", root: "git_safety" as const, severity: "low" as const };
  const result = compose({ prior: [remaining, { key: "resolved", severity: "low" }], current: [remaining], gitSafety: { state: "confirmation-required", commandDigest: sha("e"), rationaleCode: "GIT_SAFETY_CONFIRMATION_REQUIRED" } });
  assertBatchCContract(await observe(result), { action: "stop", rationale: ["GIT_SAFETY_CONFIRMATION_REQUIRED"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "confirmation-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-07 uncovered requirement routes to Spec replan", async () => {
  const result = compose({ prior: [{ key: "requirement", root: "requirement", severity: "critical" }], current: [{ key: "requirement", root: "requirement", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "replan_spec", rationale: ["ROOT_REQUIREMENT_GAP"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-08 new low related regression replans without modification", async () => {
  const result = compose({ prior: [], current: [{ key: "new-low", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["RELATED_REGRESSION_REPLAN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-09 new medium related regression replans without modification", async () => {
  const result = compose({ prior: [], current: [{ key: "new-medium", severity: "medium" }] });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["RELATED_REGRESSION_REPLAN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-RISK-10 new low data-loss regression escalates", async () => {
  const result = compose({ prior: [], current: [{ key: "new-data-loss", category: "data-loss", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["PROTECTED_RISK_DATA_LOSS"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-01 unrelated baseline is quarantined from progress", async () => {
  const result = compose({ prior: [], current: [{ key: "baseline", relationship: "unrelated_baseline", status: "pre_existing" }] });
  assertBatchCContract(await observe(result), { action: "advance_verification", rationale: ["VERIFY_STAGE_ADVANCE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
  expect(result.plan.dossier?.delta?.newUnrelatedBaseline).toHaveLength(1);
  expect(result.plan.dossier?.delta?.newRelated).toEqual([]);
});


test("C-ROUTE-02 invalid oracle routes to oracle correction", async () => {
  const result = compose({ prior: [{ key: "oracle", root: "oracle", severity: "critical" }], current: [{ key: "oracle", root: "oracle", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "correct_oracle", rationale: ["ORACLE_STALE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-03 ambiguous runtime evidence routes to diagnosis", async () => {
  const result = compose({ prior: [{ key: "runtime", root: "environment", severity: "critical" }], current: [{ key: "runtime", root: "environment", severity: "low" }] });
  assertBatchCContract(await observe(result), { action: "diagnose_runtime", rationale: ["RUNTIME_AMBIGUOUS"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-04 repeated no-progress fingerprint escalates without repair", async () => {
  const unchanged = { key: "unchanged", severity: "low" as const };
  const result = compose({ prior: [unchanged], current: [unchanged], governance: governance(incident({ attempts: 3 })) });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["DELTA_NONE_CHECKPOINT", "TERMINAL_ESCALATE"], terminal: "escalate", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-05 mixed implementation and runtime roots replan", async () => {
  const result = compose({
    prior: [{ key: "implementation", severity: "critical" }, { key: "runtime", root: "environment", severity: "low" }],
    current: [{ key: "implementation", severity: "low" }, { key: "runtime", root: "environment", severity: "low" }],
  });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["MIXED_ROOT_CAUSE_REPLAN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-06 Full-SDD floor blocks automatic repair", async () => {
  const result = compose({ lane: "full_sdd" });
  assertBatchCContract(await observe(result), { action: "escalate", rationale: ["FULL_SDD_FLOOR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-07 low-risk scoped positive shrink targets repair", async () => {
  const result = compose();
  assertBatchCContract(await observe(result), { action: "targeted_repair", rationale: ["DELTA_POSITIVE_SCOPED_REPAIR"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-08 no findings with pending stage advances verification", async () => {
  const result = compose({ prior: [], current: [], nextStage: "targeted" });
  assertBatchCContract(await observe(result), { action: "advance_verification", rationale: ["VERIFY_STAGE_ADVANCE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-ROUTE-09 no findings with completed stages completes", async () => {
  const result = compose({ prior: [], current: [], nextStage: null });
  assertBatchCContract(await observe(result), { action: "complete", rationale: ["NO_OPEN_FINDINGS_COMPLETE"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});


test("C-REVIEW-01 unanchored blocking Review finding is invalid evidence", async () => {
  const raw = structuredClone(dossier({ prior: [], current: [{ key: "review-unanchored", sourcePhase: "review" }] })) as any;
  raw.currentManifest.findings[0].requirementIds = [];
  const result = compose({ dossierValue: raw });
  assertBatchCContract(await observe(result), { action: "invalid-evidence", rationale: [], terminal: "invalid", digest: "safe-invalid", authority: "invalid-evidence", git: "invalid-evidence", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "invalid-evidence" } }, legacy: "not-applicable" });
});


test("C-REVIEW-02 batch-related Review regression replans", async () => {
  const result = compose({ prior: [], current: [{ key: "review-related", sourcePhase: "review", severity: "medium" }] });
  assertBatchCContract(await observe(result), { action: "replan_design_or_tasks", rationale: ["RELATED_REGRESSION_REPLAN"], terminal: "permit", digest: "replay-equivalent", authority: "authorized", git: "not-required", effect: { count: 0, target: null, result: { invoked: false, reasonCode: "effect-not-permitted" } }, legacy: "not-applicable" });
});