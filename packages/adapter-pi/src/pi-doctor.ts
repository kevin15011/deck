import { isAbsolute, join } from "node:path";

import { piAgentPaths, type PiAgentDirResolution } from "./agent-dir";
import { detectPiLegacy, PI_LEGACY_STALE_MEMORY_MS } from "./pi-legacy";
import type { PiFileIO } from "./pi-global-install";
import { hashContent, normalizePackageSource, parsePiManifest } from "./pi-manifest";
import { PI_MIN_VERSION, evaluatePiVersion } from "./pi-version";

/**
 * Pure, injectable Doctor inspection of the global Deck Pi install. It reads the files Deck owns (through the same
 * `PiFileIO` seam as the installer), compares them with the manifest and reports every item as ok / warning / error.
 * It never writes, never spawns, and the only runtime cross-check (`pi list` output) is supplied by the caller.
 */

export type PiDoctorStatus = "ok" | "warning" | "error";
export type PiDoctorItem = { status: PiDoctorStatus; message: string; suggestion?: string };
export type PiDoctorCategory = { category: string; status: PiDoctorStatus; items: PiDoctorItem[] };

export const PI_DOCTOR_EXTENSIONS = ["developer-team-execution", "deck-memory", "deck-subagents", "deck-tool-policy"] as const;
const GENERATED_EXTENSIONS = new Set(["deck-memory", "deck-subagents", "deck-tool-policy"]);
const MEMORY_ENV_BLANKS = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN", "DECK_RUNNER_MEMORY_TOKEN_FILE"];
const REINSTALL = "Run 'deck pi developer' (or Review & Install for Pi) to repair the Deck package.";

export type InspectPiDeckInstallInput = {
  io: PiFileIO;
  agentDir: PiAgentDirResolution;
  projectRoot?: string;
  /** Raw `pi --version` output; `undefined` when Pi could not be run. */
  piVersionOutput: string | undefined;
  /** Raw `pi list` output when the caller ran it (runtime cross-check); `undefined` skips the check. */
  piListOutput?: string;
  /** True when the path exists and is executable. */
  isExecutable: (path: string) => boolean;
  /** Deck session runtime directory that holds `pi-memory-*` token handoff directories. */
  runtimeDirectory?: string;
  /** Lists a directory with modification times; undefined when it cannot be read. */
  listDirectory?: (path: string) => Array<{ name: string; mtimeMs: number }> | undefined;
  /** `source-sha256` header of the extension bundles embedded in this Deck build, by extension name. */
  expectedBundleDigests?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
};

function category(name: string, items: PiDoctorItem[]): PiDoctorCategory {
  const status: PiDoctorStatus = items.some((item) => item.status === "error") ? "error" : items.some((item) => item.status === "warning") ? "warning" : "ok";
  return { category: name, status, items };
}

function readJson(io: PiFileIO, path: string): { ok: true; value: Record<string, unknown> } | { ok: false; missing: boolean; message: string } {
  let text: string | undefined;
  try { text = io.readText(path); } catch (error) { return { ok: false, missing: false, message: error instanceof Error ? error.message : String(error) }; }
  if (text === undefined) return { ok: false, missing: true, message: "missing" };
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ok: true, value: parsed as Record<string, unknown> } : { ok: false, missing: false, message: "not a JSON object" };
  } catch (error) {
    return { ok: false, missing: false, message: error instanceof Error ? error.message : "invalid JSON" };
  }
}

export function sourceDigestHeader(content: string | undefined): string | undefined {
  return content === undefined ? undefined : /^\/\/ source-sha256:([0-9a-f]{64})$/m.exec(content.slice(0, 400))?.[1];
}

function packageSources(settings: Record<string, unknown> | undefined): string[] {
  const packages = settings?.packages;
  return Array.isArray(packages) ? packages.map(normalizePackageSource).filter((entry): entry is string => entry !== undefined) : [];
}

function truncated(values: readonly string[], limit = 5): string {
  return values.length <= limit ? values.join(", ") : `${values.slice(0, limit).join(", ")} and ${values.length - limit} more`;
}

