/** Presentation-only formatting for launch diagnostics printed to a terminal. */
export interface LaunchDiagnosticLike {
  readonly code: string;
  readonly message: string;
  readonly severity?: "info" | "warning" | "error";
}

const RESET = "\u001b[0m";
const COLOR_BY_SEVERITY = { error: "\u001b[31m", warning: "\u001b[33m" } as const;

export function formatLaunchDiagnostic(diagnostic: LaunchDiagnosticLike, colorEnabled: boolean): string {
  const line = `[${diagnostic.code}] ${diagnostic.message}`;
  if (!colorEnabled) return line;
  const color = diagnostic.severity === "error" || diagnostic.severity === "warning" ? COLOR_BY_SEVERITY[diagnostic.severity] : undefined;
  return color ? `${color}${line}${RESET}` : line;
}

export function shouldColorStderr(env: Record<string, string | undefined> = process.env, isTTY: boolean = Boolean(process.stderr.isTTY)): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  const force = env.FORCE_COLOR?.trim().toLowerCase();
  if (force === "0" || force === "false") return false;
  if (force) return true;
  return isTTY && env.TERM !== "dumb";
}

/** Routine notes: kept in the structured diagnostics model, printed only with --verbose, --dry-run or in diagnostics views. */
const QUIET_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "node-path-cas-residual-risk",
  "codex-static-compatible",
  "codex-hook-trust-bypass",
  "codex-hook-trust-review",
  "codex-supermemory-profile",
  "codex-hooks-json-coexistence",
  "codex-local-only-ignored",
  "codex-resume-existing-history",
  "stale-managed-file-removal",
  "supermemory-raw-mcp-disabled",
  "mcp-foreign-duplicate",
  "runner-inspection",
  "managed-session-readiness",
]);

export function isQuietDiagnostic(diagnostic: LaunchDiagnosticLike): boolean {
  if (diagnostic.severity === "error") return false;
  return diagnostic.severity === "info" || QUIET_DIAGNOSTIC_CODES.has(diagnostic.code);
}

/** Plain-language line for a diagnostic worth showing on a normal launch: no code, no scary prefix beyond a bullet. */
export function formatPlainDiagnostic(diagnostic: LaunchDiagnosticLike): string {
  return `! ${diagnostic.message}`;
}
