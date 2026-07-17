import type { OrchestratorPipelineInput } from "../orchestrator/orchestrator-pipeline";
import { parseExecutionDossierHistoryV1, parseExecutionDossierV1, type ExecutionDossierV1 } from "../contracts/execution-dossier";
import {
  assertDigest,
  assertExactKeys,
  codeValue,
  denseArray,
  enumValue,
  repositoryPath,
  sha256Digest,
  stringValue,
  type Sha256Digest,
} from "../contracts/canonical";
import {
  capabilityDescriptorDigestV1,
  executeTargetedRepairV1,
  type EffectResultV1,
  type TargetedRepairCapabilityDescriptorV1,
  type TargetedRepairRequestV1,
} from "./execution-adapter-port";
import {
  composeDeveloperTeamExecutionV1,
  type DeveloperTeamExecutionCompositionResultV1,
} from "./execution-composition";
import type {
  ExecutionAuthorityStateV1,
  GitSafetyStateV1,
  TerminalGovernanceContextV1,
} from "./execution-control-plane";
import type {
  InvocationAuthorizationRejectionCodeV1,
  InvocationAuthorizationServiceV1,
} from "./invocation-authorization-service";
import { createNoopTelemetrySink, type SafeTelemetrySinkV1, type TelemetryRiskTierV1 } from "./telemetry";

const EXCLUDED_WIP = "openspec/changes/runner-capability-standardization";
const PATH_CONTEXT = { repositoryRoot: "." } as const;

export interface DeveloperTeamHostExecutionEventV1 {
  readonly schema: "developer-team-host-execution-event-v1";
  readonly runnerId: "opencode" | "pi";
  readonly executionId: string;
  readonly mode: "legacy" | "shadow" | "active";
  readonly legacyInput: OrchestratorPipelineInput;
  readonly dossier: { readonly kind: "none" } | {
    readonly kind: "execution-dossier-v1";
    readonly value: unknown;
    readonly history?: readonly unknown[];
  };
  readonly authorization: unknown;
  readonly taskArtifactPath: string | null;
  readonly target: string | null;
  readonly userAuthorizationReceiptDigest: Sha256Digest | null;
  readonly policy: { readonly allowedTargets: readonly string[]; readonly blockedTargets: readonly string[] };
  readonly gitSafety: GitSafetyStateV1;
  readonly gitEffect: { readonly kind: "non-destructive" } | { readonly kind: "destructive"; readonly commandDigest: Sha256Digest } | null;
  readonly governance: TerminalGovernanceContextV1;
}

export interface DeveloperTeamHostExecutionResultV1 {
  readonly schema: "developer-team-host-execution-result-v1";
  readonly runnerId: "opencode" | "pi";
  readonly executionId: string;
  readonly code:
    | "executed"
    | "legacy-complete"
    | "shadow-complete"
    | "effect-not-permitted"
    | "modification-not-authorized"
    | "invalid-evidence"
    | "adapter-error"
    | "host-hook-unsupported";
  readonly authorizationCode?: InvocationAuthorizationRejectionCodeV1;
  readonly composition?: DeveloperTeamExecutionCompositionResultV1;
  readonly effect: EffectResultV1;
}

export interface DeveloperTeamRunnerHostBridgeV1 {
  readonly runnerId: "opencode" | "pi";
  readonly capabilities: {
    readonly invocationAuthorizationV1: boolean;
    readonly perExecutionDossierV1: boolean;
    readonly targetedRepairCapabilityV1: boolean;
  };
  execute(event: unknown): Promise<DeveloperTeamHostExecutionResultV1>;
}

export interface DeveloperTeamRunnerHostBridgeOptionsV1 {
  readonly runnerId: "opencode" | "pi";
  readonly authorizationService: InvocationAuthorizationServiceV1;
  readonly delegate: (request: TargetedRepairRequestV1) => Promise<void>;
  readonly telemetry?: SafeTelemetrySinkV1;
  readonly now?: () => number;
  readonly hostHookSupported?: boolean;
  readonly bindCapabilityForInvocation?: (descriptor: TargetedRepairCapabilityDescriptorV1) => unknown;
}

interface ParsedHostEventV1 extends Omit<DeveloperTeamHostExecutionEventV1, "dossier" | "taskArtifactPath" | "target" | "policy" | "gitEffect"> {
  readonly dossier: { readonly kind: "none" } | {
    readonly kind: "execution-dossier-v1";
    readonly value: ExecutionDossierV1;
    readonly history?: readonly ExecutionDossierV1[];
  };
  readonly taskArtifactPath: string | null;
  readonly target: string | null;
  readonly policy: { readonly allowedTargets: readonly string[]; readonly blockedTargets: readonly string[] };
  readonly gitEffect: DeveloperTeamHostExecutionEventV1["gitEffect"];
}

