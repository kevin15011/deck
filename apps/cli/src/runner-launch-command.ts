import type {
  RunnerAdapter,
  RunnerLaunchInput,
  RunnerLaunchPlan,
  RunnerLaunchResult,
} from "@deck/core";
import { MAX_RUNNER_STDIN_PAYLOAD_BYTES, prepareAndBuildDeveloperTeamInstallPlan, RUNNER_ENV_ALLOWLIST, isSensitiveRunnerEnv, sanitizeRunnerEnv } from "@deck/core";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { createSupermemoryRuntimeHost } from "./supermemory-runtime-host";
import type { SupermemoryRunnerLoopbackBridge } from "./supermemory-runtime-host";
import { resolveDeckRuntimeSessionId } from "./supermemory-session-store";
import type { DeckSecretStore } from "@deck/core";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";

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
  };
};

export type RunRunnerLaunchResult =
  | { status: "dry-run" | "installed"; diagnostics: readonly string[] }
  | { status: "blocked"; message: string }
  | { status: "unsupported"; code: string; message: string }
  | { status: "launched"; outcome: RunnerProcessOutcome; launch: RunnerLaunchResult };

/** Generic CLI-owned install/verify/consent/spawn orchestration. */
export async function runRunnerLaunch(input: RunRunnerLaunchInput): Promise<RunRunnerLaunchResult> {
  const inspectionDiagnostics: string[] = [];
  if (input.adapter.inspectProject) {
    const inspection = await input.adapter.inspectProject(input.launch.projectRoot);
    inspectionDiagnostics.push(...inspection.diagnostics.map((diagnostic) => diagnostic.message));
    if (inspection.state === "blocked") return { status: "blocked", message: inspection.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
    if (inspection.state === "unsupported") return { status: "unsupported", code: "runner-version-unsupported", message: inspection.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
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
  const sessionResolution = resolveDeckRuntimeSessionId(baseLaunch, { runnerId: input.adapter.runnerId });
  const memoryHost = await createSupermemoryRuntimeHost({
    projectRoot: baseLaunch.projectRoot,
    teamId: baseLaunch.teamId,
    deckConfig,
    runnerId: input.adapter.runnerId,
    role: "lead",
    sessionId: sessionResolution.sessionId,
    launchMode: baseLaunch.mode,
    query: baseLaunch.mode === "exec" ? baseLaunch.prompt.join(" ") : undefined,
    secretStore: input.supermemoryRuntime?.secretStore,
    apiKey: input.supermemoryRuntime?.apiKey,
    transport: input.supermemoryRuntime?.transport,
    stateHome: input.supermemoryRuntime?.stateHome,
    deferInitialRecallToLoopback: true,
  });
  const explicitIntent = classifyExplicitMemoryIntent(baseLaunch);
  let explicitRecallAdvisory: string | undefined;
  if (explicitIntent.kind === "recall") {
    const recall = await memoryHost.explicitRecall(explicitIntent.query);
    if (!recall.ok) {
      return { status: "blocked", message: recall.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "Explicit Supermemory recall is unavailable." };
    }
    explicitRecallAdvisory = recall.advisoryText;
  }
  const launchInput = applyExplicitRecallAdvisory(baseLaunch, explicitRecallAdvisory);
  let launch: RunnerLaunchResult | undefined;
  if (!input.installOnly) {
    if (!input.adapter.buildLaunchPlan) return { status: "blocked", message: `${input.adapter.displayName} does not expose launch planning.` };
    launch = await input.adapter.buildLaunchPlan(launchInput);
  }
  const safeMutations = plan.mutationPreview ?? [];
  const previewIncomplete = plan.files.length > 0 && plan.mutationPreview === undefined;
  const preview = [
    `Mutation preview for ${input.adapter.displayName}:`,
    ...(safeMutations.length === 0
      ? ["(no file mutations)"]
      : safeMutations.map((mutation) => `${mutation.action} ${mutation.path} pre=${mutation.preimage} post=${mutation.postimage} owner=${mutation.ownership}`)),
    ...(plan.diagnostics ?? []).map((diagnostic) => `! ${diagnostic}`),
    ...preparationDiagnostics.map((diagnostic) => `! ${diagnostic.message}`),
    ...(launch?.diagnostics ?? launchPolicyDiagnostics).map((diagnostic) => `! ${diagnostic.message}`),
    ...memoryHost.diagnostics.map((diagnostic) => `! ${diagnostic.message}`),
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
    if (!(await input.confirm(preview))) return { status: "blocked", message: "Mutation was not confirmed." };
  }
  if (launch?.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  if (launch?.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
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
  launch = await input.adapter.buildLaunchPlan!(launchInput);
  if (launch.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  if (launch.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  let outcome: RunnerProcessOutcome;
  try {
    const sessionPersistDiagnostics = sessionResolution.persist();
    let explicitRememberCapture: { diagnostics: readonly import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[]; metrics: readonly import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] } = { diagnostics: [], metrics: [] };
    if (explicitIntent.kind === "remember") {
      const remember = await blockingExplicitRememberCapture(() => memoryHost.explicitRemember(explicitIntent.content, { correlationId: explicitIntent.correlationId }));
      if (remember.blocked) {
        return { status: "blocked", message: remember.diagnostics.map((diagnostic) => diagnostic.message).join("; ") || "Explicit Supermemory remember is unavailable." };
      }
      explicitRememberCapture = remember;
    }
    const loopbackBridge = memoryHost.enabled ? await memoryHost.startLoopbackBridge() : undefined;
    const executableLaunch = loopbackBridge
      ? { ...launch, plan: withSupermemoryLoopback(launch.plan, loopbackBridge, baseLaunch.mode) }
      : launch;
    const memoryInputCapture = explicitIntent.kind === "remember" || loopbackBridge
      ? { diagnostics: [], metrics: [] }
      : await safeMemoryCapture(() => memoryHost.captureLaunchInput(baseLaunch));
    const loopbackClose = { diagnostics: [] as import("./supermemory-runtime-host").SupermemoryRuntimeHostDiagnostic[], metrics: [] as import("@deck/adapter-supermemory/runtime").SupermemoryRuntimeMetric[] };
    let finalAssistant: Awaited<ReturnType<typeof trustedFinalAssistantMessage>>;
    let memoryCapture: Awaited<ReturnType<typeof safeMemoryCapture>>;
    try {
      outcome = await executeRunnerLaunchPlan(executableLaunch.plan, input.processEffects);
      finalAssistant = await trustedFinalAssistantMessage(executableLaunch.plan, input.processEffects);
      memoryCapture = loopbackBridge
        ? { diagnostics: [], metrics: [] }
        : await safeMemoryCapture(() => memoryHost.captureOutcome({ exitCode: outcome.exitCode, signal: outcome.signal, finalAssistantMessage: finalAssistant.content }));
    } finally {
      if (loopbackBridge) {
        const closed = await safeMemoryCapture(() => loopbackBridge.close());
        loopbackClose.diagnostics.push(...closed.diagnostics);
        loopbackClose.metrics.push(...closed.metrics);
      }
    }
    return {
      status: "launched",
      outcome,
      launch: {
        ...executableLaunch,
        diagnostics: [
          ...executableLaunch.diagnostics,
          ...memoryHost.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
          ...sessionResolution.diagnostics.map((message) => ({ code: "supermemory-session-continuity", severity: "warning" as const, message })),
          ...sessionPersistDiagnostics.map((message) => ({ code: "supermemory-session-continuity", severity: "warning" as const, message })),
          ...explicitRememberCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
          ...memoryInputCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
          ...finalAssistant.diagnostics,
          ...memoryCapture.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
          ...loopbackClose.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message })),
          ...inspectionDiagnostics.map((message) => ({ code: "runner-inspection", severity: "warning" as const, message })),
        ],
      },
    };
  } catch (error) {
    return { status: "blocked", message: error instanceof Error ? `Runner spawn failed: ${error.message}` : "Runner spawn failed." };
  }
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
