import type {
  RunnerAdapter,
  RunnerDiagnostic,
  RunnerLaunchInput,
  RunnerLaunchPlan,
  RunnerLaunchResult,
} from "@deck/core";
import { MAX_RUNNER_STDIN_PAYLOAD_BYTES, prepareAndBuildDeveloperTeamInstallPlan, RUNNER_ENV_ALLOWLIST, isSensitiveRunnerEnv, sanitizeRunnerEnv, resolveCanonicalSupermemoryProjectScope, createOwnerOnlyFileSecretStore } from "@deck/core";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import type { SupermemoryRunnerLoopbackBridge } from "./supermemory-runtime-host";
import { resolveDeckRuntimeSessionId } from "./supermemory-session-store";
import type { SupermemoryObservabilitySink } from "./supermemory-observability";
import type { DeckSecretStore } from "@deck/core";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";
import { formatSessionRuntimeReadiness, resolveSessionRuntimeReadiness } from "./session-runtime-readiness";

export type SpawnedRunnerResult = {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
};

export type RunnerProcessEffects = {
  inheritedEnv?: Readonly<Record<string, string | undefined>>;
  readTextFile?(path: string, maxBytes: number): Promise<{ content: string; truncated: boolean }>;
  removeFile?(path: string): Promise<void>;
  spawn(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string>; stdio: "inherit" | "pipe"; stdin: "inherit" | "closed"; stdinPayload?: RunnerLaunchPlan["stdinPayload"]; captureLimitBytes?: number; sensitiveValues?: readonly string[] },
  ): Promise<SpawnedRunnerResult>;
};

export type RunnerProcessOutcome = SpawnedRunnerResult & { truncated: boolean };

export type ExplicitMemoryIntent =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "recall"; query: string }>
  | Readonly<{ kind: "remember"; content: string; correlationId: string }>;

function redact(value: string, secrets: readonly string[]): string {
  return secrets.reduce((text, secret) => secret.length > 0 ? text.split(secret).join("[REDACTED]") : text, value);
}

function bounded(value: string, limit: number): { value: string; truncated: boolean } {
  if (value === "[REDACTED]") return { value, truncated: false };
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= limit) return { value, truncated: false };
  return { value: bytes.subarray(0, limit).toString("utf8"), truncated: true };
}

function validStdinPayload(payload: RunnerLaunchPlan["stdinPayload"]): boolean {
  return payload?.type === "utf8"
    && !payload.content.includes("\0")
    && Buffer.byteLength(payload.content, "utf8") <= MAX_RUNNER_STDIN_PAYLOAD_BYTES;
}

export function classifyExplicitMemoryIntent(launch: RunnerLaunchInput): ExplicitMemoryIntent {
  if (launch.mode !== "exec") return { kind: "none" };
  const prompt = launch.prompt.join("\n").trim();
  if (!prompt || prompt.length > 2_000) return { kind: "none" };
  const remember = prompt.match(/^\s*(?:remember|memorize|save\s+(?:this|to memory))(?:\s+(?:this|that))?\s*:?\s+([\s\S]+)$/i);
  if (remember?.[1]?.trim()) {
    const content = remember[1].trim();
    return { kind: "remember", content, correlationId: `explicit-remember-${stableDigest(content)}` };
  }
  if (/^\s*(?:what\s+(?:did|have)\s+we\s+(?:do|done)\s+so\s+far\??|recall\b|search\s+(?:memory|memories)\b|look\s+up\s+in\s+memory\b|what\s+did\s+we\s+decide\b|remember\s+what\b)/i.test(prompt)) {
    return { kind: "recall", query: prompt };
  }
  return { kind: "none" };
}

export async function executeRunnerLaunchPlan(
  plan: RunnerLaunchPlan,
  effects: RunnerProcessEffects,
): Promise<RunnerProcessOutcome> {
  if (plan.stdinPayload && (!validStdinPayload(plan.stdinPayload) || plan.stdio !== "pipe" || plan.stdin !== "closed")) {
    throw new Error("Runner stdin payload is invalid.");
  }
  const env: Record<string, string> = sanitizeRunnerEnv(effects.inheritedEnv ?? process.env);
  const secrets: string[] = [];
  for (const [key, entry] of Object.entries(plan.envOverlay ?? {})) {
    if ((entry.sensitive || isSensitiveRunnerEnv(key, entry.value)) && !RUNNER_ENV_ALLOWLIST.has(key)) {
      secrets.push(entry.value);
      continue;
    }
    env[key] = entry.value;
    if (entry.sensitive) secrets.push(entry.value);
  }
  const raw = await effects.spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env,
    stdio: plan.stdio,
    stdin: plan.stdin,
    stdinPayload: plan.stdinPayload,
    captureLimitBytes: plan.captureLimitBytes,
    sensitiveValues: secrets,
  });
  const limit = plan.captureLimitBytes ?? 1024 * 1024;
  const stdout = bounded(redact(raw.stdout, secrets), limit);
  const stderr = bounded(redact(raw.stderr, secrets), limit);
  return { ...raw, signal: raw.signal, stdout: stdout.value, stderr: stderr.value, truncated: stdout.truncated || stderr.truncated };
}

