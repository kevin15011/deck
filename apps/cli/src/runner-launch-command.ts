import { spawnInstallationGated } from "./installation-gated-spawn";
import { ROLE_TOOL_POLICY } from '@deck/core/session/role-tool-policy';
import { DeckConfigStore } from "./deck-config-store";
import { withNativeProjectReadiness } from "./native-project-readiness";
import { classifyNativeCodebase, nativeCodebaseFailureCode, resolvePiAgentDir } from "@deck/adapter-pi";
import type {
  RunnerAdapter,
  RunnerLaunchInput,
  RunnerLaunchPlan,
  RunnerLaunchResult,
} from "@deck/core";
import { acquireRunnerGenerationReference, MAX_RUNNER_STDIN_PAYLOAD_BYTES, prepareAndBuildDeveloperTeamInstallPlan, RUNNER_ENV_ALLOWLIST, isSensitiveRunnerEnv, sanitizeRunnerEnv } from "@deck/core";
import { spawn as nodeSpawn } from "node:child_process";
import { open, rm } from "node:fs/promises";
import { isQuietDiagnostic } from "./launch-diagnostic-format";
import { buildReviewedInteractiveLaunch, recordInteractiveSearchLaunch } from "./interactive-search-review";

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
    options: { cwd: string; env: Record<string, string>; stdio: "inherit" | "pipe"; stdin: "inherit" | "closed"; stdinPayload?: RunnerLaunchPlan["stdinPayload"]; captureLimitBytes?: number; sensitiveValues?: readonly string[]; onSpawn?: (pid: number) => (() => void) | undefined },
  ): Promise<SpawnedRunnerResult>;
};

export type RunnerProcessOutcome = SpawnedRunnerResult & { truncated: boolean };

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

export async function executeRunnerLaunchPlan(
  plan: RunnerLaunchPlan,
  effects: RunnerProcessEffects,
  signal?: AbortSignal,
): Promise<RunnerProcessOutcome> {
  if (plan.stdinPayload && (!validStdinPayload(plan.stdinPayload) || plan.stdio !== "pipe" || plan.stdin !== "closed")) {
    throw new Error("Runner stdin payload is invalid.");
  }
  const env: Record<string, string> = sanitizeRunnerEnv(effects.inheritedEnv ?? process.env);
  for (const key of Object.keys(env)) {
    if (key === "OPENCODE_CONFIG_CONTENT" || key === "OPENCODE_DECK_INVOCATION_AUTHORIZATION") delete env[key];
  }
  const secrets: string[] = [];
  const authorizedSensitiveKeys = ["deck-pi-web-search-v1", "deck-opencode-web-search-v1", "deck-claude-web-search-v1", "deck-codex-launch-v1"].includes(plan.sensitiveEnvAuthorization?.binding ?? "")
    ? new Set(plan.sensitiveEnvAuthorization!.keys.filter((key) => key === "TAVILY_API_KEY"))
    : new Set<string>();
  for (const [key, entry] of Object.entries(plan.envOverlay ?? {})) {
    const verifiedFailClosedControl = key === "OPENCODE_DECK_INVOCATION_AUTHORIZATION" && entry.value === "invocation-required";
    if ((entry.sensitive || isSensitiveRunnerEnv(key, entry.value)) && !RUNNER_ENV_ALLOWLIST.has(key) && !authorizedSensitiveKeys.has(key) && !verifiedFailClosedControl) {
      secrets.push(entry.value);
      continue;
    }
    env[key] = entry.value;
    if (entry.sensitive) secrets.push(entry.value);
  }
  signal?.throwIfAborted();
  if (plan.envOverlay?.DECK_PI_SESSION?.value === "1") {
    const directory = resolvePiAgentDir(env, env.HOME ?? "");
    if (!directory.ok) throw new Error("Pi startup blocked (pi-agent-dir-invalid).");
    try { classifyNativeCodebase({ agentDir: directory.dir, signal }); }
    catch (error) {
      if (signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(`Pi startup blocked (${nativeCodebaseFailureCode(error)}).`, { cause: error });
    }
  }
  signal?.throwIfAborted();
  const releaseGeneration = plan.generationReference ? acquireRunnerGenerationReference(plan.generationReference) : undefined;
  let releaseSearchReview: (() => void) | undefined;
  let raw: SpawnedRunnerResult;
  try {
    if (plan.interactiveSearchReview) releaseSearchReview = recordInteractiveSearchLaunch(plan.interactiveSearchReview);
    await plan.launchLifecycle?.beforeSpawn(env, signal);
    signal?.throwIfAborted();
    raw = await effects.spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env,
    stdio: plan.stdio,
    stdin: plan.stdin,
    stdinPayload: plan.stdinPayload,
    captureLimitBytes: plan.captureLimitBytes,
    sensitiveValues: secrets,
  }); } finally { try { releaseSearchReview?.(); } finally { try { releaseGeneration?.(); } finally { plan.launchLifecycle?.afterExit(); } } }
  const limit = plan.captureLimitBytes ?? 1024 * 1024;
  const stdout = bounded(redact(raw.stdout, secrets), limit);
  const stderr = bounded(redact(raw.stderr, secrets), limit);
  return { ...raw, signal: raw.signal, stdout: stdout.value, stderr: stderr.value, truncated: stdout.truncated || stderr.truncated };
}

