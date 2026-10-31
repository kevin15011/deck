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


export const sha = (byte: string) => `sha256:${byte.repeat(64)}` as const;

export const legacyInput = EXECUTION_V1_FIXTURES.pipelineInputs[0]!;


export function makeBatch(
  allowedTargets: readonly string[] = ["packages/sdd-runtime"],
  blockedTargets: readonly string[] = ["openspec/changes/runner-capability-standardization"],
): ApplyBatchContractV1 {
  return buildApplyBatchContractV1({
    schema: "apply-batch-v1",
    changeId: "batch-c-matrix",
    taskIds: ["EG3-R1"],
    dependencies: [],
    ownerRole: "apply-general",
    allowedTargets,
    blockedTargets,
    acceptanceObligations: ["REQ-CBC-007"],
    verificationPlan: [{ stage: "targeted", checkIds: ["batch-c-matrix"] }],
    artifactDigests: { "tasks.md": sha("a") },
    authorizationGrantRef: sha("b"),
    provenance: { actor: "apply-general", issuedAt: "2026-07-16T00:00:00Z" },
  });
}


export const batch = makeBatch();


export interface FindingSpec {
  key: string;
  root?: FailureRootCause;
  severity?: FailureSeverity;
  category?: string;
  sourcePhase?: "apply" | "verify" | "review";
  relationship?: "batch_related" | "unrelated_baseline";
  status?: "open" | "resolved" | "pre_existing" | "out_of_scope";
  requirementIds?: readonly string[];
  taskIds?: readonly string[];
  isSecurityRelevant?: boolean;
}


export interface DossierOptions {
  batch?: ApplyBatchContractV1;
  prior?: readonly FindingSpec[];
  current?: readonly FindingSpec[];
  lane?: "guarded" | "full_sdd";
  shadowOnly?: boolean;
  nextStage?: "targeted" | null;
}


export interface CompositionOptions extends DossierOptions {
  mode?: "active" | "shadow";
  dossierValue?: unknown;
  authority?: unknown;
  gitSafety?: unknown;
  governance?: TerminalGovernanceContextV1;
  effectBinding?: unknown;
}


export function finding(spec: FindingSpec, targetBatch: ApplyBatchContractV1): FailureFindingInputV1 {
  const sourcePhase = spec.sourcePhase ?? "verify";
  const relationship = spec.relationship ?? "batch_related";
  return {
    batchId: targetBatch.batchId,
    batchDigest: targetBatch.digest,
    sourcePhase,
    sourceArtifact: sourcePhase === "review" ? "review.md" : "verify.md",
    severity: spec.severity ?? "low",
    category: spec.category ?? `case-${spec.key}`,
    rootCause: spec.root ?? "implementation",
    requirementIds: spec.requirementIds ?? ["REQ-CBC-007"],
    taskIds: spec.taskIds ?? ["EG3-R1"],
    locationKeys: [`matrix/${spec.key}.ts`],
    oracleId: `oracle-${spec.key}`,
    isSecurityRelevant: spec.isSecurityRelevant ?? spec.root === "security",
    status: spec.status ?? (relationship === "unrelated_baseline" ? "pre_existing" : "open"),
    relationship,
    evidence: [{ kind: "check", checkId: `check-${spec.key}`, artifact: sourcePhase === "review" ? "review.md" : "verify.md" }],
  };
}


export function manifest(
  targetBatch: ApplyBatchContractV1,
  specs: readonly FindingSpec[],
  producedAt: string,
) {
  const producerRole = specs.some((spec) => spec.sourcePhase === "review") ? "review" as const : "verify" as const;
  return buildFailureManifestV1({
    schema: "failure-manifest-v1",
    changeId: targetBatch.changeId,
    batch: targetBatch,
    producerRole,
    producerInstanceId: "batch-c-matrix",
    producedAt,
    findings: specs.map((spec) => finding(spec, targetBatch)),
  });
}


// Reuse construction of identical immutable test inputs; every case still exercises
// the real composition/authority boundary with a fresh clone.
export const dossierFixtures = new Map<string, ExecutionDossierV1>();

