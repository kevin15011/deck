import { createHash } from "node:crypto";
import {
  createInvocationAuthorizationServiceV1,
  parseExecutionDossierHistoryV1,
  parseExecutionDossierV1,
  type DeveloperTeamRunnerHostBridgeV1,
  type InvocationAuthorizationServiceV1,
} from "@deck/sdd-runtime";
import { createPiDeveloperTeamExecutionBridgeV1 } from "../../../src/developer-team-execution-bridge";

const APPLY_AGENTS = new Set([
  "apply-general",
  "apply-backend",
  "apply-frontend",
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
]);

type PiExtensionApi = { on(event: string, handler: (event: any, context: any) => Promise<unknown>): void };

export interface PiDeveloperTeamExecutionExtensionOptionsV1 {
  readonly authorizationService?: InvocationAuthorizationServiceV1;
  readonly bridge?: DeveloperTeamRunnerHostBridgeV1;
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveExecutionEvent?: (event: Readonly<Record<string, unknown>>, input: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
}

const HOST_CONTEXT = Symbol.for("deck.developer-team.execution-context.v1");
type PiHostProviderV1 = {
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolvePi?: PiDeveloperTeamExecutionExtensionOptionsV1["resolveExecutionEvent"];
};

function digestInput(text: unknown): `sha256:${string}` {
  const value = typeof text === "string" ? text : JSON.stringify(text ?? null);
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function applyAgent(input: Record<string, unknown>): boolean {
  const role = input.subagent_type ?? input.agent ?? input.role;
  return typeof role === "string" && APPLY_AGENTS.has(role);
}

function authorizationInput(event: Record<string, unknown>, executionId: string, receipt: `sha256:${string}`) {
  if (!event.dossier || typeof event.dossier !== "object" || (event.dossier as Record<string, unknown>).kind !== "execution-dossier-v1") throw new Error("invalid-evidence");
  const dossierEnvelope = event.dossier as Record<string, unknown>;
  const dossierHistory = dossierEnvelope.history === undefined
    ? undefined
    : parseExecutionDossierHistoryV1(dossierEnvelope.history);
  const dossier = parseExecutionDossierV1(dossierEnvelope.value, dossierHistory);
  const taskArtifactPath = event.taskArtifactPath;
  const target = event.target;
  if (typeof taskArtifactPath !== "string" || typeof target !== "string") throw new Error("invalid-evidence");
  const taskArtifactDigest = dossier.batch.artifactDigests[taskArtifactPath];
  if (!taskArtifactDigest) throw new Error("invalid-evidence");
  const policy = event.policy as { blockedTargets?: unknown } | undefined;
  const policyBlocked = Array.isArray(policy?.blockedTargets) ? policy.blockedTargets.filter((value): value is string => typeof value === "string") : [];
  return {
    dossier,
    dossierHistory,
    claims: {
      invocationId: executionId,
      changeId: dossier.batch.changeId,
      batchId: dossier.batch.batchId,
      batchDigest: dossier.batch.digest,
      role: dossier.batch.ownerRole,
      taskArtifactDigest,
      allowedActions: ["targeted_repair"] as const,
      allowedTargets: [target],
      blockedTargets: [...new Set([...dossier.batch.blockedTargets, ...policyBlocked])],
      userAuthorizationReceiptDigest: receipt,
    },
  };
}

export function createPiDeveloperTeamExecutionExtensionV1(options: PiDeveloperTeamExecutionExtensionOptionsV1 = {}) {
  const authorizationService = options.authorizationService ?? createInvocationAuthorizationServiceV1();
  const bridge = options.bridge ?? createPiDeveloperTeamExecutionBridgeV1({ authorizationService, delegate: async () => {} });
  const provider = (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT] as PiHostProviderV1 | undefined;
  // Capture selected invocationAuthorization exactly once (immutable snapshot). Do not re-read options or provider mode fields.
  const capturedOptionsMode = options.invocationAuthorization;
  const capturedProviderMode = capturedOptionsMode !== undefined ? undefined : provider?.invocationAuthorization;
  const rawMode = capturedOptionsMode !== undefined
    ? capturedOptionsMode
    : capturedProviderMode !== undefined
      ? capturedProviderMode
      : "static-compatible";
  const modeIsValid = rawMode === "invocation-required" || rawMode === "static-compatible";
  const mode = modeIsValid ? (rawMode as "invocation-required" | "static-compatible") : "static-compatible";
  const resolveExecutionEvent = options.resolveExecutionEvent ?? provider?.resolvePi;
  let latestReceipt: `sha256:${string}` | undefined;

  return function registerDeveloperTeamExecutionExtension(pi: PiExtensionApi): void {
    pi.on("input", async (event) => {
      latestReceipt = digestInput(event?.text ?? event);
      return { type: "continue" };
    });
    pi.on("tool_call", async (event) => {
      const input = event?.input;
      if (!input || typeof input !== "object") return undefined;
      delete input.deckExecution;
      if (!applyAgent(input)) return undefined;
      if (!modeIsValid) return { block: true, reason: "invalid-evidence" };
      const failClosed = mode === "invocation-required";
      if (!resolveExecutionEvent) {
        return failClosed
          ? { block: true, reason: "modification-not-authorized:AUTHZ_MISSING" }
          : undefined;
      }
      let rawEvent: unknown;
      try {
        rawEvent = await resolveExecutionEvent(Object.freeze({ ...event, input: undefined }), Object.freeze({ ...input }));
      } catch {
        return failClosed
          ? { block: true, reason: "invalid-evidence" }
          : undefined;
      }
      if (!rawEvent || typeof rawEvent !== "object" || !event.toolCallId) {
        return failClosed
          ? { block: true, reason: "invalid-evidence" }
          : undefined;
      }
      if (mode === "static-compatible" && (rawEvent as Record<string, unknown>).mode !== "shadow") return undefined;
      if (!latestReceipt) {
        return { block: true, reason: "invalid-evidence" };
      }
      const executionId = event.toolCallId as string;
      try {
        const issued = authorizationInput(rawEvent as Record<string, unknown>, executionId, latestReceipt);
        const authorization = authorizationService.issue(issued.claims);
        const outcome = await bridge.execute({
          ...(rawEvent as Record<string, unknown>),
          schema: "developer-team-host-execution-event-v1",
          runnerId: "pi",
          executionId,
          dossier: {
            kind: "execution-dossier-v1",
            value: issued.dossier,
            ...(issued.dossierHistory === undefined ? {} : { history: issued.dossierHistory }),
          },
          authorization,
          userAuthorizationReceiptDigest: latestReceipt,
        });
        if (outcome.code !== "executed" && outcome.code !== "shadow-complete" && outcome.code !== "legacy-complete") {
          return failClosed
            ? { block: true, reason: outcome.authorizationCode ? `modification-not-authorized:${outcome.authorizationCode}` : outcome.code }
            : undefined;
        }
        return undefined;
      } catch {
        return failClosed
          ? { block: true, reason: "invalid-evidence" }
          : undefined;
      }
    });
  };
}

export default createPiDeveloperTeamExecutionExtensionV1();
