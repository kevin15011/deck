import { join } from "node:path";

import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";

import { piAgentPaths } from "./agent-dir";
import type { PiFileIO } from "./pi-global-install";
import { hashContent, normalizePackageSource } from "./pi-manifest";

/**
 * Detection and opt-in transactional cleanup of Deck-written legacy artifacts left by earlier Deck versions:
 * project-local `.pi/agents`, `.pi/skills` and `.deck/pi/profiles`, loose Deck files in `<agentDir>/agents` and
 * `<agentDir>/skills`, and Deck-added community package entries in project `settings.json`.
 *
 * Earlier versions kept no manifest, so "unmodified" means "equal to a known Deck template" (hash match, with the
 * per-user `model`/`thinking`/`tools` frontmatter lines ignored). Everything else is reported and kept.
 */

export const PI_LEGACY_COMMUNITY_PACKAGES: readonly string[] = ["pi-subagents", "pi-mcp-adapter"];
export const PI_LEGACY_STALE_MEMORY_MS = 24 * 3600 * 1000;

export type PiLegacyScope = "project" | "global";
export type PiLegacyKind = "agent" | "skill" | "profile";
/**
 * `stale`: global, Deck-named, differs from every current template, but is demonstrably Deck-authored (older Deck
 * version). It is removed by the opt-in cleanup (backed up first) because it shadows the package's skills.
 */
export type PiLegacyState = "unmodified" | "stale" | "modified" | "unverified";

export type PiLegacyFileFinding = Readonly<{
  scope: PiLegacyScope;
  kind: PiLegacyKind;
  /** Absolute path. */
  path: string;
  /** Probe key (`agents/x.md`, `skills/x/SKILL.md`, `profiles/<team>/system-prompt.md`). */
  key: string;
  state: PiLegacyState;
  /** Hash of the content seen by detection; cleanup keeps the file when it changed since. */
  seenHash: string;
}>;

export type PiLegacyPackageFinding = Readonly<{
  scope: PiLegacyScope;
  settingsPath: string;
  source: string;
  /** True when Deck artifacts prove Deck added the entry (it is removed by cleanup / install). */
  deckAdded: boolean;
}>;

export type PiLegacyReport = Readonly<{
  files: readonly PiLegacyFileFinding[];
  packages: readonly PiLegacyPackageFinding[];
}>;

/** Accepted content hashes per probe key. Absent templates produce `unverified` findings (Doctor). */
export type PiLegacyTemplates = ReadonlyMap<string, readonly string[]>;

const FRONTMATTER_USER_LINES = /^(?:model|thinking|tools):.*$/;

/** Ignores the per-user routing lines in agent frontmatter so a model/thinking change is not "modification". */
export function normalizeLegacyAgentContent(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return content;
  const head = content.slice(0, end).split("\n").filter((line) => !FRONTMATTER_USER_LINES.test(line)).join("\n");
  return `${head}${content.slice(end)}`;
}

export function legacyContentHash(key: string, content: string): string {
  return hashContent(key.startsWith("agents/") ? normalizeLegacyAgentContent(content) : content);
}

/** Probe keys for every Deck-named legacy path the current Deck can recognize. */
export function defaultLegacyProbeKeys(teamId = "developer-team"): string[] {
  const keys = new Set<string>();
  for (const agent of DEVELOPER_TEAM_AGENTS) {
    keys.add(`agents/${agent.id}.md`);
    keys.add(`skills/${agent.skillId}/SKILL.md`);
  }
  for (const skill of getBootstrapSkillFiles()) keys.add(`skills/${skill.skillId}/SKILL.md`);
  keys.add(`profiles/${teamId}/system-prompt.md`);
  keys.add(`profiles/${teamId}/extensions/developer-team-execution.js`);
  return [...keys].sort();
}

/** Marker present in every agent and skill the earlier Deck versions wrote (the adaptive team contract). */
const DECK_AUTHORED_MARKER = "Adaptive Developer Team Contract";

/**
 * Evidence that a Deck-named global file was authored by some Deck version: the key names a `deck-*` id, the content
 * carries the Deck contract marker, and any frontmatter `name` matches the id. Never true for project files.
 */
export function looksDeckAuthored(key: string, content: string): boolean {
  const id = /^agents\/(deck-[^/]+)\.md$/.exec(key)?.[1] ?? /^skills\/(deck-[^/]+)\/SKILL\.md$/.exec(key)?.[1];
  if (!id || !content.includes(DECK_AUTHORED_MARKER)) return false;
  if (!content.startsWith("---")) return !key.startsWith("skills/");
  const end = content.indexOf("\n---", 3);
  const head = end < 0 ? "" : content.slice(0, end);
  const name = /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(head)?.[1];
  return name === undefined ? !key.startsWith("skills/") : name === id;
}

function kindOf(key: string): PiLegacyKind {
  return key.startsWith("agents/") ? "agent" : key.startsWith("skills/") ? "skill" : "profile";
}

