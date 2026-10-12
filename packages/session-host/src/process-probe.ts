/**
 * Read-only process inspection used to record and later verify execution ownership
 * (XR-3.7, design 6.1). Nothing here can signal a process: the only kill primitive
 * accepted is typed to signal 0 (existence probe).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type ProcessIdentity = { pid: number; boot: string; platform: "linux" | "darwin"; starttime?: string };
export type Presence = "absent" | "alive" | "unknown";
export type ProcStat = { starttime: string; state: string; group: number };

export interface ProcessProbe {
  readonly platform: NodeJS.Platform;
  /** Boot session identity, or undefined when it cannot be determined. */
  bootId(): string | undefined;
  /** Identity of a LIVE process (recorded at spawn time), or undefined when absent/unsupported. */
  identify(pid: number): ProcessIdentity | undefined;
  /** `kill(pid, 0)` classification. */
  presence(pid: number): Presence;
  /** `kill(-pgid, 0)` classification. */
  groupPresence(pgid: number): Presence;
  /** Linux only: parsed /proc/<pid>/stat; undefined when the process is absent. Throws when unreadable. */
  procStat(pid: number): ProcStat | undefined;
}

export type ProbeDeps = {
  platform?: NodeJS.Platform;
  /** Existence probe only: the type forbids any real signal. */
  kill?: (pid: number, signal: 0) => void;
  readFile?: (path: string) => string;
  sysctlBootSession?: () => string;
};

const UUID = /^[a-f0-9-]{36}$/;

export function createNodeProbe(deps: ProbeDeps = {}): ProcessProbe {
  const platform = deps.platform ?? process.platform;
  const kill = deps.kill ?? ((pid: number, signal: 0) => { process.kill(pid, signal); });
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const sysctl = deps.sysctlBootSession ?? (() => execFileSync("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], {
    encoding: "utf8", timeout: 2000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"],
  }));

  const classify = (target: number): Presence => {
    try { kill(target, 0); return "alive"; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ESRCH" ? "absent" : "unknown";
    }
  };

  const bootId = (): string | undefined => {
    try {
      const raw = platform === "linux" ? readFile("/proc/sys/kernel/random/boot_id") : platform === "darwin" ? sysctl() : "";
      const value = raw.trim().toLowerCase();
      return UUID.test(value) ? value : undefined;
    } catch { return undefined; }
  };

  const procStat = (pid: number): ProcStat | undefined => {
    try {
      const fields = readFile(`/proc/${pid}/stat`).split(") ").at(-1)!.split(" ");
      if (!fields[19] || !Number.isInteger(Number(fields[2]))) throw new Error("unparseable /proc stat");
      return { state: fields[0]!, group: Number(fields[2]), starttime: fields[19] };
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
      throw error;
    }
  };

  return {
    platform,
    bootId,
    presence: (pid) => (Number.isSafeInteger(pid) && pid > 0 ? classify(pid) : "unknown"),
    groupPresence: (pgid) => (Number.isSafeInteger(pgid) && pgid > 1 ? classify(-pgid) : "unknown"),
    procStat: (pid) => (platform === "linux" ? procStat(pid) : undefined),
    identify(pid) {
      const boot = bootId();
      if (!boot || !Number.isSafeInteger(pid) || pid <= 0) return undefined;
      if (platform === "linux") {
        const stat = procStat(pid);
        return stat ? { pid, boot, platform: "linux", starttime: stat.starttime } : undefined;
      }
      // Darwin has no trustworthy birth time: identity is boot session + proven absence later.
      if (platform === "darwin") return classify(pid) === "alive" ? { pid, boot, platform: "darwin" } : undefined;
      return undefined;
    },
  };
}
