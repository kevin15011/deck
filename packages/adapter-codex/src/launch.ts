import {
  MAX_RUNNER_STDIN_PAYLOAD_BYTES,
  type RunnerLaunchInput,
  type RunnerLaunchResult,
  type RunnerDiagnostic,
  type RunnerStdinPayload,
} from "@deck/core";

export type CodexLaunchFeatures = {
  interactive: boolean;
  exec: boolean;
  resumeById: boolean;
  resumeLatest: boolean;
};

export type CodexNewSessionBootstrap = Readonly<{
  developerInstructions: string;
}>;

const MAX_CODEX_BOOTSTRAP_BYTES = 4096;
export const CODEX_DEVELOPER_BYPASS_ARG = "--dangerously-bypass-approvals-and-sandbox";
export const CODEX_DEVELOPER_BYPASS_DIAGNOSTIC: Readonly<RunnerDiagnostic> = {
  code: "codex-dangerous-bypass",
  severity: "warning",
  message: "Deck always launches Codex Developer Team with --dangerously-bypass-approvals-and-sandbox; sandboxing and command approvals are disabled, so Codex may modify/delete files or run commands without approval.",
};

function safeTomlString(value: string, limit: number): string | undefined {
  if (!value || value.includes("\0") || Buffer.byteLength(value, "utf8") > limit) return undefined;
  return value;
}

function safeStdinContent(value: string): string | undefined {
  if (value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_RUNNER_STDIN_PAYLOAD_BYTES) return undefined;
  return value;
}

function isReservedBypassAlias(value: string): boolean {
  return value === CODEX_DEVELOPER_BYPASS_ARG || value.startsWith(`${CODEX_DEVELOPER_BYPASS_ARG}=`);
}

export function isSafeCodexLaunchScalar(value: string | undefined): value is string {
  return Boolean(
    value
    && value.trim() === value
    && !value.startsWith("-")
    && !isReservedBypassAlias(value)
    && !value.includes("\0")
    && !value.includes("\r")
    && !value.includes("\n")
    && Buffer.byteLength(value, "utf8") <= 1024,
  );
}

function safeCodexScalar(value: string | undefined): string | undefined {
  return isSafeCodexLaunchScalar(value) ? value : undefined;
}

function invalidLaunchScalar(field: "model" | "reasoning"): RunnerLaunchResult {
  return {
    status: "blocked",
    code: "codex-invalid-launch-scalar",
    diagnostics: [{
      code: "invalid-launch-scalar",
      severity: "error",
      message: `Codex ${field} values must be bounded non-option scalars and cannot override Deck's reserved launch policy token.`,
    }],
  };
}

function hasOwnedBypassPolicy(args: readonly string[]): boolean {
  return args[0] === CODEX_DEVELOPER_BYPASS_ARG
    && args.filter((arg) => arg === CODEX_DEVELOPER_BYPASS_ARG).length === 1
    && !args.slice(1).some(isReservedBypassAlias);
}

function execPayload(input: Extract<RunnerLaunchInput, { mode: "exec" }>): RunnerStdinPayload | undefined {
  const payload = input.stdinPayload ?? { type: "utf8" as const, content: input.prompt.join(" ") };
  if (payload.type !== "utf8" || safeStdinContent(payload.content) === undefined) return undefined;
  return payload;
}

export function buildCodexLaunchPlan(
  input: RunnerLaunchInput,
  features: CodexLaunchFeatures,
  availableReasoningLevels: readonly string[] = [],
  bootstrap?: CodexNewSessionBootstrap,
): RunnerLaunchResult {
  const capability = input.mode === "resume-by-id" ? "resumeById" : input.mode === "resume-latest" ? "resumeLatest" : input.mode;
  if (!features[capability]) {
    return {
      status: "unsupported",
      code: `codex-${input.mode}-unsupported`,
      diagnostics: [{ code: "unsupported-launch-mode", severity: "error", message: `The inspected Codex release does not support ${input.mode}.` }],
    };
  }
  if (input.mode === "resume-by-id" && (input.sessionId.length === 0 || input.sessionId.startsWith("-") || /[\0\r\n]/.test(input.sessionId))) {
    return {
      status: "blocked",
      code: "codex-invalid-session-id",
      diagnostics: [{ code: "invalid-session-id", severity: "error", message: "Resume session IDs must be opaque non-option values." }],
    };
  }

  const newSession = input.mode === "interactive" || input.mode === "exec";
  if (newSession && input.modelId !== undefined && !safeCodexScalar(input.modelId)) return invalidLaunchScalar("model");
  if (newSession && input.reasoningLevel !== undefined && !safeCodexScalar(input.reasoningLevel)) return invalidLaunchScalar("reasoning");
  const args: string[] = [CODEX_DEVELOPER_BYPASS_ARG];
  if (newSession && bootstrap) {
    const developerInstructions = safeTomlString(bootstrap.developerInstructions, MAX_CODEX_BOOTSTRAP_BYTES);
    if (!developerInstructions) {
      return {
        status: "blocked",
        code: "codex-invalid-root-bootstrap",
        diagnostics: [{ code: "invalid-root-bootstrap", severity: "error", message: "Deck Lead bootstrap instructions are invalid and were not launched." }],
      };
    }
    args.push("-c", `developer_instructions=${JSON.stringify(developerInstructions)}`);
  }
  if (newSession) {
    const modelId = safeCodexScalar(input.modelId);
    if (modelId) args.push("--model", modelId);
    const reasoningLevel = safeCodexScalar(input.reasoningLevel);
    if (reasoningLevel && availableReasoningLevels.includes(reasoningLevel)) {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningLevel)}`);
    }
  }
  let stdinPayload: RunnerStdinPayload | undefined;
  if (input.mode === "exec") {
    stdinPayload = execPayload(input);
    if (!stdinPayload) {
      return {
        status: "blocked",
        code: "codex-invalid-exec-prompt",
        diagnostics: [{ code: "invalid-exec-prompt", severity: "error", message: "Codex exec prompt is invalid or exceeds the supported stdin payload limit." }],
      };
    }
    args.push("exec", "-");
  }
  if (input.mode === "resume-by-id") args.push("resume", input.sessionId);
  if (input.mode === "resume-latest") args.push("resume", "--last");
  if (!hasOwnedBypassPolicy(args)) {
    return {
      status: "blocked",
      code: "codex-launch-policy-invariant",
      diagnostics: [{
        code: "launch-policy-invariant",
        severity: "error",
        message: "Deck rejected the Codex launch because argv violates its reserved bypass-policy invariant.",
      }],
    };
  }

  return {
    status: "ready",
    plan: {
      command: "codex",
      args,
      cwd: input.projectRoot,
      stdio: input.mode === "exec" ? "pipe" : "inherit",
      stdin: input.mode === "exec" ? "closed" : "inherit",
      ...(stdinPayload ? { stdinPayload } : {}),
      executionClass: "static-compatible",
      ...(input.mode === "exec" ? { captureLimitBytes: 1024 * 1024 } : {}),
    },
    diagnostics: [
      CODEX_DEVELOPER_BYPASS_DIAGNOSTIC,
      ...(newSession ? [] : [{
        code: "codex-resume-existing-history",
        severity: "info" as const,
        message: "Resume preserves existing Codex history; Deck Lead bootstrap and root model overrides apply only to Deck-created new sessions.",
      }]),
      {
        code: "codex-static-compatible",
        severity: "warning",
        message: "Codex content and launch are available, but protected Developer Team controls are not bridge-enforced in this route.",
      },
    ],
  };
}
