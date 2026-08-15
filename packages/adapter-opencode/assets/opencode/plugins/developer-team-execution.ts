import { createHash } from "node:crypto";
import {
  createInvocationAuthorizationServiceV1,
  parseExecutionDossierHistoryV1,
  parseExecutionDossierV1,
  type DeveloperTeamRunnerHostBridgeV1,
  type InvocationAuthorizationServiceV1,
  type QaRunnerHostAuthorityV1,
} from "@deck/sdd-runtime";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "../../../src/developer-team-execution-bridge";

import {
  consumeSessionPreparationAuthorizationV1,
  type SessionPreparationAuthorizationExpectationV1,
  type SessionPreparationAuthorizationServiceV1,
} from "@deck/sdd-runtime";
const APPLY_AGENTS = new Set([
  "deck-apply-fast",
  "deck-apply-deep",
]);
type OpenCodePluginInput = { sessionID: string; messageID?: string; callID?: string; tool?: string };
type OpenCodePluginOutput = { message?: unknown; parts?: unknown[]; args?: Record<string, unknown>; result?: unknown };
type OpenCodeModelMessageTransformOutput = { messages: { info: Record<string, unknown>; parts: Record<string, unknown>[] }[] };

export interface OpenCodeDeveloperTeamExecutionPluginOptionsV1 {
  readonly authorizationService?: InvocationAuthorizationServiceV1;
  readonly bridge?: DeveloperTeamRunnerHostBridgeV1;
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveExecutionEvent?: (input: OpenCodePluginInput, args: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly qaAuthority?: QaRunnerHostAuthorityV1;
  readonly memoryLoopback?: MemoryLoopbackOptionsV1;
}

const HOST_CONTEXT = Symbol.for("deck.developer-team.execution-context.v1");
type OpenCodeHostProviderV1 = {
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveOpenCode?: OpenCodeDeveloperTeamExecutionPluginOptionsV1["resolveExecutionEvent"];
  readonly sessionPreparationAuthorizationService?: SessionPreparationAuthorizationServiceV1;
  readonly resolveOpenCodeSessionPreparation?: (input: Readonly<OpenCodePluginInput>, args: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
  readonly clearSessionPreparationSession?: (sessionId: string) => unknown | Promise<unknown>;
  readonly qaAuthority?: QaRunnerHostAuthorityV1;
  readonly memoryLoopback?: MemoryLoopbackOptionsV1;
};

type MemoryLoopbackOptionsV1 = Readonly<{
  endpoint?: string;
  token?: string;
  post?: (endpoint: string, token: string, body: string) => Promise<{ ok?: boolean; advisoryText?: string; diagnostics?: readonly string[] }>;
}>;

function receiptDigest(input: OpenCodePluginInput, output: OpenCodePluginOutput): `sha256:${string}` {
  const value = JSON.stringify({ sessionID: input.sessionID, messageID: input.messageID ?? null, message: output.message ?? null, parts: output.parts ?? [] });
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function applyAgent(args: Record<string, unknown>): boolean {
  const role = args.subagent_type ?? args.agent ?? args.role;
  return typeof role === "string" && APPLY_AGENTS.has(role);
}

function qaRole(args: Record<string, unknown>): "verify" | "review" | undefined {
  const role = args.subagent_type ?? args.agent ?? args.role;
  if (role === "deck-quality") return args.quality_stage === "review" ? "review" : "verify";
  return undefined;
}

function qaPendingKey(sessionId: string, callId: string): string {
  return JSON.stringify([sessionId, callId]);
}

function isDelegationTool(tool: string | undefined): boolean {
  // OpenCode exposes subagent delegation as `task`; older releases and test
  // hosts used `delegate`. Treat both as the same trusted runner boundary.
  return tool === "task" || tool === "delegate";
}

function memoryRole(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "deck-apply-fast") return "apply-fast";
  if (value === "deck-apply-deep") return "apply-deep";
  if (value === "deck-quality") return "quality";
  if (value === "deck-setup") return "setup";
  if (value === "deck-investigate") return "investigate";
  if (value === "deck-architect") return "architect";
  return undefined;
}

function textFromOutput(output: OpenCodePluginOutput): string | undefined {
  const parts = Array.isArray(output.parts)
    ? output.parts.flatMap((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? [(part as { text: string }).text] : [])
    : [];
  if (parts.length > 0) return parts.join("\n").slice(0, 64 * 1024);
  const message = output.message;
  if (message && typeof message === "object") {
    const record = message as { content?: unknown; text?: unknown };
    if (typeof record.content === "string") return record.content.slice(0, 64 * 1024);
    if (typeof record.text === "string") return record.text.slice(0, 64 * 1024);
  }
  return undefined;
}

async function sendMemoryLoopback(options: MemoryLoopbackOptionsV1 | undefined, event: Record<string, unknown>): Promise<void> {
  const endpoint = options?.endpoint ?? process.env.DECK_RUNNER_MEMORY_ENDPOINT;
  const token = options?.token ?? process.env.DECK_RUNNER_MEMORY_TOKEN;
  if (!endpoint || !token) return;
  const body = JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "opencode", ...event });
  try {
    const post = options?.post ?? (async (url, bearer, payload) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) throw new Error("invalid loopback endpoint");
      const response = await fetch(parsed, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: payload });
      return await response.json() as { ok?: boolean; advisoryText?: string; diagnostics?: readonly string[] };
    });
    await post(endpoint, token, body);
  } catch {
    // Adaptive memory is fail-open; protected execution authority remains handled separately.
  }
}

