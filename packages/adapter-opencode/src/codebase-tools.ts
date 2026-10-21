import { realpathSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { OWNED_CODEBASE_VERSION, inspectOwnedCodebase, installOwnedCodebase, isCompatibleCodebaseExecutable, pinnedOwnedCodebaseRelease, resolveDefaultDeckDataRoot, type CodebaseNativeRelease } from "@deck/core";
import { assertTrustedAncestors, ensurePrivatePath } from "./codebase-private-path";

export type OpenCodeCodebaseOptions = {
  homeDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  dataRoot?: string;
  resolveCommand?: (name: string) => string | undefined;
  release?: CodebaseNativeRelease;
  artifactEffects?: { fetchArchive?: (asset: string, signal?: AbortSignal) => Promise<Uint8Array> };
};

/** Reviewed native acquisition; shared user binaries are inspected read-only, never replaced. */
export function createOpenCodeCodebaseTools(options: OpenCodeCodebaseOptions = {}) {
  const env = options.environment ?? process.env;
  const input = options.homeDirectory ?? env.HOME;
  if (!input || !isAbsolute(input)) throw new Error("OpenCode Codebase Memory requires absolute HOME.");
  const home = realpathSync(input);
  const data = resolve(options.dataRoot ?? resolveDefaultDeckDataRoot(env, home));
  if (basename(data) !== "deck" || data === home) throw new Error("OpenCode Codebase Memory requires the dedicated Deck data root.");
  const root = join(data, "opencode", "tools", `codebase-native-v${OWNED_CODEBASE_VERSION}`, `${process.platform}-${process.arch}`);
  const release = options.release ?? pinnedOwnedCodebaseRelease();
  const sharedCandidates = () => (options.resolveCommand ? [options.resolveCommand("codebase-memory-mcp")] : [Bun.which("codebase-memory-mcp", { PATH: env.PATH }) ?? undefined, join(home, ".local", "bin", "codebase-memory-mcp")]).filter((path): path is string => !!path && isAbsolute(path) && !/[\0\r\n]/.test(path));
  const existing = () => {
    return sharedCandidates().find((path): path is string => !!path && isAbsolute(path) && !!release && isCompatibleCodebaseExecutable(path, release));
  };
  const state = (): "absent" | "ready" | "conflict" | "unsupported" => {
    if (!release) return "unsupported";
    try { assertTrustedAncestors(root, home); return inspectOwnedCodebase(root, release); }
    catch { return "conflict"; }
  };
  return {
    root, existing, state, sharedCandidates,
    command: () => existing() ?? (state() === "ready" ? join(root, "codebase-memory-mcp") : undefined),
    async install(signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (!release) throw new Error("No pinned Codebase Memory native release exists for this platform.");
      await ensurePrivatePath(resolve(root, ".."), home);
      signal?.throwIfAborted();
      return installOwnedCodebase(root, release, { ...options.artifactEffects, signal });
    },
  };
}
export type OpenCodeCodebaseTools = ReturnType<typeof createOpenCodeCodebaseTools>;
