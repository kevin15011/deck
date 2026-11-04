import { inspectCodexSupermemoryArtifact, CODEX_SUPERMEMORY_FILES, CODEX_SUPERMEMORY_VERSION } from "../../../packages/adapter-codex/src/supermemory-artifact";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, dirname } from "node:path";
import {
  inspectCodexSupermemoryReadiness,
  CODEX_LAUNCH_ENV_BINDING,
  isCodexOfficialSupermemoryConfigured,
  CODEX_SUPERMEMORY_MCP_URL,
  CODEX_SUPERMEMORY_ENV_KEY,
  createCodexTools,
  inspectCodexOwnedHookIds,
  isDeckManagedCodexMcpServer,
  CODEX_MEMORY_MCP_SERVER_ID,
  type CodexToolOptions,
} from "@deck/adapter-codex";
import { discoverLiteralSshHostAliasesFromHome, resolveOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";
import {
  createOwnerOnlyFileSecretStore,
  readLogicalGitOriginRemote,
  resolveCanonicalSupermemoryProjectScope,
  resolveSupermemorySessionScope,
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
  return withoutDeckMemoryMcpBlock(source.replace(/^# deck-codex-hook:[a-z0-9-]+:start$[\s\S]*?^# deck-codex-hook:[a-z0-9-]+:end$/gm, ""));
}

/** The Deck memory MCP entry points at a Deck binary whose path may legitimately contain "supermemory"; it is Deck-owned. */
function withoutDeckMemoryMcpBlock(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (![CODEX_MEMORY_MCP_SERVER_ID, "supermemory"].some(id => lines[index]!.trimEnd() === `# deck-codex-mcp:${id}`)) { kept.push(lines[index]!); continue; }
    const id = lines[index]!.trimEnd().slice("# deck-codex-mcp:".length);
    index += 1;
    while (index < lines.length) {
      const trimmed = lines[index]!.trim();
      if (trimmed === "" || trimmed.startsWith("# deck-codex-") || (trimmed.startsWith("[") && !new RegExp(`^\\[mcp_servers\\.${id}(?:\\.|\\])`).test(trimmed))) break;
      index += 1;
    }
    index -= 1;
  }
  return kept.join("\n");
}

function resolveCodexHome(effects: CodexSupermemoryLaunchEffects): string {
  return effects.codexHome ?? (process.env.CODEX_HOME && isAbsolute(process.env.CODEX_HOME) ? process.env.CODEX_HOME : join(effects.home ?? process.env.HOME ?? homedir(), ".codex"));
}

/** True when the reviewed install registered the Deck-owned memory MCP entry (the signal to host the loopback for it). */
export function isCodexMemoryToolsRegistered(effects: CodexSupermemoryLaunchEffects = {}): boolean {
  try {
    return isDeckManagedCodexMcpServer(readBounded(join(resolveCodexHome(effects), "config.toml")) ?? "", CODEX_MEMORY_MCP_SERVER_ID);
  } catch {
    return false;
  }
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
  const codexHome = resolveCodexHome(effects);
  const globalConfig = readBounded(join(codexHome, "config.toml")) ?? "";
  const missing = inspectCodexSupermemoryReadiness(globalConfig,tools)[0];
  if (missing) throw new Error(`Codex Supermemory launch blocked: required local artifact is unavailable (${missing.id}); run Review & Install.`);
  // Deck's own blocks are excluded from the user-level scan; anything else, in user files or in the project, would double-integrate.
  if (/supermemory/i.test(withoutDeckHookBlocks(globalConfig))) throw new Error("Codex Supermemory launch blocked: your Codex configuration contains a non-Deck Supermemory registration that would double-integrate with Deck's official plugin; preserve it and remove the conflict explicitly before retrying.");
  const foreign = [
    [join(codexHome, "hooks.json"), "your Codex hooks.json"],
    [join(projectRoot, ".codex", "hooks.json"), "the project's Codex hooks"],
    [join(projectRoot, ".codex", "config.toml"), "the project's Codex configuration"],
  ] as const;
  for (const [path, label] of foreign) {
    if (/supermemory/i.test(readBounded(path) ?? "")) throw new Error(`Codex Supermemory launch blocked: ${label} already register a Supermemory plugin or MCP server that would double-integrate with Deck's official plugin; preserve it and remove the conflict explicitly before retrying.`);
  }
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
    SUPERMEMORY_MCP_URL: Object.freeze({ value: CODEX_SUPERMEMORY_MCP_URL }),
    SUPERMEMORY_API_VERSION: Object.freeze({ value: canonicalRepoTag ? "v5" : "legacy" }),
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
  // Keep native role instructions intact. Memory guidance uses the existing
  // verified SessionStart context, refreshed on resume and after compaction.
  return {
    ...plan,
    envOverlay: { ...(plan.envOverlay ?? {}), ...overlay },
    sensitiveEnvAuthorization: { binding: VERIFIED_CODEX_SUPERMEMORY_BINDING, keys: [...new Set([...(plan.sensitiveEnvAuthorization?.keys ?? []), CODEX_SUPERMEMORY_ENV_KEY])] },
  };
}

/** Managed sessions with proven absent Git identity use only the explicit shared default. */
export function resolveCodexSupermemorySessionCredential(projectRoot: string, effects: CodexSupermemoryLaunchEffects = {}): { token: string; profile: string; canonicalRepoTag?: string } {
  const scope = resolveSupermemorySessionScope({ projectRoot, remotes: [] });
  if (scope.kind === "canonical") return resolveCodexSupermemoryLaunchCredential(projectRoot, effects);
  if (scope.kind !== "global") throw new Error("Verified Supermemory session scope is unavailable.");
  const home = effects.home ?? process.env.HOME;
  if (!home) throw new Error("Supermemory HOME is unavailable.");
  const canonicalHome = realpathSync(home);
  const store = effects.store ?? createOwnerOnlyFileSecretStore({ configHome: effects.configHome ?? process.env.XDG_CONFIG_HOME ?? join(canonicalHome, ".config") });
  const resolved = resolveOpenCodeSupermemoryCredential({ store });
  if (!resolved.ok) throw new Error(resolved.reason === "invalid-store" ? "Protected shared profile store is invalid." : "No explicit shared default credential is configured.");
  return { token: resolved.token, profile: resolved.profile };
}

/** Read-only disable evidence; never resolves credentials or installs missing artifacts. */
export function inspectDisabledCodexMemoryPlugin(effects: CodexSupermemoryLaunchEffects = {}): import("@deck/core/session/driver").NativeMemoryDescriptor["plugin"] {
  try {
    const tools = createCodexTools({ homeDir: effects.home, ...(effects.tools ?? {}) });
    const nodeCommand = tools.node.command();
    if (!nodeCommand) return undefined;
    const config = readBounded(join(resolveCodexHome(effects), "config.toml")) ?? "";
    const legacyRoot = join(dirname(tools.supermemory.root), `official-supermemory-${CODEX_SUPERMEMORY_VERSION}`);
    let root = tools.supermemory.root, scripts = tools.supermemory.scripts();
    if (!scripts || config.includes(legacyRoot + "/")) {
      // A disabled launch can precede Review & Install. Retained hook-only generations
      // must also be suppressed; recognizing them never authorizes their execution.
      root = legacyRoot;
      const hooks = CODEX_SUPERMEMORY_FILES.filter(([name]) => name === "recall.js" || name === "flush.js");
      if (inspectCodexSupermemoryArtifact(root, hooks) !== "ready") return undefined;
      scripts = { recall: join(root, "recall.js"), flush: join(root, "flush.js") };
    }
    const mcpServers = Object.fromEntries((["supermemory", CODEX_MEMORY_MCP_SERVER_ID] as const)
      .filter(id => isDeckManagedCodexMcpServer(config, id))
      // Disabled descriptors carry names for suppression only, never executable additions.
      .map(id => [id, { command: nodeCommand, args: [], env: {} }]));
    return { root, scripts, nodeCommand, mcpServers };
  } catch { return undefined; }
}
