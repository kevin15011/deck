import {
  assertExactKeys,
  deepFreeze,
  sha256Digest,
  type Sha256Digest,
} from "../contracts/canonical";
import {
  runOrchestratorPipeline,
  type OrchestratorPipelineInput,
  type OrchestratorPipelineResult,
} from "../orchestrator/orchestrator-pipeline";
import {
  planExecutionDecisionV1,
  type ExecutionAuthorityStateV1,
  type ExecutionPlanV1,
  type GitSafetyStateV1,
  type TerminalGovernanceContextV1,
} from "./execution-control-plane";
import type { TargetedRepairCapabilityDescriptorV1 } from "./execution-adapter-port";

type Common = {
  schema: "developer-team-execution-composition-v1";
  legacyInput: OrchestratorPipelineInput;
  governance: TerminalGovernanceContextV1;
};
export type DeveloperTeamExecutionCompositionInputV1 =
  | (Common & {
      mode: "legacy";
      dossier: { kind: "none" };
      authority: Extract<
        ExecutionAuthorityStateV1,
        { state: "not-applicable" }
      >;
      gitSafety: Extract<GitSafetyStateV1, { state: "not-applicable" }>;
      effectBinding: { kind: "none" };
    })
  | (Common & {
      mode: "shadow";
      dossier: { kind: "execution-dossier-v1"; value: unknown; history?: readonly unknown[] };
      authority: Exclude<
        ExecutionAuthorityStateV1,
        { state: "not-applicable" }
      >;
      gitSafety: Exclude<GitSafetyStateV1, { state: "not-applicable" }>;
      effectBinding: { kind: "none" };
    })
  | (Common & {
      mode: "active";
      dossier: { kind: "execution-dossier-v1"; value: unknown; history?: readonly unknown[] };
      authority: Exclude<
        ExecutionAuthorityStateV1,
        { state: "not-applicable" }
      >;
      gitSafety: Exclude<GitSafetyStateV1, { state: "not-applicable" }>;
      effectBinding: { kind: "none" } | TargetedRepairCapabilityDescriptorV1;
    });
export interface DeveloperTeamExecutionCompositionResultV1 {
  readonly mode: "legacy" | "shadow" | "active";
  readonly legacy?: OrchestratorPipelineResult;
  readonly plan: ExecutionPlanV1;
  readonly authoritative: "legacy" | "v1";
  readonly comparison: {
    readonly legacyOutcome?: OrchestratorPipelineResult["outcome"];
    readonly v1Action?: string;
    readonly inputDigest: Sha256Digest;
    readonly reasonCode?: "invalid-evidence";
  };
}

function invalidComposition(
  input: unknown,
): DeveloperTeamExecutionCompositionResultV1 {
  const plan = planExecutionDecisionV1(
    "shadow",
    undefined,
    undefined,
    undefined,
    undefined,
    { kind: "none" },
  );
  return deepFreeze({
    mode: "shadow" as const,
    plan,
    authoritative: "legacy" as const,
    comparison: {
      inputDigest: plan.inputDigest,
      reasonCode: "invalid-evidence" as const,
    },
  });
}

function assertLegacyComposition(raw: Record<string, unknown>): void {
  if (raw.legacyInput === undefined)
    throw new Error("invalid-evidence: legacy input");
  assertExactKeys(raw.authority, ["state", "rationaleCode"], "legacy authority");
  const authority = raw.authority as Record<string, unknown>;
  if (
    authority.state !== "not-applicable" ||
    authority.rationaleCode !== "LEGACY_AUTHORITY"
  ) {
    throw new Error("invalid-evidence: legacy authority");
  }
  assertExactKeys(raw.gitSafety, ["state", "rationaleCode"], "legacy gitSafety");
  const gitSafety = raw.gitSafety as Record<string, unknown>;
  if (
    gitSafety.state !== "not-applicable" ||
    gitSafety.rationaleCode !== "LEGACY_AUTHORITY"
  ) {
    throw new Error("invalid-evidence: legacy gitSafety");
  }
  assertExactKeys(raw.governance, ["kind"], "legacy governance");
  if ((raw.governance as Record<string, unknown>).kind !== "none")
    throw new Error("invalid-evidence: legacy governance");
  assertExactKeys(raw.effectBinding, ["kind"], "legacy effectBinding");
  if ((raw.effectBinding as Record<string, unknown>).kind !== "none")
    throw new Error("invalid-evidence: legacy effectBinding");
}

/** Validates the mode union before accessing legacy input; shadow remains legacy-authoritative. */
export function composeDeveloperTeamExecutionV1(
  input: unknown,
): DeveloperTeamExecutionCompositionResultV1 {
  try {
    assertExactKeys(
      input,
      [
        "schema",
        "mode",
        "legacyInput",
        "dossier",
        "authority",
        "gitSafety",
        "governance",
        "effectBinding",
      ],
      "execution composition",
    );
    const raw = input as Record<string, unknown>;
    if (
      raw.schema !== "developer-team-execution-composition-v1" ||
      (raw.mode !== "legacy" && raw.mode !== "shadow" && raw.mode !== "active")
    )
      return invalidComposition(input);
    if (raw.mode === "legacy") {
      assertExactKeys(raw.dossier, ["kind"], "composition.dossier");
      if ((raw.dossier as Record<string, unknown>).kind !== "none")
        return invalidComposition(input);
      assertLegacyComposition(raw);
      const legacy = runOrchestratorPipeline(
        raw.legacyInput as OrchestratorPipelineInput,
      );
      const replayPayload = {
        schema: "execution-replay-record-v1" as const,
        outcome: "legacy" as const,
        mode: "legacy" as const,
        policyVersion: "execution-decision-policy-v1" as const,
      };
      const digest = sha256Digest(replayPayload);
      const plan = deepFreeze({
        mode: "legacy" as const,
        inputDigest: digest,
        replayRecord: deepFreeze({
          ...replayPayload,
          inputDigest: digest,
        }),
        replay: () => undefined,
      });
      return deepFreeze({
        mode: "legacy" as const,
        legacy,
        plan,
        authoritative: "legacy" as const,
        comparison: { legacyOutcome: legacy.outcome, inputDigest: digest },
      });
    }
    assertExactKeys(raw.dossier, ["kind", "value", "history"], "composition.dossier");
    if (
      (raw.dossier as Record<string, unknown>).kind !==
        "execution-dossier-v1" ||
      raw.legacyInput === undefined
    )
      return invalidComposition(input);
    const legacy = runOrchestratorPipeline(
      raw.legacyInput as OrchestratorPipelineInput,
    );
    const plan = planExecutionDecisionV1(
      raw.mode,
      (raw.dossier as Record<string, unknown>).value,
      raw.authority,
      raw.gitSafety,
      raw.effectBinding,
      raw.governance as TerminalGovernanceContextV1,
      (raw.dossier as Record<string, unknown>).history as readonly unknown[] | undefined,
    );
    return deepFreeze({
      mode: raw.mode,
      legacy,
      plan,
      authoritative:
        raw.mode === "shadow" ? ("legacy" as const) : ("v1" as const),
      comparison: {
        legacyOutcome: legacy.outcome,
        v1Action: plan.decision?.action,
        inputDigest: plan.inputDigest,
        ...(plan.reasonCode ? { reasonCode: plan.reasonCode } : {}),
      },
    });
  } catch {
    return invalidComposition(input);
  }
}
/** @deprecated Package compatibility facade; Batch D, not this export, owns host reachability. */
export const runProductionExecutionDecisionPipelineV1 =
  composeDeveloperTeamExecutionV1;
