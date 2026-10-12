/**
 * Adapter from the host Supervisor to the driver-facing `SupervisedSpawn` (D-7). Drivers get a
 * narrow text-oriented surface; every child runs behind the anchor, and the task lease (if
 * any) is bound here so drivers never see paths or PIDs.
 */
import type { SupervisedChild, SupervisedSpawn } from "@deck/core/session/driver";
import type { SupervisedProcess, Supervisor } from "./supervisor";

export function toSupervisedChild(proc: SupervisedProcess): SupervisedChild {
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  return {
    ready: proc.ready,
    writeStdin: (text) => { proc.stdin.write(text); },
    endStdin: () => { proc.stdin.end(); },
    onStdout: (listener) => { proc.stdout.on("data", (chunk: string) => listener(chunk)); },
    onStderr: (listener) => { proc.stderr.on("data", (chunk: string) => listener(chunk)); },
    interrupt: () => proc.interrupt(),
    terminateGroup: (graceMs) => proc.terminateGroup(graceMs),
    exited: proc.exited,
  };
}

export function createDriverSpawn(supervisor: Supervisor, bound: { lease?: { file: string; taskId: string }; env?: Record<string, string> } = {}): SupervisedSpawn {
  return async (command, args, options) => toSupervisedChild(supervisor.spawn(command, args, {
    cwd: options?.cwd,
    env: options?.env ?? bound.env,
    ...(bound.lease ? { lease: bound.lease } : {}),
  }));
}
