import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CODEX_LAUNCH_ENV_BINDING,
  CODEX_SUPERMEMORY_ENV_KEY,
  createCodexTools,
  inspectCodexOwnedHookIds,
  type CodexToolOptions,
} from "@deck/adapter-codex";
import { discoverLiteralSshHostAliasesFromHome, resolveOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import {
  createOwnerOnlyFileSecretStore,
  readLogicalGitOriginRemote,
  resolveCanonicalSupermemoryProjectScope,
  resolveVerifiedGitSharedProjectBase,
  type DeckSecretStore,
  type RunnerLaunchPlan,
} from "@deck/core";
import { inspectProjectRepoTagOverride } from "./opencode-supermemory-launch";

/** Binding that lets exactly the official-plugin credential variable reach the Codex child process. */
export const VERIFIED_CODEX_SUPERMEMORY_BINDING = CODEX_LAUNCH_ENV_BINDING;
export const CODEX_SUPERMEMORY_API_URL = "https://api.supermemory.ai";
const MAX_SCAN_BYTES = 256 * 1024;

export type CodexSupermemoryLaunchEffects = {
  home?: string;
  configHome?: string;
  /** Codex user configuration directory; defaults to $CODEX_HOME or ~/.codex. */
  codexHome?: string;
  store?: Pick<DeckSecretStore, "read">;
  discoverAliases?: typeof discoverLiteralSshHostAliasesFromHome;
  origin?: (root: string) => string | undefined;
  tools?: CodexToolOptions;
};

function readBounded(path: string): string | undefined {
  let stat: import("node:fs").Stats;
  try { stat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) throw new Error("A Codex configuration file is not a bounded regular file.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error("A Codex configuration file changed during inspection.");
    const buffer = Buffer.alloc(Math.min(opened.size, MAX_SCAN_BYTES));
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally { closeSync(fd); }
}

/** Removes the Deck-owned marker blocks so any remaining Supermemory text is a foreign registration. */
function withoutDeckHookBlocks(source: string): string {
  return source.replace(/^# deck-codex-hook:[a-z0-9-]+:start$[\s\S]*?^# deck-codex-hook:[a-z0-9-]+:end$/gm, "");
}

/** Resolves only a Deck-selected child-process token/tag. No secret enters config files, argv or diagnostics. */
export function resolveCodexSupermemoryLaunchCredential(projectRoot: string, effects: CodexSupermemoryLaunchEffects = {}): { token: string; profile: string; canonicalRepoTag: string } {
  const home = effects.home ?? process.env.HOME;
  if (!home) throw new Error("Codex Supermemory HOME is unavailable.");
  const canonicalHome = realpathSync(home);
  const store = effects.store ?? createOwnerOnlyFileSecretStore({ configHome: effects.configHome ?? process.env.XDG_CONFIG_HOME ?? join(canonicalHome, ".config") });
  const ssh = (effects.discoverAliases ?? discoverLiteralSshHostAliasesFromHome)(canonicalHome);
  const resolved = resolveOpenCodeSupermemoryCredential({ store: store as DeckSecretStore, origin: (effects.origin ?? readLogicalGitOriginRemote)(projectRoot), ambiguousAliases: ssh.ambiguousAliases, sshDiscoveryStatus: ssh.status });
  if (!resolved.ok) throw new Error(resolved.reason === "invalid-store" ? "Protected shared profile store is invalid." : "No credential matches the trusted SSH alias and no explicit shared default credential is configured.");
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
  if (!scope.ok) throw new Error("Verified canonical Supermemory repository identity is unavailable.");
  return { token: resolved.token, profile: resolved.profile, canonicalRepoTag: scope.scope };
}

/**
 * Fails closed unless the pinned Deck-owned plugin artifact and project hooks are present and nothing else registers
 * Supermemory for Codex (user hooks/MCP, project hooks.json), so exactly one integration reads the credential.
 */
export function assertCodexSupermemoryReady(projectRoot: string, effects: CodexSupermemoryLaunchEffects = {}): void {
  const tools = createCodexTools({ homeDir: effects.home, ...(effects.tools ?? {}) });
  if (tools.supermemory.state() !== "ready") throw new Error("Codex Supermemory launch blocked: the pinned official plugin hooks are not installed and verified (run Review & Install).");
  if (tools.node.command() === undefined) throw new Error("Codex Supermemory launch blocked: a Node.js 18+ runtime is required by the official plugin hooks.");
  const projectConfig = readBounded(join(projectRoot, ".codex", "config.toml")) ?? "";
  if (!inspectCodexOwnedHookIds(projectConfig).includes("supermemory")) throw new Error("Codex Supermemory launch blocked: the project has no Deck-owned Supermemory plugin hooks (run Review & Install).");
  const codexHome = effects.codexHome ?? process.env.CODEX_HOME ?? join(effects.home ?? process.env.HOME ?? homedir(), ".codex");
  const foreign = [
    [join(codexHome, "hooks.json"), "user Codex hooks"],
    [join(codexHome, "config.toml"), "user Codex configuration"],
    [join(projectRoot, ".codex", "hooks.json"), "project Codex hooks"],
  ] as const;
  for (const [path, label] of foreign) {
    if (/supermemory/i.test(readBounded(path) ?? "")) throw new Error(`Codex Supermemory launch blocked: ${label} already register a Supermemory plugin or MCP server that would double-integrate with Deck's official plugin; preserve it and remove the conflict explicitly before retrying.`);
  }
  if (/supermemory/i.test(withoutDeckHookBlocks(projectConfig))) throw new Error("Codex Supermemory launch blocked: the project Codex configuration contains a non-Deck Supermemory registration; preserve it and remove the conflict explicitly before retrying.");
}

/** Builds the child-process-only overlay; the token is never written to a file, argv or config. */
export function buildCodexSupermemoryLaunchOverlay(input: {
  token: string;
  projectRoot: string;
  canonicalRepoTag?: string;
}): NonNullable<RunnerLaunchPlan["envOverlay"]> {
  const token = input.token.trim();
  if (!token) throw new Error("Codex Supermemory launch requires an explicitly selected credential.");
  const canonicalRepoTag = input.canonicalRepoTag?.trim();
  if (canonicalRepoTag) {
    const projectBase = resolveVerifiedGitSharedProjectBase(input.projectRoot);
    if (!projectBase) throw new Error("Codex Supermemory launch blocked because the verified Git project base could not be resolved for canonical repository tagging.");
    const override = inspectProjectRepoTagOverride(projectBase);
    if (override.status === "unsafe") throw new Error("Codex Supermemory launch blocked because the higher-priority project repoContainerTag override could not be inspected safely.");
    if (override.status === "present" && override.tag !== canonicalRepoTag) throw new Error("Codex Supermemory launch blocked because the official plugin's higher-priority project repoContainerTag conflicts with Deck's canonical repository tag.");
  }
  return Object.freeze({
    [CODEX_SUPERMEMORY_ENV_KEY]: Object.freeze({ value: token, sensitive: true }),
    SUPERMEMORY_API_URL: Object.freeze({ value: CODEX_SUPERMEMORY_API_URL }),
    ...(canonicalRepoTag ? { SUPERMEMORY_REPO_TAG: Object.freeze({ value: canonicalRepoTag }) } : {}),
  });
}

/** Binds a verified overlay to the only launch plan allowed to carry its credential. */
export function authorizeCodexSupermemoryLaunch(
  plan: RunnerLaunchPlan,
  input: Parameters<typeof buildCodexSupermemoryLaunchOverlay>[0],
  effects: CodexSupermemoryLaunchEffects = {},
): RunnerLaunchPlan {
  assertCodexSupermemoryReady(input.projectRoot, effects);
  const overlay = buildCodexSupermemoryLaunchOverlay(input);
  return {
    ...plan,
    envOverlay: { ...(plan.envOverlay ?? {}), ...overlay },
    sensitiveEnvAuthorization: { binding: VERIFIED_CODEX_SUPERMEMORY_BINDING, keys: [...new Set([...(plan.sensitiveEnvAuthorization?.keys ?? []), CODEX_SUPERMEMORY_ENV_KEY])] },
  };
}
