import { randomUUID } from "node:crypto";
import { assertPiProjectSkillExclusionTargets } from './project-skill-exclusions';
import { jsonRanges, type JsonNode } from "../../core/src/jsonc-ranges";
import { ensureDurableDir, runnerProjectScope, recordRunnerMutationJournals, compareReleaseVersions, backupManagedPreimages, assertNoContributionSymlink, contributionId, type RunnerContribution, type ContributionTarget } from "@deck/core";
import { closeSync, fsyncSync, openSync, chmodSync, existsSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, posix, sep } from "node:path";

import { piAgentPaths } from "./agent-dir";
import {
  canonicalJson,
  createEmptyPiManifest,
  fileOwnershipHash,
  hashContent,
  matchesOwnedHash,
  hashJsonValue,
  normalizePackageSource,
  parsePiManifest,
  serializePiManifest,
  type PiManifestV1,
} from "./pi-manifest";

/**
 * Transactional, manifest-owned global materialization under the Pi agent directory.
 *
 * Legacy callers retain hash-based ownership. Managed callers regenerate the dedicated package/profile roots
 * and exact generated settings selectors; generic MCP entries require bounded prior recognition.
 * Shared JSON edits preserve unrelated bytes. Private preimages precede effects; verified postimages precede
 * receipts, and the existing transaction restores its snapshots if an effect fails.
 */

export type PiFileIO = {
  exists(path: string): boolean;
  /** Returns undefined when the file does not exist. */
  readText(path: string): string | undefined;
  /** Atomically writes (creating parent directories). `mode` applies to newly created files. */
  writeText(path: string, content: string, mode?: number): void;
  /** Permission metadata, when supported by the backing filesystem. */
  readMode?(path: string): number | undefined;
  remove(path: string): void;
  /** Removes a directory only when empty; never throws. */
  removeDirIfEmpty(path: string): void;
};

