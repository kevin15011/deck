import { installOwnedNpmTool, ownedNpmCommand } from './npm-tools';
import { precheckClaudeContributionRecovery } from './recovery-precheck';
import { inspectRecoveryJournal, recoveryHash } from '../../core/src/canonical-recovery-preflight';
import { archiveRunnerJournal } from '../../core/src/runner-recovery-archive';
import { withInstallationUse, withInstallationMutation, trackInstallationProcess, InstallationBusyError } from "../../core/src/installation-use";
import { admissionFailure, type RunnerAdmissionResult } from "@deck/core";
import { createClaudeSkillDiscoveryProvider, type ClaudeSkillDiscoveryOptions } from "./skill-discovery-provider";
import { PrerequisiteEvidence, pinnedHookExecutable } from "../../core/src/session/prerequisite-evidence";
import { resolveWebSearchLaunch } from "@deck/core";
import { ROLE_TOOL_POLICY, isReadOnlyRole, readOnlyMcpTools } from "@deck/core/session/role-tool-policy";
import { SESSION_SKILLS_PLUGIN_NAME, ClaudeSkillsError, verifyClaudeSessionSkills, claudeCodebaseDenials } from "./session-skills";
import type { NativeSkillsDescriptor, RunnerPreparationFinding } from "@deck/core/session/driver";
import { claudeProjectConfigTrusted } from './personal-mcp';
import { inspectClaudeNativeSearch } from "./native-search";
import { recordRunnerMutationJournals, beginRunnerContributions, compareReleaseVersions, validReleaseVersion, backupManagedPreimages, assertNoContributionSymlink, inspectManagedDrift, contributionId, readRunnerContributions, recordOwnedRunnerArtifactTree } from "@deck/core";
import { type NpmArtifactEffects, isCompatibleCodebaseExecutable } from "@deck/core";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import { CLAUDE_ATTRIBUTION_SETTINGS_ARGS } from "./launch-settings";
import { existsSync, lstatSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile, link } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { CLAUDE_CAPABILITY_IDS, claudeContentPluginName, claudeModelMetadata, claudePluginName, normalizeClaudeAssignments, normalizeClaudeCapabilities, normalizeClaudeEfforts, type ClaudeEfforts, type ClaudeAssignments, type ClaudeCapabilityId } from "./models";
import { discoverClaudeModels, parseClaudeModelInfo, type ClaudeModelInfo } from "./model-discovery";
import type { RunnerModelInventoryResult, RunnerModelAssignmentIssue } from "../../core/src/index";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { translateClaudeCapabilityInstructions } from "./instruction-translation";
import { bootstrapSerena, getEnabledCapabilityInstructionIds, buildCapabilityInstructionBundle, createDefaultSerenaBootstrapEffects, createSerenaReadinessRevalidator, getAgentContent, getDeveloperTeamCatalog, resolveExistingSerenaReadiness, resolveSerenaOwnedRoot, resolveWebSearchReadiness, validateSerenaBootstrapResult, validateSerenaOperationAuthorization, validateSerenaReadinessEvidence, DEVELOPER_TEAM, resolveDefaultDeckDataRoot, type RunnerAdapter, type RunnerDeveloperTeamInstallPlan, type SerenaBootstrapEffects, type SerenaBootstrapRequest, type SerenaBootstrapResult, type SerenaExistingReadinessResult, type SerenaReadinessEvidence } from "../../core/src/index";
import { claudeCapabilityFiles, verifyClaudeExecutable, verifyClaudeRtkHookRuntime, type ClaudeCapabilityOptions } from "./capabilities";
import { inspectOwnedClaudeRtk, installOwnedClaudeRtk, pinnedClaudeRtkRelease, type RtkReleaseArtifact } from "./rtk-artifact";
import { createClaudeSessionDriver, type ClaudeSessionDriverOptions } from "./session-driver/driver";
import { inspectOwnedClaudeCodebase, installOwnedClaudeCodebase, pinnedClaudeCodebaseRelease, type CodebaseNativeRelease } from "./codebase-native-artifact";
import type { ChildMcpServerSpec } from "@deck/core/session/driver";

/** Read-only session composition seam; shared runner contracts remain unchanged until S2. */
export type ClaudeSessionMcpAdapter = RunnerAdapter & {
  prepareSessionNativeSkills(config?: import("@deck/core").NormalizedDeckConfig): Promise<NativeSkillsDescriptor>;
  readSessionCapabilityOverrides(config?: import("@deck/core").NormalizedDeckConfig): Promise<Record<string, ChildMcpServerSpec>>;
};

type Options = ClaudeCapabilityOptions & {
  skillDiscovery?: Pick<ClaudeSkillDiscoveryOptions, "configDir" | "systemRoots" | "exposedRoots" | "inventory">;
  npmArtifactEffects?: NpmArtifactEffects;
  homeDir?: string;
  dataRoot?: string;
  detectClaudeVersion?: () => { available: boolean; version?: string };
  modelDiscovery?: (projectRoot: string, signal?: AbortSignal) => Promise<readonly ClaudeModelInfo[]>;
  /** Hermetic release fixture only; production selects pinned platform/arch assets. */
  rtkReleaseOverride?: RtkReleaseArtifact;
  rtkArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyRtkCommand?: (executable: string) => boolean;
  codebaseReleaseOverride?: CodebaseNativeRelease;
  codebaseArtifactEffects?: { fetchArchive?: (asset: string) => Promise<Uint8Array> };
  verifyCodebaseNative?: (executable: string) => boolean;
  /** Verifies an already-installed (shared) codebase-memory-mcp; defaults to the reviewed size and hash. */
  verifyExistingCodebase?: (executable: string) => boolean;
  serenaEffects?: SerenaBootstrapEffects;
  serenaBootstrap?: (request: SerenaBootstrapRequest) => Promise<SerenaBootstrapResult>;
  serenaReadiness?: () => Promise<SerenaExistingReadinessResult>;
  serenaRevalidate?: (evidence: SerenaReadinessEvidence) => Promise<boolean>;
  /** Hermetic override; production uses the canonical shared Deck Serena root. */
  serenaOwnedRoot?: string;
  /** Cross-runner session driver options (ToS gate, executable, hermetic probe). */
  sessionDriver?: ClaudeSessionDriverOptions;
};
const ENVIRONMENT = "claude-development";
const warning = "Claude integration is static-compatible: selected native MCP and team files can be verified, but full protected execution and live combined plugin loading are not proven.";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const owner = "deck-claude-plugin-v1";
const pluginIdentity = { name: "deck-developer-team", version: "1.0.0", description: "Deck Developer Team content" } as const;
const pluginMarker = JSON.stringify(pluginIdentity, null, 2) + "\n";
// Claude namespaces MCP servers bundled by a plugin as plugin:<plugin-name>:<server>.
const pluginTool = (server: string, tool: string) => `mcp__plugin_${pluginIdentity.name}_${server}__${tool}`;

