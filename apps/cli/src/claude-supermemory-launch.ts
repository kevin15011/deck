import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  createOwnerOnlyFileSecretStore,
  readLogicalGitOriginRemote,
  resolveCanonicalSupermemoryProjectScope,
  type DeckSecretStore,
} from "@deck/core";
import { discoverLiteralSshHostAliasesFromHome, resolveOpenCodeSupermemoryCredential } from "@deck/adapter-opencode";

type Effects = {
  home?: string;
  configHome?: string;
  store?: Pick<DeckSecretStore, "read">;
  discoverAliases?: typeof discoverLiteralSshHostAliasesFromHome;
  origin?: (root: string) => string | undefined;
  claudeConfigDir?: string;
  managedSettingsPaths?: readonly string[];
};

function readOverride(path: string): Record<string, unknown> | undefined {
  let stat: import("node:fs").Stats;
  try { stat = lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Claude Supermemory override is not a bounded regular file.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > 64 * 1024) throw new Error("Claude Supermemory override changed during inspection.");
    const parts: Buffer[] = [];
    const buffer = Buffer.alloc(8192);
    let total = 0;
    while (true) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, 64 * 1024 + 1 - total), null);
      if (count === 0) break;
      total += count;
      if (total > 64 * 1024) throw new Error("Claude Supermemory override exceeds its bound.");
      parts.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(fd);
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.size !== stat.size) throw new Error("Claude Supermemory override changed during inspection.");
    const parsed: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Claude Supermemory override is malformed.");
    return parsed as Record<string, unknown>;
  } finally { closeSync(fd); }
}

function assertNoHigherPriorityOverrides(projectRoot: string, home: string, effects: Effects): void {
  const git = spawnSync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 3_000, maxBuffer: 4096, env: { PATH: process.env.PATH ?? "", HOME: home, LANG: "C" } });
  if (git.status !== 0 || !git.stdout.trim()) throw new Error("Verified Git project root is unavailable.");
  const top = realpathSync(git.stdout.trim());
  const paths = [join(top, ".claude"), join(top, ".claude", ".supermemory-claude"), join(home, ".supermemory-claude"), join(home, ".claude")];
  const relocated = effects.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR;
  if (relocated !== undefined && (!isAbsolute(relocated) || /[\0\r\n]/.test(relocated))) throw new Error("Claude relocated settings directory is untrusted.");
  const userConfigDirs = [...new Set([join(home, ".claude"), ...(relocated ? [resolve(relocated)] : [])])];
  const managedFiles = effects.managedSettingsPaths ?? [
    join(home, ".claude", "managed-settings.json"),
    ...(process.platform === "darwin" ? ["/Library/Application Support/ClaudeCode/managed-settings.json"] : process.platform === "linux" ? ["/etc/claude-code/managed-settings.json"] : []),
  ];
  const inspectedDirs = [...new Set([...paths, ...userConfigDirs, ...managedFiles.map(dirname)])];
  for (const path of inspectedDirs) {
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory()) throw new Error("Claude Supermemory configuration directory is untrusted.");
      if ((stat.mode & 0o022) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0) throw new Error("Claude settings directory is foreign-writable or replaceable.");
      if (relocated && path === resolve(relocated) && realpathSync(path) !== path) throw new Error("Claude relocated settings directory is untrusted.");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const file of [join(paths[1]!, "config.json"), join(paths[2]!, "settings.json")]) {
    const config = readOverride(file);
    if (config && ["apiKey", "baseUrl", "repoContainerTag", "projectContainerTag", "personalContainerTag", "authToken", "apiUrl"].some((key) => Object.hasOwn(config, key))) throw new Error("Claude Supermemory settings override Deck's reviewed credential or repository scope.");
  }
  for (const file of [...userConfigDirs.flatMap((dir) => [join(dir, "settings.json"), join(dir, "settings.local.json")]), join(top, ".claude", "settings.json"), join(top, ".claude", "settings.local.json"), ...managedFiles]) {
    const config = readOverride(file);
    if (!config) continue;
    if (config.env !== undefined) {
      if (!config.env || typeof config.env !== "object" || Array.isArray(config.env)) throw new Error("Claude settings environment override is malformed.");
      if (Object.keys(config.env as Record<string, unknown>).some((key) => /^SUPERMEMORY_/i.test(key) || key === "TAVILY_API_KEY")) throw new Error("Claude settings environment override conflicts with Deck's reviewed credential or endpoint.");
    }
    const enabled = config.enabledPlugins;
    if (enabled !== undefined && (!enabled || typeof enabled !== "object" || Array.isArray(enabled))) throw new Error("Claude plugin registration is malformed.");
    if (enabled && Object.entries(enabled as Record<string, unknown>).some(([name, value]) => /supermemory/i.test(name) && value !== false)) throw new Error("A second enabled Supermemory plugin conflicts with the Deck-reviewed official plugin.");
    const servers = config.mcpServers;
    if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) throw new Error("Claude user or project MCP registration is malformed.");
    if (servers && Object.keys(servers as Record<string, unknown>).some((name) => /supermemory/i.test(name))) throw new Error("An external Supermemory MCP registration conflicts with the Deck-reviewed official plugin.");
  }
}

/** Resolves only a Deck-selected child-process token/tag. No secret enters settings, argv or diagnostics. */
export function resolveClaudeSupermemoryLaunchCredential(projectRoot: string, effects: Effects = {}): { token: string; profile: string; canonicalRepoTag: string } {
  const home = effects.home ?? process.env.HOME;
  if (!home) throw new Error("Claude Supermemory HOME is unavailable.");
  const canonicalHome = realpathSync(home);
  const store = effects.store ?? createOwnerOnlyFileSecretStore({ configHome: effects.configHome ?? process.env.XDG_CONFIG_HOME ?? join(canonicalHome, ".config") });
  const ssh = (effects.discoverAliases ?? discoverLiteralSshHostAliasesFromHome)(canonicalHome);
  const resolved = resolveOpenCodeSupermemoryCredential({ store, origin: (effects.origin ?? readLogicalGitOriginRemote)(projectRoot), ambiguousAliases: ssh.ambiguousAliases, sshDiscoveryStatus: ssh.status });
  if (!resolved.ok) throw new Error(resolved.reason === "invalid-store" ? "Protected shared profile store is invalid." : "No credential matches the trusted SSH alias and no explicit shared default credential is configured.");
  const scope = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
  if (!scope.ok) throw new Error("Verified canonical Supermemory repository identity is unavailable.");
  assertNoHigherPriorityOverrides(projectRoot, canonicalHome, effects);
  return { token: resolved.token, profile: resolved.profile, canonicalRepoTag: scope.scope };
}