export function createNodePiFileIO(): PiFileIO {
  return {
    exists: (path) => existsSync(path),
    readText: (path) => {
      try {
        assertNoContributionSymlink(path);
        return readFileSync(path, "utf-8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
    },
    readMode: (path) => {
      assertNoContributionSymlink(path);
      try { return statSync(path).mode & 0o7777; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    },
    writeText: (path, content, mode) => {
      assertNoContributionSymlink(path);
      ensureDurableDir(dirname(path), 0o777 & ~process.umask());
      const temporary = `${path}.deck-${randomUUID()}.tmp`;
      const existed = existsSync(path);
      try {
        writeFileSync(temporary, content, { flag: 'wx', encoding: "utf-8", mode: 0o600 });
        if (existed) chmodSync(temporary, statSync(path).mode & 0o7777);
        else chmodSync(temporary, mode ?? (0o666 & ~process.umask()));
        const descriptor = openSync(temporary, 'r');
        try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
        assertNoContributionSymlink(path);
        renameSync(temporary, path);
        const directory = openSync(dirname(path), 'r');
        try { fsyncSync(directory); } finally { closeSync(directory); }
      } catch (error) {
        try { rmSync(temporary, { force: true }); } catch { /* best effort */ }
        throw error;
      }
    },
    remove: (path) => {
      assertNoContributionSymlink(path);
      if (!existsSync(path)) return;
      rmSync(path, { force: true });
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    },
    removeDirIfEmpty: (path) => { try { rmdirSync(path); } catch { /* not empty or absent */ } },
  };
}

export type PiDesiredFile = { relPath: string; content: string; mode?: number };

export type PiGlobalDesiredState = {
  agentDir: string;
  /** Deck-owned files, keyed by POSIX path relative to the agent dir. */
  files: readonly PiDesiredFile[];
  /** Desired `settings.json` `packages` entry for the Deck package; undefined removes it. */
  packageEntry: string | undefined;
  /**
   * Names of Deck skills (as shipped in the package) to exclude from Pi's auto-discovered skill roots
   * (`<agentDir>/skills`, `~/.agents/skills`) through `settings.json` `skills` entries `!<name>`, so Codex-owned
   * copies never produce collision diagnostics. Empty removes every exclusion Deck added.
   */
  skillExclusions: readonly string[];
  /** Desired Deck MCP server entries by name. */
  mcpServers: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Evidence (e.g. old Deck agents) that earlier Deck versions installed pi-subagents / pi-mcp-adapter. */
  legacyDeckEvidence: boolean;
};

export type PiPlanDiagnostic = { code: string; severity: "info" | "warning" | "error"; message: string };

export type PiPlanConflict = { relPath: string; reason: "foreign" | "modified" | "invalid"; message: string };

export type PiPlannedChange = {
  kind: "file" | "settings" | "mcp" | "manifest" | "backup";
  action: "create" | "update" | "delete";
  relPath: string;
  path: string;
  preimage: string;
  postimage: string;
};

type PlannedWrite = { path: string; content: string; mode?: number; expectedPre: string | "absent" };
type PlannedDelete = { path: string; expectedPre: string };

export type PiGlobalPlan = {
  agentDir: string;
  projectRetirement?: { root: string; entries: readonly { path: string; content: string }[] };
  managedFiles?: readonly PiDesiredFile[];
  managedPreimages?: readonly { target: ContributionTarget; content: string }[];
  blocked: boolean;
  diagnostics: PiPlanDiagnostic[];
  conflicts: PiPlanConflict[];
  /** Previously Deck-owned files that were left in place because the user modified them. */
  kept: { relPath: string; reason: string }[];
  changes: PiPlannedChange[];
  mutationPreview: { action: "create" | "update" | "delete"; path: string; preimage: string; postimage: string; ownership: string }[];
  /** `settings.json` package entries removed as Deck-added conflicting packages. */
  removedPackages: string[];
  writes: PlannedWrite[];
  deletes: PlannedDelete[];
};

export type PlanOptions = { now?: () => Date; managed?: boolean };

const CONFLICTING_PACKAGES = ["pi-subagents", "pi-mcp-adapter"] as const;
const MAX_JSON_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.includes("\0") || relPath.includes("\\") || isAbsolute(relPath) || posix.isAbsolute(relPath)) return false;
  const normalized = posix.normalize(relPath);
  return normalized === relPath && !normalized.startsWith("../") && normalized !== ".." && normalized !== ".";
}

function resolveInside(agentDir: string, relPath: string): string {
  return join(agentDir, ...relPath.split("/"));
}

function legacyDeckMcpEntry(name: string, entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  // Earlier Deck writers always added `transport: "process"`; Pi itself never uses that key.
  if (entry.transport === "process") return true;
  if (name === "serena" && typeof entry.command === "string" && entry.command.endsWith("/bin/serena")) return true;
  return false;
}

type JsonFile = { present: boolean; text: string | undefined; value: Record<string, unknown> };

function readJsonObject(io: PiFileIO, path: string): { ok: true; file: JsonFile } | { ok: false; message: string } {
  let text: string | undefined;
  try {
    text = io.readText(path);
  } catch (error) {
    return { ok: false, message: `Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (text === undefined) return { ok: true, file: { present: false, text: undefined, value: {} } };
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) return { ok: false, message: `${path} is unexpectedly large.` };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { ok: false, message: `${path} must contain a JSON object.` };
    return { ok: true, file: { present: true, text, value: parsed } };
  } catch {
    return { ok: false, message: `${path} contains malformed JSON.` };
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Apply JSON changes at value/element boundaries; unchanged siblings retain their original bytes. */
function preserveJson(source: string | undefined, value: Record<string, unknown>): string {
  if (source === undefined) return serializeJson(value);
  const patch = (text: string, path: string[], next: unknown): string => {
    const locate = (): JsonNode => path.reduce((node, key) => node.properties!.get(key)!.node, jsonRanges(text));
    const node = locate();
    if (canonicalJson(node.value) === canonicalJson(next)) return text;
    if (node.properties && isRecord(next)) {
      for (const key of [...node.properties.keys()].filter(key => !(key in next))) {
        const parent = path.reduce((part, key) => part.properties!.get(key)!.node, jsonRanges(text));
        const entry = parent.properties!.get(key)!;
        const start = entry.comma === undefined && entry.previousComma !== undefined ? entry.previousComma : entry.start;
        text = text.slice(0, start) + text.slice(entry.comma === undefined ? entry.node.end : entry.comma + 1);
      }
      for (const [key, item] of Object.entries(next)) {
        const parent = path.reduce((part, key) => part.properties!.get(key)!.node, jsonRanges(text));
        if (parent.properties!.has(key)) text = patch(text, [...path, key], item);
        else {
          const at = parent.end - 1;
          text = text.slice(0, at) + `${parent.properties!.size ? ',' : ''}${JSON.stringify(key)}:${JSON.stringify(item)}` + text.slice(at);
        }
      }
      return text;
    }
    if (node.elements && Array.isArray(next)) {
      const remaining = new Map<string, number>();
      for (const item of next) { const key = canonicalJson(item); remaining.set(key, (remaining.get(key) ?? 0) + 1); }
      const keep = node.elements.map(entry => {
        const key = canonicalJson(entry.node.value), count = remaining.get(key) ?? 0;
        if (count) remaining.set(key, count - 1);
        return count > 0;
      });
      // Remove only obsolete/duplicate values; unchanged foreign elements keep formatting.
      for (let index = node.elements.length - 1; index >= 0; index--) {
        const array = path.reduce((part, key) => part.properties!.get(key)!.node, jsonRanges(text));
        const entry = array.elements![index]!;
        if (keep[index]) continue;
        const start = entry.comma === undefined && entry.previousComma !== undefined ? entry.previousComma : entry.node.start;
        text = text.slice(0, start) + text.slice(entry.comma === undefined ? entry.node.end : entry.comma + 1);
      }
      const array = path.reduce((part, key) => part.properties!.get(key)!.node, jsonRanges(text));
      const present = new Set(array.elements!.map(entry => canonicalJson(entry.node.value)));
      const missing = next.filter(item => !present.has(canonicalJson(item)));
      if (missing.length) text = text.slice(0, array.end - 1) + `${array.elements!.length ? ',' : ''}${missing.map(item => JSON.stringify(item)).join(',')}` + text.slice(array.end - 1);
      const result = path.reduce((part, key) => part.properties!.get(key)!.node, jsonRanges(text));
      if (canonicalJson(result.value) === canonicalJson(next)) return text;
      throw new Error('Pi shared array order changed outside the planned entries');
    }
    return text.slice(0, node.start) + JSON.stringify(next) + text.slice(node.end);
  };
  return patch(source, [], value);
}

export function planPiGlobalInstall(desired: PiGlobalDesiredState, io: PiFileIO, options: PlanOptions = {}): PiGlobalPlan {
  const { agentDir } = desired;
  const paths = piAgentPaths(agentDir);
  const plan: PiGlobalPlan = {
    agentDir,
    blocked: false,
    diagnostics: [],
    conflicts: [],
    kept: [],
    changes: [],
    mutationPreview: [],
    removedPackages: [],
    writes: [],
    deletes: [],
  };
  const generated = (relPath: string) => isSafeRelPath(relPath) && (relPath.startsWith('deck/package/') || relPath.startsWith('deck/profiles/'));
  if (options.managed) { plan.managedFiles = desired.files.filter(file => generated(file.relPath)); plan.managedPreimages = []; }
  const block = (diagnostic: PiPlanDiagnostic) => {
    plan.diagnostics.push(diagnostic);
    plan.blocked = true;
  };
  const conflict = (entry: PiPlanConflict, code: string) => {
    plan.conflicts.push(entry);
    plan.diagnostics.push({ code, severity: entry.reason === "invalid" ? "error" : "warning", message: entry.message });
    if (entry.reason === "invalid") plan.blocked = true;
  };
  const addChange = (change: PiPlannedChange, write?: PlannedWrite, del?: PlannedDelete) => {
    plan.changes.push(change);
    plan.mutationPreview.push({ action: change.action, path: change.path, preimage: change.preimage, postimage: change.postimage, ownership: `pi-deck-${change.kind}` });
    if (write) plan.writes.push(write);
    if (del) plan.deletes.push(del);
  };

  // --- path safety -------------------------------------------------------------------------------------
  for (const file of desired.files) {
    if (!isSafeRelPath(file.relPath)) {
      conflict({ relPath: file.relPath, reason: "invalid", message: `Refusing to write outside the Pi agent directory: ${file.relPath}.` }, "PI_PLAN_PATH_ESCAPE");
    }
  }
  if (plan.blocked) return plan;

  // --- manifest ----------------------------------------------------------------------------------------
  let manifest = createEmptyPiManifest();
  const manifestRead = (() => {
    try { return io.readText(paths.manifest); } catch { return null; }
  })();
  if (manifestRead === null) {
    block({ code: "PI_MANIFEST_UNREADABLE", severity: "error", message: `Unable to read the Deck Pi manifest at ${paths.manifest}.` });
    return plan;
  }
  if (manifestRead !== undefined) {
    const parsed = parsePiManifest(manifestRead);
    let newer = false;
    try {
      const raw = JSON.parse(manifestRead);
      const version = typeof raw.schema === 'string' ? /^deck-pi-manifest-v(\d+)$/.exec(raw.schema) : undefined;
      newer = !!version && Number(version[1]) > 1 || typeof raw.deckVersion === 'string' && compareReleaseVersions(raw.deckVersion, '0.14.0') > 0;
    } catch { /* Ordinary invalid metadata is not target authority. */ }
    if (!parsed.ok || newer) {
      if (!options.managed || newer || io.exists(`${paths.manifest}.pending`)) {
        block({ code: "PI_MANIFEST_CORRUPT", severity: "error", message: 'Pi ownership metadata is invalid, newer, or pending recovery; no effects are allowed.' });
        return plan;
      }
      (plan.managedPreimages as { target: ContributionTarget; content: string }[]).push({ target: { path: paths.manifest, selector: { kind: "file" } }, content: manifestRead });
      plan.diagnostics.push({ code: 'PI_MANIFEST_REBUILT', severity: 'warning', message: 'Corrupt ownership metadata will be privately retained and rebuilt from canonical generated output.' });
    } else manifest = parsed.manifest;
  }

  // --- files -------------------------------------------------------------------------------------------
  const desiredPaths = new Set(desired.files.map((file) => file.relPath));
  const nextFiles: Record<string, string> = {};
  // Receipt hashes belong to this plan's observations, not a second disk read.
  // Nothing survives the call; apply still checks live preimages and paths.
  const fileReceiptHashes = new Map<string, string>();
  for (const file of desired.files) {
    const absolute = resolveInside(agentDir, file.relPath);
    const postimage = hashContent(file.content);
    nextFiles[file.relPath] = fileOwnershipHash(file.relPath, file.content);
    let disk: string | undefined;
    try { disk = io.readText(absolute); } catch (error) {
      conflict({ relPath: file.relPath, reason: "invalid", message: `Unable to read ${absolute}: ${error instanceof Error ? error.message : String(error)}` }, "PI_FILE_UNREADABLE");
      continue;
    }
    if (disk === undefined) {
      fileReceiptHashes.set(file.relPath, postimage);
      addChange({ kind: "file", action: "create", relPath: file.relPath, path: absolute, preimage: "absent", postimage }, { path: absolute, content: file.content, mode: file.mode, expectedPre: "absent" });
      continue;
    }
    const diskHash = hashContent(disk);
    if (diskHash === postimage || file.relPath.endsWith(".json") && fileOwnershipHash(file.relPath,disk) === fileOwnershipHash(file.relPath,file.content)) {
      fileReceiptHashes.set(file.relPath, diskHash);
      if (!(options.managed && generated(file.relPath)) && !matchesOwnedHash(file.relPath, manifest.files[file.relPath], disk) && !matchesOwnedHash(file.relPath, manifest.files[file.relPath], file.content)) {
        delete nextFiles[file.relPath];
        plan.diagnostics.push({code:"PI_FILE_UNRECEIPTED",severity:"warning",message:`Preserved unreceipted Pi file ${absolute}; it remains user-owned.`});
      }
      continue;
    }
    const owned = manifest.files[file.relPath];
    if (owned === undefined && !(options.managed && generated(file.relPath))) {
      delete nextFiles[file.relPath];
      conflict({ relPath: file.relPath, reason: "foreign", message: `A file Deck does not own already exists at ${absolute}; Deck will not overwrite it.` }, "PI_FILE_FOREIGN");
      continue;
    }
    if (!(options.managed && generated(file.relPath)) && !matchesOwnedHash(file.relPath, owned, disk)) {
      delete nextFiles[file.relPath];
      conflict({ relPath: file.relPath, reason: "modified", message: `${absolute} was modified after Deck wrote it; Deck will not overwrite it. Restore or remove the file to continue.` }, "PI_FILE_MODIFIED");
      continue;
    }
    fileReceiptHashes.set(file.relPath, postimage);
    addChange({ kind: "file", action: "update", relPath: file.relPath, path: absolute, preimage: diskHash, postimage }, { path: absolute, content: file.content, mode: file.mode, expectedPre: diskHash });
  }
  for (const [relPath, owned] of Object.entries(manifest.files)) {
    if (desiredPaths.has(relPath)) continue;
    if (options.managed && !generated(relPath)) continue; // Receipts never expand the generated retirement roots.
    if (!isSafeRelPath(relPath)) continue;
    const absolute = resolveInside(agentDir, relPath);
    let disk: string | undefined;
    try { disk = io.readText(absolute); } catch { disk = undefined; }
    if (disk === undefined) continue;
    const diskHash = hashContent(disk);
    if (!(options.managed && generated(relPath)) && !matchesOwnedHash(relPath, owned, disk)) {
      plan.kept.push({ relPath, reason: "modified by the user; no longer managed by Deck" });
      continue;
    }
    if (options.managed && generated(relPath)) { (plan.managedPreimages as { target: ContributionTarget; content: string }[]).push({ target: { path: absolute, selector: { kind: "file" } }, content: disk }); }
    addChange({ kind: "file", action: "delete", relPath, path: absolute, preimage: diskHash, postimage: "absent" }, undefined, { path: absolute, expectedPre: diskHash });
  }

  // --- settings.json -----------------------------------------------------------------------------------
  const settingsRead = readJsonObject(io, paths.settings);
  let nextSettingsText: string | undefined;
  let removedAddedPackages: string[] = [];
  const hasMcpDesired = Object.keys(desired.mcpServers).length > 0;
  if (!settingsRead.ok) {
    block({ code: "PI_SETTINGS_MALFORMED", severity: "error", message: settingsRead.message });
  } else {
    const settings = settingsRead.file.value;
    const currentPackages = settings.packages;
    if (currentPackages !== undefined && !Array.isArray(currentPackages)) {
      block({ code: "PI_SETTINGS_MALFORMED", severity: "error", message: `${paths.settings} \`packages\` must be an array.` });
    } else {
      let packages: unknown[] = [...(currentPackages ?? [])];
      const deckPath = desired.packageEntry ?? paths.packageSettingsEntry;
      const addedNormalized = new Set(manifest.settings.addedPackages.map((entry) => normalizePackageSource(entry)));

      // Deck-reserved package entry
      const deckEntries = packages.map((entry, index) => ({ entry, index })).filter(({ entry }) => normalizePackageSource(entry) === deckPath);
      const foreignDeckEntry = deckEntries.find(({ entry }) => typeof entry !== "string");
      if (foreignDeckEntry && desired.packageEntry !== undefined && !options.managed) {
        block({ code: "PI_SETTINGS_FOREIGN_DECK_PACKAGE", severity: "error", message: `${paths.settings} already contains a customized entry for ${deckPath}; Deck will not replace it. Remove it or use the plain string form.` });
      } else {
        if (options.managed) {
          for (const { entry } of deckEntries.filter(({ entry }) => typeof entry !== 'string'))
            (plan.managedPreimages as { target: ContributionTarget; content: string }[]).push({ target: { path: paths.settings, selector: { kind: 'json-array', keys: ['packages'], identity: canonicalJson(entry) } }, content: canonicalJson(entry) });
          packages = packages.filter(entry => normalizePackageSource(entry) !== deckPath || typeof entry === "string");
        }
        const stringEntries = packages.map((entry, index) => ({ entry, index })).filter(({ entry }) => normalizePackageSource(entry) === deckPath).filter(({ entry }) => typeof entry === "string");
        if (desired.packageEntry !== undefined) {
          if (stringEntries.length === 0) packages.push(desired.packageEntry);
          else if (stringEntries.length > 1) {
            // De-duplicate: keep the first occurrence only.
            const drop = new Set(stringEntries.slice(1).map(({ index }) => index));
            packages = packages.filter((_, index) => !drop.has(index));
          }
        } else if (manifest.settings.packages.includes(deckPath)) {
          const drop = new Set(stringEntries.map(({ index }) => index));
          packages = packages.filter((_, index) => !drop.has(index));
        }
      }

      // Conflicting third-party packages
      for (const name of CONFLICTING_PACKAGES) {
        const matches = packages.filter((entry) => normalizePackageSource(entry) === name);
        if (matches.length === 0) continue;
        const deckAdded = desired.legacyDeckEvidence || addedNormalized.has(name);
        if (deckAdded) {
          for (const entry of matches) removedAddedPackages.push(typeof entry === "string" ? entry : `${name}`);
          packages = packages.filter((entry) => normalizePackageSource(entry) !== name);
        } else if (name === "pi-mcp-adapter") {
          if (hasMcpDesired) {
            block({ code: "PI_MCP_ADAPTER_USER_INSTALLED", severity: "error", message: "pi-mcp-adapter is installed in your Pi settings and registers /mcp, which disables Pi's built-in MCP support that Deck uses. Deck did not install it and will not remove it. Run `pi remove npm:pi-mcp-adapter` (or remove it from settings.json `packages`), then re-run Deck." });
          } else {
            plan.diagnostics.push({ code: "PI_MCP_ADAPTER_USER_INSTALLED", severity: "warning", message: "pi-mcp-adapter is installed and disables Pi's built-in MCP; Deck MCP servers will not work until it is removed." });
          }
        } else {
          plan.diagnostics.push({ code: "PI_SUBAGENTS_USER_INSTALLED", severity: "warning", message: "pi-subagents is installed in your Pi settings and may register a subagent tool that conflicts with Deck's. Deck did not install it and will not remove it." });
        }
      }

      if (!plan.blocked) {
        const changed = canonicalJson(currentPackages ?? []) !== canonicalJson(packages) || (currentPackages === undefined && packages.length > 0);
        if (changed) {
          const nextSettings = { ...settings, packages };
          nextSettingsText = preserveJson(settingsRead.file.text, nextSettings);
        }
      }
    }
  }
  plan.removedPackages = removedAddedPackages;

  // --- settings.json `skills` exclusions (Deck-owned entries only) ---------------------------------------
  const desiredExclusions = [...new Set(desired.skillExclusions.map((name) => `!${name}`))];
  let nextOwnedExclusions: string[] = [];
  if (settingsRead.ok && !plan.blocked) {
    const currentSkills = settingsRead.file.value.skills;
    if (currentSkills !== undefined && !Array.isArray(currentSkills)) {
      block({ code: "PI_SETTINGS_MALFORMED", severity: "error", message: `${paths.settings} \`skills\` must be an array.` });
    } else {
      const owned = new Set(manifest.settings.skillExclusions);
      let skills: unknown[] = [...(currentSkills ?? [])];
      skills = skills.filter((entry) => !(typeof entry === "string" && owned.has(entry) && !desiredExclusions.includes(entry)));
      for (const entry of desiredExclusions) {
        if (skills.includes(entry)) {
          if (owned.has(entry)) nextOwnedExclusions.push(entry);
        } else {
          skills.push(entry);
          nextOwnedExclusions.push(entry);
        }
      }
      if (canonicalJson(currentSkills ?? []) !== canonicalJson(skills)) {
        const base = nextSettingsText === undefined ? settingsRead.file.value : (JSON.parse(nextSettingsText) as Record<string, unknown>);
        const { skills: _drop, ...rest } = base;
        nextSettingsText = preserveJson(nextSettingsText ?? settingsRead.file.text, skills.length > 0 ? { ...rest, skills } : rest);
      }
    }
  }

  // --- mcp.json ----------------------------------------------------------------------------------------
  const mcpRead = readJsonObject(io, paths.mcp);
  let nextMcpText: string | undefined;
  const nextMcpOwned: Record<string, string> = {};
  if (!mcpRead.ok) {
    block({ code: "PI_MCP_CONFIG_MALFORMED", severity: "error", message: mcpRead.message });
  } else {
    const config = mcpRead.file.value;
    const existingServers = config.mcpServers;
    if (existingServers !== undefined && !isRecord(existingServers)) {
      block({ code: "PI_MCP_CONFIG_MALFORMED", severity: "error", message: `${paths.mcp} \`mcpServers\` must be an object.` });
    } else {
      const servers: Record<string, unknown> = { ...(existingServers ?? {}) };
      let mutated = false;
      for (const [name, entry] of Object.entries(desired.mcpServers)) {
        const postimage = hashJsonValue(entry);
        nextMcpOwned[name] = postimage;
        const current = servers[name];
        if (current === undefined) {
          servers[name] = entry;
          mutated = true;
          continue;
        }
        const currentHash = hashJsonValue(current);
        if (currentHash === postimage) {
          if (!manifest.mcp.servers[name] && !options.managed) delete nextMcpOwned[name];
          continue;
        }
        const owned = manifest.mcp.servers[name];
        if (owned !== undefined && /^[a-f0-9]{64}$/.test(owned) && (owned === currentHash || options.managed) && ["context7", "context-mode", "codebase-memory", "serena", "web-search"].includes(name)) {
          servers[name] = entry;
          mutated = true;

        } else {
          delete nextMcpOwned[name];
          conflict({ relPath: `mcp.json#${name}`, reason: owned === undefined ? "foreign" : "modified", message: owned === undefined
            ? `${paths.mcp} already defines an MCP server named "${name}" that Deck does not own; Deck will not replace it.`
            : `The Deck-owned MCP server "${name}" in ${paths.mcp} was modified after Deck wrote it; Deck will not overwrite it.` }, "PI_MCP_ENTRY_CONFLICT");
        }
      }
      for (const [name, owned] of Object.entries(manifest.mcp.servers)) {
        if (name in desired.mcpServers) continue;
        const current = servers[name];
        if (current === undefined) continue;
        if (hashJsonValue(current) === owned || options.managed && /^[a-f0-9]{64}$/.test(owned) && ["context7", "context-mode", "codebase-memory", "serena", "web-search"].includes(name)) {
          delete servers[name];
          mutated = true;
        } else {
          plan.kept.push({ relPath: `mcp.json#${name}`, reason: "modified by the user; no longer managed by Deck" });
        }
      }
      if (mutated && !plan.blocked) {
        nextMcpText = preserveJson(mcpRead.file.text, { ...config, mcpServers: servers });
      }
    }
  }

  if (options.managed && mcpRead.ok) {
    for (const name of Object.keys(manifest.mcp.servers).filter(name => ["context7", "context-mode", "codebase-memory", "serena", "web-search"].includes(name))) {
      const previous = (mcpRead.file.value.mcpServers as Record<string, unknown> | undefined)?.[name];
      if (previous !== undefined && canonicalJson(previous) !== canonicalJson(desired.mcpServers[name]))
        (plan.managedPreimages as { target: ContributionTarget; content: string }[]).push({ target: { path: paths.mcp, selector: { kind: "json", keys: ["mcpServers", name] } }, content: canonicalJson(previous) });
    }
  }
  if (plan.blocked) {
    // No mutation is planned for a blocked plan; keep only the evidence.
    plan.changes = [];
    plan.mutationPreview = [];
    plan.writes = [];
    plan.deletes = [];
    plan.removedPackages = [];
    return plan;
  }

  // --- assemble settings / mcp / backup / manifest writes ------------------------------------------------
  if (nextSettingsText !== undefined && settingsRead.ok) {
    if (removedAddedPackages.length > 0 && settingsRead.file.text !== undefined) {
      const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
      const backupRel = `deck/backups/${stamp}/settings.json`;
      const backupPath = resolveInside(agentDir, backupRel);
      addChange({ kind: "backup", action: "create", relPath: backupRel, path: backupPath, preimage: "absent", postimage: hashContent(settingsRead.file.text) }, { path: backupPath, content: settingsRead.file.text, expectedPre: "absent" });
    }
    const pre = settingsRead.file.text === undefined ? "absent" : hashContent(settingsRead.file.text);
    addChange({ kind: "settings", action: settingsRead.file.present ? "update" : "create", relPath: "settings.json", path: paths.settings, preimage: pre, postimage: hashContent(nextSettingsText) }, { path: paths.settings, content: nextSettingsText, expectedPre: pre });
  }
  if (nextMcpText !== undefined && mcpRead.ok) {
    const pre = mcpRead.file.text === undefined ? "absent" : hashContent(mcpRead.file.text);
    addChange({ kind: "mcp", action: mcpRead.file.present ? "update" : "create", relPath: "mcp.json", path: paths.mcp, preimage: pre, postimage: hashContent(nextMcpText) }, { path: paths.mcp, content: nextMcpText, mode: 0o600, expectedPre: pre });
  }

  const contributions: RunnerContribution[] = manifest.contributions?.filter(entry => entry.sourceItemId?.startsWith("package:")) ?? [];
  const receipt = (target: ContributionTarget, hash: string, encoding: RunnerContribution["encoding"]) => contributions.push({ ...target, id: contributionId(target), hash, encoding, ownership: "prior-record", scope: "global" });
  for (const [relPath] of Object.entries(nextFiles)) {
    const path = resolveInside(agentDir, relPath);
    const hash = fileReceiptHashes.get(relPath);
    if (hash !== undefined) receipt({ path, selector: { kind: "file" } }, hash, "bytes");
  }
  for (const [name, hash] of Object.entries(nextMcpOwned)) receipt({ path: paths.mcp, selector: { kind: "json", keys: ["mcpServers", name] } }, hash, "canonical-json-v1");
  if (desired.packageEntry) receipt({ path: paths.settings, selector: { kind: "json-array", keys: ["packages"], identity: canonicalJson(desired.packageEntry) } }, hashJsonValue(desired.packageEntry), "canonical-json-v1");
  for (const exclusion of nextOwnedExclusions) receipt({ path: paths.settings, selector: { kind: "json-array", keys: ["skills"], identity: canonicalJson(exclusion) } }, hashJsonValue(exclusion), "canonical-json-v1");
  const nextManifest: PiManifestV1 = {
    contributions,
    schema: createEmptyPiManifest().schema,
    files: nextFiles,
    settings: {
      packages: desired.packageEntry ? [desired.packageEntry] : [],
      skillExclusions: nextOwnedExclusions,
      addedPackages: manifest.settings.addedPackages.filter((entry) => !removedAddedPackages.some((removed) => normalizePackageSource(removed) === normalizePackageSource(entry))),
    },
    mcp: { servers: nextMcpOwned },
  };
  const nextManifestText = serializePiManifest(nextManifest);
  const everythingEmpty = desired.files.length === 0 && !desired.packageEntry && desired.skillExclusions.length === 0 && manifest.settings.skillExclusions.length === 0 && Object.keys(desired.mcpServers).length === 0
    && Object.keys(manifest.files).length === 0 && Object.keys(manifest.mcp.servers).length === 0;
  if (!everythingEmpty && nextManifestText !== manifestRead) {
    const pre = manifestRead === undefined ? "absent" : hashContent(manifestRead);
    addChange({ kind: "manifest", action: manifestRead === undefined ? "create" : "update", relPath: "deck/manifest.json", path: paths.manifest, preimage: pre, postimage: hashContent(nextManifestText) }, { path: paths.manifest, content: nextManifestText, expectedPre: pre });
  }

  // Order: deck files, mcp, settings, backup first, manifest last.
  const order = (write: PlannedWrite): number => (write.path === paths.manifest ? 3 : write.path === paths.settings ? 2 : write.path === paths.mcp ? 1 : 0);
  plan.writes.sort((left, right) => order(left) - order(right));
  return plan;
}