async function recallMemoryLoopback(options: MemoryLoopbackOptionsV1 | undefined, event: Record<string, unknown>): Promise<string | undefined> {
  const endpoint = options?.endpoint ?? process.env.DECK_RUNNER_MEMORY_ENDPOINT;
  const token = options?.token ?? process.env.DECK_RUNNER_MEMORY_TOKEN;
  if (!endpoint || !token) return undefined;
  const body = JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "opencode", timestamp: Date.now(), ...event });
  try {
    const post = options?.post ?? (async (url, bearer, payload) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) throw new Error("invalid loopback endpoint");
      const response = await fetch(parsed, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: payload });
      return await response.json() as { ok?: boolean; advisoryText?: string; diagnostics?: readonly string[] };
    });
    const result = await post(endpoint, token, body);
    return typeof result.advisoryText === "string" ? result.advisoryText : undefined;
  } catch {
    return undefined;
  }
}

function memoryEvent(base: Record<string, unknown>): Record<string, unknown> {
  return { timestamp: Date.now(), ...base };
}

function qaInvocationResponse(value: unknown, callId: string): Readonly<{
  invocationId: string;
  digest: `sha256:${string}`;
  reference: object;
}> {
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) throw new Error("invalid-evidence");
  const response = value as Record<string, unknown>;
  const ownKeys = Reflect.ownKeys(response);
  const keys = Object.keys(response).sort();
  if (ownKeys.length !== 3 || ownKeys.some((key) => typeof key !== "string") || keys.length !== 3 || keys[0] !== "digest" || keys[1] !== "invocationId" || keys[2] !== "reference") {
    throw new Error("invalid-evidence");
  }
  if (
    response.invocationId !== callId ||
    typeof response.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(response.digest) ||
    !response.reference ||
    typeof response.reference !== "object" ||
    Array.isArray(response.reference) ||
    !Object.isFrozen(response.reference)
  ) {
    throw new Error("invalid-evidence");
  }
  return Object.freeze({ invocationId: response.invocationId, digest: response.digest as `sha256:${string}`, reference: response.reference });
}

