import { expect } from "bun:test";
import type { ExecutionDecisionV1 } from "../contracts/execution-decision";
import type { EffectResultV1 } from "./execution-adapter-port";

type AuthorityObservation = "authorized" | "missing" | "invalid" | "not-applicable" | "invalid-evidence";
type GitObservation = "not-required" | "confirmed" | "confirmation-required" | "invalid" | "not-applicable" | "invalid-evidence";
type EffectObservation = { count: 0 | 1; target: string | null; result: EffectResultV1 };

export interface BatchCContractObservation {
  decision?: ExecutionDecisionV1;
  reasonCode?: "invalid-evidence";
  inputDigest: string;
  replayDigest?: string;
  closureReplayDigest?: string;
  authority: AuthorityObservation;
  git: GitObservation;
  effect: EffectObservation;
  legacy: "not-applicable" | "legacy-authoritative";
}

export interface BatchCContractExpectation {
  action: ExecutionDecisionV1["action"] | "invalid-evidence" | "none";
  rationale: readonly string[];
  terminal: string;
  digest: "replay-equivalent" | "safe-invalid" | "not-applicable";
  authority: AuthorityObservation;
  git: GitObservation;
  effect: EffectObservation;
  legacy: "not-applicable" | "legacy-authoritative";
}

export function assertBatchCContract(
  actual: BatchCContractObservation,
  expected: BatchCContractExpectation,
): void {
  const action = actual.decision?.action ?? (actual.reasonCode === "invalid-evidence" ? "invalid-evidence" : "none");
  expect([
    action,
    actual.decision ? [...actual.decision.rationaleCodes] : [],
    actual.decision?.terminalGuard.outcome ?? (actual.reasonCode ? "invalid" : "none"),
    actual.authority,
    actual.git,
    actual.effect,
    actual.legacy,
  ]).toEqual([
    expected.action,
    [...expected.rationale],
    expected.terminal,
    expected.authority,
    expected.git,
    expected.effect,
    expected.legacy,
  ]);
  expect(actual.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  if (expected.digest === "replay-equivalent") {
    expect(actual.decision?.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(actual.replayDigest).toBe(actual.decision?.digest);
    expect(actual.closureReplayDigest).toBe(actual.decision?.digest);
    expect(actual.reasonCode).toBeUndefined();
  } else {
    expect(actual.replayDigest).toBeUndefined();
    expect(actual.closureReplayDigest).toBeUndefined();
    expect(actual.reasonCode).toBe(expected.digest === "safe-invalid" ? "invalid-evidence" : undefined);
  }
}