function missingAncestorDirs(io: PiFileIO, targets: readonly string[]): string[] {
  const created: string[] = [];
  const seen = new Set<string>();
  for (const path of targets) {
    let directory = dirname(path);
    while (!seen.has(directory) && !io.exists(directory)) {
      created.push(directory);
      seen.add(directory);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return created;
}

export type PiApplyResult = { changedCount: number; changes: readonly PiPlannedChange[]; backupPath?: string };

export function applyPiGlobalPlan(plan: PiGlobalPlan, io: PiFileIO, onRollbackProven?: (operationId: string, prove: () => boolean) => void): PiApplyResult {
  const pendingPath = join(plan.agentDir, 'deck', 'transaction.pending.json');
  // Verify preimages immediately before mutating (the plan may be stale).
  const touched = [...plan.writes.map((write) => ({ path: write.path, expected: write.expectedPre })), ...plan.deletes.map((del) => ({ path: del.path, expected: del.expectedPre }))];
  const snapshots = new Map<string, string | null>();
  const modes = new Map<string, number | undefined>();
  const operationId = randomUUID();
  let backupPath: string | undefined;
  let createdDirs: string[] = [];
  // Register the live operation before abortable preflight. A closure can prove that
  // no installation effect was attempted; persisted journal absence alone cannot.
  recordRunnerMutationJournals([
    { operationId, id: plan.projectRetirement && plan.projectRetirement.root !== plan.agentDir ? runnerProjectScope(plan.projectRetirement.root) : 'global', kind: 'deck-scope-v1' },
    { operationId, id: operationId, kind: "pi-global-install" },
  ]);
  try {
    // Existing crash evidence never authorizes a no-effect proof or disappears on a no-op.
    if (io.readText(pendingPath) !== undefined) throw new Error('Pi transaction recovery required; pending evidence was preserved.');
    if (plan.blocked) {
      const reasons = plan.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.message);
      throw new Error(`Pi global install is blocked: ${reasons.join("; ") || "unresolved conflicts"}`);
    }
    assertPiProjectSkillExclusionTargets(plan);
    if (plan.writes.length === 0 && plan.deletes.length === 0) return { changedCount: 0, changes: [] };
    for (const { path, expected } of touched) {
      const current = io.readText(path);
      const currentHash = current === undefined ? "absent" : hashContent(current);
      if (currentHash !== expected) throw new Error(`Pi global install plan is stale: ${path} changed after it was planned.`);
      snapshots.set(path, current ?? null);
      modes.set(path, io.readMode?.(path));
    }

    backupPath = plan.managedFiles ? backupManagedPreimages({ stateRoot: join(plan.agentDir, 'deck', 'backups'), runnerId: 'pi', root: plan.agentDir,
      entries: [...(plan.managedPreimages ?? []), ...plan.managedFiles.flatMap(file => {
        const path = resolveInside(plan.agentDir, file.relPath), previous = snapshots.get(path);
        return previous !== undefined && previous !== null && hashContent(previous) !== hashContent(file.content)
          ? [{ target: { path, selector: { kind: 'file' as const } }, content: previous }] : [];
      })] }) : undefined;
    if (plan.projectRetirement?.entries.length) backupManagedPreimages({
      stateRoot: join(plan.agentDir, 'deck', 'backups'), runnerId: 'pi', root: plan.projectRetirement.root,
      entries: plan.projectRetirement.entries.map(entry => ({ target: { path: entry.path, selector: { kind: 'file' as const } }, content: entry.content })),
    });
    createdDirs = missingAncestorDirs(io, [...touched.map(entry => entry.path), pendingPath]);
  } catch (error) {
    const prove = () => { try { return io.readText(pendingPath) === undefined; } catch { return false; } };
    if (prove()) onRollbackProven?.(operationId, prove);
    throw error;
  }
  // Persist only hashes/identity, never shared configuration contents or credentials.
  // In-process snapshots remain the independent authority for synchronous rollback.
  const pendingText = JSON.stringify({ schema: 'deck-pi-transaction-v1', id: operationId, root: plan.agentDir,
    targets: [
      ...plan.writes.map(write => ({ path: write.path, before: write.expectedPre, after: hashContent(write.content) })),
      ...plan.deletes.map(del => ({ path: del.path, before: del.expectedPre, after: 'absent' })),
    ],
  }) + '\n';
  const clearPending = () => {
    if (io.readText(pendingPath) !== pendingText) throw new Error('Pi pending transaction changed; evidence preserved.');
    io.remove(pendingPath);
    if (io.readText(pendingPath) !== undefined) throw new Error('Pi pending transaction removal failed.');
  };
  const assertPreimage = (path: string, expected: string) => {
    const text = io.readText(path);
    if ((text === undefined ? 'absent' : hashContent(text)) !== expected || modes.has(path) && io.readMode?.(path) !== modes.get(path)) throw new Error(`Pi target changed before publication: ${path}`);
  };

  const verifyManaged = () => {
    for (const file of plan.managedFiles ?? []) {
      const content = io.readText(resolveInside(plan.agentDir, file.relPath));
      if (content === undefined || fileOwnershipHash(file.relPath, content) !== fileOwnershipHash(file.relPath, file.content)) throw new Error('Pi managed postimage mismatch');
    }
  };
  const done: string[] = [];
  const publishedModes = new Map<string, number | undefined>();
  const retire = () => {
    for (const del of plan.deletes) {
      if (done.includes(del.path)) continue;
      assertPreimage(del.path, del.expectedPre);
      io.remove(del.path); done.push(del.path);
      if (io.readText(del.path) !== undefined) throw new Error('Pi retirement postimage mismatch');
    }
  };
  try {
    assertPreimage(pendingPath, "absent");
    io.writeText(pendingPath, pendingText, 0o600);
    if (io.readText(pendingPath) !== pendingText) throw new Error("Pi pending transaction publication failed");
    const manifestPath = piAgentPaths(plan.agentDir).manifest;
    const publicationOrder = [...plan.writes].sort((left, right) => Number(left.path === manifestPath) - Number(right.path === manifestPath));
    for (const write of publicationOrder) {
      if (write.path === manifestPath) {
        retire();
        verifyManaged();
        for (const shared of plan.writes.filter(item => item.path !== manifestPath)) {
          if (io.readText(shared.path) !== shared.content) throw new Error('Pi shared postimage mismatch');
        }
      }
      assertPreimage(write.path, write.expectedPre);
      publishedModes.set(write.path, io.readMode ? modes.get(write.path) ?? write.mode ?? (0o666 & ~process.umask()) : undefined);
      io.writeText(write.path, write.content, write.mode);
      done.push(write.path);
    }
    retire();
    verifyManaged();
    for (const write of plan.writes) if (io.readText(write.path) !== write.content) throw new Error('Pi transaction postimage mismatch');
    clearPending();
  } catch (error) {
    const failures: string[] = [];
    const expectedPostimages = new Map([
      ...plan.writes.map(write => [write.path, hashContent(write.content)] as const),
      ...plan.deletes.map(del => [del.path, "absent"] as const),
    ]);
    // Include attempted-but-throwing effects: an IO adapter may throw after publication.
    // Untouched targets are inspected too, but never restored over another writer's bytes.
    for (const path of [...done].reverse().concat(touched.map(entry => entry.path).filter(path => !done.includes(path)))) {
      try {
        const previous = snapshots.get(path);
        if (previous === undefined) continue;
        const current = io.readText(path);
        const currentHash = current === undefined ? "absent" : hashContent(current);
        const previousHash = previous === null ? "absent" : hashContent(previous);
        const previousMode = modes.get(path);
        const currentMode = io.readMode?.(path);
        if (currentHash === previousHash) {
          if (currentMode !== previousMode) throw new Error("rollback preimage permissions changed");
          continue;
        }
        // Existing files retain their mode during atomic replacement. Do not undo
        // another writer's chmod, even if the bytes still match our postimage.
        if (current !== undefined && currentMode !== publishedModes.get(path)) throw new Error("rollback postimage permissions changed");
        if (currentHash !== expectedPostimages.get(path)) throw new Error("rollback postimage changed");
        if (previous === null) io.remove(path);
        else io.writeText(path, previous, previousMode);
        if (io.readText(path) !== (previous ?? undefined) || io.readMode?.(path) !== previousMode) throw new Error("rollback preimage verification failed");
      } catch (restoreError) {
        failures.push(`${path}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
    }
    if (failures.length === 0) {
      try {
        // A failed journal publication may have left no record; only clear our exact record.
        if (io.readText(pendingPath) !== undefined) clearPending();
      } catch (cleanupError) {
        failures.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    }
    if (failures.length === 0 && onRollbackProven) {
      const prove = () => {
        try {
          return io.readText(pendingPath) === undefined && [...snapshots].every(([path, previous]) => io.readText(path) === (previous ?? undefined) && io.readMode?.(path) === modes.get(path));
        } catch { return false; }
      };
      if (prove()) onRollbackProven(operationId, prove);
    }
    for (const directory of [...createdDirs].sort((left, right) => right.length - left.length)) io.removeDirIfEmpty(directory);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(failures.length > 0 ? `${message}; rollback incomplete: ${failures.join("; ")}` : message, { cause: error });
  }
  // Empty directories left behind by deletions.
  for (const del of plan.deletes) {
    let directory = dirname(del.path);
    const root = plan.agentDir;
    while (directory.startsWith(`${root}${sep}`)) {
      io.removeDirIfEmpty(directory);
      directory = dirname(directory);
    }
  }
  return { changedCount: plan.changes.length, changes: plan.changes, backupPath };
}

export type PiVerifyResult = { valid: boolean; diagnostics: string[] };

export function verifyPiGlobalInstall(desired: PiGlobalDesiredState, io: PiFileIO): PiVerifyResult {
  const paths = piAgentPaths(desired.agentDir);
  const diagnostics: string[] = [];
  const manifestText = io.readText(paths.manifest);
  const parsed = manifestText === undefined ? undefined : parsePiManifest(manifestText);
  if (!parsed || !parsed.ok) diagnostics.push(`Deck Pi manifest is missing or invalid at ${paths.manifest}.`);
  const manifest = parsed && parsed.ok ? parsed.manifest : createEmptyPiManifest();

  for (const file of desired.files) {
    const disk = io.readText(resolveInside(desired.agentDir, file.relPath));
    if (disk === undefined) {
      diagnostics.push(`Missing Deck file: ${file.relPath}.`);
      continue;
    }
    if (fileOwnershipHash(file.relPath, disk) !== fileOwnershipHash(file.relPath, file.content)) diagnostics.push(`Deck file differs from the planned content: ${file.relPath}.`);
    else if (!matchesOwnedHash(file.relPath, manifest.files[file.relPath], file.content)) diagnostics.push(`Deck manifest does not record ${file.relPath}.`);
  }

  if (desired.packageEntry) {
    const settings = readJsonObject(io, paths.settings);
    const packages = settings.ok ? settings.file.value.packages : undefined;
    const registered = Array.isArray(packages) && packages.some((entry) => entry === desired.packageEntry);
    if (!registered) diagnostics.push(`The Deck package is not registered in ${paths.settings} (expected entry ${desired.packageEntry}).`);
  }

  if (desired.skillExclusions.length > 0) {
    const settings = readJsonObject(io, paths.settings);
    const skills = settings.ok && Array.isArray(settings.file.value.skills) ? settings.file.value.skills : [];
    for (const name of desired.skillExclusions) {
      if (!skills.includes(`!${name}`)) diagnostics.push(`The Deck skill exclusion "!${name}" is missing from ${paths.settings}.`);
    }
  }

  if (Object.keys(desired.mcpServers).length > 0) {
    const mcp = readJsonObject(io, paths.mcp);
    const servers = mcp.ok && isRecord(mcp.file.value.mcpServers) ? mcp.file.value.mcpServers : {};
    for (const [name, entry] of Object.entries(desired.mcpServers)) {
      if (!(name in servers)) diagnostics.push(`MCP server "${name}" is missing from ${paths.mcp}.`);
      else if (hashJsonValue(servers[name]) !== hashJsonValue(entry)) diagnostics.push(`MCP server "${name}" in ${paths.mcp} differs from the planned entry.`);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

/** Absolute, normalized path helper for tests and callers. */
export function resolvePiRelative(agentDir: string, relPath: string): string {
  return normalize(resolveInside(agentDir, relPath));
}

export type PiSnapshot = {
  agentDir: string;
  entries: { path: string; previous: string | null; mode?: number; /** sha256 of the content the apply wrote, or "absent" if it deleted the path */ applied: string }[];
  createdDirs: string[];
};

/** Captures everything a plan will touch so the adapter's backup/rollback hooks can restore it exactly. */
export function snapshotPiPlanTargets(plan: PiGlobalPlan, io: PiFileIO): PiSnapshot {
  const entries: PiSnapshot["entries"] = [
    ...plan.writes.map((write) => ({ path: write.path, previous: io.readText(write.path) ?? null, mode: io.readMode?.(write.path), applied: hashContent(write.content) })),
    ...plan.deletes.map((del) => ({ path: del.path, previous: io.readText(del.path) ?? null, mode: io.readMode?.(del.path), applied: "absent" })),
  ];
  return { agentDir: plan.agentDir, entries, createdDirs: missingAncestorDirs(io, entries.map((entry) => entry.path)) };
}

export type PiRestoreResult = { restored: boolean; conflicts: string[] };

/**
 * Restores a snapshot. A path whose current content is neither the applied nor the previous content was changed
 * by someone else, so it is reported as a conflict and left untouched.
 */
export function restorePiSnapshot(snapshot: PiSnapshot, io: PiFileIO): PiRestoreResult {
  const conflicts: string[] = [];
  for (const entry of [...snapshot.entries].reverse()) {
    const current = io.readText(entry.path);
    const currentHash = current === undefined ? "absent" : hashContent(current);
    const previousHash = entry.previous === null ? "absent" : hashContent(entry.previous);
    if (currentHash === previousHash) {
      if (io.readMode?.(entry.path) !== entry.mode) conflicts.push(entry.path);
      continue;
    }
    if (current !== undefined && entry.previous !== null && io.readMode?.(entry.path) !== entry.mode) {
      conflicts.push(entry.path);
      continue;
    }
    if (currentHash !== entry.applied) {
      conflicts.push(entry.path);
      continue;
    }
    if (entry.previous === null) io.remove(entry.path);
    else io.writeText(entry.path, entry.previous, entry.mode);
    if (io.readText(entry.path) !== (entry.previous ?? undefined) || io.readMode?.(entry.path) !== entry.mode) conflicts.push(entry.path);
  }
  if (conflicts.length === 0) {
    for (const directory of [...snapshot.createdDirs].sort((left, right) => right.length - left.length)) io.removeDirIfEmpty(directory);
  }
  return { restored: conflicts.length === 0, conflicts };
}

/** Reads the Deck manifest; `undefined` when it is absent or unreadable (the plan reports corruption itself). */
export function readPiManifest(io: PiFileIO, agentDir: string): PiManifestV1 | undefined {
  try {
    const text = io.readText(piAgentPaths(agentDir).manifest);
    if (text === undefined) return undefined;
    const parsed = parsePiManifest(text);
    return parsed.ok ? parsed.manifest : undefined;
  } catch {
    return undefined;
  }
}

/** Current `mcp.json` `mcpServers` (empty when absent or malformed; the plan reports malformed files itself). */
export function readPiMcpServers(io: PiFileIO, agentDir: string): Record<string, unknown> {
  const result = readJsonObject(io, piAgentPaths(agentDir).mcp);
  if (!result.ok || !isRecord(result.file.value.mcpServers)) return {};
  return { ...result.file.value.mcpServers };
}
