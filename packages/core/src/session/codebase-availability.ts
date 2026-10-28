import { realpathSync } from "node:fs";
import type { NativeSkillsDescriptor } from "./driver";

/** Invocation-local observation, never a configuration change or repair authorization. */
export type CodebaseAvailabilityDisposition = Readonly<{
  capabilityId: "codebase-memory"; enabled: true; status: "unavailable";
  reason: "unavailable" | "unsupported"; route: "native" | "managed";
  projectRoot: string; generation: string; selectionHash: string; invocationId: string;
}>;
const receipts = new WeakMap<CodebaseAvailabilityDisposition, { signal: AbortSignal; expiresAt: number }>();
/** Host composition calls only after a typed backend failure and verified enabled selection.
 * Object identity is intentional: JSON, prompts and persisted reports cannot mint receipts.
 */
export function issueCodebaseAvailability(input: {
  skills: NativeSkillsDescriptor; projectRoot: string; invocationId: string;
  route: "native" | "managed"; reason: "unavailable" | "unsupported"; signal: AbortSignal;
}): CodebaseAvailabilityDisposition {
  input.signal.throwIfAborted();
  const receipt: CodebaseAvailabilityDisposition = Object.freeze({ capabilityId: "codebase-memory", enabled: true, status: "unavailable",
    reason: input.reason, route: input.route, projectRoot: realpathSync(input.projectRoot), generation: input.skills.contentHash,
    selectionHash: input.skills.selectionHash, invocationId: input.invocationId });
  receipts.set(receipt, { signal: input.signal, expiresAt: Date.now() + 30_000 });
  return receipt;
}
export function validateCodebaseAvailability(value: CodebaseAvailabilityDisposition, input: {
  skills: NativeSkillsDescriptor; projectRoot: string; invocationId: string; route: "native" | "managed";
}): void {
  const proof = receipts.get(value);
  if (!proof || proof.signal.aborted || Date.now() > proof.expiresAt || value.route !== input.route
    || value.projectRoot !== realpathSync(input.projectRoot) || value.invocationId !== input.invocationId
    || value.generation !== input.skills.contentHash || value.selectionHash !== input.skills.selectionHash)
    throw new Error("codebase-availability-evidence-invalid");
}

/** Parity evidence may inspect a live receipt but cannot manufacture launch authority. */
export function isCurrentCodebaseAvailability(value: CodebaseAvailabilityDisposition): boolean {
  const proof = receipts.get(value);
  return !!proof && !proof.signal.aborted && Date.now() <= proof.expiresAt;
}