function withSupermemoryLoopback(plan: RunnerLaunchPlan, bridge: SupermemoryRunnerLoopbackBridge, mode: RunnerLaunchInput["mode"]): RunnerLaunchPlan {
  return {
    ...plan,
    envOverlay: { ...(plan.envOverlay ?? {}), ...bridge.envOverlay },
    executionClass: "first-class",
    bridgeBinding: { surface: "deck-runner-memory-loopback-v1", mode, evidence: "ephemeral-loopback-token" },
  };
}

type SessionLifecycleState = "planned" | "starting" | "active" | "closing" | "closed";
type SessionCloseReason = "normal" | "signal" | "blocked" | "spawn-failed" | "exception";

type ManagedSessionRuntime = Readonly<{
  host: Awaited<ReturnType<typeof createSupermemoryRuntimeHost>>;
}>;

type SessionRuntimeLease = Readonly<{
  readonly topology: "deck-managed";
  readonly sessionFingerprint: string;
  get state(): SessionLifecycleState;
  start(): Promise<ManagedSessionRuntime>;
  startLoopbackBridge(mode: RunnerLaunchInput["mode"]): Promise<SupermemoryRunnerLoopbackBridge | undefined>;
  close(reason: SessionCloseReason): Promise<{ diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] }>;
}>;

function createManagedSessionRuntimeLease(input: {
  projectRoot: string;
  teamId: string;
  deckConfig: RunnerLaunchInput["deckConfig"];
  runnerId: string;
  sessionId: string;
  launchMode: RunnerLaunchInput["mode"];
  query?: string;
  supermemoryRuntime?: RunRunnerLaunchInput["supermemoryRuntime"];
}): SessionRuntimeLease {
  let state: SessionLifecycleState = "planned";
  let startPromise: Promise<ManagedSessionRuntime> | undefined;
  let bridgePromise: Promise<SupermemoryRunnerLoopbackBridge | undefined> | undefined;
  let bridge: SupermemoryRunnerLoopbackBridge | undefined;
  let closePromise: Promise<{ diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] }> | undefined;

  const start = async (): Promise<ManagedSessionRuntime> => {
    if (startPromise) return startPromise;
    if (state !== "planned") throw new Error(`Managed session runtime cannot start from ${state}.`);
    state = "starting";
    startPromise = createSupermemoryRuntimeHost({
      projectRoot: input.projectRoot,
      teamId: input.teamId,
      deckConfig: input.deckConfig,
      runnerId: input.runnerId,
      role: "lead",
      sessionId: input.sessionId,
      launchMode: input.launchMode,
      query: input.query,
      secretStore: input.supermemoryRuntime?.secretStore,
      apiKey: input.supermemoryRuntime?.apiKey,
      transport: input.supermemoryRuntime?.transport,
      stateHome: input.supermemoryRuntime?.stateHome,
      observabilitySink: input.supermemoryRuntime?.observabilitySink,
      deferInitialRecallToLoopback: true,
    }).then((host) => {
      state = "active";
      return { host };
    }).catch((error) => {
      state = "closed";
      throw error;
    });
    return startPromise;
  };

  return {
    topology: "deck-managed",
    sessionFingerprint: stableDigest(input.sessionId),
    get state() { return state; },
    start,
    async startLoopbackBridge() {
      const runtime = await start();
      if (!runtime.host.enabled) return undefined;
      if (!bridgePromise) {
        bridgePromise = runtime.host.startLoopbackBridge().then((created) => {
          bridge = created;
          return created;
        });
      }
      return bridgePromise;
    },
    close(reason) {
      if (closePromise) return closePromise;
      state = state === "closed" ? "closed" : "closing";
      closePromise = (async () => {
        try {
          const runtime = startPromise ? await startPromise.catch(() => undefined) : undefined;
          const beforeLifecycleDiagnostics = runtime?.host.diagnostics.length ?? 0;
          if (!bridge) {
            runtime?.host.recordLifecycle("runtime-cleanup", "succeeded", reason);
            return { diagnostics: runtime?.host.diagnostics.slice(beforeLifecycleDiagnostics) ?? [], metrics: [] };
          }
          const closed = await safeMemoryCapture(() => bridge!.close());
          runtime?.host.recordLifecycle("runtime-cleanup", closed.diagnostics.length > 0 ? "failed" : "succeeded", closed.diagnostics.length > 0 ? `${reason}:cleanup-failed` : reason);
          return { diagnostics: [...closed.diagnostics, ...(runtime?.host.diagnostics.slice(beforeLifecycleDiagnostics) ?? [])], metrics: closed.metrics };
        } finally {
          state = "closed";
        }
      })();
      return closePromise;
    },
  };
}