function normalizePaths(value: unknown, field: string): string[] {
  const paths = denseArray(value, field).map((entry, index) => repositoryPath(stringValue(entry, `${field}[${index}]`), PATH_CONTEXT, `${field}[${index}]`)).sort();
  if (new Set(paths).size !== paths.length) throw new Error(`invalid-evidence: ${field}`);
  return paths;
}

function pathsIntersect(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function parseGitEffect(value: unknown): DeveloperTeamHostExecutionEventV1["gitEffect"] {
  if (value === null) return null;
  assertExactKeys(value, ["kind", "commandDigest"], "hostEvent.gitEffect");
  const kind = enumValue(value.kind, ["non-destructive", "destructive"] as const, "hostEvent.gitEffect.kind");
  if (kind === "non-destructive") {
    if (value.commandDigest !== undefined) throw new Error("invalid-evidence: hostEvent.gitEffect");
    return { kind };
  }
  assertDigest(value.commandDigest, "hostEvent.gitEffect.commandDigest");
  return { kind, commandDigest: value.commandDigest };
}

function parseHostEvent(value: unknown, runnerId: "opencode" | "pi"): ParsedHostEventV1 {
  assertExactKeys(value, ["schema", "runnerId", "executionId", "mode", "legacyInput", "dossier", "authorization", "taskArtifactPath", "target", "userAuthorizationReceiptDigest", "policy", "gitSafety", "gitEffect", "governance"], "host execution event");
  if (value.schema !== "developer-team-host-execution-event-v1" || value.runnerId !== runnerId) throw new Error("invalid-evidence: host execution identity");
  const executionId = codeValue(value.executionId, "hostEvent.executionId");
  const mode = enumValue(value.mode, ["legacy", "shadow", "active"] as const, "hostEvent.mode");
  assertExactKeys(value.dossier, ["kind", "value", "history"], "hostEvent.dossier");
  assertExactKeys(value.policy, ["allowedTargets", "blockedTargets"], "hostEvent.policy");
  const policy = {
    allowedTargets: normalizePaths(value.policy.allowedTargets, "hostEvent.policy.allowedTargets"),
    blockedTargets: normalizePaths(value.policy.blockedTargets, "hostEvent.policy.blockedTargets"),
  };

  if (mode === "legacy") {
    if (value.dossier.kind !== "none" || value.dossier.value !== undefined || value.dossier.history !== undefined || value.authorization !== null || value.taskArtifactPath !== null || value.target !== null || value.userAuthorizationReceiptDigest !== null || value.gitEffect !== null) {
      throw new Error("invalid-evidence: legacy host event");
    }
    return {
      schema: "developer-team-host-execution-event-v1",
      runnerId,
      executionId,
      mode,
      legacyInput: value.legacyInput as OrchestratorPipelineInput,
      dossier: { kind: "none" },
      authorization: null,
      taskArtifactPath: null,
      target: null,
      userAuthorizationReceiptDigest: null,
      policy,
      gitSafety: value.gitSafety as GitSafetyStateV1,
      gitEffect: null,
      governance: value.governance as TerminalGovernanceContextV1,
    };
  }

  if (value.dossier.kind !== "execution-dossier-v1") throw new Error("invalid-evidence: hostEvent.dossier");
  const dossierHistory = value.dossier.history === undefined
    ? undefined
    : parseExecutionDossierHistoryV1(value.dossier.history);
  const dossier = parseExecutionDossierV1(value.dossier.value, dossierHistory);
  const taskArtifactPath = repositoryPath(value.taskArtifactPath, PATH_CONTEXT, "hostEvent.taskArtifactPath");
  if (!dossier.batch.artifactDigests[taskArtifactPath]) throw new Error("invalid-evidence: hostEvent.taskArtifactPath");
  const target = repositoryPath(value.target, PATH_CONTEXT, "hostEvent.target");
  assertDigest(value.userAuthorizationReceiptDigest, "hostEvent.userAuthorizationReceiptDigest");
  if (!dossier.batch.allowedTargets.includes(target) || !policy.allowedTargets.includes(target)) throw new Error("invalid-evidence: hostEvent.target");
  const blockedTargets = [...dossier.batch.blockedTargets, ...policy.blockedTargets, EXCLUDED_WIP];
  if (blockedTargets.some((blocked) => pathsIntersect(target, blocked))) throw new Error("invalid-evidence: hostEvent.target");
  const gitEffect = parseGitEffect(value.gitEffect);
  if (gitEffect === null) throw new Error("invalid-evidence: hostEvent.gitEffect");
  return {
    schema: "developer-team-host-execution-event-v1",
    runnerId,
    executionId,
    mode,
    legacyInput: value.legacyInput as OrchestratorPipelineInput,
    dossier: {
      kind: "execution-dossier-v1",
      value: dossier,
      ...(dossierHistory === undefined ? {} : { history: dossierHistory }),
    },
    authorization: value.authorization,
    taskArtifactPath,
    target,
    userAuthorizationReceiptDigest: value.userAuthorizationReceiptDigest,
    policy,
    gitSafety: value.gitSafety as GitSafetyStateV1,
    gitEffect,
    governance: value.governance as TerminalGovernanceContextV1,
  };
}

function result(runnerId: "opencode" | "pi", executionId: string, code: DeveloperTeamHostExecutionResultV1["code"], effect: EffectResultV1, composition?: DeveloperTeamExecutionCompositionResultV1, authorizationCode?: InvocationAuthorizationRejectionCodeV1): DeveloperTeamHostExecutionResultV1 {
  return Object.freeze({
    schema: "developer-team-host-execution-result-v1" as const,
    runnerId,
    executionId,
    code,
    effect,
    ...(composition ? { composition } : {}),
    ...(authorizationCode ? { authorizationCode } : {}),
  });
}

function deniedAuthority(code: InvocationAuthorizationRejectionCodeV1): ExecutionAuthorityStateV1 {
  return code === "AUTHZ_MISSING"
    ? { state: "missing", rationaleCode: "AUTHZ_MISSING" }
    : { state: "invalid", rationaleCode: "AUTHZ_INVALID", rejectionCode: code, reference: null };
}

function telemetryRiskTier(composition: DeveloperTeamExecutionCompositionResultV1): TelemetryRiskTierV1 {
  switch (composition.legacy?.riskResult.tier) {
    case "critical": return "critical";
    case "high": return "high";
    case "boundary": return "medium";
    default: return "low";
  }
}

export function createDeveloperTeamRunnerHostBridgeV1(options: DeveloperTeamRunnerHostBridgeOptionsV1): DeveloperTeamRunnerHostBridgeV1 {
  const hostHookSupported = options.hostHookSupported !== false;
  const telemetry = options.telemetry ?? createNoopTelemetrySink();
  const now = options.now ?? Date.now;
  const readTime = () => {
    try {
      const value = now();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  };
  const capabilities = Object.freeze({
    invocationAuthorizationV1: hostHookSupported,
    perExecutionDossierV1: hostHookSupported,
    targetedRepairCapabilityV1: hostHookSupported,
  });

  async function execute(eventValue: unknown): Promise<DeveloperTeamHostExecutionResultV1> {
    const startedAt = readTime();
    let event: ParsedHostEventV1;
    try {
      event = parseHostEvent(eventValue, options.runnerId);
    } catch {
      return result(options.runnerId, "invalid", "invalid-evidence", { invoked: false, reasonCode: "invalid-evidence" });
    }

    async function finish(
      code: DeveloperTeamHostExecutionResultV1["code"],
      effect: EffectResultV1,
      composition?: DeveloperTeamExecutionCompositionResultV1,
      authorizationCode?: InvocationAuthorizationRejectionCodeV1,
    ): Promise<DeveloperTeamHostExecutionResultV1> {
      const output = result(options.runnerId, event.executionId, code, effect, composition, authorizationCode);
      if (event.mode === "shadow" && event.dossier.kind === "execution-dossier-v1" && composition) {
        const legacyOutcome = composition.comparison.legacyOutcome ?? "unknown";
        const v1Outcome = composition.comparison.v1Action ?? composition.comparison.reasonCode ?? code;
        try {
          await telemetry.emit({
            schema: "safe-execution-telemetry-v1",
            event: "shadow-compared",
            runner: options.runnerId,
            phase: "apply",
            riskTier: telemetryRiskTier(composition),
            wouldBeLane: composition.plan.dossier?.lane.lane ?? event.dossier.value.lane.lane,
            outcomeCode: `shadow-${legacyOutcome}-${v1Outcome}`,
            count: 1,
            durationMs: Math.max(0, readTime() - startedAt),
          });
        } catch {
          // Missing telemetry evidence blocks expansion, never the shadow execution.
        }
      }
      return output;
    }

    if (event.mode === "active" && !hostHookSupported) {
      return finish("host-hook-unsupported", { invoked: false, reasonCode: "effect-not-permitted" });
    }
    if (event.mode === "legacy") {
      const composition = composeDeveloperTeamExecutionV1({
        schema: "developer-team-execution-composition-v1",
        mode: "legacy",
        legacyInput: event.legacyInput,
        dossier: { kind: "none" },
        authority: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
        gitSafety: { state: "not-applicable", rationaleCode: "LEGACY_AUTHORITY" },
        governance: { kind: "none" },
        effectBinding: { kind: "none" },
      });
      return finish("legacy-complete", { invoked: false, reasonCode: "effect-not-permitted" }, composition);
    }

    if (event.dossier.kind !== "execution-dossier-v1" || event.taskArtifactPath === null || event.target === null || event.userAuthorizationReceiptDigest === null || event.gitEffect === null) {
      return finish("invalid-evidence", { invoked: false, reasonCode: "invalid-evidence" });
    }

    const dossier = event.dossier.value;
    const target = event.target;
    const taskArtifactPath = event.taskArtifactPath;
    const receiptDigest = event.userAuthorizationReceiptDigest;
    const provisionalCapabilityDigest = sha256Digest({ runnerId: options.runnerId, executionId: event.executionId, target, kind: "provisional-no-effect" });
    const provisional = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: event.mode,
      legacyInput: event.legacyInput,
      dossier: event.dossier,
      authority: { state: "authorized", capabilityDigest: provisionalCapabilityDigest, reference: { validation: "accepted" } },
      gitSafety: event.gitSafety,
      governance: event.governance,
      effectBinding: { kind: "none" },
    });
    if (provisional.plan.reasonCode || !provisional.plan.dossier || !provisional.plan.decision) {
      return finish("invalid-evidence", { invoked: false, reasonCode: "invalid-evidence" }, provisional);
    }

    const expectation = {
      invocationId: event.executionId,
      changeId: dossier.batch.changeId,
      batchId: dossier.batch.batchId,
      batchDigest: dossier.batch.digest,
      role: dossier.batch.ownerRole,
      taskArtifactDigest: dossier.batch.artifactDigests[taskArtifactPath]!,
      userAuthorizationReceiptDigest: receiptDigest,
      action: "targeted_repair",
      target,
      allowedTargets: dossier.batch.allowedTargets,
      blockedTargets: [...dossier.batch.blockedTargets, ...event.policy.blockedTargets, EXCLUDED_WIP],
    } as const;
    const willDelegate = event.mode === "active" && provisional.plan.decision.action === "targeted_repair";

    const descriptorPayload = {
      kind: "targeted-repair-capability-v1" as const,
      runnerId: options.runnerId,
      invocationId: event.executionId,
      batchId: dossier.batch.batchId,
      batchDigest: dossier.batch.digest,
      dossierDigest: dossier.digest,
      decisionDigest: provisional.plan.decision.digest,
      action: "targeted_repair" as const,
      target,
      gitEffect: event.gitEffect,
    };
    const descriptor: TargetedRepairCapabilityDescriptorV1 = Object.freeze({
      ...descriptorPayload,
      capabilityDigest: capabilityDescriptorDigestV1(descriptorPayload),
    });
    const authorization = willDelegate
      ? options.authorizationService.validateAndReserve(event.authorization, expectation)
      : options.authorizationService.validate(event.authorization, expectation);
    if (!authorization.accepted) {
      const composition = composeDeveloperTeamExecutionV1({
        schema: "developer-team-execution-composition-v1",
        mode: event.mode,
        legacyInput: event.legacyInput,
        dossier: event.dossier,
        authority: deniedAuthority(authorization.code),
        gitSafety: event.gitSafety,
        governance: event.governance,
        effectBinding: { kind: "none" },
      });
      return finish("modification-not-authorized", { invoked: false, reasonCode: "modification-not-authorized" }, composition, authorization.code);
    }

    const authorityDigest = willDelegate ? descriptor.capabilityDigest : authorization.reference.claimsDigest;
    const composition = composeDeveloperTeamExecutionV1({
      schema: "developer-team-execution-composition-v1",
      mode: event.mode,
      legacyInput: event.legacyInput,
      dossier: event.dossier,
      authority: { state: "authorized", capabilityDigest: authorityDigest, reference: { validation: "accepted" } },
      gitSafety: event.gitSafety,
      governance: event.governance,
      effectBinding: willDelegate ? descriptor : { kind: "none" },
    });
    if (event.mode === "shadow") {
      return finish("shadow-complete", { invoked: false, reasonCode: "effect-not-permitted" }, composition);
    }
    if (!willDelegate) {
      return finish("effect-not-permitted", { invoked: false, reasonCode: "effect-not-permitted" }, composition);
    }

    const capabilityDescriptor = options.bindCapabilityForInvocation?.(descriptor) ?? descriptor;
    const effect = await executeTargetedRepairV1(composition.plan, {
      descriptor: capabilityDescriptor as TargetedRepairCapabilityDescriptorV1,
      invoke: async (request) => {
        await options.delegate(request);
        return { invoked: true };
      },
    });
    const code = effect.invoked ? "executed" : effect.reasonCode;
    return finish(code, effect, composition);
  }

  return Object.freeze({ runnerId: options.runnerId, capabilities, execute });
}
