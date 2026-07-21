import { createHash } from "node:crypto";
import {
  createInvocationAuthorizationServiceV1,
  parseExecutionDossierHistoryV1,
  parseExecutionDossierV1,
  type DeveloperTeamRunnerHostBridgeV1,
  type InvocationAuthorizationServiceV1,
} from "@deck/sdd-runtime";
import { createOpenCodeDeveloperTeamExecutionBridgeV1 } from "../../../src/developer-team-execution-bridge";

const APPLY_AGENTS = new Set([
  "apply-general",
  "apply-backend",
  "apply-frontend",
  "deck-developer-apply-general",
  "deck-developer-apply-backend",
  "deck-developer-apply-frontend",
]);

type OpenCodePluginInput = { sessionID: string; messageID?: string; callID?: string; tool?: string };
type OpenCodePluginOutput = { message?: unknown; parts?: unknown[]; args?: Record<string, unknown> };

export interface OpenCodeDeveloperTeamExecutionPluginOptionsV1 {
  readonly authorizationService?: InvocationAuthorizationServiceV1;
  readonly bridge?: DeveloperTeamRunnerHostBridgeV1;
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveExecutionEvent?: (input: OpenCodePluginInput, args: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>;
}

const HOST_CONTEXT = Symbol.for("deck.developer-team.execution-context.v1");
type OpenCodeHostProviderV1 = {
  readonly invocationAuthorization?: "static-compatible" | "invocation-required";
  readonly resolveOpenCode?: OpenCodeDeveloperTeamExecutionPluginOptionsV1["resolveExecutionEvent"];
};

function receiptDigest(input: OpenCodePluginInput, output: OpenCodePluginOutput): `sha256:${string}` {
  const value = JSON.stringify({ sessionID: input.sessionID, messageID: input.messageID ?? null, message: output.message ?? null, parts: output.parts ?? [] });
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function applyAgent(args: Record<string, unknown>): boolean {
  const role = args.subagent_type ?? args.agent ?? args.role;
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

export function createOpenCodeDeveloperTeamExecutionPluginV1(options: OpenCodeDeveloperTeamExecutionPluginOptionsV1 = {}) {
  const authorizationService = options.authorizationService ?? createInvocationAuthorizationServiceV1();
  const bridge = options.bridge ?? createOpenCodeDeveloperTeamExecutionBridgeV1({ authorizationService, delegate: async () => {} });
  const receipts = new Map<string, `sha256:${string}`>();
  const provider = (globalThis as Record<PropertyKey, unknown>)[HOST_CONTEXT] as OpenCodeHostProviderV1 | undefined;
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
  const resolveExecutionEvent = options.resolveExecutionEvent ?? provider?.resolveOpenCode;

  return async function DeveloperTeamExecutionPlugin() {
    return {
      "chat.message": async (input: OpenCodePluginInput, output: OpenCodePluginOutput) => {
        receipts.set(input.sessionID, receiptDigest(input, output));
      },
      "tool.execute.before": async (input: OpenCodePluginInput, output: OpenCodePluginOutput) => {
        const args = output.args;
        if (!args || typeof args !== "object") return;
        delete args.deckExecution;
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
      event: async ({ event }: { event: { type?: string; properties?: { info?: { id?: string } } } }) => {
        if (event.type === "session.deleted" && event.properties?.info?.id) receipts.delete(event.properties.info.id);
      },
    };
  };
}

export default createOpenCodeDeveloperTeamExecutionPluginV1();
