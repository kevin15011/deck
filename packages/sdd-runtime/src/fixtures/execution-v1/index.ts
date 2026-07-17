import type { StateUpdate } from "../../contracts/state-update";
import type { RepairFailureEntry, RepairIncident } from "../../contracts/repair-incident";
import type { OrchestratorPipelineInput } from "../../orchestrator/orchestrator-pipeline";
import type { SafeExecutionTelemetryEventV1 } from "../../execution/telemetry";

const failure = (id: string): RepairFailureEntry => ({
  id,
  status: "open",
  sourcePhase: "verify",
  taskGroup: "EG1",
  failingContract: "REQ-ROLLOUT-001",
  errorClass: "assertion",
  evidence: { command: "bun test", latestResult: "fail", artifact: "verify-report.md", excerpt: "fixture failure" },
  attempts: { count: 0, history: [] },
  nextVerificationStage: "targeted",
  nextAction: "repair",
});

const incident = (count: number): RepairIncident => ({
  schema: "repair-incident-v1",
  incidentId: `execution-v1-${count}`,
  changeId: "developer-team-execution-convergence",
  status: "open",
  createdFrom: { phase: "verify", artifact: "verify-report.md" },
  budgets: {
    incident: { verifyCyclesSoft: 2, verifyCyclesHard: 4, repairAttemptsSoft: 2, repairAttemptsHard: 4 },
    fingerprint: { repairThreshold: 2, replanThreshold: 3, escalationThreshold: 4 },
  },
  failures: Array.from({ length: count }, (_, index) => failure(`fixture-${index}`)),
  lifecycle: [{ event: "repair.started", phase: "verify", artifact: "verify-report.md", at: "2026-07-15T00:00:00Z", summary: "fixture" }],
});

const passAudit = {
  invariants: "frozen compatibility",
  boundaries: "single package",
  ambiguity: [],
  riskSignals: [],
  confidence: 0.95,
  externalContracts: [],
  sensitiveData: [],
  testDirection: "unit-first",
};

const safeTelemetryProjection: SafeExecutionTelemetryEventV1 = {
  schema: "safe-execution-telemetry-v1",
  event: "baseline-recorded",
  runner: "opencode",
  phase: "apply",
  riskTier: "low",
  wouldBeLane: "fast",
  outcomeCode: "legacy-completed",
  count: 1,
  durationMs: 25,
};

export const EXECUTION_V1_FIXTURES = Object.freeze({
  scenarios: Object.freeze({
    legacyNoContract: { contract: null, result: "legacy-compatible" },
    pass: { findings: [], result: "pass" },
    verifyFailure: { phase: "verify", findings: ["fixture-finding"] },
    reviewFailure: { phase: "review", findings: ["fixture-finding"] },
    incident: { artifact: "repair-incident.md", status: "open" },
    unchangedSet: { prior: ["a"], current: ["a"] },
    shrinkingSet: { prior: ["a", "b"], current: ["a"] },
    expandingSet: { prior: ["a"], current: ["a", "b"] },
    excludedWip: { target: "openspec/changes/runner-capability-standardization/state.yaml", commit: "8c6d167", result: "excluded-scope" },
  }),
  repairIncidents: Object.freeze([incident(1), incident(2), incident(3)]),
  pipelineInputs: Object.freeze<OrchestratorPipelineInput[]>([
    { audit: passAudit, auditType: "spec" },
    { audit: { ...passAudit, invariants: "", boundaries: "" }, auditType: "spec", enforcementMode: "full-enforcement" },
    { audit: passAudit, auditType: "spec", failureHistory: [
      { phase: "verify", taskGroup: "EG1", failingContract: "fixture", errorClass: "assertion", changedFiles: ["fixture.ts"], reviewFindingHash: "fixture" },
      { phase: "verify", taskGroup: "EG1", failingContract: "fixture", errorClass: "assertion", changedFiles: ["fixture.ts"], reviewFindingHash: "fixture" },
    ] },
  ]),
  stateUpdate: Object.freeze<StateUpdate>({
    targetArtifact: "fixture.md", baseVersion: 1, operation: "patch",
    patch: [{ op: "replace", path: "/status", value: "done" }],
    writerId: "execution-v1", idempotencyKey: "execution-v1", timestamp: "2026-07-15T00:00:00Z",
  }),
  secretSeeds: Object.freeze(["sk-fixture-secret", "Bearer fixture-proof", "/home/fixture/private/project", "raw prompt fixture"]),
  secretSeededTelemetry: Object.freeze({
    ...safeTelemetryProjection,
    credential: "sk-fixture-secret",
    authorizationProof: "Bearer fixture-proof",
    absolutePath: "/home/fixture/private/project",
    prompt: "raw prompt fixture",
    diagnostics: "unrestricted fixture diagnostic",
  }),
  safeTelemetryProjection: Object.freeze(safeTelemetryProjection),
  invalidTelemetryValues: Object.freeze([
    { ...safeTelemetryProjection, runner: "unknown" },
    { ...safeTelemetryProjection, count: -1 },
    { ...safeTelemetryProjection, durationMs: Number.NaN },
    { ...safeTelemetryProjection, outcomeCode: "free form diagnostic" },
  ]),
  baselineExecutions: Object.freeze([
    { ...safeTelemetryProjection, riskTier: "low", wouldBeLane: "fast", durationMs: 100 },
    { ...safeTelemetryProjection, runner: "pi", riskTier: "medium", wouldBeLane: "guarded", durationMs: 200 },
    { ...safeTelemetryProjection, phase: "verify", riskTier: "high", wouldBeLane: "full_sdd", durationMs: 300 },
  ] satisfies readonly SafeExecutionTelemetryEventV1[]),
  baselines: Object.freeze([
    { ...safeTelemetryProjection, runner: "pi", riskTier: "medium", wouldBeLane: "guarded", durationMs: 200 },
    { ...safeTelemetryProjection, phase: "verify", riskTier: "high", wouldBeLane: "full_sdd", durationMs: 300 },
  ] satisfies readonly SafeExecutionTelemetryEventV1[]),
  capabilityProbes: Object.freeze({
    opencode: { runner: "opencode", supported: false, mode: "static-compatible", codes: ["INVOCATION_HOOK_UNPROVEN", "FRESH_AGENT_HOOK_UNPROVEN"] },
    pi: { runner: "pi", supported: false, mode: "static-compatible", codes: ["INVOCATION_HOOK_UNPROVEN", "FRESH_AGENT_HOOK_UNPROVEN"] },
  } as const),
});