export function dossier(options: DossierOptions = {}): ExecutionDossierV1 {
  const key = JSON.stringify([options.batch, options.prior, options.current, options.lane, options.shadowOnly, options.nextStage]);
  let fixture = dossierFixtures.get(key);
  if (!fixture) { fixture = buildDossier(options); dossierFixtures.set(key, fixture); }
  return structuredClone(fixture);
}

export function buildDossier(options: DossierOptions): ExecutionDossierV1 {
  const targetBatch = options.batch ?? batch;
  const priorSpecs = options.prior ?? [{ key: "main", severity: "critical" }];
  const currentSpecs = options.current ?? [{ key: "main", severity: "low" }];
  const priorManifest = manifest(targetBatch, priorSpecs, "2026-07-15T00:00:00Z");
  const currentManifest = manifest(targetBatch, currentSpecs, "2026-07-16T00:00:00Z");
  const nextStage = options.nextStage === undefined ? "targeted" : options.nextStage;
  return createExecutionDossierV1({
    schema: "execution-dossier-v1",
    batch: targetBatch,
    priorManifest,
    currentManifest,
    delta: computeFailureDeltaV1(priorManifest, currentManifest),
    lane: {
      schema: "lane-decision-v1",
      lane: options.lane ?? "guarded",
      riskScore: 1,
      floorReasons: [],
      policyOverrides: [],
      shadowOnly: options.shadowOnly ?? false,
    },
    verification: {
      schema: "staged-verification-state-v1",
      batchId: targetBatch.batchId,
      stages: [{
        stage: "targeted",
        status: nextStage ? "pending" : "passed",
        checkIds: ["batch-c-matrix"],
        evidence: [],
      }],
      ...(nextStage ? { nextStage } : {}),
    },
    causalContext: {
      schema: "causal-context-v1",
      batchDigest: targetBatch.digest,
      priorDecisionDigests: [],
      activeFindingIds: currentManifest.findings
        .filter((entry) => entry.status === "open")
        .map((entry) => entry.findingId),
      evidenceRefs: [],
      attemptSummaries: [],
    },
    registryIntents: [],
  });
}


export const authorized = (capabilityDigest = sha("c")): ExecutionAuthorityStateV1 => ({
  state: "authorized",
  capabilityDigest,
  reference: { validation: "accepted" },
});


export const gitNotRequired: GitSafetyStateV1 = { state: "not-required", policyDigest: sha("d") };


export function compositionInput(options: CompositionOptions = {}): Record<string, unknown> {
  const dossierValue = Object.prototype.hasOwnProperty.call(options, "dossierValue")
    ? options.dossierValue
    : dossier(options);
  return {
    schema: "developer-team-execution-composition-v1",
    mode: options.mode ?? "active",
    legacyInput,
    dossier: { kind: "execution-dossier-v1", value: dossierValue },
    authority: options.authority ?? authorized(),
    gitSafety: options.gitSafety ?? gitNotRequired,
    governance: options.governance ?? { kind: "none" },
    effectBinding: options.effectBinding ?? { kind: "none" },
  };
}


export function compose(options: CompositionOptions = {}): DeveloperTeamExecutionCompositionResultV1 {
  return composeDeveloperTeamExecutionV1(compositionInput(options));
}


export function descriptor(
  result: DeveloperTeamExecutionCompositionResultV1,
  target = "packages/sdd-runtime",
  destructive = false,
): TargetedRepairCapabilityDescriptorV1 {
  if (!result.plan.dossier || !result.plan.decision) throw new Error("matrix setup requires a valid decision");
  const value = {
    kind: "targeted-repair-capability-v1" as const,
    runnerId: "opencode" as const,
    invocationId: "batch-c-matrix-invocation",
    batchId: result.plan.dossier.batch.batchId,
    batchDigest: result.plan.dossier.batch.digest,
    dossierDigest: result.plan.dossier.digest,
    decisionDigest: result.plan.decision.digest,
    action: "targeted_repair" as const,
    target,
    gitEffect: destructive
      ? { kind: "destructive" as const, commandDigest: sha("e") }
      : { kind: "non-destructive" as const },
  };
  return { ...value, capabilityDigest: capabilityDescriptorDigestV1(value) };
}