export function createNodeRunnerProcessEffects(nodeSpawner: typeof nodeSpawn = nodeSpawn): RunnerProcessEffects {
  return {
    inheritedEnv: process.env,
    readTextFile: readBoundedTextFile,
    removeFile: async (path) => { await rm(path, { force: true }); },
    spawn(command, args, options) {
      return new Promise((resolve) => {
        const child = nodeSpawner(command, [...args], {
          cwd: options.cwd,
          env: options.env,
          stdio: options.stdio === "inherit"
            ? "inherit"
            : [options.stdinPayload ? "pipe" : options.stdin === "inherit" ? "inherit" : "ignore", "pipe", "pipe"],
        });
        const requestedLimit = options.captureLimitBytes ?? 1024 * 1024;
        const limit = requestedLimit + Math.max(0, ...(options.sensitiveValues ?? []).map((value) => Buffer.byteLength(value)));
        let stdout: Buffer = Buffer.alloc(0);
        let stderr: Buffer = Buffer.alloc(0);
        const append = (current: Buffer, chunk: Buffer): Buffer => current.byteLength >= limit
          ? current
          : Buffer.concat([current, chunk.subarray(0, limit - current.byteLength)]);
        child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
        child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
        if (options.stdinPayload && child.stdin) {
          child.stdin.once("error", () => {
            // A child that exits before consuming stdin can raise EPIPE; no prompt bytes are surfaced.
          });
          child.stdin.end(options.stdinPayload.content);
        }
        const forward = (signal: NodeJS.Signals) => { if (!child.killed) child.kill(signal); };
        const onSigint = () => forward("SIGINT");
        const onSigterm = () => forward("SIGTERM");
        process.once("SIGINT", onSigint);
        process.once("SIGTERM", onSigterm);
        const cleanup = () => {
          process.off("SIGINT", onSigint);
          process.off("SIGTERM", onSigterm);
        };
        child.once("error", (error) => {
          cleanup();
          resolve({ exitCode: 1, stdout: stdout.toString(), stderr: error.message });
        });
        child.once("close", (code, signal) => {
          cleanup();
          resolve({ exitCode: code ?? (signal ? 1 : 0), signal: signal ?? undefined, stdout: stdout.toString(), stderr: stderr.toString() });
        });
      });
    },
  };
}

export type RunRunnerLaunchInput = {
  adapter: RunnerAdapter;
  launch: RunnerLaunchInput;
  installOnly?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  localOnly?: boolean;
  cliMemoryProvider?: string;
  interactive: boolean;
  confirm?: (summary: string) => Promise<boolean>;
  presentPreview: (preview: string) => Promise<void>;
  processEffects: RunnerProcessEffects;
  supermemoryRuntime?: {
    secretStore?: DeckSecretStore;
    apiKey?: string;
    transport?: SupermemoryRuntimeTransport;
    stateHome?: string;
    observabilitySink?: SupermemoryObservabilitySink;
  };
};

export type RunRunnerLaunchResult =
  | { status: "dry-run" | "installed"; diagnostics: readonly string[] }
  | { status: "blocked"; message: string; diagnostics?: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[] }
  | { status: "unsupported"; code: string; message: string; diagnostics?: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[] }
  | { status: "launched"; outcome: RunnerProcessOutcome; launch: RunnerLaunchResult };

type StaticIntegrationState = "ready" | "degraded" | "blocked";

function staticIntegrationFromPreview(input: { previewIncomplete: boolean; planBlocked?: boolean; mutationCount: number; launch?: RunnerLaunchResult }): StaticIntegrationState {
  if (input.previewIncomplete || input.planBlocked || input.launch?.status === "blocked" || input.launch?.status === "unsupported") return "blocked";
  return input.mutationCount > 0 ? "degraded" : "ready";
}

function staticIntegrationAfterVerification(verified: Awaited<ReturnType<RunnerAdapter["verifyDeveloperTeamInstall"]>>): StaticIntegrationState {
  return verified.valid ? "ready" : "blocked";
}

