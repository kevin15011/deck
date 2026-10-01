import type { RunnerLaunchInput, RunnerLaunchResult } from "@deck/core";

const MAX_SESSION_ID_BYTES = 1024;

/** Native Claude launch planning only; installation and plugin handoff are separate gates. */
export function buildClaudeLaunchPlan(input: RunnerLaunchInput): RunnerLaunchResult {
  if (input.deckConfig.adaptiveMemory.enabled || input.deckConfig.adaptiveMemory.activeProvider === "supermemory") {
    return {
      status: "blocked",
      code: "claude-memory-handoff-unverified",
      diagnostics: [{ code: "claude-memory-handoff-unverified", severity: "error", message: "Claude adaptive memory needs a verified Deck-managed plugin and credential handoff before launch." }],
    };
  }
  if (input.mode === "exec") {
    return {
      status: "unsupported",
      code: "claude-exec-unverified",
      diagnostics: [{ code: "claude-exec-unverified", severity: "error", message: "Claude non-interactive launch is not yet bound to Deck's execution controls." }],
    };
  }
  if (input.reasoningLevel !== undefined || input.runnerNative !== undefined) {
    return {
      status: "unsupported",
      code: "claude-native-overrides-unverified",
      diagnostics: [{ code: "claude-native-overrides-unverified", severity: "error", message: "Claude native options are not yet verified for Deck-managed launches." }],
    };
  }
  if (input.modelId !== undefined && !isSafeScalar(input.modelId)) {
    return {
      status: "blocked",
      code: "claude-invalid-model",
      diagnostics: [{ code: "claude-invalid-model", severity: "error", message: "Claude model selection must be a bounded, non-option scalar." }],
    };
  }
  if (input.mode === "resume-by-id" && !isSafeScalar(input.sessionId)) {
    return {
      status: "blocked",
      code: "claude-invalid-session-id",
      diagnostics: [{ code: "claude-invalid-session-id", severity: "error", message: "Claude session ID must be a bounded, non-option scalar." }],
    };
  }

  // Safe mode prevents user/project plugins, hooks and MCP from being loaded in
  // this *native-only* lane. Managed policy can still run managed hooks.
  const args: string[] = ["--safe-mode", ...(input.mode === "resume-by-id" ? ["--resume", input.sessionId]
    : input.mode === "resume-latest" ? ["--continue"] : [])];
  if (input.modelId) args.push("--model", input.modelId);
  return {
    status: "ready",
    plan: {
      command: "claude",
      args,
      cwd: input.projectRoot,
      stdio: "inherit",
      stdin: "inherit",
      executionClass: "static-compatible",
    },
    diagnostics: [{ code: "claude-native-permissions-only", severity: "warning", message: "Claude runs in safe mode with native permissions; Deck team, tools, plugins and memory are not installed on this route. Managed policy may still run hooks." }],
  };
}

function isSafeScalar(value: string): boolean {
  return value.length > 0
    && value.trim() === value
    && !value.startsWith("-")
    && !/[\0\r\n]/.test(value)
    && Buffer.byteLength(value, "utf8") <= MAX_SESSION_ID_BYTES;
}