function qaResult(value: unknown): object {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-evidence");
  return value;
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

export function createOpenCodeDeveloperTeamExecutionPluginV1(options: OpenCodeDeveloperTeamExecutionPluginOptionsV1 = {}) {
  const authorizationService = options.authorizationService ?? createInvocationAuthorizationServiceV1();
  const bridge = options.bridge ?? createOpenCodeDeveloperTeamExecutionBridgeV1({ authorizationService, delegate: async () => {} });
  const receipts = new Map<string, `sha256:${string}`>();
  const pendingQa = new Map<string, Readonly<{ sessionId: string; invocationId: string; digest: `sha256:${string}`; reference: object }>>();
  const settledQaKeys = new Set<string>();
  const recalledSessions = new Set<string>();
  const pendingModelContexts: string[] = [];
  const provider = (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT] as OpenCodeHostProviderV1 | undefined;
  // Capture every trusted host capability exactly once. Prompt/caller data is never consulted for authority.
  const preparationAuthorizationService = provider?.sessionPreparationAuthorizationService;
  const resolveSessionPreparation = provider?.resolveOpenCodeSessionPreparation;
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
  const resolveExecutionEvent = options.resolveExecutionEvent ?? provider?.resolveOpenCode;
  const memoryLoopback = options.memoryLoopback ?? provider?.memoryLoopback;

  return async function DeveloperTeamExecutionPlugin() {
    return {
      "experimental.chat.messages.transform": async (_input: Record<string, never>, output: OpenCodeModelMessageTransformOutput) => {
        if (pendingModelContexts.length === 0 || !Array.isArray(output.messages)) return;
        const contexts = pendingModelContexts.splice(0).join("\n\n");
        output.messages.unshift({
          info: { id: `deck-adaptive-memory-${receiptDigest({ sessionID: "model-transform" }, { parts: [{ text: contexts }] }).slice(7, 23)}`, role: "system" },
          parts: [{ type: "text", text: contexts }],
        });
      },
      "chat.message": async (input: OpenCodePluginInput, output: OpenCodePluginOutput) => {
        receipts.set(input.sessionID, receiptDigest(input, output));
        const text = textFromOutput(output);
        const messageRole = output.message && typeof output.message === "object" ? (output.message as { role?: unknown }).role : undefined;
        if (!recalledSessions.has(input.sessionID)) {
          recalledSessions.add(input.sessionID);
          const advisoryText = await recallMemoryLoopback(memoryLoopback, memoryEvent({ eventId: `${input.sessionID}:session_start`, event: "session_start", sessionId: input.sessionID, role: "lead", query: text }));
          if (advisoryText) pendingModelContexts.push(advisoryText);
        }
        if (text && messageRole === "user") await sendMemoryLoopback(memoryLoopback, memoryEvent({ eventId: `${input.sessionID}:${input.messageID ?? "message"}:user_capture`, event: "capture", sessionId: input.sessionID, source: "trusted-user-prompt", content: text, correlationId: input.messageID }));
        if (text && messageRole === "assistant") await sendMemoryLoopback(memoryLoopback, memoryEvent({ eventId: `${input.sessionID}:${input.messageID ?? "message"}:assistant_capture`, event: "capture", sessionId: input.sessionID, source: "trusted-final-assistant", content: text, correlationId: input.messageID }));
      },
      "tool.execute.before": async (input: OpenCodePluginInput, output: OpenCodePluginOutput) => {
        const args = output.args;
        if (!args || typeof args !== "object") return;
        delete args.deckExecution;
        delete args.deckPreparation;
        delete args.deckQaInvocation;
        delete args.deckQaResult;
        const requestedRole = qaRole(args);
        if (requestedRole) {
          if (!isDelegationTool(input.tool) || !input.sessionID || !input.callID) throw new Error("invalid-evidence");
          if (!modeIsValid) throw new Error("invalid-evidence");
          if (!qaAuthority) {
            if (mode === "invocation-required") throw new Error("modification-not-authorized:AUTHZ_MISSING");
            return;
          }
          const key = qaPendingKey(input.sessionID, input.callID);
          if (pendingQa.has(key) || settledQaKeys.has(key)) throw new Error("invalid-evidence");
          let response: ReturnType<typeof qaInvocationResponse>;
          try {
            response = qaInvocationResponse(
              await qaAuthority.prepare(Object.freeze({
                runnerId: "opencode",
                sessionId: input.sessionID,
                invocationId: input.callID,
                requestedRole,
              })),
              input.callID,
            );
          } catch {
            throw new Error("invalid-evidence");
          }
          pendingQa.set(key, Object.freeze({ sessionId: input.sessionID, ...response }));
          args.deckQaInvocation = response;
          return;
        }
        const role = args.subagent_type ?? args.agent ?? args.role;
        const roleAdvisory = await recallMemoryLoopback(memoryLoopback, memoryEvent({ eventId: `${input.sessionID}:${input.callID ?? "call"}:role_start`, event: "role_start", sessionId: input.sessionID, role: memoryRole(role), query: typeof role === "string" ? role : undefined }));
        if (roleAdvisory) pendingModelContexts.push(roleAdvisory);
        if (role === "deck-setup") {
          if (!isDelegationTool(input.tool) || !input.callID) throw new Error("invalid-evidence");
          if (!preparationAuthorizationService) throw new Error("modification-not-authorized:AUTHZ_PROVIDER_MISSING");
          if (!resolveSessionPreparation) throw new Error("modification-not-authorized:AUTHZ_MISSING");
          let resolved: ReturnType<typeof preparationResolution>;
          try {
            resolved = preparationResolution(await resolveSessionPreparation(Object.freeze({ ...input }), Object.freeze({ ...args })));
          } catch {
            throw new Error("invalid-evidence");
          }
          const validation = consumeSessionPreparationAuthorizationV1(
            preparationAuthorizationService,
            resolved.authorization,
            {
              ...resolved.expectation,
              sessionId: input.sessionID,
              invocationId: input.callID,
              agentId: "deck-setup",
              activeRunnerId: "opencode",
            },
          );
          if (!validation.accepted) throw new Error(`modification-not-authorized:${validation.code}`);
          args.deckPreparation = Object.freeze({
            kind: "deck-preparation-authority-reference-v1",
            ...validation.reference,
          });
          return;
        }
        if (!applyAgent(args)) return;
        if (!modeIsValid) throw new Error("invalid-evidence");
        const failClosed = mode === "invocation-required";
        if (!resolveExecutionEvent) {
          if (failClosed) throw new Error("modification-not-authorized:AUTHZ_MISSING");
          return;
        }
        let rawEvent: unknown;
        try {
          rawEvent = await resolveExecutionEvent(input, Object.freeze({ ...args }));
        } catch {
          if (failClosed) throw new Error("invalid-evidence");
          return;
        }
        if (!rawEvent || typeof rawEvent !== "object" || !input.callID) {
          if (failClosed) throw new Error("invalid-evidence");
          return;
        }
        if (mode === "static-compatible" && (rawEvent as Record<string, unknown>).mode !== "shadow") return;
        const receipt = receipts.get(input.sessionID);
        if (!receipt) throw new Error("invalid-evidence");
        try {
          const executionId = input.callID;
          const issued = authorizationInput(rawEvent as Record<string, unknown>, executionId, receipt);
          const authorization = authorizationService.issue(issued.claims);
          const outcome = await bridge.execute({
            ...(rawEvent as Record<string, unknown>),
            schema: "developer-team-host-execution-event-v1",
            runnerId: "opencode",
            executionId,
            dossier: {
              kind: "execution-dossier-v1",
              value: issued.dossier,
              ...(issued.dossierHistory === undefined ? {} : { history: issued.dossierHistory }),
            },
            authorization,
            userAuthorizationReceiptDigest: receipt,
          });
          if (outcome.code !== "executed" && outcome.code !== "shadow-complete" && outcome.code !== "legacy-complete") {
            throw new Error(outcome.authorizationCode ? `modification-not-authorized:${outcome.authorizationCode}` : outcome.code);
          }
        } catch (error) {
          if (!failClosed) return;
          if (error instanceof Error && /^(?:modification-not-authorized:AUTHZ_[A-Z_]+|invalid-evidence|adapter-error|host-hook-unsupported)$/.test(error.message)) throw error;
          throw new Error("invalid-evidence");
        }
      },
      "tool.execute.after": async (input: OpenCodePluginInput, output: OpenCodePluginOutput) => {
        const args = output.args;
        if (args && typeof args === "object") {
          delete args.deckQaInvocation;
          delete args.deckQaResult;
        }
        if (!isDelegationTool(input.tool) || !input.sessionID || !input.callID) return;
        const key = qaPendingKey(input.sessionID, input.callID);
        const pending = pendingQa.get(key);
        if (!pending) {
          if (args && typeof args === "object" && qaRole(args)) throw new Error("invalid-evidence");
          return;
        }
        try {
          if (!qaAuthority) throw new Error("invalid-evidence");
          await qaAuthority.consume(pending.reference, qaResult(output.result));
        } catch {
          throw new Error("invalid-evidence");
        } finally {
          pendingQa.delete(key);
          settledQaKeys.add(key);
        }
      },
      event: async ({ event }: { event: { type?: string; properties?: { info?: { id?: string } } } }) => {
        if (event.type !== "session.deleted" || !event.properties?.info?.id) return;
          const sessionId = event.properties.info.id;
          receipts.delete(sessionId);
          recalledSessions.delete(sessionId);
        for (const [key, pending] of pendingQa) {
          if (pending.sessionId === sessionId) pendingQa.delete(key);
        }
        for (const key of settledQaKeys) {
          const [settledSessionId] = JSON.parse(key) as [string, string];
          if (settledSessionId === sessionId) settledQaKeys.delete(key);
        }
        try {
          if (clearSessionPreparation) await clearSessionPreparation(sessionId);
        } finally {
          qaAuthority?.clearSession(sessionId);
          await sendMemoryLoopback(memoryLoopback, memoryEvent({ eventId: `${sessionId}:shutdown_flush`, event: "shutdown_flush", sessionId, role: "lead" }));
        }
      },
    };
  };
}

export default createOpenCodeDeveloperTeamExecutionPluginV1();
