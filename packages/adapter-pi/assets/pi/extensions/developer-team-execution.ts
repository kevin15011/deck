import { createHash } from "node:crypto";
import {
  createInvocationAuthorizationServiceV1,
  parseExecutionDossierHistoryV1,
  parseExecutionDossierV1,
  type DeveloperTeamRunnerHostBridgeV1,
  type InvocationAuthorizationServiceV1,
  type QaRunnerHostAuthorityV1,
} from "@deck/sdd-runtime";
import { createPiDeveloperTeamExecutionBridgeV1 } from "../../../src/developer-team-execution-bridge";

import {
  consumeSessionPreparationAuthorizationV1,
  type SessionPreparationAuthorizationExpectationV1,
  type SessionPreparationAuthorizationServiceV1,
} from "@deck/sdd-runtime";
const APPLY_AGENTS = new Set([
  "deck-apply-fast",
  "deck-apply-deep",
]);
type PiExtensionApi = { on(event: string, handler: (event: any, context: any) => Promise<unknown>): void };
type PiQaInvocationV1 = Readonly<{ invocationId: string; digest: `sha256:${string}`; reference: unknown }>;

export interface PiDeveloperTeamExecutionExtensionOptionsV1 {
  readonly authorizationService?: InvocationAuthorizationServiceV1;
  readonly bridge?: DeveloperTeamRunnerHostBridgeV1;
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveExecutionEvent?: (event: Readonly<Record<string, unknown>>, input: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly qaAuthority?: QaRunnerHostAuthorityV1;
}

const HOST_CONTEXT = Symbol.for("deck.developer-team.execution-context.v1");
type PiHostProviderV1 = {
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolvePi?: PiDeveloperTeamExecutionExtensionOptionsV1["resolveExecutionEvent"];
  readonly sessionPreparationAuthorizationService?: SessionPreparationAuthorizationServiceV1;
  readonly resolvePiSessionPreparation?: (
    event: Readonly<Record<string, unknown>>,
    input: Readonly<Record<string, unknown>>,
    context: Readonly<{ sessionId: string; activeRunnerId: "pi" }>,
  ) => unknown | Promise<unknown>;
  readonly clearSessionPreparationSession?: (sessionId: string) => unknown | Promise<unknown>;
  readonly qaAuthority?: QaRunnerHostAuthorityV1;
};

function digestInput(text: unknown): `sha256:${string}` {
  const value = typeof text === "string" ? text : JSON.stringify(text ?? null);
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function applyAgent(input: Record<string, unknown>): boolean {
  const role = input.subagent_type ?? input.agent ?? input.role;
  return typeof role === "string" && APPLY_AGENTS.has(role);
}

function qaRole(input: Record<string, unknown>): "verify" | "review" | undefined {
  const role = input.subagent_type ?? input.agent ?? input.role;
  if (role === "deck-quality") return input.quality_stage === "review" ? "review" : "verify";
  return undefined;
}

function qaInvocation(value: unknown, toolCallId: string): PiQaInvocationV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.isFrozen(value)) throw new Error("invalid-evidence");
  const resolution = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(resolution);
  const keys = Object.keys(resolution).sort();
  if (
    ownKeys.length !== 3 ||
    ownKeys.some((key) => typeof key !== "string") ||
    keys.length !== 3 ||
    keys[0] !== "digest" ||
    keys[1] !== "invocationId" ||
    keys[2] !== "reference" ||
    resolution.invocationId !== toolCallId ||
    typeof resolution.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(resolution.digest) ||
    !resolution.reference ||
    typeof resolution.reference !== "object" ||
    !Object.isFrozen(resolution.reference)
  ) throw new Error("invalid-evidence");
  return value as PiQaInvocationV1;
}