/** Absolute path of a probe key inside a scope (project `.pi`/`.deck/pi`, or the Pi agent directory). */
export function legacyPathFor(scope: PiLegacyScope, roots: { projectRoot: string; agentDir: string }, key: string): string {
  const parts = key.split("/");
  if (scope === "global") return join(roots.agentDir, ...parts);
  if (key.startsWith("profiles/")) return join(roots.projectRoot, ".deck", "pi", ...parts);
  return join(roots.projectRoot, ".pi", ...parts);
}

function readSafe(io: PiFileIO, path: string): string | undefined {
  try { return io.readText(path); } catch { return undefined; }
}

function settingsPackageSources(io: PiFileIO, settingsPath: string): string[] {
  const text = readSafe(io, settingsPath);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { packages?: unknown };
    return Array.isArray(parsed.packages) ? parsed.packages.map(normalizePackageSource).filter((entry): entry is string => entry !== undefined) : [];
  } catch {
    return [];
  }
}

export type DetectPiLegacyInput = {
  io: PiFileIO;
  agentDir: string;
  projectRoot: string;
  keys?: readonly string[];
  templates?: PiLegacyTemplates;
};

/** Pure read-only detection; never writes. Missing files are simply absent from the report. */
export function detectPiLegacy(input: DetectPiLegacyInput): PiLegacyReport {
  const keys = input.keys ?? defaultLegacyProbeKeys();
  const roots = { projectRoot: input.projectRoot, agentDir: input.agentDir };
  const files: PiLegacyFileFinding[] = [];
  const scopes: PiLegacyScope[] = ["project", "global"];
  for (const scope of scopes) {
    for (const key of keys) {
      // Profiles lived only in the project (`.deck/pi/profiles`); the global profile is Deck's current layout.
      if (scope === "global" && key.startsWith("profiles/")) continue;
      const path = legacyPathFor(scope, roots, key);
      const disk = readSafe(input.io, path);
      if (disk === undefined) continue;
      const accepted = input.templates?.get(key);
      const state: PiLegacyState = input.templates === undefined
        ? "unverified"
        : accepted?.includes(legacyContentHash(key, disk)) ? "unmodified"
          : scope === "global" && looksDeckAuthored(key, disk) ? "stale" : "modified";
      files.push({ scope, kind: kindOf(key), path, key, state, seenHash: hashContent(disk) });
    }
  }

  const deckLeadEvidence = (scope: PiLegacyScope): boolean => files.some((file) => file.scope === scope && (file.key === "agents/deck-lead.md" || file.key === "skills/deck-lead/SKILL.md"));
  const packages: PiLegacyPackageFinding[] = [];
  const settingsFiles: Array<{ scope: PiLegacyScope; path: string }> = [
    { scope: "project", path: join(input.projectRoot, ".pi", "settings.json") },
    { scope: "global", path: piAgentPaths(input.agentDir).settings },
  ];
  for (const { scope, path } of settingsFiles) {
    for (const source of settingsPackageSources(input.io, path)) {
      if (!PI_LEGACY_COMMUNITY_PACKAGES.includes(source)) continue;
      packages.push({ scope, settingsPath: path, source, deckAdded: deckLeadEvidence(scope) });
    }
  }
  return { files, packages };
}

export function describePiLegacy(report: PiLegacyReport): string[] {
  const lines: string[] = [];
  for (const file of report.files) {
    lines.push(`${file.path} (${file.state === "unmodified" ? "unmodified Deck file" : file.state === "stale" ? "Deck file from an older version that shadows the package: removed by cleanup" : file.state === "modified" ? "differs from the Deck template: kept on cleanup" : "Deck-named file"})`);
  }
  for (const entry of report.packages) {
    const note = !entry.deckAdded
      ? "not recorded as Deck-added: kept"
      : entry.scope === "global" ? "added by an earlier Deck version: removed by the install itself" : "added by an earlier Deck version: removed by the cleanup";
    lines.push(`${entry.settingsPath}: npm:${entry.source} (${note})`);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// Opt-in transactional cleanup
// ---------------------------------------------------------------------------------------------------------------

export type CleanupPiLegacyInput = {
  io: PiFileIO;
  agentDir: string;
  projectRoot: string;
  /** Fresh detection with templates (the caller re-detects immediately before cleanup). */
  report: PiLegacyReport;
  /** Directory under the Deck state home; a timestamped subdirectory is created for the backup. */
  backupRoot: string;
  now?: () => Date;
};

export type CleanupPiLegacyResult = Readonly<{
  removed: readonly string[];
  preserved: readonly string[];
  diagnostics: readonly string[];
  backupDir?: string;
}>;

type Original = { path: string; content: string };

function removeSettingsEntries(content: string, sources: ReadonlySet<string>): string | undefined {
  let parsed: { packages?: unknown } & Record<string, unknown>;
  try { parsed = JSON.parse(content); } catch { return undefined; }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.packages)) return undefined;
  const kept = parsed.packages.filter((entry) => {
    const source = normalizePackageSource(entry);
    return source === undefined || !sources.has(source);
  });
  if (kept.length === parsed.packages.length) return undefined;
  return `${JSON.stringify({ ...parsed, packages: kept }, null, 2)}\n`;
}

