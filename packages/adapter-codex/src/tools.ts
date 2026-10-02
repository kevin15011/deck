import { existsSync, realpathSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import { assertTrustedAncestors, ensurePrivatePath } from "./private-path";
import {
  CODEX_SUPERMEMORY_ROOT_NAME,
  inspectCodexSupermemoryArtifact,
  installCodexSupermemoryArtifact,
  type CodexSupermemoryArtifactEffects,
  type CodexSupermemoryFileEntry,
} from "./supermemory-artifact";

/** Pinned shared npm release, identical to the Claude adapter's reviewed Context Mode version. */
export const CODEX_CONTEXT_MODE_PACKAGE = "context-mode@1.0.169";
export const CODEX_MIN_NODE_MAJOR = 18;

export type CodexOwnedState = "absent" | "ready" | "conflict" | "unusable" | "unsupported";

export type CodexToolOptions = {
  homeDir?: string;
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
  /** Verifies a shared Context Mode executable (defaults to a real `--version` probe). */
  verifyContextMode?: (executable: string) => boolean;
  installContextMode?: () => Promise<boolean>;
  /** Absolute Node.js used by Deck-owned hook scripts; production resolves `node` and checks the version. */
  nodeCommand?: string;
  verifyNodeRuntime?: (executable: string) => boolean;
  supermemoryArtifactEffects?: CodexSupermemoryArtifactEffects;
  supermemoryManifest?: readonly CodexSupermemoryFileEntry[];
};

function runVersion(executable: string, home: string, args: readonly string[] = ["--version"]) {
  return spawnSync(executable, [...args], { timeout: 4_000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { HOME: home, PATH: process.env.PATH ?? "" } });
}

/** Deck-owned shared-tool resolution for Codex; every returned command is an absolute, verified path. */
export function createCodexTools(options: CodexToolOptions = {}) {
  const homeInput = options.homeDir ?? process.env.HOME;
  if (!homeInput || !isAbsolute(homeInput)) throw new Error("Codex shared tools require an absolute user HOME.");
  const home = realpathSync(resolve(homeInput));
  const lexicalData = resolve(options.dataRoot ?? resolveDefaultDeckDataRoot(process.env, resolve(homeInput)));
  if (basename(lexicalData) !== "deck" || lexicalData === home) throw new Error("Codex tools require the dedicated Deck data root.");
  const withinHome = relative(resolve(homeInput), lexicalData);
  const dataRoot = withinHome === "" || withinHome !== ".." && !withinHome.startsWith(`..${sep}`) && !isAbsolute(withinHome) ? resolve(home, withinHome) : lexicalData;
  const parent = join(dataRoot, "codex");
  const toolRoot = join(parent, "tools");
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

  // ---- Node.js (needed by Deck-owned RTK and Supermemory hook scripts) ----
  const verifyNode = options.verifyNodeRuntime ?? ((executable: string) => {
    const probe = runVersion(executable, home);
    return probe.status === 0 && Number(`${probe.stdout}`.trim().match(/^v(\d+)\./)?.[1] ?? 0) >= CODEX_MIN_NODE_MAJOR;
  });
  const nodeCommand = (): string | undefined => {
    const candidate = executableFile(options.nodeCommand ?? pathCandidate("node"));
    return candidate && verifyNode(candidate) ? candidate : undefined;
  };

  // ---- RTK: Deck-owned pinned release, never a PATH binary of unknown version ----
  const rtkRelease = options.rtkReleaseOverride ?? pinnedOwnedRtkRelease();
  const ownedRtkRoot = join(toolRoot, `rtk-v${OWNED_RTK_VERSION}`, platform);
  const verifyRtk = options.verifyRtkCommand ?? ((executable: string) => {
    const version = runVersion(executable, home);
    const match = `${version.stdout}`.trim().match(/^rtk\s+(\d+)\.(\d+)\.(\d+)/i);
    if (version.status !== 0 || !match || Number(match[1]) === 0 && Number(match[2]) < 50) return false;
    const hook = runVersion(executable, home, ["hook", "codex", "--help"]);
    return hook.status === 0 && /Codex CLI PreToolUse hook/i.test(`${hook.stdout}`);
  });
  const rtkState = (): CodexOwnedState => {
    if (!rtkRelease) return "unsupported";
    try {
      assertTrustedAncestors(ownedRtkRoot, home);
      const state = inspectOwnedRtk(ownedRtkRoot, rtkRelease);
      return state === "ready" && !verifyRtk(join(ownedRtkRoot, "rtk")) ? "unusable" : state;
    } catch { return "conflict"; }
  };
  const rtkCommand = (): string | undefined => rtkState() === "ready" ? join(ownedRtkRoot, "rtk") : undefined;

  // ---- Codebase Memory: an existing shared install wins (shared per-user daemon); otherwise the pinned native release ----
  const codebaseRelease = options.codebaseReleaseOverride ?? pinnedOwnedCodebaseRelease();
  const ownedCodebaseRoot = join(toolRoot, `codebase-native-v${OWNED_CODEBASE_VERSION}`, platform);
  const verifyOwnedCodebase = options.verifyCodebaseNative ?? ((executable: string) => runVersion(executable, home).status === 0);
  const verifyExistingCodebase = options.verifyExistingCodebase ?? ((executable: string) => {
    const result = runVersion(executable, home);
    const match = `${result.stdout}`.trim().match(/^codebase-memory-mcp\s+(\d+)\.(\d+)\.(\d+)/i);
    if (result.status !== 0 || !match) return false;
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return major > 0 || minor > 10 || minor === 10 && patch >= 8;
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
  const codebaseState = (): CodexOwnedState => {
    if (!codebaseRelease) return "unsupported";
    try {
      assertTrustedAncestors(ownedCodebaseRoot, home);
      const state = inspectOwnedCodebase(ownedCodebaseRoot, codebaseRelease);
      return state === "ready" && !verifyOwnedCodebase(join(ownedCodebaseRoot, "codebase-memory-mcp")) ? "unusable" : state;
    } catch { return "conflict"; }
  };
  const codebaseCommand = (): string | undefined => existingCodebase() ?? (codebaseState() === "ready" ? join(ownedCodebaseRoot, "codebase-memory-mcp") : undefined);

  // ---- Context Mode: reuse a shared binary; otherwise a pinned npm prefix install inside the Deck-owned tools root ----
  const verifyContextMode = options.verifyContextMode ?? ((executable: string) => runVersion(executable, home).status === 0);
  const ownedContextMode = join(toolRoot, "node_modules", ".bin", "context-mode");
  const contextModeCommand = (): string | undefined => {
    for (const candidate of [pathCandidate("context-mode"), ownedContextMode]) {
      try {
        if (!candidate || !isAbsolute(candidate) || !existsSync(candidate)) continue;
        if (candidate === ownedContextMode) assertTrustedAncestors(toolRoot, home);
        const real = executableFile(candidate);
        if (real && verifyContextMode(real)) return candidate;
      } catch { /* try next */ }
    }
    return undefined;
  };
  const installContextMode = async (): Promise<boolean> => {
    if (options.installContextMode) return options.installContextMode();
    const npm = Bun.which("npm");
    if (!npm) return false;
    await ensurePrivatePath(toolRoot, home);
    const code = await new Promise<number>((done) => {
      const child = spawn(npm, ["install", "--prefix", toolRoot, "--no-audit", "--no-fund", "--ignore-scripts", CODEX_CONTEXT_MODE_PACKAGE], {
        cwd: home,
        env: { HOME: home, PATH: process.env.PATH ?? "", USER: process.env.USER ?? "" },
        stdio: "ignore",
      });
      const timer = setTimeout(() => { child.kill("SIGTERM"); done(1); }, 120_000);
      child.once("error", () => { clearTimeout(timer); done(1); });
      child.once("close", (status) => { clearTimeout(timer); done(status ?? 1); });
    });
    return code === 0 && contextModeCommand() !== undefined;
  };

  // ---- Official Supermemory plugin hooks ----
  const supermemoryRoot = join(toolRoot, CODEX_SUPERMEMORY_ROOT_NAME);
  const supermemoryState = (): "absent" | "ready" | "conflict" => {
    try {
      assertTrustedAncestors(supermemoryRoot, home);
      return inspectCodexSupermemoryArtifact(supermemoryRoot, options.supermemoryManifest);
    } catch { return "conflict"; }
  };

  return Object.freeze({
    home,
    dataRoot,
    parent,
    toolRoot,
    node: Object.freeze({ command: nodeCommand }),
    /** Absolute, executable path for a bare command name (follows symlinks such as nvm shims). */
    resolveExecutable: (name: string): string | undefined => {
      const candidate = pathCandidate(name);
      return executableFile(candidate) ? candidate : undefined;
    },
    rtk: Object.freeze({
      state: rtkState,
      command: rtkCommand,
      root: ownedRtkRoot,
      supported: () => rtkRelease !== undefined,
      async install(): Promise<"installed" | "unchanged"> {
        if (!rtkRelease) throw new Error("No pinned RTK artifact exists for this platform.");
        await ensurePrivatePath(resolve(ownedRtkRoot, ".."), home);
        const result = await installOwnedRtk(ownedRtkRoot, rtkRelease, options.rtkArtifactEffects);
        if (rtkState() !== "ready") throw new Error("RTK verification failed.");
        return result;
      },
    }),
    codebase: Object.freeze({
      state: codebaseState,
      existing: existingCodebase,
      command: codebaseCommand,
      supported: () => existingCodebase() !== undefined || codebaseRelease !== undefined,
      async install(): Promise<"installed" | "unchanged"> {
        if (!codebaseRelease) throw new Error("No pinned Codebase Memory native release exists for this platform.");
        await ensurePrivatePath(resolve(ownedCodebaseRoot, ".."), home);
        const result = await installOwnedCodebase(ownedCodebaseRoot, codebaseRelease, options.codebaseArtifactEffects);
        if (codebaseState() !== "ready") throw new Error("Codebase Memory native verification failed.");
        return result;
      },
    }),
    contextMode: Object.freeze({ command: contextModeCommand, install: installContextMode }),
    supermemory: Object.freeze({
      root: supermemoryRoot,
      state: supermemoryState,
      /** Absolute hook script paths, only when the pinned artifact verifies. */
      scripts: (): { recall: string; flush: string } | undefined => supermemoryState() === "ready" ? { recall: join(supermemoryRoot, "recall.js"), flush: join(supermemoryRoot, "flush.js") } : undefined,
      async install(): Promise<"installed" | "unchanged"> {
        await ensurePrivatePath(toolRoot, home);
        const result = await installCodexSupermemoryArtifact(supermemoryRoot, options.supermemoryArtifactEffects, options.supermemoryManifest);
        if (supermemoryState() !== "ready") throw new Error("Official artifact verification failed.");
        return result;
      },
    }),
  });
}

export type CodexTools = ReturnType<typeof createCodexTools>;
