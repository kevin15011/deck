import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  OWNED_CODEBASE_VERSION,
  OWNED_RTK_VERSION,
  inspectOwnedCodebase,
  inspectOwnedRtk,
  installOwnedCodebase,
  installOwnedRtk,
  pinnedOwnedCodebaseRelease,
  pinnedOwnedRtkRelease,
  resolveDefaultDeckDataRoot,
  type CodebaseNativeRelease,
  type RtkReleaseArtifact,
} from "@deck/core";

export type PiOwnedState = "absent" | "ready" | "conflict" | "unusable" | "unsupported";

export type PiToolOptions = {
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  dataRoot?: string;
  /** Privileged test seam replacing PATH lookups of shared executables. */
  resolveCommand?: (name: string) => string | undefined;
  rtkReleaseOverride?: RtkReleaseArtifact;
  rtkArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyRtkCommand?: (executable: string) => boolean;
  codebaseReleaseOverride?: CodebaseNativeRelease;
  codebaseArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyCodebaseNative?: (executable: string) => boolean;
  /** Verifies an already-installed shared codebase-memory-mcp (defaults to a real `--version` probe). */
  verifyExistingCodebase?: (executable: string) => boolean;
};

function runVersion(executable: string, home: string, args: readonly string[] = ["--version"]) {
  return spawnSync(executable, [...args], { timeout: 4_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { HOME: home, PATH: process.env.PATH ?? "" } });
}

/**
 * Deck-owned tool resolution for Pi. RTK and Codebase Memory use the pinned, hash-verified artifacts from
 * `@deck/core` (never an unknown PATH binary), except that a usable shared Codebase Memory is reused.
 * Every command returned is an absolute, existing, executable path.
 */