/**
 * Removes only unmodified or demonstrably Deck-authored stale files and Deck-added package entries. Everything to be changed is backed up first
 * (a failed backup aborts before any mutation), each file is re-verified immediately before removal, and any
 * failure restores every original.
 */
export function cleanupPiLegacy(input: CleanupPiLegacyInput): CleanupPiLegacyResult {
  const { io } = input;
  const preserved: string[] = [];
  const diagnostics: string[] = [];
  const originals: Original[] = [];

  const fileTargets = input.report.files.filter((file) => {
    if (file.state === "unmodified" || file.state === "stale") return true;
    preserved.push(file.path);
    return false;
  });
  const removablePackages = new Map<string, Set<string>>();
  for (const entry of input.report.packages) {
    // The global settings entries are removed by the install plan itself (mandatory removal), not here.
    if (entry.scope !== "project") continue;
    if (!entry.deckAdded) { preserved.push(`${entry.settingsPath} (npm:${entry.source})`); continue; }
    const set = removablePackages.get(entry.settingsPath) ?? new Set<string>();
    set.add(entry.source);
    removablePackages.set(entry.settingsPath, set);
  }

  const settingsWrites: Array<{ path: string; before: string; after: string }> = [];
  for (const [path, sources] of removablePackages) {
    const before = readSafe(io, path);
    const after = before === undefined ? undefined : removeSettingsEntries(before, sources);
    if (before !== undefined && after !== undefined) settingsWrites.push({ path, before, after });
  }

  const removals: Original[] = [];
  for (const file of fileTargets) {
    const content = readSafe(io, file.path);
    if (content === undefined) continue;
    if (hashContent(content) !== file.seenHash) { preserved.push(file.path); continue; }
    removals.push({ path: file.path, content });
  }

  if (removals.length === 0 && settingsWrites.length === 0) {
    if (preserved.length > 0) diagnostics.push(`Kept ${preserved.length} item(s) that are not unmodified Deck files: ${preserved.join(", ")}. Review them yourself.`);
    else diagnostics.push("No legacy Pi artifacts were found.");
    return { removed: [], preserved, diagnostics };
  }

  originals.push(...removals, ...settingsWrites.map((write) => ({ path: write.path, content: write.before })));
  const stamp = (input.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDir = join(input.backupRoot, `pi-legacy-${stamp}`);
  try {
    const index: Array<{ path: string; backup: string; sha256: string }> = [];
    originals.forEach((original, position) => {
      const backup = join(backupDir, "files", String(position));
      io.writeText(backup, original.content, 0o600);
      index.push({ path: original.path, backup, sha256: hashContent(original.content) });
    });
    io.writeText(join(backupDir, "index.json"), `${JSON.stringify({ createdAt: stamp, items: index }, null, 2)}\n`, 0o600);
  } catch (error) {
    return { removed: [], preserved, diagnostics: [`Legacy cleanup was not started because the backup could not be written (${error instanceof Error ? error.message : String(error)}); nothing was changed.`], backupDir };
  }

  const removed: string[] = [];
  const touchedDirs = new Set<string>();
  try {
    for (const removal of removals) {
      // Re-verify immediately before removal: a file edited since detection is kept.
      const current = readSafe(io, removal.path);
      if (current === undefined) continue;
      if (current !== removal.content) { preserved.push(removal.path); continue; }
      io.remove(removal.path);
      removed.push(removal.path);
      touchedDirs.add(removal.path.slice(0, removal.path.lastIndexOf("/")));
    }
    for (const write of settingsWrites) {
      io.writeText(write.path, write.after);
      removed.push(`${write.path} (Deck-added package entries)`);
    }
  } catch (error) {
    for (const original of originals) {
      try { io.writeText(original.path, original.content); } catch { /* best effort; the backup holds every original */ }
    }
    return { removed: [], preserved, diagnostics: [`Legacy cleanup failed and every changed file was restored (${error instanceof Error ? error.message : String(error)}). Backup: ${backupDir}`], backupDir };
  }

  // Prune directories emptied by the removal, deepest first, never above the scope roots.
  const pruneStops = new Set([input.projectRoot, input.agentDir, join(input.projectRoot, ".pi"), join(input.projectRoot, ".deck"), join(input.projectRoot, ".deck", "pi")]);
  for (const start of [...touchedDirs].sort((left, right) => right.length - left.length)) {
    let directory = start;
    while (!pruneStops.has(directory) && directory.length > 1) {
      io.removeDirIfEmpty(directory);
      const parent = directory.slice(0, directory.lastIndexOf("/"));
      if (parent === directory) break;
      directory = parent;
    }
  }

  diagnostics.push(`Removed ${removed.length} legacy Pi item(s). Backup: ${backupDir}`);
  if (preserved.length > 0) diagnostics.push(`Kept ${preserved.length} item(s) that are not unmodified Deck files (modified, from another Deck version, or not Deck-added): ${preserved.join(", ")}. Review them yourself.`);
  return { removed, preserved, diagnostics, backupDir };
}