export function inspectPiDeckInstall(input: InspectPiDeckInstallInput): PiDoctorCategory[] {
  const { io } = input;
  const result: PiDoctorCategory[] = [];

  // --- Version and agent directory -------------------------------------------------------------------------
  const version = evaluatePiVersion(input.piVersionOutput);
  const runtimeItems: PiDoctorItem[] = [
    version.supported
      ? { status: "ok", message: `Pi ${version.version} detected (minimum ${PI_MIN_VERSION}).` }
      : { status: "error", message: version.diagnostic ?? "Pi version could not be verified.", suggestion: "Install or upgrade Pi: npm install -g @earendil-works/pi-coding-agent@latest" },
  ];
  if (!input.agentDir.ok) {
    runtimeItems.push({ status: "error", message: input.agentDir.message, suggestion: "Set PI_CODING_AGENT_DIR to an absolute directory or unset it." });
    result.push(category("Pi runtime", runtimeItems));
    return result;
  }
  const agentDir = input.agentDir.dir;
  const paths = piAgentPaths(agentDir);
  runtimeItems.push({ status: "ok", message: `Pi agent directory: ${agentDir} (${input.agentDir.source === "env" ? "PI_CODING_AGENT_DIR" : "default ~/.pi/agent"}).` });
  result.push(category("Pi runtime", runtimeItems));

  // --- Manifest, registration and drift --------------------------------------------------------------------
  const installItems: PiDoctorItem[] = [];
  const manifestText = (() => { try { return io.readText(paths.manifest); } catch { return undefined; } })();
  const parsedManifest = manifestText === undefined ? undefined : parsePiManifest(manifestText);
  const settings = readJson(io, paths.settings);
  const globalSources = packageSources(settings.ok ? settings.value : undefined);
  const manifest = parsedManifest?.ok ? parsedManifest.manifest : undefined;

  if (manifestText === undefined) {
    installItems.push({ status: "warning", message: `The Deck Pi package is not installed (no manifest at ${paths.manifest}).`, suggestion: "Run 'deck pi developer' to install the Deck team globally for Pi." });
  } else if (!manifest) {
    installItems.push({ status: "error", message: `The Deck Pi manifest is corrupt: ${parsedManifest && !parsedManifest.ok ? parsedManifest.reason : "unreadable"}.`, suggestion: `Review ${paths.manifest}, remove it if it is not yours, then reinstall.` });
  } else {
    const registered = globalSources.includes(paths.packageSettingsEntry);
    installItems.push(registered
      ? { status: "ok", message: `The Deck package is registered in ${paths.settings} (${paths.packageSettingsEntry}).` }
      : { status: "error", message: `The Deck package is not registered in ${paths.settings} (expected ${paths.packageSettingsEntry}).`, suggestion: REINSTALL });
    if (input.piListOutput !== undefined) {
      installItems.push(input.piListOutput.includes(paths.packageSettingsEntry) || input.piListOutput.includes(paths.packageRoot)
        ? { status: "ok", message: "'pi list' reports the Deck package." }
        : { status: "warning", message: "'pi list' does not report the Deck package; Pi may not load it.", suggestion: REINSTALL });
    }
    const missing: string[] = [];
    const modified: string[] = [];
    for (const [relPath, expected] of Object.entries(manifest.files)) {
      let disk: string | undefined;
      try { disk = io.readText(join(agentDir, ...relPath.split("/"))); } catch { disk = undefined; }
      if (disk === undefined) missing.push(relPath);
      else if (hashContent(disk) !== expected) modified.push(relPath);
    }
    if (missing.length > 0) installItems.push({ status: "error", message: `Deck files are missing: ${truncated(missing)}.`, suggestion: REINSTALL });
    if (modified.length > 0) installItems.push({ status: "warning", message: `Deck files were modified after install: ${truncated(modified)}.`, suggestion: "Restore or remove the modified files; install will not overwrite them." });
    if (missing.length === 0 && modified.length === 0) installItems.push({ status: "ok", message: `Manifest matches ${Object.keys(manifest.files).length} installed Deck files (no drift).` });
  }
  result.push(category("Pi Deck package", installItems));
  if (!manifest) {
    result.push(inspectLegacyAndPackages(input, agentDir, globalSources, undefined));
    return result;
  }

  // --- Extensions ------------------------------------------------------------------------------------------
  const extensionItems: PiDoctorItem[] = [];
  for (const name of PI_DOCTOR_EXTENSIONS) {
    const base = `deck/package/extensions/${name}`;
    const missing = ["index.js", "impl.js"].filter((file) => manifest.files[`${base}/${file}`] === undefined || !io.exists(join(agentDir, ...`${base}/${file}`.split("/"))));
    if (missing.length > 0) { extensionItems.push({ status: "error", message: `Extension ${name} is incomplete (missing ${missing.join(", ")}).`, suggestion: REINSTALL }); continue; }
    if (GENERATED_EXTENSIONS.has(name)) {
      const installed = sourceDigestHeader((() => { try { return io.readText(join(agentDir, ...`${base}/impl.js`.split("/"))); } catch { return undefined; } })());
      const expected = input.expectedBundleDigests?.[name];
      if (installed === undefined) extensionItems.push({ status: "warning", message: `Extension ${name} has no source-sha256 header.`, suggestion: REINSTALL });
      else if (expected !== undefined && installed !== expected) extensionItems.push({ status: "warning", message: `Extension ${name} was built from different sources than this Deck build (source-sha256 ${installed.slice(0, 12)} vs ${expected.slice(0, 12)}).`, suggestion: REINSTALL });
      else extensionItems.push({ status: "ok", message: `Extension ${name} is present (source-sha256 ${installed.slice(0, 12)}).` });
    } else {
      extensionItems.push({ status: "ok", message: `Extension ${name} is present.` });
    }
  }
  const policyConfigPath = join(agentDir, "deck", "package", "extensions", "deck-tool-policy", "config.json");
  const policy = readJson(io, policyConfigPath);
  if (!policy.ok) {
    extensionItems.push({ status: "error", message: `The tool-policy config.json is ${policy.missing ? "missing" : `invalid (${policy.message})`}.`, suggestion: REINSTALL });
  } else if (typeof policy.value.rtkBinary === "string") {
    extensionItems.push(isAbsolute(policy.value.rtkBinary) && input.isExecutable(policy.value.rtkBinary)
      ? { status: "ok", message: `RTK rewrite is pinned to ${policy.value.rtkBinary}.` }
      : { status: "error", message: `The pinned RTK binary ${policy.value.rtkBinary} does not exist or is not executable; shell commands will run unchanged.`, suggestion: "Re-run Deck install to restore the Deck-owned RTK binary." });
  } else {
    extensionItems.push({ status: "ok", message: "RTK rewrite is not configured (RTK not selected)." });
  }
  result.push(category("Pi extensions", extensionItems));

  // --- MCP -------------------------------------------------------------------------------------------------
  const mcpItems: PiDoctorItem[] = [];
  const mcp = readJson(io, paths.mcp);
  const owned = Object.keys(manifest.mcp.servers);
  const servers = mcp.ok && mcp.value.mcpServers && typeof mcp.value.mcpServers === "object" ? mcp.value.mcpServers as Record<string, Record<string, unknown>> : {};
  if (owned.length === 0) mcpItems.push({ status: "ok", message: "No Deck MCP servers are configured." });
  for (const name of owned) {
    const entry = servers[name];
    if (!entry) { mcpItems.push({ status: "error", message: `MCP server "${name}" is recorded by Deck but missing from ${paths.mcp}.`, suggestion: REINSTALL }); continue; }
    const problems: string[] = [];
    const command = typeof entry.command === "string" ? entry.command : undefined;
    if (command === undefined) problems.push("no command");
    else if (!isAbsolute(command)) problems.push("the command is not an absolute path");
    else if (!input.isExecutable(command)) problems.push(`the command ${command} does not exist or is not executable`);
    if (entry.exposure !== "direct") problems.push('exposure is not "direct" (mcp__* tool names will not exist)');
    const env = entry.env && typeof entry.env === "object" ? entry.env as Record<string, unknown> : {};
    if (MEMORY_ENV_BLANKS.some((key) => env[key] !== "")) problems.push("the memory environment blanks are missing");
    mcpItems.push(problems.length === 0
      ? { status: "ok", message: `MCP server "${name}": absolute command, direct exposure, memory variables blanked.` }
      : { status: "error", message: `MCP server "${name}": ${problems.join("; ")}.`, suggestion: REINSTALL });
  }
  result.push(category("Pi MCP (built-in)", mcpItems));

  // --- Memory ----------------------------------------------------------------------------------------------
  const memoryItems: PiDoctorItem[] = [];
  memoryItems.push(manifest.files["deck/package/extensions/deck-memory/impl.js"] !== undefined
    ? { status: "ok", message: "The deck-memory extension is installed (loopback recall/capture in Deck-managed sessions only)." }
    : { status: "error", message: "The deck-memory extension is not installed.", suggestion: REINSTALL });
  if (input.runtimeDirectory && input.listDirectory) {
    const now = (input.now ?? Date.now)();
    const stale = (input.listDirectory(input.runtimeDirectory) ?? []).filter((entry) => entry.name.startsWith("pi-memory-") && now - entry.mtimeMs > PI_LEGACY_STALE_MEMORY_MS).map((entry) => join(input.runtimeDirectory!, entry.name));
    memoryItems.push(stale.length === 0
      ? { status: "ok", message: "No stale pi-memory-* token handoff directories." }
      : { status: "warning", message: `${stale.length} stale pi-memory-* token handoff director${stale.length === 1 ? "y" : "ies"} older than 24h: ${truncated(stale, 3)}.`, suggestion: "They are swept on the next Deck-managed Pi launch; remove them manually if no Pi session is running." });
  }
  result.push(category("Pi adaptive memory", memoryItems));

  result.push(inspectLegacyAndPackages(input, agentDir, globalSources, manifest.settings.addedPackages));
  return result;
}

