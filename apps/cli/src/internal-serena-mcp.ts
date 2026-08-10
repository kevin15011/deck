import { spawn as nodeSpawn } from "node:child_process";

import {
  SERENA_MCP_ARGS,
  resolveExistingSerenaReadiness,
  type SerenaExistingReadinessResult,
} from "@deck/core";

export const INTERNAL_SERENA_MCP_PROBE_TOKEN = "deck-serena-mcp-proxy-v1";

type ProxyChildOutcome = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}>;

type ProxyChild = Readonly<{
  wait: () => Promise<ProxyChildOutcome>;
  forwardSignal: (signal: NodeJS.Signals) => void;
}>;

type SignalHandler = () => void;

const DEFAULT_FORWARDED_SIGNALS: readonly NodeJS.Signals[] = process.platform === "win32"
  ? ["SIGINT", "SIGTERM"]
  : ["SIGINT", "SIGTERM", "SIGHUP"];

export type InternalSerenaMcpEffects = Readonly<{
  resolveReadiness: () => Promise<SerenaExistingReadinessResult>;
  spawnInherited: (command: string, args: readonly string[]) => Promise<ProxyChild>;
  onSignal?: (signal: NodeJS.Signals, handler: SignalHandler) => () => void;
  /** Allows deterministic tests while production escalates a non-terminating child. */
  scheduleTerminationEscalation?: (handler: () => void) => () => void;
  supportedSignals?: readonly NodeJS.Signals[];
  writeStderr: (message: string) => void;
}>;

export type InternalSerenaMcpResult = Readonly<{
  exitCode: number;
  signal?: NodeJS.Signals;
}>;

function boundedDiagnostic(readiness: Exclude<SerenaExistingReadinessResult, { state: "ready" }>): string {
  const message = readiness.diagnostic.message.replace(/[\r\n]+/g, " ").trim();
  return message.length <= 400 ? message : `${message.slice(0, 397)}...`;
}

function spawnInherited(command: string, args: readonly string[]): Promise<ProxyChild> {
  const child = nodeSpawn(command, [...args], { shell: false, stdio: "inherit" });
  let settled = false;
  const outcome = new Promise<ProxyChildOutcome>((resolve) => {
    const finish = (next: ProxyChildOutcome) => {
      if (settled) return;
      settled = true;
      resolve(next);
    };
    child.once("error", () => finish({ exitCode: 1, signal: null }));
    child.once("close", (exitCode, signal) => finish({ exitCode, signal }));
  });
  return Promise.resolve({
    wait: () => outcome,
    forwardSignal: (signal) => {
      if (settled) return;
      try {
        child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
      }
    },
  });
}

const defaultEffects: InternalSerenaMcpEffects = {
  resolveReadiness: () => resolveExistingSerenaReadiness(),
  spawnInherited,
  onSignal: (signal, handler) => {
    process.on(signal, handler);
    return () => process.off(signal, handler);
  },
  scheduleTerminationEscalation: (handler) => {
    const timer = setTimeout(handler, 1_000);
    timer.unref();
    return () => clearTimeout(timer);
  },
  writeStderr: (message) => process.stderr.write(message),
};

/**
 * Starts the validated Deck-owned Serena launcher as an MCP stdio proxy.
 * This command deliberately accepts no runtime arguments and never invokes
 * bootstrap, installation, configuration, directory creation, or PATH edits.
 */
export async function runInternalSerenaMcp(
  effects: InternalSerenaMcpEffects = defaultEffects,
): Promise<InternalSerenaMcpResult> {
  let readiness: SerenaExistingReadinessResult;
  try {
    readiness = await effects.resolveReadiness();
  } catch {
    effects.writeStderr("deck internal serena-mcp: Serena readiness could not be determined. Install or repair Deck-owned Serena, then retry.\n");
    return { exitCode: 1 };
  }
  if (readiness.state !== "ready") {
    effects.writeStderr(`deck internal serena-mcp: Serena is unavailable (${readiness.diagnostic.code}): ${boundedDiagnostic(readiness)}\n`);
    return { exitCode: 1 };
  }

  let child: ProxyChild;
  try {
    child = await effects.spawnInherited(readiness.evidence.resolvedExecutablePath, SERENA_MCP_ARGS);
  } catch {
    effects.writeStderr("deck internal serena-mcp: Serena could not be started. Repair the Deck-owned launcher, then retry.\n");
    return { exitCode: 1 };
  }

  let forwardedSignal: NodeJS.Signals | undefined;
  let cancelEscalation: (() => void) | undefined;
  const onSignal = effects.onSignal ?? defaultEffects.onSignal!;
  const scheduleTerminationEscalation = effects.scheduleTerminationEscalation ?? defaultEffects.scheduleTerminationEscalation!;
  const removeSignalHandlers: Array<() => void> = [];
  try {
    for (const signal of effects.supportedSignals ?? DEFAULT_FORWARDED_SIGNALS) {
      removeSignalHandlers.push(onSignal(signal, () => {
        if (forwardedSignal) return;
        forwardedSignal = signal;
        child.forwardSignal(signal);
        cancelEscalation = scheduleTerminationEscalation(() => child.forwardSignal("SIGKILL"));
      }));
    }
    const outcome = await child.wait();
    if (outcome.signal) return { exitCode: 1, signal: outcome.signal };
    if (forwardedSignal) return { exitCode: outcome.exitCode ?? 1, signal: forwardedSignal };
    return { exitCode: outcome.exitCode ?? 1 };
  } finally {
    cancelEscalation?.();
    for (const remove of removeSignalHandlers) remove();
  }
}
