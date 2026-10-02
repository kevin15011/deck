import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import { CLAUDE_ATTRIBUTION_SETTINGS_ARGS } from "./launch-settings";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile, link } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { CLAUDE_CAPABILITY_IDS, claudeContentPluginName, claudeModelMetadata, claudePluginName, normalizeClaudeAssignments, normalizeClaudeCapabilities, normalizeClaudeEfforts, type ClaudeEfforts, type ClaudeAssignments, type ClaudeCapabilityId } from "./models";
import { discoverClaudeModels, parseClaudeModelInfo, type ClaudeModelInfo } from "./model-discovery";
import type { RunnerModelInventoryResult, RunnerModelAssignmentIssue } from "../../core/src/index";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { bootstrapSerena, buildCapabilityInstructionBundle, createDefaultSerenaBootstrapEffects, createSerenaReadinessRevalidator, getAgentContent, getDeveloperTeamCatalog, resolveCanonicalSupermemoryProjectScope, resolveExistingSerenaReadiness, resolveSerenaOwnedRoot, resolveWebSearchReadiness, validateSerenaBootstrapResult, validateSerenaOperationAuthorization, validateSerenaReadinessEvidence, DEVELOPER_TEAM, resolveDefaultDeckDataRoot, type RunnerAdapter, type RunnerDeveloperTeamInstallPlan, type SerenaBootstrapEffects, type SerenaBootstrapRequest, type SerenaBootstrapResult, type SerenaExistingReadinessResult, type SerenaReadinessEvidence } from "../../core/src/index";
import { claudeCapabilityFiles, verifyClaudeExecutable, verifyClaudeRtkHookRuntime, type ClaudeCapabilityOptions } from "./capabilities";
import { spawn } from "node:child_process";
import { CLAUDE_SUPERMEMORY_COMMIT, CLAUDE_SUPERMEMORY_FILES, inspectClaudeSupermemoryArtifact, installClaudeSupermemoryArtifact, type ClaudeSupermemoryArtifactEffects } from "./supermemory-artifact";
import { inspectOwnedClaudeRtk, installOwnedClaudeRtk, pinnedClaudeRtkRelease, type RtkReleaseArtifact } from "./rtk-artifact";
import { inspectOwnedClaudeCodebase, installOwnedClaudeCodebase, pinnedClaudeCodebaseRelease, type CodebaseNativeRelease } from "./codebase-native-artifact";

type Options = ClaudeCapabilityOptions & {
  homeDir?: string;
  dataRoot?: string;
  detectClaudeVersion?: () => { available: boolean; version?: string };
  modelDiscovery?: (projectRoot: string, signal?: AbortSignal) => Promise<readonly ClaudeModelInfo[]>;
  /** Hermetic installer effects; production uses only the pinned official source. */
  supermemoryArtifactEffects?: ClaudeSupermemoryArtifactEffects;
  /** Hermetic manifest seam; production always uses the pinned complete manifest. */
  officialPluginManifest?: readonly (readonly [string, string, number])[];
  /** Optional hermetic Node.js prerequisite verifier. Production probes Node without a provider call. */
  verifyNodeRuntime?: () => boolean;
  /** Hermetic release fixture only; production selects pinned platform/arch assets. */
  rtkReleaseOverride?: RtkReleaseArtifact;
  rtkArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyRtkCommand?: (executable: string) => boolean;
  codebaseReleaseOverride?: CodebaseNativeRelease;
  codebaseArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyCodebaseNative?: (executable: string) => boolean;
  /** Verifies an already-installed (shared) codebase-memory-mcp; defaults to a real `--version` probe. */
  verifyExistingCodebase?: (executable: string) => boolean;
  serenaEffects?: SerenaBootstrapEffects;
  serenaBootstrap?: (request: SerenaBootstrapRequest) => Promise<SerenaBootstrapResult>;
  serenaReadiness?: () => Promise<SerenaExistingReadinessResult>;
  serenaRevalidate?: (evidence: SerenaReadinessEvidence) => Promise<boolean>;
  /** Hermetic override; production uses the canonical shared Deck Serena root. */
  serenaOwnedRoot?: string;
  resolveMemoryCredential?: (projectRoot: string) => { token: string; profile: string; canonicalRepoTag: string };
};
const ENVIRONMENT = "claude-development";
const warning = "Claude integration is static-compatible: selected native MCP and pinned official memory files can be verified, but full protected execution and live combined plugin loading are not proven.";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const owner = "deck-claude-plugin-v1";
const pluginIdentity = { name: "deck-developer-team", version: "1.0.0", description: "Deck Developer Team content" } as const;
const pluginMarker = JSON.stringify(pluginIdentity, null, 2) + "\n";
// Claude namespaces MCP servers bundled by a plugin as plugin:<plugin-name>:<server>.
const pluginTool = (server: string, tool: string) => `mcp__plugin_${pluginIdentity.name}_${server}__${tool}`;

function expectedFiles(root: string, assignments: ClaudeAssignments = {}, capabilities: readonly ClaudeCapabilityId[] = [], effects: ClaudeCapabilityOptions = {}, providerId?: string, efforts: ClaudeEfforts = {}) {
  const files: { path: string; content: string; kind: "agent" | "skill" | "other" }[] = [{ path: join(root, ".claude-plugin", "plugin.json"), content: pluginMarker, kind: "other" }];
  for (const agent of getDeveloperTeamCatalog()) {
    if (!/^[a-z][a-z0-9-]*$/.test(agent.id) || !/^[a-z][a-z0-9-]*$/.test(agent.skillId)) throw new Error("Invalid canonical Claude role ID.");
    const instructionIds = capabilities.filter((id) => id !== "context7") as Exclude<ClaudeCapabilityId, "context7">[];
    const canonical = getAgentContent(agent.id, { promptProfile: "legacy", ...(instructionIds.length ? { capabilityInstructions: buildCapabilityInstructionBundle(instructionIds) } : {}) });
    if (!canonical?.agentBody || !canonical.skillBody || /<!-- Placeholder:/.test(canonical.agentBody + canonical.skillBody)) throw new Error("Incomplete canonical Claude role.");
    const readOnlyTools = [
      "Read", "Grep", "Glob", "Skill",
      ...(capabilities.includes("context7") ? ["resolve-library-id", "query-docs"].map((tool) => pluginTool("context7", tool)) : []),
      ...(capabilities.includes("codebase-memory") ? ["search_graph", "trace_path", "get_code_snippet", "check_index_coverage", "query_graph", "get_architecture", "search_code", "index_status", "list_projects"].map((tool) => pluginTool("codebase-memory", tool)) : []),
      ...(capabilities.includes("context-mode") ? ["ctx_search", "ctx_stats"].map((tool) => pluginTool("context-mode", tool)) : []),
      ...(capabilities.includes("serena") ? ["find_symbol", "find_referencing_symbols", "find_implementations", "find_declaration", "get_symbols_overview", "get_diagnostics_for_file"].map((tool) => pluginTool("serena", tool)) : []),
      ...(capabilities.includes("web-search") ? ["tavily_search", "tavily_extract"].map((tool) => pluginTool("web-search", tool)) : []),
    ];
    const frontmatter = (name: string) => `---\nname: ${name}\ndescription: ${JSON.stringify(agent.description)}\n${assignments[agent.id] ? `model: ${JSON.stringify(assignments[agent.id])}\n` : ""}${efforts[agent.id] ? `effort: ${efforts[agent.id]}\n` : ""}skills:\n  - deck-developer-team:${agent.skillId}\n${agent.id === "deck-investigate" || agent.id === "deck-quality" ? `tools: ${readOnlyTools.join(", ")}\n` : ""}---\n\n`;
    const guidance = "<!-- Deck Claude plugin: guidance, not runtime enforcement. -->\n\n";
    files.push({ path: join(root, "agents", `${agent.id}.md`), content: frontmatter(agent.id) + guidance + canonical.agentBody.trim() + "\n", kind: "agent" });
    files.push({ path: join(root, "skills", agent.skillId, "SKILL.md"), content: frontmatter(agent.skillId) + guidance + canonical.skillBody.trim() + "\n", kind: "skill" });
  }
  const skillIds = new Set(getDeveloperTeamCatalog().map((agent) => agent.skillId));
  for (const { skillId } of getStandaloneSkills()) {
    if (!/^[a-z][a-z0-9-]*$/.test(skillId) || skillIds.has(skillId)) throw new Error("Invalid or duplicate standalone Claude skill ID.");
    skillIds.add(skillId);
    const bundle = getStandaloneSkill(skillId);
    files.push({ path: join(root, "skills", skillId, "SKILL.md"), content: bundle.SKILL, kind: "skill" });
    for (const [packagePath, content] of Object.entries(bundle.files)) {
      if (!packagePath || packagePath.includes("\\") || packagePath.includes("\0") || isAbsolute(packagePath)
        || packagePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
        || packagePath === "SKILL.md") throw new Error("Invalid standalone Claude skill resource path.");
      files.push({ path: join(root, "skills", skillId, packagePath), content, kind: "other" });
    }
  }
  files.push(...claudeCapabilityFiles(root, capabilities, effects, providerId));
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Duplicate Claude plugin file path.");
  if (files.some((file) => Buffer.byteLength(file.content) > 1024 * 1024)) throw new Error("Claude plugin content exceeds file bound.");
  return Object.freeze(files.map((file) => Object.freeze({ ...file })));
}