async function runtimeCredentialState(runtime: RunRunnerLaunchInput["supermemoryRuntime"]): Promise<"present" | "missing" | "deferred"> {
  if (runtime?.apiKey) return "present";
  if (runtime?.transport && !runtime.secretStore) return "deferred";
  const store = runtime?.secretStore ?? defaultRuntimeSecretStore();
  try {
    return store.read("supermemory-api-key")?.trim() ? "present" : "missing";
  } catch {
    return "deferred";
  }
}

function defaultRuntimeSecretStore(): DeckSecretStore {
  return createOwnerOnlyFileSecretStore({ configHome: process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? "/home/user", ".config") });
}

function diagnosticFromClose(diagnostic: import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic) {
  return { code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message };
}

function readinessDiagnosticFromReadiness(readiness: ReturnType<typeof resolveSessionRuntimeReadiness>) {
  return { code: "managed-session-readiness", severity: readiness.managedRuntime === "blocked" ? "error" as const : readiness.managedRuntime === "degraded" ? "warning" as const : "info" as const, message: formatSessionRuntimeReadiness(readiness) };
}

function finalReadinessFromRuntimeHost(input: {
  host: Awaited<ReturnType<typeof createSupermemoryRuntimeHost>> | undefined;
  staticIntegrationState: StaticIntegrationState;
  adaptiveMemoryEnabled: boolean;
  hasProjectIdentity: boolean;
  credentialState: "present" | "missing" | "deferred";
  diagnostics?: readonly { code: string }[];
}): ReturnType<typeof resolveSessionRuntimeReadiness> {
  const codes = new Set([...(input.host?.diagnostics.map((diagnostic) => diagnostic.code) ?? []), ...(input.diagnostics?.map((diagnostic) => diagnostic.code) ?? [])]);
  const runtimeCredentialState = codes.has("supermemory-runtime-auth-missing")
    ? "missing"
    : codes.has("supermemory-runtime-secret-store-failed")
      ? "deferred"
      : input.credentialState;
  const providerConnectivityState = codes.has("supermemory-runtime-health-failed") ? "degraded" : "ready";
  const observabilityState = codes.has("supermemory-runtime-observability-degraded") ? "degraded" : "ready";
  const loopbackState = codes.has("supermemory-runtime-loopback-failed") ? "degraded" : "ready";
  const captureState = codes.has("supermemory-runtime-capture-failed") ? "degraded" : "ready";
  const cleanupState = codes.has("supermemory-runtime-cleanup-failed") ? "degraded" : "ready";
  return resolveSessionRuntimeReadiness({
    topology: "deck-managed",
    staticIntegrationState: input.staticIntegrationState,
    adaptiveMemoryEnabled: input.adaptiveMemoryEnabled,
    hasProjectIdentity: input.hasProjectIdentity && !codes.has("supermemory-runtime-scope-missing"),
    runtimeCredentialState,
    providerConnectivityState,
    observabilityState,
    loopbackState,
    captureState,
    cleanupState,
  });
}

function withoutManagedReadinessDiagnostics<T extends { code?: string }>(diagnostics: readonly T[]): T[] {
  return diagnostics.filter((diagnostic) => diagnostic.code !== "managed-session-readiness");
}

function withSingleFinalReadinessDiagnostic<T extends { code?: string; severity: "info" | "warning" | "error"; message: string }>(
  diagnostics: readonly T[],
  readiness: ReturnType<typeof resolveSessionRuntimeReadiness>,
): Array<T | ReturnType<typeof readinessDiagnosticFromReadiness>> {
  return [readinessDiagnosticFromReadiness(readiness), ...withoutManagedReadinessDiagnostics(diagnostics)];
}