function inspectLegacyAndPackages(input: InspectPiDeckInstallInput, agentDir: string, globalSources: readonly string[], deckAdded: readonly string[] | undefined): PiDoctorCategory {
  const items: PiDoctorItem[] = [];
  const projectSettings = input.projectRoot ? readJson(input.io, join(input.projectRoot, ".pi", "settings.json")) : undefined;
  const projectSources = packageSources(projectSettings?.ok ? projectSettings.value : undefined);
  const report = detectPiLegacy({ io: input.io, agentDir, projectRoot: input.projectRoot ?? join(agentDir, "deck", "no-project") });
  const deckAddedSet = new Set((deckAdded ?? []).map((entry) => normalizePackageSource(entry)));

  if (globalSources.includes("pi-mcp-adapter") || projectSources.includes("pi-mcp-adapter")) {
    const byDeck = deckAddedSet.has("pi-mcp-adapter") || report.packages.some((entry) => entry.source === "pi-mcp-adapter" && entry.deckAdded);
    items.push({ status: "error", message: `pi-mcp-adapter is registered and disables Pi's built-in MCP (the Deck MCP servers will not load). ${byDeck ? "An earlier Deck version added it." : "It was not added by Deck."}`, suggestion: byDeck ? "Run 'deck pi developer': Deck removes the entry it added." : "Remove npm:pi-mcp-adapter from settings.json yourself, or accept that Deck MCP servers are unavailable." });
  }
  if (globalSources.includes("pi-subagents") || projectSources.includes("pi-subagents")) {
    items.push({ status: "warning", message: "pi-subagents is registered and would register a second 'subagent' tool next to the Deck delegation tool.", suggestion: deckAddedSet.has("pi-subagents") || report.packages.some((entry) => entry.source === "pi-subagents" && entry.deckAdded) ? "Run 'deck pi developer': Deck removes the entry it added." : "Remove npm:pi-subagents from settings.json if you do not need it." });
  }
  if (report.files.length > 0) {
    const shadowing = report.files.some((file) => file.scope === "global" && file.kind === "skill");
    items.push({
      status: "warning",
      message: `${report.files.length} legacy Deck file(s) from an earlier version can duplicate the global package: ${truncated(report.files.map((file) => file.path), 4)}.${shadowing ? " Legacy skills in the Pi skills directory shadow the package's skills outside Deck sessions and show up as a '[Skill conflicts]' block at startup (Deck sessions already prefer the package)." : ""}`,
      suggestion: "Run 'deck pi developer --cleanup-legacy': it removes unmodified Deck files and global deck-* files that are demonstrably Deck-authored but older than the current templates (a backup is kept; user-modified files stay). ~/.agents/skills belongs to other runners and is never touched.",
    });
  } else if (items.length === 0) {
    items.push({ status: "ok", message: "No legacy Deck artifacts, pi-subagents or pi-mcp-adapter entries found." });
  }
  return category("Pi legacy and conflicts", items);
}