function privateDir(path: string) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error(`Claude Deck data directory is not owner-only: ${path}`);
}

/** Root-owned sticky temporary parents (for example /tmp) cannot replace another owner's child. */
function assertTrustedAncestors(path: string, home: string): void {
  if (!isAbsolute(path) || !isAbsolute(home)) throw new Error("Claude plugin path must be absolute.");
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  const homeStat = lstatSync(home);
  if (!homeStat.isDirectory() || (uid !== undefined && homeStat.uid !== uid)) throw new Error("Claude HOME is not owned by the active user.");
  let current = resolve(path);
  while (true) {
    let stat: import("node:fs").Stats | undefined;
    try { stat = lstatSync(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (stat) {
      if (!stat.isDirectory()) throw new Error(`Untrusted Claude plugin ancestor: ${current}`);
      const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if ((stat.mode & 0o022) !== 0 && !stickyRoot) throw new Error(`Writable Claude plugin ancestor: ${current}`);
      if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) throw new Error(`Foreign Claude plugin ancestor: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function inspect(root: string, files: ReturnType<typeof expectedFiles>, home: string): "absent" | "ready" | "conflict" {
  try { assertTrustedAncestors(root, home); }
  catch { return "conflict"; }
  if (!existsSync(root)) {
    try { lstatSync(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent"; }
    return "conflict";
  }
  try {
    const allowedFiles = new Set(files.map((file) => file.path));
    const directories = new Set([root]);
    for (const file of files) {
      let path = dirname(file.path);
      while (path !== root) {
        if (!path.startsWith(`${root}${sep}`)) throw new Error("Unexpected Claude plugin path.");
        directories.add(path);
        path = dirname(path);
      }
    }
    for (const directory of directories) {
      privateDir(directory);
      for (const child of readdirSync(directory)) {
        const path = join(directory, child);
        if (!directories.has(path) && !allowedFiles.has(path)) return "conflict";
      }
    }
    for (const file of files) {
      const stat = lstatSync(file.path);
      if (!stat.isFile() || stat.size !== Buffer.byteLength(file.content) || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || readFileSync(file.path, "utf8") !== file.content) return "conflict";
    }
    return "ready";
  } catch { return "conflict"; }
}

async function ensurePrivatePath(path: string, home: string) {
  if (resolve(path) === resolve(home)) throw new Error("Claude Deck data root cannot be HOME.");
  assertTrustedAncestors(path, home); // before any mutation
  const missing: string[] = [];
  let current = resolve(path);
  while (true) {
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || await realpath(current) !== current) throw new Error("Claude Deck data ancestor is not a real directory.");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(current);
      const parent = dirname(current);
      if (parent === current) throw new Error("No real Deck data ancestor.");
      current = parent;
    }
  }
  for (const dir of missing.reverse()) {
    assertTrustedAncestors(dirname(dir), home);
    await mkdir(dir, { mode: 0o700 });
    privateDir(dir);
  }
  assertTrustedAncestors(path, home);
  privateDir(path);
}

function matchesCanonicalFiles(candidate: unknown, canonical: ReturnType<typeof expectedFiles>): candidate is RunnerDeveloperTeamInstallPlan {
  if (!candidate || typeof candidate !== "object") return false;
  const plan = candidate as Partial<RunnerDeveloperTeamInstallPlan>;
  return plan.blocked !== true && Array.isArray(plan.files) && plan.files.length === canonical.length
    && plan.files.every((file, index) => file?.path === canonical[index]!.path && file.content === canonical[index]!.content && file.kind === canonical[index]!.kind);
}

export function createClaudeRunnerAdapter(options: Options = {}): RunnerAdapter {
  const homeInput = options.homeDir ?? process.env.HOME;
  if (!homeInput || !isAbsolute(homeInput)) throw new Error("Claude global plugin requires an absolute user HOME.");
  if (options.dataRoot !== undefined && !isAbsolute(options.dataRoot)) throw new Error("Claude Deck data root must be absolute.");
  const lexicalHome = resolve(homeInput);
  const home = realpathSync(lexicalHome); // canonicalize the approved HOME (macOS /var and /tmp aliases)
  const lexicalData = resolve(options.dataRoot ?? resolveDefaultDeckDataRoot(process.env, lexicalHome));
  if (basename(lexicalData) !== "deck" || lexicalData === lexicalHome) throw new Error("Claude plugin requires the dedicated Deck data root.");
  const withinHome = relative(lexicalHome, lexicalData);
  const dataRoot = withinHome === "" || withinHome !== ".." && !withinHome.startsWith(`..${sep}`) && !isAbsolute(withinHome)
    ? resolve(home, withinHome)
    : lexicalData;
  const parent = join(dataRoot, "claude");
  const officialRoot = join(parent, `official-supermemory-${CLAUDE_SUPERMEMORY_COMMIT.slice(0, 12)}`);
  const officialManifest = options.officialPluginManifest ?? CLAUDE_SUPERMEMORY_FILES;
  const nodeAvailable = options.verifyNodeRuntime ?? (() => {
    const executable = Bun.which("node");
    if (!executable) return false;
    const version = Bun.spawnSync([executable, "--version"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: { PATH: process.env.PATH ?? "", HOME: home } });
    const match = version.stdout.toString().trim().match(/^v(\d+)\./);
    return version.exitCode === 0 && Number(match?.[1] ?? 0) >= 18;
  });
  const officialState = () => {
    try { assertTrustedAncestors(officialRoot, home); const state = inspectClaudeSupermemoryArtifact(officialRoot, officialManifest); return state === "ready" && !nodeAvailable() ? "unusable" as const : state; }
    catch { return "conflict" as const; }
  };
  const toolRoot = join(parent, "tools");
  const rtkRelease = options.rtkReleaseOverride ?? pinnedClaudeRtkRelease();
  const ownedRtkRoot = join(toolRoot, "rtk-v0.50.0", `${process.platform}-${process.arch}`);
  const verifyRtkCommand = options.verifyRtkCommand ?? ((executable: string) => {
    const environment = { HOME: home, PATH: process.env.PATH ?? "" };
    const version = Bun.spawnSync([executable, "--version"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: environment });
    const match = version.stdout.toString().trim().match(/^rtk\s+(\d+)\.(\d+)\.(\d+)/i);
    if (version.exitCode !== 0 || !match || Number(match[1]) === 0 && Number(match[2]) < 50) return false;
    const hook = Bun.spawnSync([executable, "hook", "claude", "--help"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: environment });
    return hook.exitCode === 0 && /Claude Code PreToolUse hook/i.test(hook.stdout.toString());
  });
  const codebaseRelease = options.codebaseReleaseOverride ?? pinnedClaudeCodebaseRelease();
  const ownedCodebaseRoot = join(toolRoot, "codebase-native-v0.11.0", `${process.platform}-${process.arch}`);
  const verifyCodebaseNative = options.verifyCodebaseNative ?? ((executable: string) => {
    const result = Bun.spawnSync([executable, "--version"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: { HOME: home, PATH: process.env.PATH ?? "" } });
    return result.exitCode === 0;
  });
  // Reuse a codebase-memory-mcp already installed for another runner (PATH or ~/.local/bin). The tool talks to a
  // shared per-user daemon and a client of a different version hangs, so an existing install wins over the pin.
  const verifyExistingCodebase = options.verifyExistingCodebase ?? ((executable: string) => {
    const result = Bun.spawnSync([executable, "--version"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: { HOME: home, PATH: process.env.PATH ?? "" } });
    const match = result.stdout.toString().trim().match(/^codebase-memory-mcp\s+(\d+)\.(\d+)\.(\d+)/i);
    if (result.exitCode !== 0 || !match) return false;
    const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return major > 0 || minor > 10 || minor === 10 && patch >= 8;
  });
  const existingCodebase = (): string | undefined => {
    if (options.resolveCommand) return options.resolveCommand("codebase-memory-mcp"); // privileged test seam
    for (const candidate of [Bun.which("codebase-memory-mcp"), join(home, ".local", "bin", "codebase-memory-mcp")]) {
      try { if (candidate && isAbsolute(candidate) && existsSync(candidate) && verifyExistingCodebase(candidate)) return candidate; } catch { /* try next */ }
    }
    return undefined;
  };
  const ownedCodebaseState = () => {
    try {
      assertTrustedAncestors(ownedCodebaseRoot, home);
      const state = codebaseRelease ? inspectOwnedClaudeCodebase(ownedCodebaseRoot, codebaseRelease) : "unsupported" as const;
      return state === "ready" && !verifyCodebaseNative(join(ownedCodebaseRoot, "codebase-memory-mcp")) ? "unusable" as const : state;
    }
    catch { return "conflict" as const; }
  };
  const ownedRtkState = () => {
    try {
      assertTrustedAncestors(ownedRtkRoot, home);
      const state = rtkRelease ? inspectOwnedClaudeRtk(ownedRtkRoot, rtkRelease) : "unsupported" as const;
      return state === "ready" && !verifyRtkCommand(join(ownedRtkRoot, "rtk")) ? "unusable" as const : state;
    }
    catch { return "conflict" as const; }
  };
  const serenaRoot = options.serenaOwnedRoot ?? join(dataRoot, "tools", "serena");
  const serenaEffects: SerenaBootstrapEffects = options.serenaEffects ?? { ...createDefaultSerenaBootstrapEffects(), resolveDeckDataRoot: () => dataRoot };
  let serenaEvidence: SerenaReadinessEvidence | undefined;
  const toolEffects: ClaudeCapabilityOptions = { ...options, serenaReadinessVerified: () => serenaEvidence !== undefined, resolveCommand: (name) => name === "rtk" && rtkRelease && ownedRtkState() === "ready"
    ? join(ownedRtkRoot, "rtk")
    : name === "rtk" && rtkRelease && (ownedRtkState() === "conflict" || ownedRtkState() === "unusable")
      ? undefined
    : name === "rtk"
      ? (() => { const candidate = options.resolveCommand?.(name) ?? (options.resolveCommand ? undefined : Bun.which(name)); return candidate && isAbsolute(candidate) && verifyRtkCommand(candidate) ? candidate : undefined; })()
    : name === "codebase-memory-mcp"
      ? (existingCodebase() ?? (codebaseRelease && ownedCodebaseState() === "ready" ? join(ownedCodebaseRoot, "codebase-memory-mcp") : undefined)) // production never runs the npm self-downloading shim
    : options.resolveCommand
      ? options.resolveCommand(name)
    : name === "tavily-mcp"
      ? (() => {
          try {
            const packageRoot = join(toolRoot, "node_modules", "tavily-mcp");
            assertTrustedAncestors(packageRoot, home);
            const manifest = join(packageRoot, "package.json");
            const stat = lstatSync(manifest);
            if (!stat.isFile() || stat.size > 64 * 1024) return undefined;
            const receipt = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
            return receipt.version === "0.2.22" && existsSync(join(toolRoot, "node_modules", ".bin", name)) ? join(toolRoot, "node_modules", ".bin", name) : undefined;
          } catch { return undefined; }
        })()
      : Bun.which(name) ?? (existsSync(join(toolRoot, "node_modules", ".bin", name)) ? join(toolRoot, "node_modules", ".bin", name) : undefined) };
  const revalidateSerena = async (): Promise<boolean> => {
    if (!serenaEvidence) return false;
    try {
      assertTrustedAncestors(serenaRoot, home);
      if (!validateSerenaReadinessEvidence(serenaEvidence, serenaRoot).valid) return false;
      if (options.serenaRevalidate) return options.serenaRevalidate(serenaEvidence);
      return (await createSerenaReadinessRevalidator(serenaRoot, serenaEffects)(serenaEvidence)).valid;
    } catch { return false; }
  };
  const probeSerena = async (): Promise<boolean> => {
    if (!options.serenaProxyCommand) return false;
    if (await revalidateSerena()) return true;
    serenaEvidence = undefined;
    try {
      const result = await (options.serenaReadiness?.() ?? resolveExistingSerenaReadiness(serenaEffects));
      if (result.state !== "ready" || !validateSerenaReadinessEvidence(result.evidence, serenaRoot).valid) return false;
      serenaEvidence = result.evidence;
      if (options.serenaRevalidate ? await options.serenaRevalidate(result.evidence) : (await result.revalidate(result.evidence)).valid) return true;
    } catch { /* unavailable evidence is never promoted */ }
    serenaEvidence = undefined;
    return false;
  };
  const installSharedTool = async (id: "context-mode" | "context7" | "web-search"): Promise<boolean> => {
    if (options.installSharedTool) return options.installSharedTool(id);
    const pkg = id === "context-mode" ? "context-mode@1.0.169" : id === "web-search" ? "tavily-mcp@0.2.22" : "@upstash/context7-mcp@4.1.1";
    const npm = Bun.which("npm");
    if (!npm) return false;
    await ensurePrivatePath(toolRoot, home);
    const result = await new Promise<number>((done) => {
      const child = spawn(npm, ["install", "--prefix", toolRoot, "--no-audit", "--no-fund", "--ignore-scripts", pkg], {
        cwd: home,
        env: { HOME: home, PATH: process.env.PATH ?? "", USER: process.env.USER ?? "" },
        stdio: "ignore",
      });
      const timeout = setTimeout(() => { child.kill("SIGTERM"); done(1); }, 120_000);
      child.once("error", () => { clearTimeout(timeout); done(1); });
      child.once("close", (code) => { clearTimeout(timeout); done(code ?? 1); });
    });
    if (result !== 0) return false;
    try { verifyClaudeExecutable(id === "context7" ? "context7-mcp" : id === "web-search" ? "tavily-mcp" : "context-mode", toolEffects); return true; }
    catch { return false; }
  };
  const metadataPath = join(parent, "model-assignments.json");
  let modelSnapshot: Extract<RunnerModelInventoryResult, { state: "ready" }> | undefined;
  let modelSnapshotRoot: string | undefined;
  let modelDiscoveryGeneration = 0;
  const modelAvailable = (id: string) => id === "inherit" || modelSnapshot?.inventory.modelsByProvider.claude?.some((model) => model.id === id) === true;
  type Selection = { assignments: ClaudeAssignments; capabilities: readonly ClaudeCapabilityId[]; providerId?: string; plugin: string; contentHash?: string; efforts?: ClaudeEfforts };
  const readSelection = (): Selection => {
    assertTrustedAncestors(parent, home);
    let stat: import("node:fs").Stats;
    try { stat = lstatSync(metadataPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { assignments: normalizeClaudeAssignments({}), capabilities: [], plugin: claudePluginName({}, []) };
      throw error;
    }
    if (!stat.isFile() || stat.size > 8 * 1024 || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("Claude plugin selection metadata is untrusted.");
    const raw = readFileSync(metadataPath, "utf8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const assignments = normalizeClaudeAssignments(data.assignments);
    const capabilities = normalizeClaudeCapabilities(data.capabilities ?? []);
    const providerId = data.providerId === undefined ? undefined : data.providerId;
    if (providerId !== undefined && providerId !== "tavily" || capabilities.includes("web-search") !== (providerId === "tavily")) throw new Error("Claude Web Search provider selection is untrusted.");
    const contentHash = ["deck-claude-models-v2", "deck-claude-models-v3"].includes(data.schema as string) && typeof data.contentHash === "string" ? data.contentHash : undefined;
    const efforts = normalizeClaudeEfforts(data.efforts ?? {});
    if (raw !== claudeModelMetadata(assignments, capabilities, providerId as string | undefined, contentHash, efforts)) throw new Error("Claude plugin selection metadata does not match the owned plugin.");
    return { assignments, capabilities, ...(providerId ? { providerId: providerId as string } : {}), plugin: contentHash ? claudeContentPluginName(assignments, capabilities, providerId as string | undefined, contentHash) : claudePluginName(assignments, capabilities), ...(contentHash ? { contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
  };
  const readAssignments = (): ClaudeAssignments => readSelection().assignments;
  const active = () => {
    const selection = readSelection();
    const location = join(parent, selection.plugin);
    return { ...selection, location, expected: expectedFiles(location, selection.assignments, selection.capabilities, toolEffects, selection.providerId, selection.efforts) };
  };
  const materialization = (assignments: ClaudeAssignments, capabilities: readonly ClaudeCapabilityId[], providerId: string | undefined, current: Selection, efforts: ClaudeEfforts = current.efforts ?? {}) => {
    const legacyName = claudePluginName(assignments, capabilities);
    const legacyRoot = join(parent, legacyName);
    const legacyFiles = expectedFiles(legacyRoot, assignments, capabilities, toolEffects, providerId, efforts);
    const contentHash = hash(JSON.stringify(legacyFiles.map((file) => [relative(legacyRoot, file.path), file.kind, hash(file.content)])));
    const versionedName = claudeContentPluginName(assignments, capabilities, providerId, contentHash);
    const legacyState = inspect(legacyRoot, legacyFiles, home);
    // Preserve an existing v1 receipt while it still exactly matches. A stale v1
    // selection may be superseded, but an unrelated conflicting directory may not.
    if (legacyState === "ready" && current.plugin === legacyName && !current.contentHash) return { location: legacyRoot, files: legacyFiles, plugin: legacyName, state: legacyState };
    if (legacyState === "conflict") {
      const marker = legacyFiles[0]!;
      try {
        privateDir(legacyRoot);
        privateDir(dirname(marker.path));
        const stat = lstatSync(marker.path);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || readFileSync(marker.path, "utf8") !== marker.content) throw new Error("Invalid Deck plugin marker.");
      } catch { throw new Error("Claude plugin destination conflicts with unowned content."); }
    }
    const location = join(parent, versionedName);
    const files = expectedFiles(location, assignments, capabilities, toolEffects, providerId, efforts);
    return { location, files, plugin: versionedName, contentHash, state: inspect(location, files, home) };
  };
  const writeActive = async (selection: Selection) => {
    const { assignments, capabilities, providerId, contentHash, efforts } = selection;
    const next = claudeModelMetadata(assignments, capabilities, providerId, contentHash, efforts);
    const current = readSelection();
    if (JSON.stringify(current) === JSON.stringify(selection) && existsSync(metadataPath)) return;
    let previous: string | undefined;
    try { previous = readFileSync(metadataPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = join(parent, `.model-assignments-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, next, { flag: "wx", mode: 0o600 });
      let observed: string | undefined;
      try { observed = readFileSync(metadataPath, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (observed !== previous) throw new Error("Claude model metadata changed during installation.");
      if (previous === undefined) await link(temporary, metadataPath);
      else await rename(temporary, metadataPath);
    } finally { await rm(temporary, { force: true }); }
  };
  const unsupported = (id: string, label: string) => ({ capabilityId: id, label, description: `${label} is not verified for Deck-managed Claude.`, section: "runner-capabilities", requirementLevel: "optional" as const, source: "claude-plugin-dir", installKind: "runner-native" as const, supportStatus: "unsupported" as const, isInstalled: false, isBlocked: true, diagnostics: [warning] });
  const capability = () => {
    let state: "absent" | "ready" | "conflict" = "conflict";
    try { const selected = active(); state = inspect(selected.location, selected.expected, home); } catch { /* invalid metadata fails closed */ }
    return { capabilityId: "claude-team-files", label: "Claude Developer Team plugin files", description: "Global agents and skills; does not establish execution controls.", section: "runner-capabilities", requirementLevel: "optional" as const, source: "deck-owned-plugin-dir", installKind: "runner-native" as const, supportStatus: "runner-specific" as const, isInstalled: state === "ready", isBlocked: state === "conflict", diagnostics: [warning] };
  };
  const plan: RunnerAdapter["buildDeveloperTeamInstallPlan"] = (input) => {
    try {
      const current = readSelection();
      const assignments = input.modelAssignments === undefined ? current.assignments : normalizeClaudeAssignments(input.modelAssignments);
      const efforts = normalizeClaudeEfforts(input.thinkingAssignments ?? current.efforts ?? {});
      if (Object.entries(assignments).some(([role, model]) => current.assignments[role] !== model && (model !== "inherit" && modelSnapshotRoot !== input.projectRoot || !modelAvailable(model)))) throw new Error("Changed Claude model requires ready runtime discovery.");
      if (Object.entries(efforts).some(([role, level]) => (current.efforts?.[role] !== level || current.assignments[role] !== assignments[role]) && !adapter.getThinkingLevels(assignments[role]).includes(level))) throw new Error("Changed Claude effort requires compatible runtime metadata.");
      const capabilities = input.capabilityIds === undefined ? current.capabilities : normalizeClaudeCapabilities(input.capabilityIds.filter((id) => id !== "claude-team-files"));
      const providerId = capabilities.includes("web-search") ? input.deckConfig.webSearch.enabled ? input.deckConfig.webSearch.provider : undefined : undefined;
      const desired = materialization(assignments, capabilities, providerId, current, efforts);
      const { files: canonical, state, plugin, contentHash } = desired;
      const blocked = state === "conflict" || input.environmentId !== ENVIRONMENT || input.deckConfig.adaptiveMemory.enabled && (officialState() !== "ready" || !resolveCanonicalSupermemoryProjectScope({ projectRoot: input.projectRoot, remotes: [] }).ok) || !!input.memoryProvider || (capabilities.includes("web-search") && (providerId !== "tavily" || !(options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim())) || (input.capabilityInstructions?.instructions ?? []).some((fragment) => fragment.packageId && fragment.packageId !== "code-economy" && !capabilities.includes(fragment.packageId as ClaudeCapabilityId));
      const changed = JSON.stringify(current.assignments) !== JSON.stringify(assignments) || JSON.stringify(current.capabilities) !== JSON.stringify(capabilities) || current.providerId !== providerId || current.plugin !== plugin;
      return {
        files: canonical.map((file) => ({ ...file })),
        modelAssignments: { ...assignments },
        thinkingAssignments: { ...efforts },
        capabilityIds: [...capabilities],
        ...(providerId ? { providerId } : {}),
        pluginName: plugin,
        ...(contentHash ? { contentHash } : {}),
        blocked,
        diagnostics: [warning, "Claude models are runtime-reported, not guaranteed account-entitled.", ...(blocked ? ["Claude plugin conflict or unverified memory/tool/effort selection; no files will be written."] : [])],
        mutationPreview: blocked ? [] : [
          ...(state === "ready" ? [] : canonical.map((file) => ({ action: "create" as const, path: file.path, preimage: "absent", postimage: hash(file.content), ownership: owner }))),
          ...(changed ? [{ action: "update" as const, path: metadataPath, preimage: "owned-model-selection", postimage: hash(claudeModelMetadata(assignments, capabilities, providerId, contentHash, efforts)), ownership: owner }] : []),
        ],
      };
    } catch {
      return { files: [], blocked: true, diagnostics: [warning, "Claude model metadata, alias or global plugin path is untrusted; no files will be written."], mutationPreview: [] };
    }
  };
  const adapter: RunnerAdapter = {
    runnerId: "claude", displayName: "Claude Code", environmentIds: [ENVIRONMENT], packageInstructionIds: ["context-mode", "codebase-memory", "rtk", "serena"],
    ui: { environmentLabels: { [ENVIRONMENT]: "Claude Code" }, dashboard: { defaultSelectedTeamIds: ["developer-team"], defaultSelectedCapabilityIds: ["claude-team-files"], extraSelectableCapabilities: [{ id: "context7", label: "Context7", description: "Use a verified shared Context7 MCP binary in the Claude plugin." }], managedLaunchSupported: false, launchHint: "deck claude developer starts a supervised static-compatible session. Deck supplies the pinned official memory plugin when selected; co-loaded user plugins may also see the process credential. Protected execution remains unsupported.", executionClass: "static-compatible" }, model: { providerSource: "Installed Claude runtime-reported metadata; account entitlement not guaranteed", missingChecks: ["account entitlement", "comparison with authenticated native /model"], remediation: "Retry metadata discovery and check native Claude /model for account-specific availability.", defaultThinkingLevels: [] }, adaptiveMemory: { supermemory: { supported: true, requiresExternalToken: true, selectionStatus: "Official Claude Supermemory uses the existing protected alias/default profile store." } } },
    async inspectProject(projectRoot) {
      const identity = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: [] });
      return { projectRoot, state: identity.ok ? "ready" : "degraded", evidence: { interactive: true, exec: false, resume: false, resumeLatest: false, canonicalIdentityVerified: identity.ok }, diagnostics: identity.ok ? [] : [{ code: "claude-project-identity-unverified", severity: "warning" as const, message: "Canonical Git repository identity is unavailable; shared adaptive memory cannot be enabled for this project." }] };
    },
    async detectDeckInstall() {
      try {
        await probeSerena();
        const selected = active();
        if (inspect(selected.location, selected.expected, home) !== "ready") return { installed: false, managedPaths: [], diagnostics: ["Deck-owned Claude plugin content is missing or conflicts with its current canonical manifest."] };
        return { installed: true, managedPaths: [...selected.expected.map((file) => file.path), ...(existsSync(metadataPath) ? [metadataPath] : [])], diagnostics: ["Verified global Deck-owned Claude plugin; account model availability and protected execution are not implied."] };
      } catch { return { installed: false, managedPaths: [], diagnostics: ["Deck-owned Claude plugin or selection metadata is untrusted."] }; }
    },
    async buildLaunchPlan(input) {
      const diagnostic = (code: string, message: string) => [{ code, severity: "error" as const, message }];
      const memoryEnabled = input.deckConfig.adaptiveMemory.enabled && input.deckConfig.adaptiveMemory.activeProvider === "supermemory";
      if (memoryEnabled && officialState() !== "ready") return { status: "blocked", code: "claude-official-memory-plugin-unverified", diagnostics: diagnostic("claude-official-memory-plugin-unverified", "The pinned official Claude Supermemory plugin or Node.js 18+ runtime is not installed and verified.") };
      const identity = memoryEnabled ? resolveCanonicalSupermemoryProjectScope({ projectRoot: input.projectRoot, remotes: [] }) : undefined;
      if (identity && !identity.ok) return { status: "blocked", code: "claude-project-identity-unverified", diagnostics: diagnostic("claude-project-identity-unverified", "Canonical Git repository identity is required for a shared Supermemory session.") };
      if (input.deckConfig.adaptiveMemory.enabled !== memoryEnabled || !input.deckConfig.adaptiveMemory.enabled && input.deckConfig.adaptiveMemory.activeProvider === "supermemory") return { status: "blocked", code: "claude-memory-selection-invalid", diagnostics: diagnostic("claude-memory-selection-invalid", "Claude adaptive memory selection is inconsistent.") };
      if (input.mode !== "interactive" || input.modelId || input.reasoningLevel || input.runnerNative) return { status: "unsupported", code: "claude-team-route-unverified", diagnostics: diagnostic("claude-team-route-unverified", "Only interactive Claude plugin-file sessions are supported; native overrides and exec/resume are unverified.") };
      await probeSerena(); // read-only Core probe; required if selected plugin includes Serena
      let selected: ReturnType<typeof active> | undefined;
      try { selected = active(); } catch { /* untrusted owned metadata */ }
      if (selected?.capabilities.includes("serena") && !await revalidateSerena()) return { status: "blocked", code: "claude-serena-readiness-stale", diagnostics: diagnostic("claude-serena-readiness-stale", "Deck-owned Serena bootstrap evidence is stale; Claude was not launched.") };
      if (!selected || inspect(selected.location, selected.expected, home) !== "ready") return { status: "blocked", code: "claude-plugin-unverified", diagnostics: diagnostic("claude-plugin-unverified", "Deck-owned global Claude plugin or model selection is missing or conflicts with its verified manifest.") };
      const webSearchEnabled = selected.capabilities.includes("web-search");
      if (webSearchEnabled !== input.deckConfig.webSearch.enabled || webSearchEnabled && selected.providerId !== input.deckConfig.webSearch.provider) return { status: "blocked", code: "claude-web-search-selection-stale", diagnostics: diagnostic("claude-web-search-selection-stale", "Claude Web Search selection changed; review and reinstall the global plugin before launch.") };
      const token = webSearchEnabled ? (options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim() : undefined;
      if (webSearchEnabled && (!token || /[\0\r\n]/.test(token))) return { status: "blocked", code: "claude-web-search-credential-missing", diagnostics: diagnostic("claude-web-search-credential-missing", "The shared Tavily credential is unavailable; Deck did not launch Claude.") };
      let credential: ReturnType<NonNullable<Options["resolveMemoryCredential"]>> | undefined;
      if (memoryEnabled) {
        try { credential = options.resolveMemoryCredential?.(input.projectRoot); } catch { /* Never expose a secret-store or project-config error. */ }
        if (!credential || !credential.token || credential.token.length > 16 * 1024 || /[\0\r\n]/.test(credential.token) || !/^sm_project_v1_[a-z0-9_]{3,180}$/.test(credential.canonicalRepoTag) || credential.canonicalRepoTag !== (identity?.ok ? identity.scope : undefined)) return { status: "blocked", code: "claude-memory-profile-unavailable", diagnostics: diagnostic("claude-memory-profile-unavailable", "Shared Supermemory profile, verified repository tag or plugin-override inspection is not ready.") };
      }
      const envOverlay = { ...(token ? { TAVILY_API_KEY: { value: token, sensitive: true } } : {}), ...(credential ? { SUPERMEMORY_CC_API_KEY: { value: credential.token, sensitive: true }, SUPERMEMORY_REPO_TAG: { value: credential.canonicalRepoTag } } : {}) };
      const sensitiveKeys = [...(token ? ["TAVILY_API_KEY"] : []), ...(credential ? ["SUPERMEMORY_CC_API_KEY"] : [])];
      return { status: "ready", plan: { command: "claude", args: [...CLAUDE_ATTRIBUTION_SETTINGS_ARGS, "--plugin-dir", selected.location, ...(credential ? ["--plugin-dir", officialRoot] : []), "--agent", "deck-developer-team:deck-lead"], cwd: input.projectRoot, stdio: "inherit", stdin: "inherit", executionClass: "static-compatible", ...(sensitiveKeys.length ? { envOverlay, sensitiveEnvAuthorization: { binding: credential ? "deck-claude-official-memory-v1" : "deck-claude-web-search-v1", keys: sensitiveKeys } } : {}) }, diagnostics: [{ code: "claude-static-compatible", severity: "warning", message: credential ? "Pinned official Supermemory plugin owns recall/capture; Deck only supplies the selected process-local profile and verified scope. Co-loaded user plugins may see the process credential; protected execution remains unsupported." : "Deck supplies the verified team plugin with --plugin-dir. Other user/managed plugins and hooks may still load; remote memory is not asserted off for external plugins." }] };
    },
    async detectRuntimes() {
      let detected = options.detectClaudeVersion?.();
      if (!detected) {
        const command = Bun.which("claude");
        if (command) {
          const probe = Bun.spawnSync([command, "--version"], { timeout: 3_000, stdout: "pipe", stderr: "ignore", env: { HOME: home, PATH: process.env.PATH ?? "" } });
          const version = probe.success ? probe.stdout.toString().trim().match(/^(\d+)\.(\d+)\.(\d+)/) : null;
          detected = { available: Boolean(version && (Number(version[1]) > 2 || Number(version[1]) === 2 && (Number(version[2]) > 1 || Number(version[2]) === 1 && Number(version[3]) >= 218))), ...(version ? { version: version[0] } : {}) };
        } else detected = { available: false };
      }
      return [{ runtimeId: "claude", displayName: "Claude Code", isAvailable: detected.available, ...(detected.version ? { version: detected.version } : {}), diagnostics: detected.available ? [] : ["Claude Code 2.1.218+ executable was not verified; Deck may install content but cannot claim a supported interactive runner."] }];
    },
    async getCapabilityInventory(input) {
      await probeSerena(); // read-only, runner-neutral Core readiness; no implicit bootstrap
      let selected: ReturnType<typeof active> | undefined;
      try { selected = active(); } catch { /* untrusted metadata */ }
      const checks = (["context-mode", "codebase-memory", "rtk", "serena", "context7", "web-search"] as const).map((id) => {
        let executableReady = true;
        try { claudeCapabilityFiles(parent, [id], toolEffects, id === "web-search" ? input.deckConfig.webSearch.provider : undefined); }
        catch { executableReady = false; }
        const materialized = executableReady && selected?.capabilities.includes(id) === true && inspect(selected.location, selected.expected, home) === "ready";
        let rtkHookReady = true;
        if (id === "rtk") { try { verifyClaudeRtkHookRuntime(toolEffects); } catch { rtkHookReady = false; } }
        const installable = id === "context-mode" || id === "context7" || id === "web-search" || id === "serena" && Boolean(options.serenaProxyCommand) || id === "rtk" && rtkHookReady && Boolean(rtkRelease) && ownedRtkState() !== "conflict" && ownedRtkState() !== "unusable" || id === "codebase-memory" && (Boolean(existingCodebase()) || Boolean(codebaseRelease) && ownedCodebaseState() !== "conflict" && ownedCodebaseState() !== "unusable");
        return { capabilityId: id, label: id, description: `${id} uses the Deck-owned global Claude plugin; readiness requires the selected tool executable and verified native config.`, section: "runner-capabilities", requirementLevel: "optional" as const, installKind: "runner-native" as const, source: "deck-owned-plugin-dir", supportStatus: executableReady || installable ? "runner-specific" as const : "blocked" as const, isInstalled: materialized, isBlocked: !executableReady && !installable, diagnostics: executableReady ? [] : [installable ? `${id} must be installed through the reviewed Deck tool action.` : `${id} executable or provider bootstrap is unavailable.`] };
      });
      const provider = options.webSearchProviderResolver?.(input.deckConfig.webSearch.provider);
      const webSearchIndex = checks.findIndex((entry) => entry.capabilityId === "web-search");
      const searchEntry = checks[webSearchIndex]!;
      const credentialAvailable = Boolean((options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim());
      const readiness = resolveWebSearchReadiness({ enabled: input.deckConfig.webSearch.enabled, runnerSupported: searchEntry.supportStatus === "runner-specific", providerConfigured: provider?.providerId === "tavily", credentialAvailable, executableAvailable: searchEntry.diagnostics.length === 0, mcpConfigured: searchEntry.isInstalled });
      return { runnerId: "claude", environmentId: ENVIRONMENT, capabilities: [capability(), { capabilityId: "adaptive-memory", label: "Official Supermemory", description: "Pinned official Claude plugin; uses shared protected alias/default profiles.", section: "runner-capabilities", requirementLevel: "optional" as const, installKind: "runner-native" as const, source: `supermemoryai/claude-supermemory@${CLAUDE_SUPERMEMORY_COMMIT}`, supportStatus: "runner-specific" as const, isInstalled: officialState() === "ready", isBlocked: officialState() === "conflict" || officialState() === "unusable", diagnostics: officialState() === "conflict" ? ["Official plugin content differs from the pinned manifest."] : officialState() === "unusable" ? ["Official plugin requires an available Node.js 18+ runtime."] : [] }, unsupported("protected-execution", "Protected execution"), ...checks.map((entry) => entry.capabilityId === "web-search" ? { ...entry, webSearchProvider: provider, webSearchReadiness: readiness, webSearchEvidence: { enabled: input.deckConfig.webSearch.enabled, runnerSupported: entry.supportStatus === "runner-specific", providerConfigured: provider?.providerId === "tavily", credentialAvailable, executableAvailable: entry.supportStatus === "runner-specific", mcpConfigured: entry.isInstalled } } : entry)] };
    },
    buildReviewPlan(state) {
      const selectedCapabilities = [...new Set([
        ...Object.entries(state.selectedCapabilities).filter(([id, selected]) => selected && id !== "claude-team-files" && !["context-mode", "codebase-memory", "rtk", "serena"].includes(id)).map(([id]) => id),
        ...Object.entries(state.packageInstructions).filter(([id, enabled]) => enabled && ["context-mode", "codebase-memory", "rtk", "serena"].includes(id)).map(([id]) => id),
      ])];
      const memorySelected = state.adaptiveMemory.provider === "supermemory";
      const memoryState = officialState();
      const profileReady = state.adaptiveMemory.supermemory?.configured === true || state.adaptiveMemory.supermemory?.runtimeCredentialStored === true;
      const scope = (state as typeof state & { runtime?: { projectIdentity?: string; projectRoot?: string } }).runtime;
      const identityVerified = scope?.projectIdentity === "verified";
      let selectedProfileReady = !memorySelected;
      if (memorySelected && scope?.projectRoot) {
        try {
          const credential = options.resolveMemoryCredential?.(scope.projectRoot);
          selectedProfileReady = Boolean(credential?.token && /^sm_project_v1_[a-z0-9_]{3,180}$/.test(credential.canonicalRepoTag));
        } catch { /* Never surface protected store content in review. */ }
      }
      const unsupportedSelected = memorySelected && (!profileReady || !identityVerified || !selectedProfileReady) || memoryState === "conflict" || memoryState === "unusable";
      let selected: (ReturnType<typeof active> & { installableMissing?: readonly ("context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena")[] }) | undefined;
      let changingModels = false;
      try {
        const current = readSelection();
        const team = (state as typeof state & { teams?: Record<string, { modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string> }> }).teams?.["developer-team"];
        const assignments = team?.modelAssignments === undefined ? current.assignments : normalizeClaudeAssignments(team.modelAssignments);
        const efforts = normalizeClaudeEfforts(team?.thinkingAssignments ?? current.efforts ?? {});
        if (Object.entries(assignments).some(([role, model]) => current.assignments[role] !== model && !modelAvailable(model))) throw new Error("Claude model discovery is not ready.");
        if (Object.entries(efforts).some(([role, level]) => (current.efforts?.[role] !== level || current.assignments[role] !== assignments[role]) && !adapter.getThinkingLevels(assignments[role]).includes(level))) throw new Error("Claude effort discovery is not ready.");
        const capabilities = normalizeClaudeCapabilities(selectedCapabilities);
        const providerId = capabilities.includes("web-search") ? state.webSearchProvider : undefined;
        if (capabilities.includes("web-search") && (providerId !== "tavily" || !(options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim() || options.webSearchProviderResolver?.(providerId)?.command.join("\0") !== "npx\0-y\0tavily-mcp@0.2.22")) throw new Error("Claude Web Search provider or shared credential is not ready.");
        const installableMissing = capabilities.filter((id): id is "context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena" => {
          if (id === "serena") {
            if (serenaEvidence) return false;
            if (!options.serenaProxyCommand || state.explicitlySelectedCapabilities?.serena !== true) throw new Error("Serena requires current-operation TUI authorization and a verified Deck proxy.");
            return true;
          }
          if (id !== "context-mode" && id !== "context7" && id !== "codebase-memory" && id !== "web-search" && id !== "rtk") return false;
          if (id === "rtk" && (!rtkRelease || ownedRtkState() === "conflict" || ownedRtkState() === "unusable")) throw new Error("RTK pinned release is unavailable or conflicts with owned content.");
          if (id === "rtk") verifyClaudeRtkHookRuntime(toolEffects);
          if (id === "codebase-memory" && !existingCodebase() && (!codebaseRelease || ownedCodebaseState() === "conflict" || ownedCodebaseState() === "unusable")) throw new Error("Codebase Memory pinned native release is unavailable or conflicts with owned content.");
          try { verifyClaudeExecutable(id === "context7" ? "context7-mcp" : id === "codebase-memory" ? "codebase-memory-mcp" : id === "web-search" ? "tavily-mcp" : id === "rtk" ? "rtk" : "context-mode", toolEffects); return false; }
          catch { return true; }
        });
        // Every other selected capability must already have a verified native command.
        for (const id of capabilities.filter((id) => !installableMissing.includes(id as "context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena"))) claudeCapabilityFiles(parent, [id], toolEffects, id === "web-search" ? providerId : undefined);
        const desired = installableMissing.length === 0 ? materialization(assignments, capabilities, providerId, current, efforts) : undefined;
        selected = { assignments, capabilities, ...(providerId ? { providerId } : {}), ...(Object.keys(efforts).length ? { efforts } : {}), plugin: desired?.plugin ?? claudePluginName(assignments, capabilities), ...(desired?.contentHash ? { contentHash: desired.contentHash } : {}), location: desired?.location ?? join(parent, claudePluginName(assignments, capabilities)), expected: desired?.files ?? [], installableMissing };
        changingModels = JSON.stringify(assignments) !== JSON.stringify(current.assignments) || JSON.stringify(capabilities) !== JSON.stringify(current.capabilities);
      } catch { /* untrusted metadata or unsupported alias */ }
      const stateAtReview = selected ? selected.installableMissing?.length ? "absent" : inspect(selected.location, selected.expected, home) : "conflict";
      const blocked = unsupportedSelected || stateAtReview === "conflict";
      const pendingInstalls = selected?.installableMissing ?? [];
      const installs = [
        ...(memorySelected && memoryState === "absent" ? [{ id: "claude.official-supermemory.install", kind: "install-claude-supermemory", title: "Install and verify pinned official Claude Supermemory plugin", capabilityId: "adaptive-memory", status: "ready" as const, required: true }] : []),
        ...pendingInstalls.map((id) => ({ id: `claude.tool.${id}.install`, kind: id === "rtk" ? "install-claude-rtk" : id === "codebase-memory" ? "install-claude-codebase" : id === "serena" ? "install-serena" : "install-claude-tool", title: `Install and verify ${id} in Deck-owned shared tools`, capabilityId: id, status: "ready" as const, required: true })),
      ];
      const preview = `${stateAtReview === "ready" ? "Verify existing" : `Create ${selected?.expected.length || 15} owner-only files in`} ${selected?.location ?? parent}; ${pendingInstalls.length ? `Install ${pendingInstalls.join(", ")} before materialization; ` : ""}${changingModels ? "Update Deck-owned model selection; " : ""}ownership=${owner}. Deck does not write project or Claude settings; ${memorySelected ? "the official plugin may add its statusLine to user Claude settings on first SessionStart when no statusLine exists; co-loaded user/project/managed plugins can access the selected process credential and Deck does not isolate them. " : ""}${warning}`;
      return { groups: { automaticInstalls: installs, manualSteps: [], configWrites: [], teamApplications: state.runnerId === "claude" ? [{ id: "claude.team.install", kind: "apply-team-bundle", title: "Install global Claude Developer Team plugin files", status: blocked ? "blocked" as const : "ready" as const, required: true, description: preview, dependencies: installs.map((install) => install.id) }] : [], validations: state.runnerId === "claude" ? [{ id: "adaptive-memory.supermemory.deck-config", kind: "write-deck-config", title: "Persist reviewed Claude capabilities and shared memory selection after verification", status: blocked ? "blocked" as const : "ready" as const, required: true, dependencies: ["claude.team.install"] }] : [] }, diagnostics: [{ code: blocked ? "claude-team-install-blocked" : "claude-files-only", severity: blocked ? "error" as const : "warning" as const, message: blocked ? `${preview} Existing global plugin conflict or unverified selection blocks installation.` : preview }], ready: !blocked };
    },
    buildInstallationPlan() { return { steps: [{ action: "install", tool: "Claude global Developer Team plugin files" }] }; },
    async runAction(action, context) {
      if (action.capabilityId === "serena" && action.kind === "install-serena") {
        const authorized = validateSerenaOperationAuthorization(context?.serenaAuthorization, context?.currentOperation);
        if (!authorized.valid || context.currentOperation?.runner !== "claude") return { actionId: action.id, status: "failed", message: "Claude Serena requires current-operation explicit TUI authorization.", diagnostics: [], serenaOutcome: "failed" as const };
        try {
          const ownedRoot = options.serenaOwnedRoot ?? await resolveSerenaOwnedRoot(serenaEffects);
          if (!ownedRoot || ownedRoot !== serenaRoot) throw new Error("Serena owned root mismatch.");
          const request: SerenaBootstrapRequest = { authorization: authorized.authorization, currentOperation: context.currentOperation, operation: context.operation, signal: context.signal };
          const outcome = await (options.serenaBootstrap?.(request) ?? bootstrapSerena(request, serenaEffects));
          const verified = validateSerenaBootstrapResult(outcome, ownedRoot);
          if (!verified.valid) throw new Error("Serena bootstrap did not produce validated evidence.");
          serenaEvidence = verified.result.evidence;
          if (!await revalidateSerena()) throw new Error("Serena evidence failed immediate revalidation.");
          return { actionId: action.id, status: "executed", message: "Deck-owned Claude Serena prerequisite installed and revalidated.", diagnostics: [], serenaOutcome: verified.result.outcome, serenaReadiness: verified.result.evidence };
        } catch { serenaEvidence = undefined; return { actionId: action.id, status: "failed", message: "Claude Serena bootstrap or owned proxy validation failed.", diagnostics: [], serenaOutcome: "failed" as const }; }
      }
      if (action.kind === "install-claude-supermemory" && action.capabilityId === "adaptive-memory") {
        try {
          await ensurePrivatePath(parent, home);
          const status = await installClaudeSupermemoryArtifact(officialRoot, options.supermemoryArtifactEffects, officialManifest);
          if (officialState() !== "ready") throw new Error("Official artifact verification failed.");
          return { actionId: action.id, status: "executed", message: status === "installed" ? "Pinned official Supermemory plugin installed and verified." : "Pinned official Supermemory plugin verified without changes.", diagnostics: [] };
        } catch { return { actionId: action.id, status: "failed", message: "Pinned official Claude Supermemory plugin installation failed; adaptive memory was not activated.", diagnostics: [] }; }
      }
      if (action.kind === "install-claude-rtk" && action.capabilityId === "rtk") {
        if (!rtkRelease) return { actionId: action.id, status: "failed", message: "No pinned RTK artifact exists for this platform.", diagnostics: [] };
        try {
          await ensurePrivatePath(dirname(ownedRtkRoot), home);
          const result = await installOwnedClaudeRtk(ownedRtkRoot, rtkRelease, options.rtkArtifactEffects);
          if (ownedRtkState() !== "ready") throw new Error("RTK verification failed.");
          return { actionId: action.id, status: "executed", message: result === "installed" ? "Pinned Claude-safe RTK installed and verified without global init." : "Pinned Claude-safe RTK verified without changes.", diagnostics: [] };
        } catch { return { actionId: action.id, status: "failed", message: "Pinned RTK installation failed; Claude hook was not materialized.", diagnostics: [] }; }
      }
      if (action.kind === "install-claude-codebase" && action.capabilityId === "codebase-memory") {
        if (!codebaseRelease) return { actionId: action.id, status: "failed", message: "No pinned Codebase Memory native release exists for this platform.", diagnostics: [] };
        try {
          await ensurePrivatePath(dirname(ownedCodebaseRoot), home);
          const outcome = await installOwnedClaudeCodebase(ownedCodebaseRoot, codebaseRelease, options.codebaseArtifactEffects);
          if (ownedCodebaseState() !== "ready") throw new Error("Codebase Memory native verification failed.");
          return { actionId: action.id, status: "executed", message: outcome === "installed" ? "Pinned Codebase Memory native executable installed and verified; no session download is needed." : "Pinned Codebase Memory native executable verified without changes.", diagnostics: [] };
        } catch { return { actionId: action.id, status: "failed", message: "Pinned Codebase Memory native install failed; no npm shim was configured.", diagnostics: [] }; }
      }
      const id = action.capabilityId;
      if (action.kind !== "install-claude-tool" || id !== "context-mode" && id !== "context7" && id !== "web-search") return { actionId: action.id, status: "failed", message: "Claude tool install action is unsupported.", diagnostics: [warning] };
      const command = id === "context7" ? "context7-mcp" : id === "web-search" ? "tavily-mcp" : "context-mode";
      try { verifyClaudeExecutable(command, toolEffects); return { actionId: action.id, status: "executed", message: `${id} is already available.`, diagnostics: [] }; }
      catch { /* reviewed install effect follows */ }
      if (!await installSharedTool(id)) return { actionId: action.id, status: "failed", message: `${id} installation failed or executable was not verified.`, diagnostics: [] };
      try { verifyClaudeExecutable(command, toolEffects); return { actionId: action.id, status: "executed", message: `${id} was installed and verified.`, diagnostics: [] }; }
      catch { return { actionId: action.id, status: "failed", message: `${id} executable was not verified after installation.`, diagnostics: [] }; }
    },
    getTeams() { return [DEVELOPER_TEAM]; },
    getModelCatalog() { return { providers: modelSnapshot?.inventory.providers ?? [], models: (modelSnapshot?.inventory.modelsByProvider.claude ?? []).map((model) => ({ id: model.id, displayName: model.displayName, providerId: "claude", capabilities: [], supportsReasoning: model.supportsReasoning === true })), developerTeamDefaults: [] }; },
    async getModelInventory(request) {
      const generation = ++modelDiscoveryGeneration;
      try {
        const reported = parseClaudeModelInfo(await (options.modelDiscovery?.(request.projectRoot, request.signal) ?? discoverClaudeModels({ home, projectRoot: request.projectRoot, configDir: process.env.CLAUDE_CONFIG_DIR, signal: request.signal })));
        if (request.signal?.aborted || generation !== modelDiscoveryGeneration) throw new Error("cancelled or superseded");
        const models = reported.flatMap((model, priority) => [model.value, ...(model.resolvedModel && model.resolvedModel !== model.value ? [model.resolvedModel] : [])].map((id) => ({ id, modelId: id, providerId: "claude", displayName: id === model.value ? model.displayName : `${model.displayName} (${id})`, description: model.description, priority, source: "runner-resolved" as const, variants: model.supportsEffort === true ? model.supportedEffortLevels ?? [] : [], supportsReasoning: model.supportsEffort === true })));
        const distinct = [...new Map(models.map((model) => [model.id, model])).values()];
        const inventory = { providers: [{ id: "claude", displayName: "Claude runtime-reported models", source: "runner-resolved" as const }], modelsByProvider: { claude: distinct.length ? [...distinct, { id: "inherit", modelId: "inherit", providerId: "claude", displayName: "Inherit parent model (not a detected model)", description: "Explicit native subagent inheritance.", source: "runner-resolved" as const, variants: [], supportsReasoning: false }] : [] }, diagnostics: ["Installed Claude initialize/supportedModels metadata; no inference message or provider entitlement check. Credentials are not copied into the isolated probe. Effort uses the documented native subagent frontmatter only for runtime-reported compatible levels."] };
        modelSnapshot = { state: "ready", inventory, source: "live", discoveredAt: Date.now(), fingerprint: hash(JSON.stringify(reported)) }; modelSnapshotRoot = request.projectRoot;
        return modelSnapshot;
      } catch {
        if (generation === modelDiscoveryGeneration) { modelSnapshot = undefined; modelSnapshotRoot = undefined; }
        return { state: "blocked", inventory: null, source: "none", error: { code: "command-failed", message: "Claude metadata-only model discovery failed. Check the installed CLI and safe model settings, then retry. No fallback models were selected.", retryable: true } };
      }
    },
    async validateModelAssignments(input) {
      const result = await adapter.getModelInventory!({ projectRoot: input.projectRoot, mode: "rescan" });
      if (result.state !== "ready" || input.expectedFingerprint && input.expectedFingerprint !== result.fingerprint) return { valid: false, issues: input.changedAgentIds.map((agentId) => ({ agentId, code: "inventory-not-ready" as const, message: "Claude runtime discovery changed or is not ready; retry before changing assignments." })) };
      const issues = input.changedAgentIds.flatMap<RunnerModelAssignmentIssue>((agentId) => !modelAvailable(input.modelAssignments[agentId] ?? "inherit") ? [{ agentId, code: "model-unavailable", message: "Selected Claude model is no longer reported by the runtime." }] : input.thinkingAssignments[agentId] && !adapter.getThinkingLevels(input.modelAssignments[agentId]).includes(input.thinkingAssignments[agentId]!) ? [{ agentId, code: "variant-unavailable", message: "Claude effort level is not reported compatible with the selected model." }] : []);
      return issues.length ? { valid: false, issues } : { valid: true, fingerprint: result.fingerprint };
    },
    readModelAssignments() { try { return { ...readAssignments() }; } catch { return {}; } }, readThinkingAssignments() { try { return { ...readSelection().efforts }; } catch { return {}; } },
    readSelectedCapabilityIds() {
      try {
        const selection = readSelection();
        const root = join(parent, selection.plugin);
        const marker = join(root, ".claude-plugin", "plugin.json");
        assertTrustedAncestors(root, home);
        privateDir(root);
        privateDir(dirname(marker));
        const stat = lstatSync(marker);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || readFileSync(marker, "utf8") !== pluginMarker) return undefined;
        return [...selection.capabilities];
      } catch { return undefined; }
    },
    getThinkingLevels(modelId) { return modelSnapshot?.inventory.modelsByProvider.claude?.find((model) => model.id === modelId)?.variants ?? []; }, supportsThinking(modelId) { return adapter.getThinkingLevels(modelId).length > 0; },
    buildDeveloperTeamInstallPlan: plan,
    async applyDeveloperTeamInstall(input) {
      const candidate = input.plan as RunnerDeveloperTeamInstallPlan & { modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string>; capabilityIds?: string[]; providerId?: string; pluginName?: string; contentHash?: string };
      const assignments = normalizeClaudeAssignments(candidate.modelAssignments ?? readAssignments());
      const efforts = normalizeClaudeEfforts(candidate.thinkingAssignments ?? readSelection().efforts ?? {});
      const previousSelection = readSelection();
      const changedAgentIds = [...new Set([...Object.keys(assignments), ...Object.keys(efforts)])].filter((role) => assignments[role] !== previousSelection.assignments[role] || efforts[role] !== previousSelection.efforts?.[role]);
      if (changedAgentIds.length && !(await adapter.validateModelAssignments!({ projectRoot: input.projectRoot, modelAssignments: { ...assignments }, thinkingAssignments: { ...efforts }, changedAgentIds })).valid) throw new Error("Claude runtime model selection changed or is unavailable; plugin was not modified.");
      const capabilities = normalizeClaudeCapabilities(candidate.capabilityIds ?? readSelection().capabilities);
      if (capabilities.includes("serena") && !await revalidateSerena()) throw new Error("Claude Serena readiness is stale; plugin was not modified.");
      const providerId = capabilities.includes("web-search") ? candidate.providerId : undefined;
      const expected = plan({ projectRoot: input.projectRoot, environmentId: input.environmentId, modelAssignments: { ...assignments }, thinkingAssignments: { ...efforts }, capabilityIds: ["claude-team-files", ...capabilities], deckConfig: { adaptiveMemory: { enabled: false, activeProvider: "none" }, webSearch: { enabled: providerId === "tavily", provider: providerId } } as Parameters<typeof plan>[0]["deckConfig"] });
      if (expected.blocked) throw new Error("Claude global plugin plan is blocked or stale.");
      const desired = expected as typeof candidate;
      const selectedRoot = join(parent, desired.pluginName!);
      const canonical = expectedFiles(selectedRoot, assignments, capabilities, toolEffects, providerId, efforts);
      if (candidate.pluginName !== desired.pluginName || candidate.contentHash !== desired.contentHash || !matchesCanonicalFiles(input.plan, canonical)) throw new Error("Claude global plugin plan is stale or untrusted.");
      const existing = inspect(selectedRoot, canonical, home);
      if (existing === "conflict") throw new Error("Claude plugin destination already exists with unknown content.");
      await ensurePrivatePath(parent, home);
      if (existing === "absent") {
        const staging = await mkdtemp(join(parent, ".deck-claude-stage-"));
        try {
          for (const file of canonical) {
            const local = join(staging, relative(selectedRoot, file.path));
            await mkdir(dirname(local), { recursive: true, mode: 0o700 });
            await writeFile(local, file.content, { flag: "wx", mode: 0o600 });
          }
          if (inspect(staging, canonical.map((file) => ({ ...file, path: join(staging, relative(selectedRoot, file.path)) })), home) !== "ready") throw new Error("Claude plugin staging verification failed.");
          if (inspect(selectedRoot, canonical, home) !== "absent") throw new Error("Claude plugin destination appeared during staging.");
          await mkdir(selectedRoot, { mode: 0o700 }); // exclusive, never replace an unrelated plugin
          for (const file of canonical) {
            const local = join(selectedRoot, relative(selectedRoot, file.path));
            await mkdir(dirname(local), { recursive: true, mode: 0o700 });
            await writeFile(local, file.content, { flag: "wx", mode: 0o600 });
          }
        } finally {
          if (await realpath(staging).catch(() => undefined) === staging) await rm(staging, { recursive: true, force: true });
        }
      }
      if (inspect(selectedRoot, canonical, home) !== "ready") throw new Error("Claude plugin publication is indeterminate; inspect global Deck plugin manually.");
      const nextSelection = { assignments, capabilities, ...(providerId ? { providerId } : {}), plugin: desired.pluginName!, ...(desired.contentHash ? { contentHash: desired.contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
      await writeActive(nextSelection); // select only fully verified immutable content
      if (JSON.stringify(readSelection()) !== JSON.stringify(nextSelection)) throw new Error("Claude plugin selection is indeterminate; inspect global Deck metadata manually.");
      return { results: canonical.map((file) => ({ agentId: file.path, kind: file.kind, status: existing === "ready" ? "unchanged" : "created" })), changedCount: existing === "ready" ? 0 : canonical.length, unchangedCount: existing === "ready" ? canonical.length : 0 };
    },
    getNextScreen() { return "complete"; },
    async inspectEnvironment() { return { status: "content-only", diagnostics: [warning] }; },
    async reviewTools() { return { status: "unsupported", diagnostics: [warning] }; },
    backupDeveloperTeamFiles() { return { payload: undefined, diagnostics: ["Versioned plugin creation has no previous Deck-owned files to restore."] }; },
    async rollbackDeveloperTeamFiles() {
      try {
        assertTrustedAncestors(parent, home);
        const versions = readdirSync(parent).filter((name) => /^developer-team-v(?:1(?:-[0-9a-f]{16})?|2-[0-9a-f]{16})$/.test(name));
        if (versions.length === 0) return { status: "nothing-to-do", conflicts: [], diagnostics: ["No Claude plugin was published."] };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "nothing-to-do", conflicts: [], diagnostics: ["No Claude plugin was published."] };
      }
      return { status: "conflict", conflicts: [parent], diagnostics: ["Published or externally changed Claude plugin is not automatically deleted; inspect versioned content and active metadata manually before recovery."] };
    },
    async verifyDeveloperTeamInstall(candidate) {
      try {
        const snapshot = candidate as RunnerDeveloperTeamInstallPlan & { modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string>; capabilityIds?: string[]; providerId?: string; pluginName?: string; contentHash?: string };
        const assignments = normalizeClaudeAssignments(snapshot.modelAssignments ?? readAssignments());
        const efforts = normalizeClaudeEfforts(snapshot.thinkingAssignments ?? readSelection().efforts ?? {});
        const capabilities = normalizeClaudeCapabilities(snapshot.capabilityIds ?? readSelection().capabilities);
        if (capabilities.includes("serena") && !await revalidateSerena()) return { valid: false, diagnostics: ["Claude Serena readiness is stale."] };
        const providerId = capabilities.includes("web-search") ? snapshot.providerId : undefined;
        const selectedRoot = join(parent, snapshot.pluginName!);
        const canonical = expectedFiles(selectedRoot, assignments, capabilities, toolEffects, providerId, efforts);
        const selection = { assignments, capabilities, ...(providerId ? { providerId } : {}), plugin: snapshot.pluginName, ...(snapshot.contentHash ? { contentHash: snapshot.contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
        const digest = hash(JSON.stringify(canonical.map((file) => [relative(selectedRoot, file.path), file.kind, hash(file.content)])));
        const validName = snapshot.contentHash ? snapshot.contentHash === digest && snapshot.pluginName === claudeContentPluginName(assignments, capabilities, providerId, digest) : snapshot.pluginName === claudePluginName(assignments, capabilities);
        return { valid: validName && matchesCanonicalFiles(candidate, canonical) && JSON.stringify(readSelection()) === JSON.stringify(selection) && inspect(selectedRoot, canonical, home) === "ready", diagnostics: [warning] };
      } catch { return { valid: false, diagnostics: ["Claude model metadata or plugin verification failed."] }; }
    },
    resolveThinking() { return undefined; }, getDefaultThinking() { return "off"; },
    getCapability(id) { return [capability(), unsupported("adaptive-memory", "Adaptive Memory"), unsupported("protected-execution", "Protected execution")].find((entry) => entry.capabilityId === id); },
    getCapabilityIds() { return ["claude-team-files", ...CLAUDE_CAPABILITY_IDS]; }, getSelectableTools() { return []; },
  };
  return adapter;
}
