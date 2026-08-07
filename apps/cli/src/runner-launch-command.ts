import type {
  RunnerAdapter,
  RunnerLaunchInput,
  RunnerLaunchPlan,
  RunnerLaunchResult,
} from "@deck/core";
import { MAX_RUNNER_STDIN_PAYLOAD_BYTES } from "@deck/core";
import { spawn as nodeSpawn } from "node:child_process";

export type SpawnedRunnerResult = {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
};

export type RunnerProcessEffects = {
  inheritedEnv?: Readonly<Record<string, string | undefined>>;
  spawn(
    command: string,
    args: readonly string[],
    options: { cwd: string; env: Record<string, string>; stdio: "inherit" | "pipe"; stdin: "inherit" | "closed"; stdinPayload?: RunnerLaunchPlan["stdinPayload"]; captureLimitBytes?: number; sensitiveValues?: readonly string[] },
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
): Promise<RunnerProcessOutcome> {
  if (plan.stdinPayload && (!validStdinPayload(plan.stdinPayload) || plan.stdio !== "pipe" || plan.stdin !== "closed")) {
    throw new Error("Runner stdin payload is invalid.");
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(effects.inheritedEnv ?? process.env)) {
    if (value !== undefined) env[key] = value;
  }
  const secrets: string[] = [];
  for (const [key, entry] of Object.entries(plan.envOverlay ?? {})) {
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

export function createNodeRunnerProcessEffects(nodeSpawner: typeof nodeSpawn = nodeSpawn): RunnerProcessEffects {
  return {
    inheritedEnv: process.env,
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
  interactive: boolean;
  confirm?: (summary: string) => Promise<boolean>;
  presentPreview: (preview: string) => Promise<void>;
  processEffects: RunnerProcessEffects;
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
  const plan = input.adapter.buildDeveloperTeamInstallPlan({
    projectRoot: input.launch.projectRoot,
    environmentId: input.adapter.environmentIds[0]!,
    localOnly: input.localOnly,
    ...(codexAssignments ? codexAssignments : {}),
  });
  const safeMutations = plan.mutationPreview ?? [];
  const previewIncomplete = plan.files.length > 0 && plan.mutationPreview === undefined;
  const preview = [
    `Mutation preview for ${input.adapter.displayName}:`,
    ...(safeMutations.length === 0
      ? ["(no file mutations)"]
      : safeMutations.map((mutation) => `${mutation.action} ${mutation.path} pre=${mutation.preimage} post=${mutation.postimage} owner=${mutation.ownership}`)),
    ...(plan.diagnostics ?? []).map((diagnostic) => `! ${diagnostic}`),
    ...inspectionDiagnostics.map((diagnostic) => `! ${diagnostic}`),
    ...(previewIncomplete ? ["! Exact mutation metadata is unavailable; apply is blocked."] : []),
  ].join("\n");
  await input.presentPreview(preview);

  if (previewIncomplete) return { status: "blocked", message: "Exact mutation preview is required before apply." };
  if (plan.blocked) return { status: "blocked", message: plan.diagnostics?.join("; ") ?? "Runner installation plan is blocked." };
  if (input.dryRun) return { status: "dry-run", diagnostics: [preview] };

  let launch: RunnerLaunchResult | undefined;
  if (!input.installOnly) {
    if (!input.adapter.buildLaunchPlan) return { status: "blocked", message: `${input.adapter.displayName} does not expose launch planning.` };
    launch = await input.adapter.buildLaunchPlan(input.launch);
    if (launch.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
    if (launch.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  }

  if (safeMutations.length > 0 && !input.yes) {
    if (!input.interactive || !input.confirm) return { status: "blocked", message: "Mutation requires --yes in non-interactive mode." };
    if (!(await input.confirm(preview))) return { status: "blocked", message: "Mutation was not confirmed." };
  }
  const backup = input.adapter.backupDeveloperTeamFiles(plan);
  let applyResult: Awaited<ReturnType<RunnerAdapter["applyDeveloperTeamInstall"]>>;
  try {
    applyResult = await input.adapter.applyDeveloperTeamInstall({ projectRoot: input.launch.projectRoot, environmentId: input.adapter.environmentIds[0]!, plan });
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
  launch = await input.adapter.buildLaunchPlan!(input.launch);
  if (launch.status === "unsupported") return { status: "unsupported", code: launch.code, message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  if (launch.status === "blocked") return { status: "blocked", message: launch.diagnostics.map((diagnostic) => diagnostic.message).join("; ") };
  let outcome: RunnerProcessOutcome;
  try {
    outcome = await executeRunnerLaunchPlan(launch.plan, input.processEffects);
  } catch (error) {
    return { status: "blocked", message: error instanceof Error ? `Runner spawn failed: ${error.message}` : "Runner spawn failed." };
  }
  return {
    status: "launched",
    outcome,
    launch: {
      ...launch,
      diagnostics: [...launch.diagnostics, ...inspectionDiagnostics.map((message) => ({ code: "runner-inspection", severity: "warning" as const, message }))],
    },
  };
}
