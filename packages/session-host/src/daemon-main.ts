/** Process entry for `deck internal session-daemon`. */
import { startDaemon, type DaemonOptions } from "./daemon";
import { resolveStatePaths } from "./paths";

export type RunSessionDaemonOptions = {
  env?: Record<string, string | undefined>;
  version: string;
  anchorCommand: readonly string[];
  createService?: DaemonOptions["createService"];
  web?: DaemonOptions["web"];
  stderr?: (text: string) => void;
};

/** Runs until the daemon stops (idle, restart request or signal). Returns the process exit code. */
export async function runSessionDaemon(options: RunSessionDaemonOptions): Promise<number> {
  const env = options.env ?? process.env;
  const stderr = options.stderr ?? ((text: string) => { process.stderr.write(text); });
  const idleOverride = Number(env.DECK_SESSION_DAEMON_IDLE_MS);
  const started = await startDaemon({
    paths: resolveStatePaths({ env }),
    version: options.version,
    anchorCommand: options.anchorCommand,
    createService: options.createService,
    web: options.web,
    ...(Number.isFinite(idleOverride) && idleOverride > 0 ? { idleMs: idleOverride } : {}),
  });
  if (!started.ok) {
    stderr(started.reason === "already-running"
      ? `deck session daemon is already running${started.holder ? ` (pid ${started.holder.pid})` : ""}\n`
      : "deck session daemon could not acquire its lock (another start is in progress)\n");
    return 0;
  }
  const { daemon } = started;
  const onSignal = (signal: string) => () => { void daemon.stop(`signal:${signal}`); };
  const handlers = (["SIGTERM", "SIGINT", "SIGHUP"] as const).map((s) => [s, onSignal(s)] as const);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try { await daemon.stopped; } finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
  return 0;
}