export function expectedFiles(root: string, assignments: ClaudeAssignments = {}, capabilities: readonly ClaudeCapabilityId[] = [], effects: ClaudeCapabilityOptions = {}, providerId?: string, efforts: ClaudeEfforts = {}) {
  const files: { path: string; content: string; kind: "agent" | "skill" | "other" }[] = [{ path: join(root, ".claude-plugin", "plugin.json"), content: pluginMarker, kind: "other" }];
  for (const agent of getDeveloperTeamCatalog()) {
    if (!/^[a-z][a-z0-9-]*$/.test(agent.id) || !/^[a-z][a-z0-9-]*$/.test(agent.skillId)) throw new Error("Invalid canonical Claude role ID.");
    const instructionIds = capabilities.filter((id) => id !== "context7") as Exclude<ClaudeCapabilityId, "context7">[];
    const canonical = getAgentContent(agent.id, { promptProfile: "compact", ...(instructionIds.length ? { capabilityInstructions: translateClaudeCapabilityInstructions(buildCapabilityInstructionBundle(instructionIds)) } : {}) });
    if (!canonical?.agentBody || !canonical.skillBody || /<!-- Placeholder:/.test(canonical.agentBody + canonical.skillBody)) throw new Error("Incomplete canonical Claude role.");
    const readOnlyTools = [
      ...ROLE_TOOL_POLICY.mcp.deck!.map(tool => `mcp__deck__${tool}`),
      ...(capabilities.includes("web-search") ? ["WebSearch", "WebFetch"] : []),
      ...ROLE_TOOL_POLICY.builtins.map(tool => tool[0]!.toUpperCase() + tool.slice(1)),
      ...readOnlyMcpTools(capabilities, (server, tool) => server === "codebase-memory"
        ? [pluginTool(server, tool), `mcp__${server}__${tool}`]
        : server === "web-search" ? [`mcp__${server}__tavily_${tool}`] : [pluginTool(server, tool)]),
    ];
    const frontmatter = (name: string) => `---\nname: ${name}\ndescription: ${JSON.stringify(agent.description)}\n${assignments[agent.id] ? `model: ${JSON.stringify(assignments[agent.id])}\n` : ""}${efforts[agent.id] ? `effort: ${efforts[agent.id]}\n` : ""}skills:\n  - deck-developer-team:${agent.skillId}\n${isReadOnlyRole(agent.id) ? `tools: ${readOnlyTools.join(", ")}\n` : ""}---\n\n`;
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

/** Only current generator leaves may be repaired. Unknown entries and unsafe paths stay closed. */
function repairable(root: string, files: ReturnType<typeof expectedFiles>, home: string): boolean {
  try {
    assertTrustedAncestors(root, home);
    const allowed = new Set(files.map(file => file.path));
    const directories = new Set([root]);
    for (const file of files) {
      let directory = dirname(file.path);
      while (directory !== root) { directories.add(directory); directory = dirname(directory); }
    }
    const walk = (path: string): boolean => {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return false;
      if (stat.isDirectory()) return directories.has(path) && readdirSync(path).every(name => walk(join(path, name)));
      return stat.isFile() && stat.size <= 1024 * 1024 && allowed.has(path);
    };
    return walk(root);
  } catch { return false; }
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

export function createClaudeRunnerAdapter(options: Options = {}): ClaudeSessionMcpAdapter {
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
  // Shared user installations remain untouched; reuse only the exact reviewed build.
  const verifyExistingCodebase = options.verifyExistingCodebase ?? ((executable: string) => isCompatibleCodebaseExecutable(executable, codebaseRelease));
  const existingCodebase = (): string | undefined => {
    const candidates = options.resolveCommand
      ? [options.resolveCommand("codebase-memory-mcp")]
      : [Bun.which("codebase-memory-mcp"), join(home, ".local", "bin", "codebase-memory-mcp")];
    for (const candidate of candidates) {
      try { if (candidate && isAbsolute(candidate) && verifyExistingCodebase(candidate)) return candidate; } catch (error) { if (!["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
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
    : name === "context7-mcp" || name === "tavily-mcp"
      ? ownedNpmCommand(toolRoot, name === "context7-mcp" ? "context7" : "web-search")
      : Bun.which(name) ?? undefined };
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
    if (id === "context-mode") return false;
    return withInstallationMutation(parent, async () => {
      await ensurePrivatePath(toolRoot, home);
      await installOwnedNpmTool({ toolsRoot: toolRoot, id, effects: options.npmArtifactEffects,
        publishReceipt: artifactRoot => { recordOwnedRunnerArtifactTree({ runnerId: "claude", root: parent, manifestPath: join(parent, "manifest.json"), artifactRoot, sourceItemId: `package:${id}` }); },
      });
      return ownedNpmCommand(toolRoot, id) !== undefined;
    });
  };
  const metadataPath = join(parent, "model-assignments.json");
  // In-process rollback evidence only: a restarted writer never infers proof from journal claims.
  const rollbackProofs = new Map<string, () => boolean>();
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
    const originalCapabilities = Array.isArray(data.capabilities) ? [...new Set(data.capabilities)] as ClaudeCapabilityId[] : [];
    if (originalCapabilities.some(id => ![...CLAUDE_CAPABILITY_IDS, "context-mode", "serena"].includes(id))) throw new Error("Claude legacy capability metadata is invalid.");
    originalCapabilities.sort();
    const capabilities = normalizeClaudeCapabilities(originalCapabilities);
    const providerId = data.providerId === undefined ? undefined : data.providerId;
    if (providerId !== undefined && providerId !== "tavily" || capabilities.includes("web-search") !== (providerId === "tavily")) throw new Error("Claude Web Search provider selection is untrusted.");
    const contentHash = ["deck-claude-models-v2", "deck-claude-models-v3"].includes(data.schema as string) && typeof data.contentHash === "string" ? data.contentHash : undefined;
    const efforts = normalizeClaudeEfforts(data.efforts ?? {});
    if (data.plugin !== JSON.parse(claudeModelMetadata(assignments, originalCapabilities, providerId as string | undefined, contentHash, efforts)).plugin) throw new Error("Claude plugin selection metadata does not match the owned plugin.");
    return { assignments, capabilities, ...(providerId ? { providerId: providerId as string } : {}), plugin: contentHash ? claudeContentPluginName(assignments, originalCapabilities, providerId as string | undefined, contentHash) : claudePluginName(assignments, originalCapabilities), ...(contentHash ? { contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
  };
  const readAssignments = (): ClaudeAssignments => readSelection().assignments;
  const active = () => {
    const selection = readSelection();
    const location = join(parent, selection.plugin);
    return { ...selection, location, expected: expectedFiles(location, selection.assignments, selection.capabilities, toolEffects, selection.providerId, selection.efforts) };
  };
  const ownedPartialPublication = (root: string, files: ReturnType<typeof expectedFiles>): boolean => {
    try {
      const receipts = new Map(readRunnerContributions(join(parent, 'manifest.json'))?.contributions.map(entry => [entry.id, entry]));
      const expected = new Map(files.map(file => [file.path, file.content]));
      if (!files.every(file => receipts.get(contributionId({ path: file.path, selector: { kind: 'file' } }))?.hash === hash(file.content))) return false;
      const inspectPartial = (path: string): boolean => {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) return false;
        if (stat.isDirectory()) return readdirSync(path).every(name => inspectPartial(join(path, name)));
        return stat.isFile() && expected.has(path) && readFileSync(path, 'utf8') === expected.get(path);
      };
      return inspectPartial(root);
    } catch { return false; }
  };
  const materialization = (assignments: ClaudeAssignments, capabilities: readonly ClaudeCapabilityId[], providerId: string | undefined, current: Selection, efforts: ClaudeEfforts = current.efforts ?? {}) => {
    const hashRoot = parent;
    const hashFiles = expectedFiles(hashRoot, assignments, capabilities, toolEffects, providerId, efforts);
    const contentHash = hash(JSON.stringify(hashFiles.map((file) => [relative(hashRoot, file.path), file.kind, hash(file.content)])));
    const versionedName = claudeContentPluginName(assignments, capabilities, providerId, contentHash);
    const location = join(parent, versionedName);
    const files = expectedFiles(location, assignments, capabilities, toolEffects, providerId, efforts);
    return { location, files, plugin: versionedName, contentHash, state: inspect(location, files, home) };
  };
  const selectionBytes = (selection: Selection, previous?: string) => {
    const extras = previous === undefined ? {} : Object.fromEntries(Object.entries(JSON.parse(previous)).filter(([key]) =>
      !["schema", "assignments", "capabilities", "efforts", "providerId", "plugin", "contentHash"].includes(key)));
    return JSON.stringify({ ...extras, ...JSON.parse(claudeModelMetadata(selection.assignments, selection.capabilities, selection.providerId, selection.contentHash, selection.efforts)) }, null, 2) + "\n";
  };
  const writeActive = async (next: string, expectedPrevious: string | undefined) => {
    readSelection(); // Validate existing selection before any rewrite.
    let previous: string | undefined;
    try { previous = readFileSync(metadataPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (previous !== expectedPrevious) throw new Error("Claude model metadata changed during installation.");
    if (previous === next) return;
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
      const explicitCodebase = getEnabledCapabilityInstructionIds(input.deckConfig, "claude").includes("codebase-memory");
      const nativeSearch = inspectClaudeNativeSearch({ projectRoot: input.projectRoot, modelId: assignments["deck-lead"], environment: options.sessionDriver?.baseEnv, flags: options.sessionDriver?.extraArgs }, home);
      const fallbackRequired = input.deckConfig.webSearch.enabled && nativeSearch.availability !== "available" && nativeSearch.webAllowed !== false;
      const capabilities = normalizeClaudeCapabilities([...(input.capabilityIds === undefined ? current.capabilities : input.capabilityIds.filter(id => [...CLAUDE_CAPABILITY_IDS, "context-mode", "serena"].includes(id as ClaudeCapabilityId))), ...(input.deckConfig.webSearch.enabled ? ["web-search"] : [])]
        .filter(id => (id !== "codebase-memory" || explicitCodebase) && (id !== "web-search" || input.deckConfig.webSearch.enabled)));
      const providerId = capabilities.includes("web-search") ? input.deckConfig.webSearch.enabled ? input.deckConfig.webSearch.provider : undefined : undefined;
      const desired = materialization(assignments, capabilities, providerId, current, efforts);
      const { files: canonical, state, plugin, contentHash } = desired;
      const blocked = state === "conflict" && !repairable(desired.location, canonical, home) || input.environmentId !== ENVIRONMENT || (fallbackRequired && (providerId !== "tavily" || !(options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim())) || (input.capabilityInstructions?.instructions ?? []).some((fragment) => fragment.packageId && fragment.packageId !== "code-economy" && !capabilities.includes(fragment.packageId as ClaudeCapabilityId));
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
        diagnostics: [warning, "Claude models are runtime-reported, not guaranteed account-entitled.", ...(blocked ? ["Claude plugin conflict or unverified tool/effort selection; no files will be written."] : [])],
        mutationPreview: blocked ? [] : [
          ...(state === "ready" ? [] : canonical.map((file) => ({ action: "create" as const, path: file.path, preimage: "absent", postimage: hash(file.content), ownership: owner }))),
          ...(changed ? [{ action: "update" as const, path: metadataPath, preimage: "owned-model-selection", postimage: hash(claudeModelMetadata(assignments, capabilities, providerId, contentHash, efforts)), ownership: owner }] : []),
        ],
      };
    } catch {
      return { files: [], blocked: true, diagnostics: [warning, "Claude model metadata, alias or global plugin path is untrusted; no files will be written."], mutationPreview: [] };
    }
  };
  const preparationEvidence = new PrerequisiteEvidence();
  const adapter: ClaudeSessionMcpAdapter = {
    skillDiscovery: createClaudeSkillDiscoveryProvider({
      ...options.skillDiscovery, homeDir: home,
      configDir: options.skillDiscovery?.configDir ?? options.sessionDriver?.baseEnv?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
      projectAdmitted: projectRoot => claudeProjectConfigTrusted(home, projectRoot, options.sessionDriver?.baseEnv ?? process.env),
      selectedPluginGeneration: () => existsSync(metadataPath) ? readSelection().contentHash : undefined,
      selectedPlugin: () => {
        if (!existsSync(metadataPath)) return undefined;
        // Catalog visibility is advisory; launch verification remains separate.
        const location = join(parent, readSelection().plugin);
        assertTrustedAncestors(location, home);
        return location;
      },
    }),
    inspectNativeSearch: async (input) => inspectClaudeNativeSearch({ ...input, environment: input.environment ?? options.sessionDriver?.baseEnv, flags: input.flags ?? options.sessionDriver?.extraArgs }, home),
    mutationRoot: parent, stateSchema: 1,
    async recoverPendingMutation(references) {
      if (references.length !== 1 || references[0]!.kind !== "claude-contributions" || references[0]!.operationId !== references[0]!.id) return undefined;
      const id = references[0]!.id, prove = rollbackProofs.get(id);
      if (!prove || !prove()) return undefined;
      rollbackProofs.delete(id);
      return "preimage";
    },
    precheckPendingMutation(input) {
      const candidate = plan(input) as RunnerDeveloperTeamInstallPlan & { modelAssignments: Record<string, string>; thinkingAssignments: Record<string, string>; capabilityIds: string[]; providerId?: string; pluginName: string; contentHash?: string };
      if (!existsSync(join(parent, 'manifest.json.pending'))) return;
      if (candidate.blocked) throw new Error('claude-legacy-recovery-plan-blocked');
      const current = existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : undefined;
      const selection = { assignments: candidate.modelAssignments, capabilities: candidate.capabilityIds, ...(candidate.providerId ? { providerId: candidate.providerId } : {}), plugin: candidate.pluginName, ...(candidate.contentHash ? { contentHash: candidate.contentHash } : {}), ...(Object.keys(candidate.thinkingAssignments).length ? { efforts: candidate.thinkingAssignments } : {}) };
      precheckClaudeContributionRecovery(parent, '0.14.0', [...candidate.files, { path: metadataPath, content: selectionBytes(selection as Selection, current) }]);
    },
    async prepareCanonicalRecovery(input, references, self) {
      const originals = references.filter(j => !['canonical-recovery-v1', 'deck-scope-v1'].includes(j.kind));
      if (originals.length > 1 || originals.some(j => j.kind !== 'claude-contributions' || j.id !== j.operationId)) throw new Error('claude-recovery-reference-invalid');
      const pendingPath = join(parent, 'manifest.json.pending');
      const journal = inspectRecoveryJournal(pendingPath);
      const candidate = plan(input);
      if (candidate.blocked) throw new Error('claude-recovery-plan-blocked');
      const targets = new Map(candidate.files.map(file => [file.path, hash(file.content)]));
      targets.set(metadataPath, 'selection');
      const generationLeaves = new Set(candidate.files.map(file => relative(join(parent, (candidate as RunnerDeveloperTeamInstallPlan & { pluginName: string }).pluginName), file.path)));
      let journalGeneration: string | undefined;
      let manifest: ReturnType<typeof readRunnerContributions>;
      try { manifest = readRunnerContributions(join(parent, 'manifest.json')); }
      catch { throw new Error('claude-recovery-required: manifest-unproven'); }
      if (manifest && (manifest.runnerId !== 'claude' || manifest.root !== parent || !validReleaseVersion(manifest.deckVersion) || compareReleaseVersions(manifest.deckVersion, self.semver) > 0)) throw new Error('claude-recovery-manifest-incompatible');
      if (journal) {
        const raw = journal.value;
        if (!originals.some(j => j.id === raw?.operationId) || raw?.runnerId !== 'claude' || raw.root !== parent || raw.manifestPath !== join(parent, 'manifest.json') || raw.scope !== 'global' || raw.managed !== true || !validReleaseVersion(raw.deckVersion) || compareReleaseVersions(raw.deckVersion, self.semver) > 0 || !Array.isArray(raw.targets) || raw.targets.length !== targets.size) throw new Error('claude-recovery-journal-invalid');
        const seen = new Set<string>();
        for (const entry of raw.targets) {
          const target = entry?.target;
          const local = typeof target?.path === 'string' ? relative(parent, target.path) : '';
          const parts = local.split(sep), generation = parts.shift();
          const generated = !!generation && /^developer-team-v(?:1(?:-[a-f0-9]{16})?|2-[a-f0-9]{16})$/.test(generation) && generationLeaves.has(parts.join(sep));
          if (generated) {
            if (journalGeneration && journalGeneration !== generation) throw new Error('claude-recovery-generation-mixed');
            journalGeneration = generation;
          }
          if (!target || typeof target.path !== 'string' || resolve(target.path) !== target.path || (!targets.has(target.path) && !generated) || target.selector?.kind !== 'file' || Object.keys(target.selector).length !== 1 || entry.id !== contributionId(target) || seen.has(entry.id) || !recoveryHash(entry.preimage) || !recoveryHash(entry.postimage)) throw new Error('claude-recovery-target-untrusted');
          assertNoContributionSymlink(target.path); seen.add(entry.id);
        }
      }
      return {
        journalKinds: ['claude-contributions'], maximumAdapterJournals: 1,
        archive: async () => {
          journal?.unchanged();
          for (const reference of originals) archiveRunnerJournal({ livePath: pendingPath, reference, bound: originals, journalKinds: ['claude-contributions'] });
        },
        reconcile: async () => adapter.applyDeveloperTeamInstall({ projectRoot: input.projectRoot, environmentId: input.environmentId, plan: plan(input) }),
        verify: async () => (await adapter.verifyDeveloperTeamInstall(candidate)).valid && (await adapter.evaluateSessionAdmission!()).verdict === 'admit',
      };
    },
    withNativeInstallationUse: effect => withInstallationUse(parent,effect),
    trackNativeInstallationProcess: pid => trackInstallationProcess(parent,pid),
    readManagedContentDrift() {
      try {
        const selected = active();
        const manifest = readRunnerContributions(join(parent, "manifest.json"));
        if (!manifest || manifest.runnerId !== "claude" || manifest.root !== parent) return true;
        const targets = [...selected.expected.map(file => ({ path: file.path, selector: { kind: "file" as const } })), { path: metadataPath, selector: { kind: "file" as const } }];
        return inspectManagedDrift({ inventory: { runnerId: "claude", root: parent, generatedRoots: [selected.location], slots: [{ path: metadataPath, selector: { kind: "file" as const }, authority: 'generated' }] }, targets, receipts: manifest.contributions }).drift;
      } catch { return true; }
    },
    evaluateSessionAdmission() {
      try {
        const selected = active();
        if (inspect(selected.location, selected.expected, home) !== "ready") return admissionFailure(undefined);
        return { verdict: "admit", checks: [], ...(selected.contentHash ? { generation: selected.contentHash } : {}) } as RunnerAdmissionResult;
      } catch (error) { return admissionFailure(error); }
    },
    async prepareSessionNativeSkills(config) {
      const findings: RunnerPreparationFinding[] = [];
      try {
        if (config && existsSync(metadataPath)) {
          const current = readSelection();
          const candidate = plan({ projectRoot: home, environmentId: ENVIRONMENT, deckConfig: config, capabilityIds: ["claude-team-files", ...current.capabilities] });
          if (!candidate.blocked && (candidate.mutationPreview?.length || adapter.readManagedContentDrift?.(config))) {
            try {
              await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: ENVIRONMENT, plan: candidate });
              findings.push({ kind: "H", code: "claude-managed-content-reconciled", item: "team-plugin", message: "Regenerated Deck plugin files and verified their receipts." });
            } catch (error) {
              if (!(error instanceof InstallationBusyError)) throw error;
              findings.push({ kind: "W", code: "claude-refresh-deferred", item: "team-plugin", message: "Installed generation remains in use; prepared a separate verified generation." });
            }
          }
        }
        const selection = readSelection();
        const sourceText = readFileSync(metadataPath, "utf8");
        if (Object.keys(JSON.parse(sourceText)).some(key => !["schema", "assignments", "capabilities", "efforts", "providerId", "plugin", "contentHash"].includes(key)))
          findings.push({ kind: "W", code: "claude-selection-preserved", item: "model-assignments.json", message: "Custom selection metadata is preserved. This launch uses only validated model and capability selections." });
        const location = join(parent, selection.plugin);
        const capabilities = selection.capabilities.filter(id => !config ||
          (id !== "codebase-memory" || getEnabledCapabilityInstructionIds(config, "claude").includes(id)) &&
          (id !== "web-search" || config.webSearch.enabled) &&
          (id !== "rtk" || config.packageInstructions.claude?.rtk === true));
        const available = capabilities.filter(id => {
          try { claudeCapabilityFiles(parent, [id], toolEffects, selection.providerId); return true; }
          catch {
            findings.push({ kind: "W", code: "claude-optional-unavailable", item: id,
              message: `${id} is unavailable for this launch. Saved selections are preserved; ordinary work can continue.` });
            return false;
          }
        });
        // Commands come from the trusted composition, never from an edited installed hook.
        const providerId = available.includes("web-search") ? selection.providerId : undefined;
        const hashFiles = expectedFiles(parent, selection.assignments, available, toolEffects, providerId, selection.efforts);
        const contentHash = hash(JSON.stringify(hashFiles.map(file => [relative(parent, file.path), file.kind, hash(file.content)])));
        const root = join(parent, `prepared-${contentHash}`);
        const files = hashFiles.map(file => ({ ...file, path: join(root, relative(parent, file.path)) }));
        let receipts: ReturnType<typeof readRunnerContributions>;
        try { receipts = readRunnerContributions(join(parent, "manifest.json")); }
        catch { findings.push({ kind: "W", code: "claude-ownership-unknown", item: "manifest.json", message: "Ownership metadata is unavailable. Installed originals are preserved; this launch uses a fresh verified copy." }); }
        const prior = new Map(receipts?.contributions.map(entry => [entry.path, entry.hash]));
        // Only inspect bounded known paths. Unknown extras are preserved and never loaded.
        for (const file of hashFiles) {
          const key = relative(parent, file.path), installed = join(location, key);
          try {
            assertTrustedAncestors(dirname(installed), home);
            const stat = lstatSync(installed);
            if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) throw new Error();
            const bytes = readFileSync(installed, "utf8");
            if (hash(bytes) !== prior.get(installed) && bytes !== file.content)
              findings.push({ kind: "W", code: "claude-content-preserved", item: key, message: `Preserved customized ${key}. This launch uses the bundled copy; no customized hook is executed.` });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") findings.push({ kind: "W", code: "claude-content-preserved", item: key, message: `Preserved unverified ${key}; it is excluded from this launch.` });
          }
        }
        await ensurePrivatePath(parent, home);
        const state = inspect(root, files, home);
        if (state === "conflict") throw new ClaudeSkillsError("prepared-generation-conflict");
        if (state === "absent") {
          const staging = await mkdtemp(join(parent, ".deck-claude-stage-"));
          try {
            for (const file of files) {
              const local = join(staging, relative(root, file.path));
              mkdirSync(dirname(local), { recursive: true, mode: 0o700 });
              writeFileSync(local, file.content, { flag: "wx", mode: 0o600 });
            }
            if (inspect(staging, files.map(file => ({ ...file, path: join(staging, relative(root, file.path)) })), home) !== "ready") throw new ClaudeSkillsError("staged-generation-invalid");
            assertTrustedAncestors(root, home);
            try { await rename(staging, root); }
            catch (error) { if (inspect(root, files, home) !== "ready") throw error; }
            findings.push({ kind: "H", code: "claude-content-refreshed", item: "team-plugin", message: "Prepared current Deck skills and hooks. Existing generations remain intact." });
          } finally { await rm(staging, { recursive: true, force: true }); }
        }
        // A separate immutable selection keeps refresh from invalidating active invocations.
        const selectionText = claudeModelMetadata(selection.assignments, available, providerId, contentHash, selection.efforts);
        const selectionPath = join(parent, `prepared-selection-${hash(selectionText)}.json`);
        if (!existsSync(selectionPath)) {
          const temporary = join(parent, `.prepared-selection-${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, selectionText, { flag: "wx", mode: 0o600 });
            try { await link(temporary, selectionPath); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          } finally { await rm(temporary, { force: true }); }
        }
        if (readFileSync(metadataPath, "utf8") !== sourceText) throw new ClaudeSkillsError("selection-changed-during-refresh");
        const descriptor: NativeSkillsDescriptor = { root, pluginName: SESSION_SKILLS_PLUGIN_NAME,
          selectionPath, selectionHash: hash(selectionText), contentHash,
          sourceSelection: { path: metadataPath, hash: hash(sourceText) }, preparation: findings,
          files: Object.fromEntries(files.map(file => [relative(root, file.path), hash(file.content)])) };
        verifyClaudeSessionSkills(descriptor);
        return descriptor;
      } catch (error) { throw error instanceof ClaudeSkillsError ? error : new ClaudeSkillsError("preparation-boundary"); }
    },
    getSessionDriver: () => createClaudeSessionDriver(options.sessionDriver),
    runnerId: "claude", displayName: "Claude Code", environmentIds: [ENVIRONMENT], packageInstructionIds: ["codebase-memory", "rtk"],
    ui: { environmentLabels: { [ENVIRONMENT]: "Claude Code" }, dashboard: { defaultSelectedTeamIds: ["developer-team"], defaultSelectedCapabilityIds: ["claude-team-files"], extraSelectableCapabilities: [{ id: "context7", label: "Context7", description: "Use a verified shared Context7 MCP binary in the Claude plugin." }], managedLaunchSupported: false, launchHint: "deck claude developer starts a supervised static-compatible session with the verified team plugin. Protected execution remains unsupported.", executionClass: "static-compatible" }, model: { providerSource: "Installed Claude runtime-reported metadata; account entitlement not guaranteed", missingChecks: ["account entitlement", "comparison with authenticated native /model"], remediation: "Retry metadata discovery and check native Claude /model for account-specific availability.", defaultThinkingLevels: [] }, },
    async inspectProject(projectRoot) {
      return { projectRoot, state: "ready", evidence: { interactive: true, exec: false, resume: false, resumeLatest: false }, diagnostics: [] };
    },
    async detectDeckInstall() {
      try {
        const selected = active();
        if (inspect(selected.location, selected.expected, home) !== "ready") {
          assertTrustedAncestors(selected.location, home);
          const marker = join(selected.location, ".claude-plugin/plugin.json");
          if (adapter.readSelectedCapabilityIds?.() !== undefined && existsSync(marker) && lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink() && readFileSync(marker, "utf8") === pluginMarker) return { installed: false, replacementRequired: true, managedPaths: [selected.location, metadataPath], diagnostics: ["Existing dedicated Deck plugin is stale; publish a new generation through the reviewed content plan. Existing content remains preserved."] };
          return { installed: false, managedPaths: [], diagnostics: ["Deck-owned Claude plugin content is missing or conflicts with its current canonical manifest."] };
        }
        return { installed: true, managedPaths: [...selected.expected.map((file) => file.path), ...(existsSync(metadataPath) ? [metadataPath] : [])], diagnostics: ["Verified global Deck-owned Claude plugin; account model availability and protected execution are not implied."] };
      } catch { return { installed: false, managedPaths: [], diagnostics: ["Deck-owned Claude plugin or selection metadata is untrusted."] }; }
    },
    async buildLaunchPlan(input) {
      const diagnostic = (code: string, message: string) => [{ code, severity: "error" as const, message }];
      // Standalone launches retain canonical isolation and verified plugin content.
      if (input.mode !== "interactive" || input.modelId || input.reasoningLevel || input.runnerNative) return { status: "unsupported", code: "claude-team-route-unverified", diagnostics: diagnostic("claude-team-route-unverified", "Only interactive Claude plugin-file sessions are supported; native overrides and exec/resume are unverified.") };
      let prepared: NativeSkillsDescriptor;
      try { prepared = await this.prepareSessionNativeSkills(input.deckConfig); }
      catch (error) { return { status: "blocked", code: "claude-session-skills-unverified", diagnostics: diagnostic("claude-session-skills-unverified", error instanceof Error ? error.message : "Check private Claude paths, then prepare again.") }; }
      const snapshot = JSON.parse(readFileSync(prepared.selectionPath, "utf8"));
      const selected = { ...snapshot, capabilities: snapshot.capabilities ?? [], assignments: snapshot.assignments ?? {}, location: prepared.root };
      if (selected?.capabilities.includes("serena") && !await revalidateSerena()) return { status: "blocked", code: "claude-serena-readiness-stale", diagnostics: diagnostic("claude-serena-readiness-stale", "Deck-owned Serena bootstrap evidence is stale; Claude was not launched.") };
      verifyClaudeSessionSkills(prepared);
      if (selected.capabilities.includes("codebase-memory") && !getEnabledCapabilityInstructionIds(input.deckConfig, "claude").includes("codebase-memory")) return { status: "blocked", code: "claude-codebase-memory-selection-stale", diagnostics: diagnostic("claude-codebase-memory-selection-stale", "Codebase Memory activation changed. Review and publish a verified replacement Claude plugin before reopening; existing generations and independent executables are preserved.") };
      const nativeSearch = inspectClaudeNativeSearch({ projectRoot: input.projectRoot, modelId: selected.assignments["deck-lead"], environment: options.sessionDriver?.baseEnv, flags: options.sessionDriver?.extraArgs }, home);
      if (selected.capabilities.includes("web-search") && !input.deckConfig.webSearch.enabled) return { status: "blocked", code: "claude-web-search-selection-stale", diagnostics: diagnostic("claude-web-search-selection-stale", "Review and publish a replacement Claude generation for the current Web Search selection.") };
      const needsFallback = input.deckConfig.webSearch.enabled && nativeSearch.availability !== "available" && nativeSearch.webAllowed !== false;
      const provider = needsFallback ? options.webSearchProviderResolver?.(input.deckConfig.webSearch.provider) : undefined;
      const token = provider ? (options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim() : undefined;
      let search: ReturnType<typeof resolveWebSearchLaunch>;
      try { search = resolveWebSearchLaunch(input.deckConfig.webSearch.enabled, nativeSearch, !!provider && !!token && !/[\0\r\n]/.test(token)); }
      catch {
        search = { route: "disabled", diagnostics: ["web-search-fallback-unavailable"] };
        prepared.preparation = [...prepared.preparation ?? [], { kind: "W", code: "claude-optional-unavailable", item: "web-search", message: "Search fallback is unavailable. Ordinary work can continue; configure its provider and credential to use it." }];
      }
      const webSearchEnabled = search.route === "fallback";
      if (webSearchEnabled && (!selected.capabilities.includes("web-search") || selected.providerId !== input.deckConfig.webSearch.provider)) return { status: "blocked", code: "claude-web-search-selection-stale", diagnostics: diagnostic("claude-web-search-selection-stale", "Review and reinstall the selected search capability.") };
      const searchArgs = webSearchEnabled && provider ? ["--mcp-config", JSON.stringify({ mcpServers: { [provider.semanticServerId]: { command: provider.command[0], args: provider.command.slice(1) } } })] : [];
      const codebaseDenials = input.codebaseAvailability ? claudeCodebaseDenials({ skills: prepared,
        projectRoot: input.projectRoot, invocationId: input.codebaseInvocationId ?? "", route: "native", overrides: [], availability: input.codebaseAvailability }) : [];
      const attributionArgs = codebaseDenials.length ? ["--settings", JSON.stringify({ attribution: { commit: "", pr: "" }, deniedMcpServers: codebaseDenials.map(serverName => ({ serverName })) })] : CLAUDE_ATTRIBUTION_SETTINGS_ARGS;
      const envOverlay = { ...(webSearchEnabled && token ? { TAVILY_API_KEY: { value: token, sensitive: true } } : {}) };
      const sensitiveKeys = [...(webSearchEnabled && token ? ["TAVILY_API_KEY"] : [])];
      return { status: "ready", plan: { generationReference: { root: selected.location, selectionPath: prepared.selectionPath, selectionHash: prepared.selectionHash }, command: "claude", args: [...attributionArgs, ...searchArgs, "--setting-sources", claudeProjectConfigTrusted(home, input.projectRoot, options.sessionDriver?.baseEnv ?? process.env) ? "user,project,local" : "user", "--plugin-dir", selected.location, "--agent", "deck-developer-team:deck-lead"], cwd: input.projectRoot, stdio: "inherit", stdin: "inherit", executionClass: "static-compatible", ...(sensitiveKeys.length ? { envOverlay, sensitiveEnvAuthorization: { binding: "deck-claude-web-search-v1", keys: sensitiveKeys } } : {}) }, diagnostics: [...(prepared.preparation ?? []).map(finding => ({ code: finding.code, severity: "warning" as const, message: finding.message })), ...(input.deckConfig.webSearch.enabled && nativeSearch.availability === "unknown" ? [{ code: "native-search-detection-defect", severity: "warning" as const, message: "Native search availability is unknown; the configured fallback is selected and may duplicate an existing search tool." }, { code: "native-search-possible-duplicate", severity: "warning" as const, message: "Review the effective Claude provider/model/tool configuration; existing user search tools are preserved." }] : []), { code: "claude-static-compatible", severity: "warning", message: "Deck supplies the verified team plugin with --plugin-dir. Protected execution remains unsupported." }] };
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
      let selected: ReturnType<typeof active> | undefined;
      try { selected = active(); } catch { /* untrusted metadata */ }
      const checks = (["codebase-memory", "rtk", "context7", "web-search"] as const).map((id) => {
        if (id === "codebase-memory" && !getEnabledCapabilityInstructionIds(input.deckConfig, "claude").includes("codebase-memory")) return { capabilityId: id, label: "Codebase Memory", description: "Disabled until explicit activation", section: "runner-capabilities", requirementLevel: "optional" as const, installKind: "runner-native" as const, supportStatus: "runner-specific" as const, isInstalled: false, isBlocked: false, diagnostics: [] };
        let executableReady = true;
        try { claudeCapabilityFiles(parent, [id], toolEffects, id === "web-search" ? input.deckConfig.webSearch.provider : undefined); }
        catch { executableReady = false; }
        const materialized = executableReady && selected?.capabilities.includes(id) === true && inspect(selected.location, selected.expected, home) === "ready";
        let rtkHookReady = true;
        if (id === "rtk") { try { verifyClaudeRtkHookRuntime(toolEffects); } catch { rtkHookReady = false; } }
        const installable = id === "context7" || id === "web-search" || id === "rtk" && rtkHookReady && Boolean(rtkRelease) || id === "codebase-memory" && (Boolean(existingCodebase()) || Boolean(codebaseRelease));
        return { capabilityId: id, label: id, description: `${id} uses the Deck-owned global Claude plugin; readiness requires the selected tool executable and verified native config.`, section: "runner-capabilities", requirementLevel: "optional" as const, installKind: "runner-native" as const, source: "deck-owned-plugin-dir", supportStatus: executableReady || installable ? "runner-specific" as const : "blocked" as const, isInstalled: materialized, isBlocked: !executableReady && !installable, diagnostics: executableReady ? [] : [installable ? `${id} must be installed through the reviewed Deck tool action.` : `${id} executable or provider bootstrap is unavailable.`] };
      });
      const provider = options.webSearchProviderResolver?.(input.deckConfig.webSearch.provider);
      const webSearchIndex = checks.findIndex((entry) => entry.capabilityId === "web-search");
      const searchEntry = checks[webSearchIndex]!;
      const credentialAvailable = Boolean((options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim());
      const readiness = resolveWebSearchReadiness({ nativeSearch: inspectClaudeNativeSearch({ projectRoot: input.projectRoot, environment: options.sessionDriver?.baseEnv, flags: options.sessionDriver?.extraArgs }, home), enabled: input.deckConfig.webSearch.enabled, runnerSupported: searchEntry.supportStatus === "runner-specific", providerConfigured: provider?.providerId === "tavily", credentialAvailable, executableAvailable: searchEntry.diagnostics.length === 0, mcpConfigured: searchEntry.isInstalled });
      return { runnerId: "claude", environmentId: ENVIRONMENT, capabilities: [capability(), unsupported("protected-execution", "Protected execution"), ...checks.map((entry) => entry.capabilityId === "web-search" ? { ...entry, webSearchProvider: provider, webSearchReadiness: readiness, webSearchEvidence: { enabled: input.deckConfig.webSearch.enabled, runnerSupported: entry.supportStatus === "runner-specific", providerConfigured: provider?.providerId === "tavily", credentialAvailable, executableAvailable: entry.supportStatus === "runner-specific", mcpConfigured: entry.isInstalled } } : entry)] };
    },
    buildReviewPlan(state) {
      const selectedCapabilities = [...new Set([
        // Dashboard-level ids (codebase-memory-mcp alias) are reviewed elsewhere, not plugin capabilities.
        ...Object.entries(state.selectedCapabilities).filter(([id, selected]) => selected && (CLAUDE_CAPABILITY_IDS as readonly string[]).includes(id) && !["codebase-memory", "rtk"].includes(id)).map(([id]) => id),
        ...Object.entries(state.packageInstructions).filter(([id, enabled]) => enabled && ["context-mode", "codebase-memory", "rtk", "serena"].includes(id)).map(([id]) => id),
      ])];
      const blockedReasons: string[] = [];
      let selectionFailure = "Claude selection metadata or native capability verification failed. Re-select capabilities and models, then retry.";
      const rejectSelection = (reason: string): never => { selectionFailure = reason; throw new Error("Claude review selection blocked."); };
      let selected: (ReturnType<typeof active> & { installableMissing?: readonly ("context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena")[] }) | undefined;
      let changingModels = false;
      try {
        const current = readSelection();
        const team = (state as typeof state & { teams?: Record<string, { modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string> }> }).teams?.["developer-team"];
        const assignments = team?.modelAssignments === undefined ? current.assignments : normalizeClaudeAssignments(team.modelAssignments);
        const efforts = normalizeClaudeEfforts(team?.thinkingAssignments ?? current.efforts ?? {});
        if (Object.entries(assignments).some(([role, model]) => current.assignments[role] !== model && !modelAvailable(model))) rejectSelection("Claude model discovery is not ready. Retry after correcting this selection.");
        if (Object.entries(efforts).some(([role, level]) => (current.efforts?.[role] !== level || current.assignments[role] !== assignments[role]) && !adapter.getThinkingLevels(assignments[role]).includes(level))) rejectSelection("Claude effort discovery is not ready. Retry after correcting this selection.");
        const capabilities = normalizeClaudeCapabilities(selectedCapabilities);
        const providerId = capabilities.includes("web-search") ? state.webSearchProvider : undefined;
        const projectRoot = (state as typeof state & { runtime?: { projectRoot?: string } }).runtime?.projectRoot ?? process.cwd();
        const nativeSearch = capabilities.includes("web-search") ? inspectClaudeNativeSearch({ projectRoot, modelId: assignments["deck-lead"], environment: options.sessionDriver?.baseEnv, flags: options.sessionDriver?.extraArgs }, home) : undefined;
        const fallbackRequired = nativeSearch !== undefined && nativeSearch.availability !== "available" && nativeSearch.webAllowed !== false;
        if (fallbackRequired && (providerId !== "tavily" || !(options.webSearchCredential?.() ?? process.env.TAVILY_API_KEY)?.trim() || options.webSearchProviderResolver?.(providerId)?.command.join("\0") !== "npx\0-y\0tavily-mcp@0.2.22")) rejectSelection("Claude Web Search provider or shared credential is not ready. Retry after correcting this selection.");
        const installableMissing = capabilities.filter((id): id is "context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena" => {
          if (id === "web-search" && !fallbackRequired) return false;
          if (id === "serena") {
            if (serenaEvidence) return false;
            if (!options.serenaProxyCommand || state.explicitlySelectedCapabilities?.serena !== true) rejectSelection("Serena requires current-operation TUI authorization and a verified Deck proxy. Retry after correcting this selection.");
            return true;
          }
          if (id !== "context-mode" && id !== "context7" && id !== "codebase-memory" && id !== "web-search" && id !== "rtk") return false;
          if (id === "rtk" && !rtkRelease) rejectSelection("RTK pinned release is unavailable or conflicts with owned content. Retry after correcting this selection.");
          if (id === "rtk") verifyClaudeRtkHookRuntime(toolEffects);
          if (id === "codebase-memory" && !existingCodebase() && !codebaseRelease) rejectSelection("Codebase Memory pinned native release is unavailable or conflicts with owned content. Retry after correcting this selection.");
          try { verifyClaudeExecutable(id === "context7" ? "context7-mcp" : id === "codebase-memory" ? "codebase-memory-mcp" : id === "web-search" ? "tavily-mcp" : id === "rtk" ? "rtk" : "context-mode", toolEffects); return false; }
          catch { return true; }
        });
        // Every other selected capability must already have a verified native command.
        for (const id of capabilities.filter((id) => !installableMissing.includes(id as "context-mode" | "context7" | "codebase-memory" | "web-search" | "rtk" | "serena"))) claudeCapabilityFiles(parent, [id], toolEffects, id === "web-search" ? providerId : undefined);
        const desired = installableMissing.length === 0 ? materialization(assignments, capabilities, providerId, current, efforts) : undefined;
        selected = { assignments, capabilities, ...(providerId ? { providerId } : {}), ...(Object.keys(efforts).length ? { efforts } : {}), plugin: desired?.plugin ?? claudePluginName(assignments, capabilities), ...(desired?.contentHash ? { contentHash: desired.contentHash } : {}), location: desired?.location ?? join(parent, claudePluginName(assignments, capabilities)), expected: desired?.files ?? [], installableMissing };
        changingModels = JSON.stringify(assignments) !== JSON.stringify(current.assignments) || JSON.stringify(capabilities) !== JSON.stringify(current.capabilities);
      } catch (error) {
        // Unclassified local failures keep the generic guidance plus a bounded cause for diagnosis.
        const cause = selectionFailure.startsWith("Claude selection metadata") && error instanceof Error ? error.message.replace(/[\r\n]+/g, " ").slice(0, 200) : "";
        blockedReasons.push(cause ? `${selectionFailure} Cause: ${cause}` : selectionFailure);
      }
      const stateAtReview = selected ? selected.installableMissing?.length ? "absent" : inspect(selected.location, selected.expected, home) : "conflict";
      if (selected && stateAtReview === "conflict" && !repairable(selected.location, selected.expected, home)) blockedReasons.push("The global Claude team plugin files or their parent directories conflict with the reviewed content or private ownership requirements. Review the Deck-owned plugin path before retrying.");
      const blocked = blockedReasons.length > 0;
      const pendingInstalls = selected?.installableMissing ?? [];
      const installs = [
        ...pendingInstalls.map((id) => ({ id: `claude.tool.${id}.install`, kind: id === "rtk" ? "install-claude-rtk" : id === "codebase-memory" ? "install-claude-codebase" : id === "serena" ? "install-serena" : "install-claude-tool", title: `Install and verify ${id} in Deck-owned shared tools`, capabilityId: id, status: "ready" as const, required: true })),
      ];
      const preview = `${stateAtReview === "ready" ? "Verify existing" : `Create ${selected?.expected.length || 15} owner-only files in`} ${selected?.location ?? parent}; ${pendingInstalls.length ? `Install ${pendingInstalls.join(", ")} before materialization; ` : ""}${changingModels ? "Update Deck-owned model selection; " : ""}ownership=${owner}. Deck does not write project or Claude settings; ${warning}`;
      return { groups: { automaticInstalls: installs, manualSteps: [], configWrites: [], teamApplications: state.runnerId === "claude" ? [{ id: "claude.team.install", kind: "apply-team-bundle", title: "Install global Claude Developer Team plugin files", status: blocked ? "blocked" as const : "ready" as const, required: true, description: preview, dependencies: installs.map((install) => install.id) }] : [], validations: state.runnerId === "claude" ? [] : [] }, diagnostics: [{ code: blocked ? "claude-team-install-blocked" : "claude-files-only", severity: blocked ? "error" as const : "warning" as const, message: blocked ? blockedReasons.join(" ") : preview }], ready: !blocked };
    },
    buildInstallationPlan() { return { steps: [{ action: "install", tool: "Claude global Developer Team plugin files" }] }; },
    async runAction(action, context) {
      if (["serena", "context-mode"].includes(action.capabilityId ?? "")) return { actionId: action.id, status: "skipped", message: "Retired capability is disabled.", diagnostics: [] };
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
      if (action.kind === "install-claude-rtk" && action.capabilityId === "rtk") {
        if (!rtkRelease) return { actionId: action.id, status: "failed", message: "No pinned RTK artifact exists for this platform.", diagnostics: [] };
        try {
          await ensurePrivatePath(dirname(ownedRtkRoot), home);
          const result = await installOwnedClaudeRtk(ownedRtkRoot, rtkRelease, options.rtkArtifactEffects);
          if (ownedRtkState() !== "ready") throw new Error("RTK verification failed.");
          recordOwnedRunnerArtifactTree({ runnerId: "claude", root: parent, manifestPath: join(parent, "manifest.json"), artifactRoot: ownedRtkRoot, sourceItemId: "package:rtk" });
          return { actionId: action.id, status: "executed", message: result === "installed" ? "Pinned Claude-safe RTK installed and verified without global init." : "Pinned Claude-safe RTK verified without changes.", diagnostics: [] };
        } catch { return { actionId: action.id, status: "failed", message: "Pinned RTK installation failed; Claude hook was not materialized.", diagnostics: [] }; }
      }
      if (action.kind === "install-claude-codebase" && action.capabilityId === "codebase-memory") {
        if (!codebaseRelease) return { actionId: action.id, status: "failed", message: "No pinned Codebase Memory native release exists for this platform.", diagnostics: [] };
        try {
          await ensurePrivatePath(dirname(ownedCodebaseRoot), home);
          const outcome = await installOwnedClaudeCodebase(ownedCodebaseRoot, codebaseRelease, options.codebaseArtifactEffects);
          if (ownedCodebaseState() !== "ready") throw new Error("Codebase Memory native verification failed.");
          recordOwnedRunnerArtifactTree({ runnerId: "claude", root: parent, manifestPath: join(parent, "manifest.json"), artifactRoot: ownedCodebaseRoot, sourceItemId: "package:codebase-memory" });
          return { actionId: action.id, status: "executed", message: outcome === "installed" ? "Pinned Codebase Memory native executable installed and verified; no session download is needed." : "Pinned Codebase Memory native executable verified without changes.", diagnostics: [] };
        } catch { return { actionId: action.id, status: "failed", message: "Pinned Codebase Memory native install failed; no npm shim was configured.", diagnostics: [] }; }
      }
      const id = action.capabilityId;
      if (action.kind !== "install-claude-tool" || id !== "context-mode" && id !== "context7" && id !== "web-search") return { actionId: action.id, status: "failed", message: "Claude tool install action is unsupported.", diagnostics: [warning] };
      const command = id === "context7" ? "context7-mcp" : id === "web-search" ? "tavily-mcp" : "context-mode";
      try { verifyClaudeExecutable(command, toolEffects); return { actionId: action.id, status: "executed", message: `${id} is already available.`, diagnostics: [] }; }
      catch { /* reviewed install effect follows */ }
      if (!await installSharedTool(id)) return { actionId: action.id, status: "failed", message: `${id} installation failed or executable was not verified.`, diagnostics: [] };
      try {
        verifyClaudeExecutable(command, toolEffects);
        // Production npm publication includes receipt accounting inside its mutation
        // lease and rollback boundary. Only the privileged host override needs it here.
        if (options.installSharedTool) recordOwnedRunnerArtifactTree({ runnerId: "claude", root: parent, manifestPath: join(parent, "manifest.json"), artifactRoot: join(toolRoot, "node_modules"), sourceItemId: `package:${id}` });
        return { actionId: action.id, status: "executed", message: `${id} was installed and verified.`, diagnostics: [] };
      }
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
    readPreparationCapabilities(config): import("../../core/src/session/preparation").PreparationMember["capabilities"] {
      const evidence = preparationEvidence;
      let selection: ReturnType<typeof readSelection>;
      try { selection = readSelection(); } catch { return {}; }
      const root = join(parent, selection.plugin);
      return {
        rtk: evidence.observe(config.packageInstructions.claude?.rtk === true, () => {
          if (!selection.capabilities.includes("rtk")) throw new Error("hook-missing");
          const hooks = evidence.read(join(root, "hooks/hooks.json"));
          if (!JSON.parse(hooks).hooks?.PreToolUse?.some((group: any) => group.hooks?.some((hook: any) => hook.command?.includes("/hooks/rtk-hook.cjs")))) throw new Error("hook-missing");
          const script = evidence.read(join(root, "hooks/rtk-hook.cjs"));
          return [hooks, script, evidence.executable(pinnedHookExecutable(script)), evidence.executable(options.rtkHookRuntimeCommand ?? "node")];
        }),
        context7: evidence.observe(selection.capabilities.includes("context7"), () => {
          const entry = JSON.parse(evidence.read(join(root, ".mcp.json"))).mcpServers?.context7;
          return [entry?.args ?? [], evidence.executable(entry?.command)];
        }),
      };
    },
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
    async readSessionCapabilityOverrides(config) {
      const selection = readSelection(); // Reject corrupt metadata, even when no ordinary package is selected.
      if (!existsSync(metadataPath)) return {};
      if (adapter.readSelectedCapabilityIds?.() === undefined) throw new Error("Claude session MCP selection is untrusted.");
      const ids = selection.capabilities.filter((id) => id === "codebase-memory" && config && getEnabledCapabilityInstructionIds(config, "claude").includes("codebase-memory"));
      // Cross sessions verify the reviewed native pin during managed readiness.
      // Static plugin installs retain their shared-daemon command preference.
      const sessionEffects: ClaudeCapabilityOptions = {
        ...toolEffects,
        resolveCommand: (name) => name === "codebase-memory-mcp" && ownedCodebaseState() === "ready"
          ? join(ownedCodebaseRoot, "codebase-memory-mcp")
          : toolEffects.resolveCommand?.(name),
      };
      const codebaseCommand = ids.includes("codebase-memory") ? sessionEffects.resolveCommand?.("codebase-memory-mcp") : undefined;
      if (ids.includes("codebase-memory") && !codebaseCommand && ["conflict", "unusable"].includes(ownedCodebaseState())) throw new Error("codebase-memory-integrity-failed");
      // Missing optional tooling reaches managed readiness without weakening metadata or other packages.
      const file = claudeCapabilityFiles(parent, ids.filter(id => id !== "codebase-memory"), sessionEffects).find((file) => file.path.endsWith("/.mcp.json"));
      const servers = file ? (JSON.parse(file.content) as { mcpServers: Record<string, { command: string; args?: string[] }> }).mcpServers : {};
      if (ids.includes("codebase-memory")) servers["codebase-memory"] = { command: codebaseCommand ?? join(home, ".local", "bin", "codebase-memory-mcp") };
      return Object.fromEntries(Object.entries(servers).map(([id, server]) => [id, { command: server.command, args: server.args ?? [], env: {} }]));
    },
    getThinkingLevels(modelId) { return modelSnapshot?.inventory.modelsByProvider.claude?.find((model) => model.id === modelId)?.variants ?? []; }, supportsThinking(modelId) { return adapter.getThinkingLevels(modelId).length > 0; },
    async prepareDeveloperTeamInstall() { return []; },
    buildDeveloperTeamInstallPlan: plan,
    async applyDeveloperTeamInstall(input) {
      return withInstallationMutation(parent, async () => {
      const candidate = input.plan as RunnerDeveloperTeamInstallPlan & { modelAssignments?: Record<string, string>; thinkingAssignments?: Record<string, string>; capabilityIds?: string[]; providerId?: string; pluginName?: string; contentHash?: string };
      const assignments = normalizeClaudeAssignments(candidate.modelAssignments ?? readAssignments());
      const efforts = normalizeClaudeEfforts(candidate.thinkingAssignments ?? readSelection().efforts ?? {});
      const previousSelection = readSelection();
      const changedAgentIds = [...new Set([...Object.keys(assignments), ...Object.keys(efforts)])].filter((role) => assignments[role] !== previousSelection.assignments[role] || efforts[role] !== previousSelection.efforts?.[role]);
      if (changedAgentIds.length && !(await adapter.validateModelAssignments!({ projectRoot: input.projectRoot, modelAssignments: { ...assignments }, thinkingAssignments: { ...efforts }, changedAgentIds })).valid) throw new Error("Claude runtime model selection changed or is unavailable; plugin was not modified.");
      const capabilities = normalizeClaudeCapabilities(candidate.capabilityIds ?? readSelection().capabilities);
      if (capabilities.includes("serena") && !await revalidateSerena()) throw new Error("Claude Serena readiness is stale; plugin was not modified.");
      const providerId = capabilities.includes("web-search") ? candidate.providerId : undefined;
      const expected = plan({ projectRoot: input.projectRoot, environmentId: input.environmentId, modelAssignments: { ...assignments }, thinkingAssignments: { ...efforts }, capabilityIds: ["claude-team-files", ...capabilities], deckConfig: { capabilities: { "codebase-memory": { enabled: capabilities.includes("codebase-memory"), runners: {} } }, webSearch: { enabled: providerId === "tavily", provider: providerId } } as Parameters<typeof plan>[0]["deckConfig"] });
      if (expected.blocked) throw new Error("Claude global plugin plan is blocked or stale.");
      const desired = expected as typeof candidate;
      const selectedRoot = join(parent, desired.pluginName!);
      const canonical = expectedFiles(selectedRoot, assignments, capabilities, toolEffects, providerId, efforts);
      if (candidate.pluginName !== desired.pluginName || candidate.contentHash !== desired.contentHash || !matchesCanonicalFiles(input.plan, canonical)) throw new Error("Claude global plugin plan is stale or untrusted.");
      const existing = inspect(selectedRoot, canonical, home);
      const pendingPath = join(parent, "manifest.json.pending");
      const expectedByPath = new Map(canonical.map(file => [file.path, file.content]));
      const safePartial = (path: string): boolean => {
        try {
          const stat = lstatSync(path);
          if (stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) return false;
          if (stat.isDirectory()) return (stat.mode & 0o077) === 0 && readdirSync(path).every(name => safePartial(join(path, name)));
          return stat.isFile() && (stat.mode & 0o077) === 0 && expectedByPath.has(path) && readFileSync(path, "utf8") === expectedByPath.get(path);
        } catch { return false; }
      };
      const resumePublication = existing === "conflict" && (existsSync(pendingPath) && safePartial(selectedRoot) || ownedPartialPublication(selectedRoot, canonical));
      const repairPublication = existing === "conflict" && repairable(selectedRoot, canonical, home);
      if (existing === "conflict" && !resumePublication && !repairPublication) throw new Error("Claude plugin destination contains unsafe or unknown paths.");
      const legacySelection = { assignments, capabilities, ...(providerId ? { providerId } : {}), plugin: desired.pluginName!, ...(desired.contentHash ? { contentHash: desired.contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
      precheckClaudeContributionRecovery(parent, '0.14.0', [...canonical, { path: metadataPath, content: selectionBytes(legacySelection, existsSync(metadataPath) ? readFileSync(metadataPath, 'utf8') : undefined) }]);
      await ensurePrivatePath(parent, home);
      const preimages = new Map(canonical.map(file => [file.path, existsSync(file.path) ? readFileSync(file.path, "utf8") : undefined]));
      const contributionManifestPath = join(parent, "manifest.json");
      assertNoContributionSymlink(contributionManifestPath);
      const manifestBefore = existsSync(contributionManifestPath) ? readFileSync(contributionManifestPath, "utf8") : undefined;
      if (manifestBefore !== undefined) {
        let declared: { deckVersion?: string } | undefined;
        try { declared = JSON.parse(manifestBefore); } catch { /* Handled below as ordinary corrupt metadata. */ }
        if (typeof declared?.deckVersion === 'string' && compareReleaseVersions(declared.deckVersion, '0.14.0') > 0) throw new Error('managed-by-newer-deck');
      }
      const nextSelection = { assignments, capabilities, ...(providerId ? { providerId } : {}), plugin: desired.pluginName!, ...(desired.contentHash ? { contentHash: desired.contentHash } : {}), ...(Object.keys(efforts).length ? { efforts } : {}) };
      const selectionBefore = existsSync(metadataPath) ? readFileSync(metadataPath, "utf8") : undefined;
      const nextSelectionBytes = selectionBytes(nextSelection, selectionBefore);
      const replaced: { path: string; before: string | undefined; after: string }[] = [];
      let accounting: ReturnType<typeof beginRunnerContributions> | undefined;
      const operationId = randomUUID();
      try {
      recordRunnerMutationJournals([{ operationId, id: 'global', kind: 'deck-scope-v1' }, { operationId, id: operationId, kind: "claude-contributions" }]);
      try { readRunnerContributions(contributionManifestPath); }
      catch (error) {
        let newer = false;
        try {
          const raw = JSON.parse(manifestBefore!);
          const version = typeof raw.schema === 'string' ? /^deck-runner-contributions-v(\d+)$/.exec(raw.schema) : undefined;
          newer = !!version && Number(version[1]) > 1 || typeof raw.deckVersion === 'string' && compareReleaseVersions(raw.deckVersion, '0.14.0') > 0;
        } catch { /* Invalid ordinary receipt metadata is recoverable only through regeneration. */ }
        if (newer || existsSync(pendingPath)) throw error;
        backupManagedPreimages({ stateRoot: join(parent, 'backups'), runnerId: 'claude', root: parent,
          entries: [{ target: { path: contributionManifestPath, selector: { kind: 'file' } }, content: manifestBefore }] });
        const empty = JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'claude', root: parent, deckVersion: '0.14.0', contributions: [] });
        const temporary = join(parent, `.manifest-repair-${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, empty, { flag: 'wx', mode: 0o600 });
          assertNoContributionSymlink(contributionManifestPath);
          if (readFileSync(contributionManifestPath, 'utf8') !== manifestBefore) throw new Error('Claude ownership metadata changed during repair.');
          const account = input.beforeMetadataWrite?.(contributionManifestPath, hash(empty));
          await rename(temporary, contributionManifestPath);
          replaced.push({ path: contributionManifestPath, before: manifestBefore, after: empty });
          account?.();
        } finally { await rm(temporary, { force: true }); }
      }
      accounting = beginRunnerContributions({ operationId, runnerId: "claude", root: parent, manifestPath: contributionManifestPath,
        deckVersion: "0.14.0", dedicatedRoots: [parent],
        managed: { stateRoot: join(parent, "backups"), inventory: { runnerId: "claude", root: parent, generatedRoots: [selectedRoot],
          slots: [{ path: metadataPath, selector: { kind: "file" as const }, authority: "generated" as const }] } }, beforeMetadataWrite: input.beforeMetadataWrite, targets: [...canonical.map(file => ({ path: file.path, selector: { kind: "file" as const }, expectedHash: hash(file.content) })), { path: metadataPath, selector: { kind: "file" as const }, expectedHash: hash(nextSelectionBytes) }] });
      if (existing === "absent" || resumePublication || repairPublication) {
        const staging = await mkdtemp(join(parent, ".deck-claude-stage-"));
        try {
          for (const file of canonical) {
            const local = join(staging, relative(selectedRoot, file.path));
            await mkdir(dirname(local), { recursive: true, mode: 0o700 });
            await writeFile(local, file.content, { flag: "wx", mode: 0o600 });
          }
          if (inspect(staging, canonical.map((file) => ({ ...file, path: join(staging, relative(selectedRoot, file.path)) })), home) !== "ready") throw new Error("Claude plugin staging verification failed.");
          if (!resumePublication && !repairPublication && inspect(selectedRoot, canonical, home) !== "absent") throw new Error("Claude plugin destination appeared during staging.");
          if (!resumePublication && !repairPublication) await mkdir(selectedRoot, { mode: 0o700 }); // exclusive, never replace an unrelated plugin
          for (const file of canonical) {
            const local = join(selectedRoot, relative(selectedRoot, file.path));
            await mkdir(dirname(local), { recursive: true, mode: 0o700 });
            if (repairPublication && existsSync(local)) {
              assertTrustedAncestors(dirname(local), home);
              const stat = lstatSync(local);
              if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Claude generated path changed during publication.");
              const previous = preimages.get(local);
              if (readFileSync(local, "utf8") !== previous) throw new Error("Claude generated preimage changed during publication.");
              if (previous !== file.content) {
                const temporary = join(dirname(local), `.deck-repair-${randomUUID()}.tmp`);
                try {
                  await writeFile(temporary, file.content, { flag: "wx", mode: 0o600 });
                  if (readFileSync(local, "utf8") !== previous) throw new Error("Claude generated preimage changed during publication.");
                  await rename(temporary, local);
                  replaced.push({ path: local, before: previous, after: file.content });
                } finally { await rm(temporary, { force: true }); }
              }
            } else if (resumePublication && existsSync(local)) {
              if (lstatSync(local).isSymbolicLink() || readFileSync(local, "utf8") !== file.content) throw new Error("Claude partial publication changed; preserved for review.");
            } else {
              await writeFile(local, file.content, { flag: "wx", mode: 0o600 });
              replaced.push({ path: local, before: undefined, after: file.content });
            }
          }
        } finally {
          if (await realpath(staging).catch(() => undefined) === staging) await rm(staging, { recursive: true, force: true });
        }
      }
      if (inspect(selectedRoot, canonical, home) !== "ready") throw new Error("Claude plugin publication is indeterminate; inspect global Deck plugin manually.");
      await writeActive(nextSelectionBytes, selectionBefore);
      if (selectionBefore !== nextSelectionBytes) replaced.push({ path: metadataPath, before: selectionBefore, after: nextSelectionBytes }); // select only fully verified immutable content
      if (JSON.stringify(readSelection()) !== JSON.stringify(nextSelection)) throw new Error("Claude plugin selection is indeterminate; inspect global Deck metadata manually.");
      const contributions = accounting.commit();
      return { contributions, contributionManifestPath, results: canonical.map((file) => ({ agentId: file.path, kind: file.kind, status: existing === "ready" ? "unchanged" : "created" })), changedCount: existing === "ready" ? 0 : canonical.length, unchangedCount: existing === "ready" ? canonical.length : 0 };
      } catch (error) {
        try {
          // Only restore this invocation's effects while their exact postimages remain.
          // An external edit or unsafe path preserves the journal and private backups.
          for (const entry of replaced.reverse()) {
            assertTrustedAncestors(dirname(entry.path), home);
            assertNoContributionSymlink(entry.path);
            const stat = lstatSync(entry.path);
            if (!stat.isFile() || (stat.mode & 0o077) !== 0 || readFileSync(entry.path, "utf8") !== entry.after) throw new Error("Claude rollback conflict; changed output preserved.");
            if (entry.before === undefined) await rm(entry.path);
            else {
              const temporary = join(dirname(entry.path), `.deck-rollback-${randomUUID()}.tmp`);
              try {
                await writeFile(temporary, entry.before, { flag: "wx", mode: 0o600 });
                assertNoContributionSymlink(entry.path);
                if (readFileSync(entry.path, "utf8") !== entry.after) throw new Error("Claude rollback conflict; changed output preserved.");
                await rename(temporary, entry.path);
              } finally { await rm(temporary, { force: true }); }
            }
          }
          assertNoContributionSymlink(contributionManifestPath);
          if (manifestBefore === undefined ? existsSync(contributionManifestPath) : readFileSync(contributionManifestPath, "utf8") !== manifestBefore) throw new Error("Claude rollback manifest changed; recovery evidence retained.");
          accounting?.abort(); // Independently verifies every captured preimage before clearing evidence.
          const captured = new Map([...preimages, [metadataPath, selectionBefore], [contributionManifestPath, manifestBefore]]);
          const prove = () => {
            try {
              if (existsSync(pendingPath)) return false;
              for (const [path, before] of captured) {
                assertTrustedAncestors(dirname(path), home);
                assertNoContributionSymlink(path);
                if (before === undefined ? existsSync(path) : !existsSync(path) || readFileSync(path, "utf8") !== before) return false;
              }
              return true;
            } catch { return false; }
          };
          if (prove()) {
            if (rollbackProofs.size >= 16) rollbackProofs.delete(rollbackProofs.keys().next().value!);
            rollbackProofs.set(operationId, prove);
          }
        } catch { accounting?.abandon(); }
        throw error;
      }
      });
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
        const admission = await adapter.evaluateSessionAdmission!();
        return { admission, valid: admission.verdict !== "blocked" && validName && matchesCanonicalFiles(candidate, canonical) && JSON.stringify(readSelection()) === JSON.stringify(selection) && inspect(selectedRoot, canonical, home) === "ready", diagnostics: [warning, ...admission.checks.filter(c=>c.status === "fail").map(c=>`installed-not-launchable: ${c.id} (${c.remediation})`)] };
      } catch { return { valid: false, diagnostics: ["Claude model metadata or plugin verification failed."] }; }
    },
    resolveThinking() { return undefined; }, getDefaultThinking() { return "off"; },
    getCapability(id) { return [capability(), unsupported("protected-execution", "Protected execution")].find((entry) => entry.capabilityId === id); },
    getCapabilityIds() { return ["claude-team-files", ...CLAUDE_CAPABILITY_IDS]; }, getSelectableTools() { return []; },
  };
  return adapter;
}