function redactSensitiveLaunchPlan(plan: RunnerLaunchPlan): RunnerLaunchPlan {
  if (!plan.envOverlay) return plan;
  return {
    ...plan,
    envOverlay: Object.fromEntries(Object.entries(plan.envOverlay).map(([key, entry]) => [
      key,
      entry.sensitive ? { ...entry, value: "[REDACTED]" } : entry,
    ])),
  };
}

export function createNodeRunnerProcessEffects(nodeSpawner: typeof nodeSpawn = nodeSpawn): RunnerProcessEffects {
  return {
    inheritedEnv: process.env,
    readTextFile: readBoundedTextFile,
    removeFile: async (path) => { await rm(path, { force: true }); },
    spawn(command, args, options) {
      return new Promise((resolve) => {
        // The shell cannot touch the installation until its lease exists. EOF on parent
        // death refuses launch; after exec the PID and process birth identity stay the same.
        const stdio = options.stdio === "inherit"
          ? ["inherit", "inherit", "inherit"] as const
          : [options.stdinPayload ? "pipe" : options.stdin === "inherit" ? "inherit" : "ignore", "pipe", "pipe"] as const;
        const { child, register } = spawnInstallationGated(command, args, {
          cwd: options.cwd, env: options.env, stdio: [...stdio], onSpawn: options.onSpawn,
        }, nodeSpawner);
        let releaseInstallationUse: (() => void) | undefined;
        try {
          releaseInstallationUse = register();
        } catch (error) {
          child.kill();
          child.once('error', () => {});
          child.once('close', () => { releaseInstallationUse?.(); resolve({ exitCode: 1, stdout: '', stderr: String(error) }); });
          return;
        }
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
          releaseInstallationUse?.(); releaseInstallationUse = undefined;
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
  signal?: AbortSignal;
  adapter: RunnerAdapter;
  launch: RunnerLaunchInput;
  installOnly?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  localOnly?: boolean;
  /** Print routine notes and full mutation details too (dry runs always do). */
  verbose?: boolean;
  interactive: boolean;
  confirm?: (summary: string) => Promise<boolean>;
  presentPreview: (preview: string) => Promise<void>;
  processEffects: RunnerProcessEffects;

};

export type RunRunnerLaunchResult =
  | { status: "dry-run" | "installed"; diagnostics: readonly string[] }
  | { status: "blocked"; message: string; diagnostics?: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[] }
  | { status: "unsupported"; code: string; message: string; diagnostics?: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[] }
  | { status: "launched"; outcome: RunnerProcessOutcome; launch: RunnerLaunchResult };

function summarizeMutations(mutations: readonly { path: string }[]): string {
  const isConfig = (path: string) => /config\.toml$/.test(path) && !path.includes("/skills/");
  const agents = mutations.filter((mutation) => /\/agents\/[^/]+\.(?:toml|md)$/.test(mutation.path)).length;
  const skills = new Set(mutations.map((mutation) => mutation.path.match(/\/skills\/([^/]+)\//)?.[1]).filter(Boolean)).size;
  const parts: string[] = [];
  if (agents > 0) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  if (skills > 0) parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
  if (mutations.some((mutation) => isConfig(mutation.path))) parts.push("configuration (MCP servers, hooks)");
  return parts.length > 0 ? parts.join(", ") : `${mutations.length} file${mutations.length === 1 ? "" : "s"}`;
}

/** Calm, product-level launch output: what is happening and anything the user must act on. Details live behind --verbose/--dry-run. */
function conciseLaunchSummary(context: {
  input: RunRunnerLaunchInput;
  mutations: readonly { path: string }[];
  planDiagnostics: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[];
  preparationDiagnostics: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[];
  launchDiagnostics: readonly { code: string; severity: "info" | "warning" | "error"; message: string }[];
  readinessBlocked?: string;
  sessionDiagnostics: readonly string[];
}): string {
  const { input } = context;
  const name = input.adapter.displayName;
  const lines: string[] = [];
  if (context.mutations.length > 0) lines.push(`Updating ${name} team files: ${summarizeMutations(context.mutations)}.`);
  else if (input.installOnly) lines.push(`${name} team files are up to date.`);
  else lines.push(`Launching ${name} Developer Team.`);
  const seen = new Set<string>();
  const problems = [...context.planDiagnostics, ...context.preparationDiagnostics, ...context.launchDiagnostics].filter((entry) => !isQuietDiagnostic(entry));
  for (const entry of problems) {
    if (seen.has(entry.message)) continue;
    seen.add(entry.message);
    lines.push(`! ${entry.message}`);
  }
  if (context.readinessBlocked) lines.push(`! ${context.readinessBlocked}`);
  for (const message of context.sessionDiagnostics) lines.push(`! ${message}`);
  return lines.join("\n");
}

/** Generic CLI-owned install/verify/consent/spawn orchestration. */
export async function runRunnerLaunch(input: RunRunnerLaunchInput): Promise<RunRunnerLaunchResult> {
  input.signal?.throwIfAborted();
  try {
    if (!input.installOnly && !input.dryRun && input.adapter.withNativeInstallationUse) {
      return await input.adapter.withNativeInstallationUse(() => runRunnerLaunchReserved({ ...input, processEffects: {
        ...input.processEffects,
        spawn: (command, args, options) => input.processEffects.spawn(command, args, { ...options,
          onSpawn: pid => input.adapter.trackNativeInstallationProcess?.(pid),
        }),
      } }));
    }
    return await runRunnerLaunchReserved(input);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "Runner preparation failed safely.";
    return { status: "blocked", message: message.includes("symlink boundary:")
      ? message + "; preserve the linked content elsewhere and remove the conflicting symlink before retrying."
      : message };
  }
}
async function runRunnerLaunchReserved(input: RunRunnerLaunchInput): Promise<RunRunnerLaunchResult> {
  input.signal?.throwIfAborted();
  // The native Claude lane is separate. No Claude Developer Team adapter is verified yet;
  // Keep the unverified adapter out of this launch path.
  if (input.adapter.runnerId === "claude") {
    return { status: "unsupported", code: "claude-developer-unverified", message: "Claude Developer Team installation and launch are not verified. Use deck claude native for the safe-mode-only route." };
  }
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
  const deckConfig = input.launch.deckConfig;
  const readCurrentReadinessConfig = createNativeReadinessConfigReader(
    new DeckConfigStore({ allowDefaultEnvironment: true, homeDir: input.processEffects?.inheritedEnv?.HOME,
      xdgConfigHome: input.processEffects?.inheritedEnv?.XDG_CONFIG_HOME }));
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
  let launch: RunnerLaunchResult | undefined;
  if (!input.installOnly) {
    if (!input.adapter.buildLaunchPlan) return { status: "blocked", message: `${input.adapter.displayName} does not expose launch planning.` };
    launch = await buildReviewedInteractiveLaunch(input.adapter, baseLaunch);
  }
  const safeMutations = plan.mutationPreview ?? [];
  const previewIncomplete = plan.files.length > 0 && plan.mutationPreview === undefined;
  const preview = [
    `Mutation preview for ${input.adapter.displayName}:`,
    ...(safeMutations.length === 0
      ? ["(no file mutations)"]
      : safeMutations.map((mutation) => `${mutation.action} ${mutation.path} pre=${mutation.preimage} post=${mutation.postimage} owner=${mutation.ownership}`)),
    ...(plan.diagnostics ?? []).map((diagnostic) => `! ${diagnostic}`),
    ...preparationDiagnostics.filter((diagnostic) => !(plan.diagnostics ?? []).includes(diagnostic.message)).map((diagnostic) => `! ${diagnostic.message}`),
    ...(launch?.diagnostics ?? launchPolicyDiagnostics).map((diagnostic) => `! ${diagnostic.message}`),
    ...inspectionDiagnostics.map((diagnostic) => `! ${diagnostic}`),
    ...(previewIncomplete ? ["! Exact mutation metadata is unavailable; apply is blocked."] : []),
  ].join("\n");
  const detailed = input.dryRun === true || input.verbose === true;
  await input.presentPreview(detailed ? preview : conciseLaunchSummary({
    input,
    mutations: safeMutations,
    planDiagnostics: plan.diagnosticEntries ?? (plan.diagnostics ?? []).map((message) => ({ code: "plan", severity: "warning" as const, message })),
    preparationDiagnostics,
    launchDiagnostics: launch?.diagnostics ?? launchPolicyDiagnostics,
    sessionDiagnostics: [],
  }));

  if (previewIncomplete) return { status: "blocked", message: "Exact mutation preview is required before apply." };
  if (plan.blocked) {
    // Report the real problems; routine notes would only bury them.
    const problems = (plan.diagnosticEntries ?? []).filter((entry) => !isQuietDiagnostic(entry)).map((entry) => entry.message);
    return { status: "blocked", message: (problems.length > 0 ? problems : plan.diagnostics ?? []).join("; ") || "Runner installation plan is blocked." };
  }
  if (input.dryRun) return { status: "dry-run", diagnostics: [preview] };

  if (safeMutations.length > 0 && !input.yes && !(plan.automaticRefresh && !input.installOnly)) {
    if (!input.interactive || !input.confirm) return { status: "blocked", message: "Mutation requires --yes in non-interactive mode." };
    const confirmationQuestion = input.installOnly
      ? "Apply these changes? [y/N]"
      : `Apply these changes and launch ${input.adapter.displayName}? [y/N]`;
    if (!(await input.confirm(confirmationQuestion))) return { status: "blocked", message: "Mutation was not confirmed." };
  }
  if (launch?.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  if (launch?.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  const backup = input.adapter.backupDeveloperTeamFiles(plan);
  let refreshDeferred = false;
  let applyResult: Awaited<ReturnType<RunnerAdapter["applyDeveloperTeamInstall"]>> = { results: [], changedCount: 0, unchangedCount: 0 };
  try {
    applyResult = await input.adapter.applyDeveloperTeamInstall({ projectRoot: baseLaunch.projectRoot, environmentId: input.adapter.environmentIds[0]!, plan });
  } catch (error) {
    if (!input.installOnly && ["codex", "opencode", "pi"].includes(input.adapter.runnerId) && error && typeof error === "object" && "code" in error && ["codex-installation-in-use", "runner-installation-in-use", "runner-mutation-deferred"].includes(String(error.code))) {
      refreshDeferred = true;
      await input.presentPreview(`${input.adapter.displayName} content refresh deferred while another invocation is active; launching with installed content.`);
    } else {
      const rollback = error && typeof error === "object" && "rollback" in error
        ? (error as { rollback?: { conflicts?: readonly string[] } }).rollback
        : undefined;
      const conflicts = rollback?.conflicts ?? [];
      const message = error instanceof Error ? error.message : "Runner installation failed safely.";
      return { status: "blocked", message: conflicts.length > 0 ? `${message}; rollback conflicts: ${conflicts.join(", ")}` : message };
    }
  }
  const verified = refreshDeferred ? { valid: true, diagnostics: [] } : await input.adapter.verifyDeveloperTeamInstall(plan);
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
  if (input.adapter.runnerId === "opencode") {
    try {
      for (const roleId of ["deck-lead", ...ROLE_TOOL_POLICY.readOnlyRoles]) {
        await input.adapter.prepareSessionNativeRole?.(roleId);
      }
    } catch (error) {
      return { status: "blocked", message: error instanceof Error ? error.message : "OpenCode role validation failed; review the installed role permissions." };
    }
  }

  launch = await buildReviewedInteractiveLaunch(input.adapter, baseLaunch);
  if (launch.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  if (launch.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; "), diagnostics: launch.diagnostics };
  try {
    const outcome = await executeRunnerLaunchPlan(withNativeProjectReadiness(launch.plan, input.adapter.runnerId, readCurrentReadinessConfig, undefined, config => input.adapter.readPreparationCapabilities?.(config) ?? {}, input.adapter.readPreparationGeneration?.bind(input.adapter)), input.processEffects, input.signal);
    const output = await trustedFinalAssistantMessage(launch.plan, input.processEffects);
    return { status: "launched", outcome, launch: { ...launch, plan: redactSensitiveLaunchPlan(launch.plan), diagnostics: [...launch.diagnostics, ...output.diagnostics, ...inspectionDiagnostics.map((message) => ({ code: "runner-inspection", severity: "warning" as const, message }))] } };
  } catch (error) {
    if (input.signal?.aborted || error instanceof Error && error.name === "AbortError") throw error;
    return { status: "blocked", message: error instanceof Error ? `Runner spawn failed: ${error.message}` : "Runner spawn failed." };
  }
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

/** Read trusted persisted intent on every lifecycle refresh. */
export function createNativeReadinessConfigReader(store: Pick<DeckConfigStore, "read"> = new DeckConfigStore({ allowDefaultEnvironment: true })) {
  return () => store.read();
}
