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