function qaInvocationKey(sessionId: string, toolCallId: string): string {
  return `${sessionId}\u0000${toolCallId}`;
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

function preparationResolution(value: unknown): {
  readonly authorization: unknown;
  readonly expectation: SessionPreparationAuthorizationExpectationV1;
} {
  if (!value || typeof value !== "object") throw new Error("invalid-evidence");
  const resolution = value as Record<string, unknown>;
  if (!("authorization" in resolution) || !resolution.expectation || typeof resolution.expectation !== "object") {
    throw new Error("invalid-evidence");
  }
  return {
    authorization: resolution.authorization,
    expectation: resolution.expectation as SessionPreparationAuthorizationExpectationV1,
  };
}

export function createPiDeveloperTeamExecutionExtensionV1(options: PiDeveloperTeamExecutionExtensionOptionsV1 = {}) {
  const authorizationService = options.authorizationService ?? createInvocationAuthorizationServiceV1();
  const bridge = options.bridge ?? createPiDeveloperTeamExecutionBridgeV1({ authorizationService, delegate: async () => {} });
  const provider = (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT] as PiHostProviderV1 | undefined;
  // Capture every trusted host capability exactly once. Prompt/caller data is never consulted for authority.
  const preparationAuthorizationService = provider?.sessionPreparationAuthorizationService;
  const resolveSessionPreparation = provider?.resolvePiSessionPreparation;
  const clearSessionPreparation = provider?.clearSessionPreparationSession;
  const qaAuthority = options.qaAuthority ?? provider?.qaAuthority;
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
  const pendingQaInvocations = new Map<string, Readonly<{ sessionId: string; invocation: PiQaInvocationV1 }>>();
  const settledQaInvocationKeys = new Set<string>();

  return function registerDeveloperTeamExecutionExtension(pi: PiExtensionApi): void {
    pi.on("input", async (event) => {
      latestReceipt = digestInput(event?.text ?? event);
      return { type: "continue" };
    });
    pi.on("tool_call", async (event, context) => {
      const input = event?.input;
      if (!input || typeof input !== "object") return undefined;
      delete input.deckExecution;
      delete input.deckPreparation;
      delete input.deckQaInvocation;
      delete input.deckQaResult;
      const role = input.subagent_type ?? input.agent ?? input.role;
      if (role === "deck-setup") {
        const sessionId = context?.sessionManager?.getSessionId?.();
        if (event.toolName !== "subagent" || typeof event.toolCallId !== "string" || typeof sessionId !== "string" || sessionId.length === 0) {
          return { block: true, reason: "invalid-evidence" };
        }
        if (!preparationAuthorizationService) {
          return { block: true, reason: "modification-not-authorized:AUTHZ_PROVIDER_MISSING" };
        }
        if (!resolveSessionPreparation) {
          return { block: true, reason: "modification-not-authorized:AUTHZ_MISSING" };
        }
        let resolved: ReturnType<typeof preparationResolution>;
        try {
          resolved = preparationResolution(await resolveSessionPreparation(
            Object.freeze({ ...event, input: undefined }),
            Object.freeze({ ...input }),
            Object.freeze({ sessionId, activeRunnerId: "pi" }),
          ));
        } catch {
          return { block: true, reason: "invalid-evidence" };
        }
        const validation = consumeSessionPreparationAuthorizationV1(
          preparationAuthorizationService,
          resolved.authorization,
          {
            ...resolved.expectation,
            sessionId,
            invocationId: event.toolCallId,
            agentId: "deck-setup",
            activeRunnerId: "pi",
          },
        );
        if (!validation.accepted) {
          return { block: true, reason: `modification-not-authorized:${validation.code}` };
        }
        input.deckPreparation = Object.freeze({
          kind: "deck-preparation-authority-reference-v1",
          ...validation.reference,
        });
        return undefined;
      }
      const requestedRole = qaRole(input);
      if (requestedRole) {
        if (!modeIsValid) return { block: true, reason: "invalid-evidence" };
        const failClosed = mode === "invocation-required";
        if (event.toolName !== "subagent" || typeof event.toolCallId !== "string" || event.toolCallId.length === 0) {
          return { block: true, reason: "invalid-evidence" };
        }
        const sessionId = context?.sessionManager?.getSessionId?.();
        if (typeof sessionId !== "string" || sessionId.length === 0) return { block: true, reason: "invalid-evidence" };
        if (!qaAuthority) {
          return failClosed
            ? { block: true, reason: "modification-not-authorized:AUTHZ_MISSING" }
            : undefined;
        }
        const key = qaInvocationKey(sessionId, event.toolCallId);
        if (pendingQaInvocations.has(key) || settledQaInvocationKeys.has(key)) return { block: true, reason: "invalid-evidence" };
        let invocation: PiQaInvocationV1;
        try {
          invocation = qaInvocation(await qaAuthority.prepare(Object.freeze({
            runnerId: "pi",
            sessionId,
            invocationId: event.toolCallId,
            requestedRole,
          })), event.toolCallId);
        } catch {
          return failClosed
            ? { block: true, reason: "invalid-evidence" }
            : undefined;
        }
        input.deckQaInvocation = invocation;
        pendingQaInvocations.set(key, Object.freeze({ sessionId, invocation }));
        return undefined;
      }
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
    pi.on("tool_result", async (event, context) => {
      const toolCallId = event?.toolCallId;
      const sessionId = context?.sessionManager?.getSessionId?.();
      const resultInput = event?.input;
      const reportsQaRole = !!resultInput && typeof resultInput === "object" && qaRole(resultInput) !== undefined;
      if (typeof toolCallId !== "string" || toolCallId.length === 0 || typeof sessionId !== "string" || sessionId.length === 0) {
        return reportsQaRole ? { block: true, reason: "invalid-evidence" } : undefined;
      }
      const key = qaInvocationKey(sessionId, toolCallId);
      const pending = pendingQaInvocations.get(key);
      if (!pending) {
        const hasMismatchedPending = [...pendingQaInvocations.values()].some((candidate) => candidate.invocation.invocationId === toolCallId);
        return reportsQaRole || hasMismatchedPending || settledQaInvocationKeys.has(key)
          ? { block: true, reason: "invalid-evidence" }
          : undefined;
      }
      if (event.toolName !== "subagent" || !qaAuthority) return { block: true, reason: "invalid-evidence" };
      try {
        await qaAuthority.consume(pending.invocation.reference, event?.result);
        return undefined;
      } catch {
        return { block: true, reason: "invalid-evidence" };
      } finally {
        pendingQaInvocations.delete(key);
        settledQaInvocationKeys.add(key);
      }
    });
    pi.on("session_shutdown", async (_event, context) => {
      latestReceipt = undefined;
      const sessionId = context?.sessionManager?.getSessionId?.();
      if (typeof sessionId === "string" && sessionId.length > 0) {
        for (const [key, pending] of pendingQaInvocations) if (pending.sessionId === sessionId) pendingQaInvocations.delete(key);
        for (const key of settledQaInvocationKeys) if (key.startsWith(`${sessionId}\u0000`)) settledQaInvocationKeys.delete(key);
        try {
          if (clearSessionPreparation) await clearSessionPreparation(sessionId);
        } finally {
          qaAuthority?.clearSession(sessionId);
        }
      }
    });
  };
}

export default createPiDeveloperTeamExecutionExtensionV1();