export function boundTargeted(
  options: CompositionOptions = {},
  binding: { target?: string; destructive?: boolean; gitSafety?: GitSafetyStateV1 } = {},
) {
  const gitSafety = binding.gitSafety ?? gitNotRequired;
  const provisional = compose({ ...options, authority: authorized(), gitSafety, effectBinding: { kind: "none" } });
  const capability = descriptor(provisional, binding.target, binding.destructive);
  const result = compose({
    ...options,
    authority: authorized(capability.capabilityDigest),
    gitSafety,
    effectBinding: capability,
  });
  return { result, capability };
}


export async function observe(
  result: DeveloperTeamExecutionCompositionResultV1,
  capability?: TargetedRepairCapabilityDescriptorV1,
  behavior: "success" | "throw" = "success",
): Promise<BatchCContractObservation> {
  let count: 0 | 1 = 0;
  let target: string | null = null;
  const effectResult = await executeTargetedRepairV1(
    result.plan,
    capability
      ? {
          descriptor: capability,
          invoke: async (request) => {
            count = 1;
            target = request.target;
            if (behavior === "throw") throw new Error("adapter failure");
            return { invoked: true };
          },
        }
      : undefined,
  );
  const record = result.plan.replayRecord;
  const replay = replayExecutionDecisionV1(record);
  const closureReplay = result.plan.replay();
  const authority: BatchCContractObservation["authority"] = record.outcome === "valid"
    ? record.authority.state
    : record.outcome === "legacy" ? "not-applicable" : "invalid-evidence";
  const git: BatchCContractObservation["git"] = record.outcome === "valid"
    ? record.gitSafety.state
    : record.outcome === "legacy" ? "not-applicable" : "invalid-evidence";
  return {
    decision: result.plan.decision,
    reasonCode: result.plan.reasonCode,
    inputDigest: result.plan.inputDigest,
    replayDigest: replay?.digest,
    closureReplayDigest: closureReplay?.digest,
    authority,
    git,
    effect: { count, target, result: effectResult },
    legacy: result.legacy && result.authoritative === "legacy"
      ? "legacy-authoritative" as const
      : "not-applicable" as const,
  };
}


export function incident(options: { attempts?: number; runtimeTokens?: number; failures?: boolean } = {}): RepairIncident {
  const failure: RepairFailureEntry = {
    id: "batch-c-terminal",
    status: "open",
    sourcePhase: "verify",
    taskGroup: "EG3-R1",
    failingContract: "REQ-CBC-007",
    errorClass: "assertion",
    evidence: { command: "bun test", latestResult: "fail", artifact: "verify.md", excerpt: "matrix failure" },
    attempts: { count: options.attempts ?? 0, history: [] },
    nextVerificationStage: "targeted",
    nextAction: "repair",
    fingerprint: {
      phase: "verify",
      taskGroup: "EG3-R1",
      failingContract: "REQ-CBC-007",
      errorClass: "assertion",
      changedFiles: ["packages/sdd-runtime/src/execution/execution-control-plane.ts"],
      reviewFindingHash: "batch-c",
    },
  };
  return {
    schema: "repair-incident-v1",
    incidentId: "batch-c-terminal-incident",
    changeId: batch.changeId,
    status: "open",
    createdFrom: { phase: "verify", artifact: "verify.md" },
    budgets: {
      incident: { verifyCyclesSoft: 10, verifyCyclesHard: 20, repairAttemptsSoft: 10, repairAttemptsHard: 20 },
      fingerprint: { repairThreshold: 2, replanThreshold: 3, escalationThreshold: 4 },
    },
    failures: options.failures === false ? [] : [failure],
    lifecycle: [{ event: "repair.started", phase: "verify", artifact: "verify.md", at: "2026-07-16T00:00:00Z", summary: "matrix" }],
    ...(options.runtimeTokens === undefined ? {} : {
      runtimeBudget: { tokensUsed: options.runtimeTokens, turnsUsed: 1, timeElapsedMs: 1, toolCallsUsed: 1 },
    }),
  };
}


export const governance = (
  value: RepairIncident,
  config: Extract<TerminalGovernanceContextV1, { kind: "repair-incident" }>["config"] = "default",
): TerminalGovernanceContextV1 => ({ kind: "repair-incident", incident: value, config });