export function createPiTools(options: PiToolOptions = {}) {
  const env = options.env ?? process.env;
  const homeInput = options.homeDir ?? env.HOME;
  if (!homeInput || !isAbsolute(homeInput)) throw new Error("Pi shared tools require an absolute user HOME.");
  const home = realpathSync(resolve(homeInput));
  const lexicalData = resolve(options.dataRoot ?? resolveDefaultDeckDataRoot(env, resolve(homeInput)));
  if (basename(lexicalData) !== "deck" || lexicalData === home) throw new Error("Pi tools require the dedicated Deck data root.");
  const withinHome = relative(resolve(homeInput), lexicalData);
  const dataRoot = withinHome === "" || (withinHome !== ".." && !withinHome.startsWith(`..${sep}`) && !isAbsolute(withinHome)) ? resolve(home, withinHome) : lexicalData;
  const toolRoot = join(dataRoot, "pi", "tools");
  const platform = `${process.platform}-${process.arch}`;

  const pathCandidate = (name: string): string | undefined => {
    const candidate = options.resolveCommand ? options.resolveCommand(name) : (Bun.which(name) ?? undefined);
    return candidate && isAbsolute(candidate) && !/[\0\r\n]/.test(candidate) ? candidate : undefined;
  };
  const executableFile = (candidate: string | undefined): string | undefined => {
    if (!candidate) return undefined;
    try {
      const real = realpathSync(candidate);
      const stat = statSync(real);
      return stat.isFile() && (stat.mode & 0o111) !== 0 ? real : undefined;
    } catch { return undefined; }
  };
  const ensurePrivate = (path: string) => { mkdirSync(path, { recursive: true, mode: 0o700 }); };

  // ---- RTK ----
  const rtkRelease = options.rtkReleaseOverride ?? pinnedOwnedRtkRelease();
  const ownedRtkRoot = join(toolRoot, `rtk-v${OWNED_RTK_VERSION}`, platform);
  const verifyRtk = options.verifyRtkCommand ?? ((executable: string) => {
    const version = runVersion(executable, home);
    const match = `${version.stdout}`.trim().match(/^rtk\s+(\d+)\.(\d+)\.(\d+)/i);
    return version.status === 0 && !!match && !(Number(match[1]) === 0 && Number(match[2]) < 50);
  });
  const rtkState = (): PiOwnedState => {
    if (!rtkRelease) return "unsupported";
    try {
      const state = inspectOwnedRtk(ownedRtkRoot, rtkRelease);
      return state === "ready" && !verifyRtk(join(ownedRtkRoot, "rtk")) ? "unusable" : state;
    } catch { return "conflict"; }
  };

  // ---- Codebase Memory: a usable shared install wins; otherwise the pinned native release ----
  const codebaseRelease = options.codebaseReleaseOverride ?? pinnedOwnedCodebaseRelease();
  const ownedCodebaseRoot = join(toolRoot, `codebase-native-v${OWNED_CODEBASE_VERSION}`, platform);
  const verifyOwnedCodebase = options.verifyCodebaseNative ?? ((executable: string) => runVersion(executable, home).status === 0);
  const verifyExistingCodebase = options.verifyExistingCodebase ?? ((executable: string) => {
    const result = runVersion(executable, home);
    const match = `${result.stdout}`.trim().match(/^codebase-memory-mcp\s+(\d+)\.(\d+)\.(\d+)/i);
    if (result.status !== 0 || !match) return false;
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return major > 0 || minor > 10 || (minor === 10 && patch >= 8);
  });
  const existingCodebase = (): string | undefined => {
    const candidates = options.resolveCommand
      ? [options.resolveCommand("codebase-memory-mcp")]
      : [Bun.which("codebase-memory-mcp") ?? undefined, join(home, ".local", "bin", "codebase-memory-mcp")];
    for (const candidate of candidates) {
      try {
        const real = candidate && isAbsolute(candidate) && existsSync(candidate) ? executableFile(candidate) : undefined;
        if (real && verifyExistingCodebase(real)) return candidate;
      } catch { /* try next */ }
    }
    return undefined;
  };
  const codebaseState = (): PiOwnedState => {
    if (!codebaseRelease) return "unsupported";
    try {
      const state = inspectOwnedCodebase(ownedCodebaseRoot, codebaseRelease);
      return state === "ready" && !verifyOwnedCodebase(join(ownedCodebaseRoot, "codebase-memory-mcp")) ? "unusable" : state;
    } catch { return "conflict"; }
  };

  return Object.freeze({
    home,
    dataRoot,
    toolRoot,
    /** Absolute, executable path for a bare command name (follows symlinks such as nvm shims). */
    resolveExecutable: (name: string): string | undefined => {
      const candidate = pathCandidate(name);
      return executableFile(candidate) ? candidate : undefined;
    },
    rtk: Object.freeze({
      state: rtkState,
      root: ownedRtkRoot,
      supported: () => rtkRelease !== undefined,
      command: (): string | undefined => (rtkState() === "ready" ? join(ownedRtkRoot, "rtk") : undefined),
      async install(): Promise<"installed" | "unchanged"> {
        if (!rtkRelease) throw new Error("No pinned RTK artifact exists for this platform.");
        ensurePrivate(dirname(ownedRtkRoot));
        const result = await installOwnedRtk(ownedRtkRoot, rtkRelease, options.rtkArtifactEffects);
        if (rtkState() !== "ready") throw new Error("RTK verification failed.");
        return result;
      },
    }),
    codebase: Object.freeze({
      state: codebaseState,
      root: ownedCodebaseRoot,
      existing: existingCodebase,
      supported: () => existingCodebase() !== undefined || codebaseRelease !== undefined,
      command: (): string | undefined => existingCodebase() ?? (codebaseState() === "ready" ? join(ownedCodebaseRoot, "codebase-memory-mcp") : undefined),
      async install(): Promise<"installed" | "unchanged"> {
        if (!codebaseRelease) throw new Error("No pinned Codebase Memory native release exists for this platform.");
        ensurePrivate(dirname(ownedCodebaseRoot));
        const result = await installOwnedCodebase(ownedCodebaseRoot, codebaseRelease, options.codebaseArtifactEffects);
        if (codebaseState() !== "ready") throw new Error("Codebase Memory native verification failed.");
        return result;
      },
    }),
  });
}

export type PiTools = ReturnType<typeof createPiTools>;