/** Generic CLI-owned install/verify/consent/spawn orchestration. */
export async function runRunnerLaunch(input: RunRunnerLaunchInput): Promise<RunRunnerLaunchResult> {
  const inspectionDiagnostics: string[] = [];
  if (input.adapter.inspectProject) {
    const inspection = await input.adapter.inspectProject(input.launch.projectRoot);
    inspectionDiagnostics.push(...inspection.diagnostics.map((diagnostic) => diagnostic.message));
    if (inspection.state === "blocked") return { status: "blocked", message: inspection.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: inspection.diagnostics };
    if (inspection.state === "unsupported") return { status: "unsupported", code: "runner-version-unsupported", message: inspection.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: inspection.diagnostics };
  }

  const codexAssignments = input.adapter.runnerId === "codex"
    ? {
        modelAssignments: input.adapter.readModelAssignments(input.launch.projectRoot),
        thinkingAssignments: input.adapter.readThinkingAssignments(input.launch.projectRoot),
      }
    : undefined;
  const deckConfig = resolveLaunchDeckConfig(input.launch.deckConfig, input.cliMemoryProvider);
  const baseLaunch = { ...input.launch, deckConfig } as RunnerLaunchInput;
  const installInput = {
    projectRoot: baseLaunch.projectRoot,
    environmentId: input.adapter.environmentIds[0]!,
    localOnly: input.localOnly,
    deckConfig,
    ...(codexAssignments ? codexAssignments : {}),
  };
  const { preparationDiagnostics, plan } = await prepareAndBuildDeveloperTeamInstallPlan(input.adapter, installInput);
  const launchPolicyDiagnostics = input.adapter.getLaunchPolicyDiagnostics?.() ?? [];
  const sessionResolution = resolveDeckRuntimeSessionId(baseLaunch, { runnerId: input.adapter.runnerId, stateHome: input.supermemoryRuntime?.stateHome });
  const projectIdentity = resolveCanonicalSupermemoryProjectScope({ projectRoot: baseLaunch.projectRoot, remotes: [] });
  const explicitIntent = classifyExplicitMemoryIntent(baseLaunch);
  let launch: RunnerLaunchResult | undefined;
  if (!input.installOnly) {
    if (!input.adapter.buildLaunchPlan) return { status: "blocked", message: `${input.adapter.displayName} does not expose launch planning.` };
    launch = await input.adapter.buildLaunchPlan(baseLaunch);
  }
  const safeMutations = plan.mutationPreview ?? [];
  const previewIncomplete = plan.files.length > 0 && plan.mutationPreview === undefined;
  const preApplyStaticState = staticIntegrationFromPreview({ previewIncomplete, planBlocked: plan.blocked, mutationCount: safeMutations.length, launch });
  const credentialState = await runtimeCredentialState(input.supermemoryRuntime);
  const preApplyReadiness = resolveSessionRuntimeReadiness({
    topology: "deck-managed",
    staticIntegrationState: preApplyStaticState,
    adaptiveMemoryEnabled: deckConfig.adaptiveMemory.enabled === true,
    hasProjectIdentity: projectIdentity.ok,
    runtimeCredentialState: credentialState,
  });
  const preview = [
    `Mutation preview for ${input.adapter.displayName}:`,
    ...(safeMutations.length === 0
      ? ["(no file mutations)"]
      : safeMutations.map((mutation) => `${mutation.action} ${mutation.path} pre=${mutation.preimage} post=${mutation.postimage} owner=${mutation.ownership}`)),
    ...(plan.diagnostics ?? []).map((diagnostic) => `! ${diagnostic}`),
    ...preparationDiagnostics.map((diagnostic) => `! ${diagnostic.message}`),
    ...(launch?.diagnostics ?? launchPolicyDiagnostics).map((diagnostic) => `! ${diagnostic.message}`),
    formatSessionRuntimeReadiness(preApplyReadiness),
    ...sessionResolution.diagnostics.map((diagnostic) => `! ${diagnostic}`),
    ...inspectionDiagnostics.map((diagnostic) => `! ${diagnostic}`),
    ...(previewIncomplete ? ["! Exact mutation metadata is unavailable; apply is blocked."] : []),
  ].join("\n");
  await input.presentPreview(preview);

  if (previewIncomplete) return { status: "blocked", message: "Exact mutation preview is required before apply." };
  if (plan.blocked) return { status: "blocked", message: plan.diagnostics?.join("; ") ?? "Runner installation plan is blocked." };
  if (input.dryRun) return { status: "dry-run", diagnostics: [preview] };

  if (safeMutations.length > 0 && !input.yes) {
    if (!input.interactive || !input.confirm) return { status: "blocked", message: "Mutation requires --yes in non-interactive mode." };
    const confirmationQuestion = input.installOnly
      ? "Apply these project changes? [y/N]"
      : `Apply these project changes and launch ${input.adapter.displayName}? [y/N]`;
    if (!(await input.confirm(confirmationQuestion))) return { status: "blocked", message: "Mutation was not confirmed." };
  }
  if (launch?.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  if (launch?.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  const backup = input.adapter.backupDeveloperTeamFiles(plan);
  let applyResult: Awaited<ReturnType<RunnerAdapter["applyDeveloperTeamInstall"]>>;
  try {
    applyResult = await input.adapter.applyDeveloperTeamInstall({ projectRoot: baseLaunch.projectRoot, environmentId: input.adapter.environmentIds[0]!, plan });
  } catch (error) {
    const rollback = error && typeof error === "object" && "rollback" in error
      ? (error as { rollback?: { conflicts?: readonly string[] } }).rollback
      : undefined;
    const conflicts = rollback?.conflicts ?? [];
    const message = error instanceof Error ? error.message : "Runner installation failed safely.";
    return { status: "blocked", message: conflicts.length > 0 ? `${message}; rollback conflicts: ${conflicts.join(", ")}` : message };
  }
  const verified = await input.adapter.verifyDeveloperTeamInstall(plan);
  if (!verified.valid) {
    const rollbackTarget = applyResult.operation ? { payload: applyResult.operation, diagnostics: [] } : backup;
    try {
      const rollback = await input.adapter.rollbackDeveloperTeamFiles(rollbackTarget);
      if (rollback.status === "conflict") {
        const details = rollback.diagnostics.join("; ") || `Rollback conflicts: ${rollback.conflicts.join(", ")}`;
        return { status: "blocked", message: `Semantic verification failed and rollback requires recovery: ${details}` };
      }
      if (rollback.status !== "rolled-back") {
        return { status: "blocked", message: `Semantic verification failed and the applied operation could not be rolled back: ${verified.diagnostics.join("; ")}` };
      }
      return { status: "blocked", message: `Semantic verification failed; the applied operation was rolled back. ${verified.diagnostics.join("; ")}` };
    } catch (error) {
      return { status: "blocked", message: `Semantic verification failed and rollback failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  if (input.installOnly) return { status: "installed", diagnostics: verified.diagnostics };

  const postVerifyReadiness = resolveSessionRuntimeReadiness({
    topology: "deck-managed",
    staticIntegrationState: staticIntegrationAfterVerification(verified),
    adaptiveMemoryEnabled: deckConfig.adaptiveMemory.enabled === true,
    hasProjectIdentity: projectIdentity.ok,
    runtimeCredentialState: credentialState,
  });
  let readinessDiagnostic = readinessDiagnosticFromReadiness(postVerifyReadiness);
  const lease = createManagedSessionRuntimeLease({
    projectRoot: baseLaunch.projectRoot,
    teamId: baseLaunch.teamId,
    deckConfig,
    runnerId: input.adapter.runnerId,
    sessionId: sessionResolution.sessionId,
    launchMode: baseLaunch.mode,
    query: baseLaunch.mode === "exec" ? baseLaunch.prompt.join(" ") : undefined,
    supermemoryRuntime: input.supermemoryRuntime,
  });
  let closeReason: SessionCloseReason = "normal";
  let closeDiagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[] = [];
  let result: RunRunnerLaunchResult | undefined;
  let startedMemoryHost: Awaited<ReturnType<typeof createSupermemoryRuntimeHost>> | undefined;
  try {
    const { host: memoryHost } = await lease.start();
    startedMemoryHost = memoryHost;
    readinessDiagnostic = readinessDiagnosticFromReadiness(finalReadinessFromRuntimeHost({
      host: memoryHost,
      staticIntegrationState: staticIntegrationAfterVerification(verified),
      adaptiveMemoryEnabled: deckConfig.adaptiveMemory.enabled === true,
      hasProjectIdentity: projectIdentity.ok,
      credentialState,
    }));
    const sessionPersistDiagnostics = memoryHost.enabled ? sessionResolution.persist() : [];
    let explicitRecallAdvisory: string | undefined;
    if (explicitIntent.kind === "recall") {
      const recall = await memoryHost.explicitRecall(explicitIntent.query);
      if (!recall.ok) {
        closeReason = "blocked";
        result = { status: "blocked", message: recall.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "Explicit Supermemory recall is unavailable.", diagnostics: [readinessDiagnostic, ...recall.diagnostics.map(diagnosticFromClose)] };
      } else {
        explicitRecallAdvisory = recall.advisoryText;
      }
    }
    const launchInput = applyExplicitRecallAdvisory(baseLaunch, explicitRecallAdvisory);
    if (!result) {
      launch = await input.adapter.buildLaunchPlan!(launchInput);
      if (launch.status === "unsupported") {
        closeReason = "blocked";
        result = { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: [readinessDiagnostic, ...launch.diagnostics] };
      } else if (launch.status === "blocked") {
        closeReason = "blocked";
        result = { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: [readinessDiagnostic, ...launch.diagnostics] };
      }
    }

    let explicitRememberCapture: { diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] } = { diagnostics: [], metrics: [] };
    if (!result && explicitIntent.kind === "remember") {
      const remember = await blockingExplicitRememberCapture(() => memoryHost.explicitRemember(explicitIntent.content, { correlationId: explicitIntent.correlationId }));
      if (remember.blocked) {
        closeReason = "blocked";
        result = { status: "blocked", message: remember.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "Explicit Supermemory remember is unavailable.", diagnostics: [readinessDiagnostic, ...remember.diagnostics.map(diagnosticFromClose)] };
      } else {
        explicitRememberCapture = remember;
      }
    }

    if (!result && launch?.status === "ready") {
      const loopbackBridge = memoryHost.enabled ? await lease.startLoopbackBridge(baseLaunch.mode) : undefined;
      const executableLaunch = loopbackBridge
        ? { ...launch, plan: withSupermemoryLoopback(launch.plan, loopbackBridge, baseLaunch.mode) }
        : launch;
      const memoryInputCapture = explicitIntent.kind === "remember" || loopbackBridge
        ? { diagnostics: [], metrics: [] }
        : await safeMemoryCapture(() => memoryHost.captureLaunchInput(baseLaunch));
      let outcome: RunnerProcessOutcome;
      let finalAssistant: Awaited<ReturnType<typeof trustedFinalAssistantMessage>>;
      let memoryCapture: Awaited<ReturnType<typeof safeMemoryCapture>>;
      try {
        outcome = await executeRunnerLaunchPlan(executableLaunch.plan, input.processEffects);
        closeReason = outcome.signal ? "signal" : "normal";
        finalAssistant = await trustedFinalAssistantMessage(executableLaunch.plan, input.processEffects);
        memoryCapture = loopbackBridge
          ? { diagnostics: [], metrics: [] }
          : await safeMemoryCapture(() => memoryHost.captureOutcome({ exitCode: outcome.exitCode, signal: outcome.signal, finalAssistantMessage: finalAssistant.content }));
      } catch (error) {
        closeReason = "spawn-failed";
        throw error;
      }
      result = {
        status: "launched",
        outcome,
        launch: {
          ...executableLaunch,
          diagnostics: [
            ...executableLaunch.diagnostics,
            readinessDiagnostic,
            ...memoryHost.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
            ...sessionResolution.diagnostics.map((message) => ({ code: "supermemory-session-continuity", severity: "warning" as const, message })),
            ...sessionPersistDiagnostics.map((message) => ({ code: "supermemory-session-continuity", severity: "warning" as const, message })),
            ...explicitRememberCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
            ...memoryInputCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
            ...finalAssistant.diagnostics,
            ...memoryCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
            ...inspectionDiagnostics.map((message) => ({ code: "runner-inspection", severity: "warning" as const, message })),
          ],
        },
      };
    }
  } catch (error) {
    closeReason = closeReason === "normal" ? "exception" : closeReason;
    const reasonForMessage = closeReason as SessionCloseReason;
    const prefix = reasonForMessage === "spawn-failed" ? "Runner spawn failed" : "Runner launch failed";
    result = { status: "blocked", message: error instanceof Error ? `${prefix}: ${error.message}` : `${prefix}.`, diagnostics: [readinessDiagnostic] };
  } finally {
    const closed = await lease.close(closeReason);
    closeDiagnostics = closed.diagnostics;
  }

  const cleanupDiagnostics = closeDiagnostics.map(diagnosticFromClose);
  const finalReadinessFor = (diagnostics: readonly { code: string }[]) => finalReadinessFromRuntimeHost({
    host: startedMemoryHost,
    staticIntegrationState: staticIntegrationAfterVerification(verified),
    adaptiveMemoryEnabled: deckConfig.adaptiveMemory.enabled === true,
    hasProjectIdentity: projectIdentity.ok,
    credentialState,
    diagnostics,
  });
  if (!result) {
    const diagnostics = [readinessDiagnostic, ...cleanupDiagnostics];
    return { status: "blocked", message: "Runner launch did not produce a result.", diagnostics: withSingleFinalReadinessDiagnostic(diagnostics, finalReadinessFor(diagnostics)) };
  }
  if (result.status === "launched") {
    const launchDiagnostics: readonly RunnerDiagnostic[] = withSingleFinalReadinessDiagnostic([...result.launch.diagnostics, ...cleanupDiagnostics], finalReadinessFor([...result.launch.diagnostics, ...cleanupDiagnostics]));
    if (result.launch.status === "ready") return { ...result, launch: { ...result.launch, diagnostics: launchDiagnostics } };
    if (result.launch.status === "unsupported") return { ...result, launch: { ...result.launch, diagnostics: launchDiagnostics } };
    return { ...result, launch: { ...result.launch, diagnostics: launchDiagnostics } };
  }
  if (result.status === "blocked" || result.status === "unsupported") {
    const diagnostics = [...(result.diagnostics ?? []), ...cleanupDiagnostics];
    return { ...result, diagnostics: withSingleFinalReadinessDiagnostic(diagnostics, finalReadinessFor(diagnostics)) };
  }
  return result;
}

function applyExplicitRecallAdvisory(launch: RunnerLaunchInput, advisoryText?: string): RunnerLaunchInput {
  if (!advisoryText || launch.mode !== "exec") return launch;
  const content = [advisoryText, ...(launch.prompt ?? [])].join("\n\n");
  return { ...launch, prompt: [advisoryText, ...launch.prompt], stdinPayload: launch.stdinPayload ? { ...launch.stdinPayload, content } : launch.stdinPayload };
}

function stableDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function resolveLaunchDeckConfig(deckConfig: RunRunnerLaunchInput["launch"]["deckConfig"], cliMemoryProvider: string | undefined): RunRunnerLaunchInput["launch"]["deckConfig"] {
  if (cliMemoryProvider === "none") return { ...deckConfig, adaptiveMemory: { ...deckConfig.adaptiveMemory, enabled: false, activeProvider: "none" as const } };
  if (cliMemoryProvider === "supermemory") return { ...deckConfig, adaptiveMemory: { ...deckConfig.adaptiveMemory, enabled: true, activeProvider: "supermemory" as const } };
  return deckConfig;
}

async function trustedFinalAssistantMessage(plan: RunnerLaunchPlan, effects: RunnerProcessEffects): Promise<{ content?: string; diagnostics: readonly { code: string; severity: "warning"; message: string }[] }> {
  const contract = plan.outputCapture?.finalAssistantMessage;
  if (!contract || contract.trust !== "runner-native-final-assistant" || contract.source !== "file") return { diagnostics: [] };
  if (!contract.path || contract.path.includes("\0")) {
    return { diagnostics: [{ code: "runner-output-capture-invalid", severity: "warning", message: "Trusted final-assistant capture skipped: invalid output file path." }] };
  }
  try {
    const read = effects.readTextFile ?? readBoundedTextFile;
    const fileOutput = await read(contract.path, contract.maxBytes);
    const boundedOutput = bounded(fileOutput.content, contract.maxBytes);
    if (contract.cleanup !== false) await (effects.removeFile ?? (async (path: string) => { await rm(path, { force: true }); }))(contract.path);
    const content = boundedOutput.value.trim() || undefined;
    return { content, diagnostics: (boundedOutput.truncated || fileOutput.truncated) ? [{ code: "runner-output-capture-truncated", severity: "warning", message: `Trusted final-assistant output file was truncated to ${contract.maxBytes} bytes before capture.` }] : [] };
  } catch (error) {
    return { diagnostics: [{ code: "runner-output-capture-unavailable", severity: "warning", message: `Trusted final-assistant capture skipped: ${error instanceof Error ? error.message : String(error)}` }] };
  }
}

async function readBoundedTextFile(path: string, maxBytes: number): Promise<{ content: string; truncated: boolean }> {
  const limit = Math.max(0, maxBytes);
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
    return { content: buffer.subarray(0, Math.min(bytesRead, limit)).toString("utf8"), truncated: bytesRead > limit };
  } finally {
    await file.close();
  }
}

async function safeMemoryCapture(capture: () => Promise<{ diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] }>) {
  const timeoutMs = 10_000;
  try {
    return await Promise.race([
      capture(),
      new Promise<Awaited<ReturnType<typeof capture>>>((resolve) => setTimeout(() => resolve({
        diagnostics: [{ code: "supermemory-runtime-capture-failed", severity: "warning", message: "Supermemory capture flush timed out; runner launch completed without blocking." }],
        metrics: [],
      }), timeoutMs)),
    ]);
  } catch (error) {
    return {
      diagnostics: [{ code: "supermemory-runtime-capture-failed" as const, severity: "warning" as const, message: `Supermemory capture failed open: ${error instanceof Error ? error.message : String(error)}` }],
      metrics: [],
    };
  }
}

async function blockingExplicitRememberCapture(capture: () => Promise<{ ok: boolean; diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] }>) {
  const timeoutMs = 10_000;
  try {
    const result = await Promise.race([
      capture(),
      new Promise<Awaited<ReturnType<typeof capture>>>((resolve) => setTimeout(() => resolve({
        ok: false,
        diagnostics: [{ code: "supermemory-runtime-capture-failed", severity: "error", message: "Explicit Supermemory remember timed out before runner launch." }],
        metrics: [],
      }), timeoutMs)),
    ]);
    return { blocked: !result.ok, diagnostics: result.diagnostics, metrics: result.metrics };
  } catch (error) {
    return {
      blocked: true,
      diagnostics: [{ code: "supermemory-runtime-capture-failed" as const, severity: "error" as const, message: `Explicit Supermemory remember failed before runner launch: ${error instanceof Error ? error.message : String(error)}` }],
      metrics: [],
    };
  }
}
