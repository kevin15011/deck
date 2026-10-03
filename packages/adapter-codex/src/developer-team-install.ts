import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import executionHookAssetPath from "../assets/codex/hooks/developer-team-execution.generated.js" with { type: "file" };

import {
  DEVELOPER_TEAM,
  buildDeveloperTeamManifest,
  composeCapabilityInstructions,
  getBootstrapSkillFiles,
  type CapabilityInstructionBundle,
  type DeveloperTeamModelAssignments,
  type DeveloperTeamThinkingAssignments,
  type RunnerDiagnostic,
  type WebSearchProviderDescriptorV1,
  parseSkillDescriptor,
} from "@deck/core";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";

import { CODEX_MEMORY_BRIDGE_HOOK_BLOCK, codexHooksFeatureDisabled, mergeCodexOwnedHooks, mergeCodexProjectConfig, type CodexOwnedHookBlock } from "./codex-config";
import { rtkHookScript } from "@deck/core";
import { translateCodexCapabilityInstructions, validateCodexInstructionTranslation } from "./instruction-translation";
import { buildCodexMcpServers, inspectCodexSupermemoryMcpState, mergeCodexMcpServers } from "./mcp-config";
import type { CodexExpectedFile, CodexMutation, CodexMutationPlan, CodexOwnershipReleaseCheck } from "./types";

const OWNED_MARKER = "deck-codex-v1";
const AGENTS_START = "<!-- deck:developer-team:start -->";
const AGENTS_END = "<!-- deck:developer-team:end -->";
const AGENTS_OWNERSHIP_RELEASE = "AGENTS.md";

export type BuildCodexInstallPlanInput = {
  projectRoot: string;
  existingFiles: ReadonlyMap<string, string>;
  existingModes?: ReadonlyMap<string, number>;
  agentsFile?:
    | { state: "absent" }
    | { state: "file"; content: string; mode: number }
    | { state: "unsafe"; reason: string };
  modelAssignments?: DeveloperTeamModelAssignments;
  thinkingAssignments?: DeveloperTeamThinkingAssignments;
  capabilityInstructions?: CapabilityInstructionBundle;
  memoryProvider?: "none" | "supermemory";
  supermemoryProjectScope?: string;
  mcpCapabilityIds?: readonly string[];
  /** Full materialization may change runner config; content-only refreshes Deck content only. */
  materializationScope?: "full" | "content-only";
  /** A fresh Core probe confirmed the Deck-owned Serena launcher. */
  serenaLauncherAvailable?: boolean;
  /** The effective `deck` executable has confirmed portable Serena proxy support. */
  serenaProxyAvailable?: boolean;
  serenaProxyCommand?: readonly string[];
  /** Self-referencing `<deck> internal memory-mcp` command; written only with the Supermemory provider. */
  deckMemoryCommand?: readonly string[];
  webSearchProviderSupported?: boolean;
  webSearchProviderConfigured?: boolean;
  webSearchProvider?: WebSearchProviderDescriptorV1;
  webSearchCredentialAvailable?: boolean;
  webSearchExecutableAvailable?: boolean;
  webSearchCommand?: string;
  /** Absolute Codex home the virtual `.codex/**` paths map to; defaults to `<projectRoot>/.codex`. */
  codexHome?: string;
  /** Resolved executable paths already registered by foreign (non-Deck) MCP servers; Deck does not add a duplicate server for them. */
  foreignMcpCommands?: ReadonlyMap<string, string>;
  /** Absolute, verified executables written into MCP tables; bare PATH names are never persisted. */
  contextModeCommand?: string;
  codebaseMemoryCommand?: string;
  /** Present only when the owned pinned RTK binary and a Node.js runtime are verified. */
  rtkHook?: { nodeCommand: string; rtkBinary: string };
  /** Present only when the pinned official Codex Supermemory hook artifact is verified. */
  supermemoryHooks?: { nodeCommand: string; recallScript: string; flushScript: string };
  confirmedModels?: readonly string[];
  confirmedReasoningByModel?: Readonly<Record<string, readonly string[]>>;
};

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeRelativePath(path: string): string {
  const normalized = posix.normalize(path);
  if (normalized.startsWith("../") || normalized.startsWith("/") || normalized === ".." || normalized.includes("\0")) {
    throw new Error(`Unsafe managed path: ${path}`);
  }
  return normalized;
}


/**
 * The planner works in a virtual layout: `.codex/**` lives under the Codex home (honouring CODEX_HOME) and
 * `.agents/skills/**` under the user's home. The adapter maps these to real roots; Deck-owned support files
 * (manifest, hook scripts) live under `.codex/deck/` so nothing Deck-private is mixed into Codex's own directories.
 */
export const CODEX_MANIFEST_PATH = ".codex/deck/manifest.json";
export const CODEX_RTK_HOOK_SCRIPT_PATH = ".codex/deck/hooks/deck-rtk-hook.cjs";
export const CODEX_EXECUTION_HOOK_PATH = ".codex/deck/hooks/developer-team-execution.js";
const RTK_HOOK_SCRIPT_PATH = CODEX_RTK_HOOK_SCRIPT_PATH;

function isPreservedRuntimePath(path: string): boolean {
  return path === ".codex/config.toml" || path === CODEX_EXECUTION_HOOK_PATH || path === RTK_HOOK_SCRIPT_PATH;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function roleContent(agent: { agentId: string; instruction: string; model?: string; reasoning?: string }, roleId: string, bundle?: CapabilityInstructionBundle): string {
  const instruction = composeCapabilityInstructions(agent.instruction, bundle, { surface: "agent", teamId: "developer-team", agentId: agent.agentId });
  const catalog = DEVELOPER_TEAM_AGENTS.find((entry) => entry.id === agent.agentId);
  return [
    `# ${OWNED_MARKER}`,
    // Codex identifies a custom agent by its `name` field (not the filename), so it must equal the canonical role id.
    `name = ${tomlString(roleId)}`,
    `description = ${tomlString(catalog?.description ?? `Deck Developer Team role ${agent.agentId}`)}`,
    `developer_instructions = ${tomlString(instruction)}`,
    ...(agent.model ? [`model = ${tomlString(agent.model)}`] : []),
    ...(agent.reasoning ? [`model_reasoning_effort = ${tomlString(agent.reasoning)}`] : []),
    "",
  ].join("\n");
}

function retireLegacyAgentsBlock(source: string, ownedHash: string | undefined): { content?: string; collision?: string } {
  const starts = source.split(AGENTS_START).length - 1;
  const ends = source.split(AGENTS_END).length - 1;
  if (starts === 0 && ends === 0) return {};
  if (starts !== 1 || ends !== 1) return { collision: "AGENTS.md legacy cleanup is blocked because Deck markers are duplicate or malformed." };
  const start = source.indexOf(AGENTS_START);
  const endStart = source.indexOf(AGENTS_END);
  if (endStart < start) return { collision: "AGENTS.md legacy cleanup is blocked because Deck markers are reversed." };
  if (ownedHash === undefined) return { collision: "AGENTS.md legacy cleanup is blocked because no prior Codex ownership hash exists." };
  if (hash(source) !== ownedHash) return { collision: "AGENTS.md legacy cleanup is blocked because its bytes no longer match the prior Codex ownership hash." };
  return { content: source.slice(0, start) + source.slice(endStart + AGENTS_END.length) };
}

function ensureNativeSkillFrontmatter(content: string, skillId: string): string {
  if (content.startsWith("---\n") && parseSkillDescriptor(content, skillId).ok) return content;
  let body = content;
  if (content.startsWith("---\n")) {
    const closing = content.indexOf("\n---\n", 4);
    if (closing >= 0) body = content.slice(closing + 5);
  }
  return [
    "---",
    `name: ${JSON.stringify(skillId)}`,
    `description: ${JSON.stringify(`Deck native ${skillId} skill`)}`,
    "---",
    body,
  ].join("\n");
}

export function buildCodexDeveloperTeamInstallPlan(input: BuildCodexInstallPlanInput): CodexMutationPlan {
  const materializationScope = input.materializationScope ?? "full";
  const manifestPath = CODEX_MANIFEST_PATH;
  const diagnostics: RunnerDiagnostic[] = [];
  const capabilityInstructions = translateCodexCapabilityInstructions(input.capabilityInstructions);
  if (capabilityInstructions) {
    for (const message of validateCodexInstructionTranslation(capabilityInstructions)) diagnostics.push({ code: "codex-instruction-translation-invalid", severity: "error", message });
  }
  let blocked = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const priorManifestSource = input.existingFiles.get(manifestPath);
  let priorHashes: Record<string, string> = {};
  let hasPendingAgentsOwnershipRelease = false;
  if (priorManifestSource !== undefined) {
    try {
      const parsed = JSON.parse(priorManifestSource) as { version?: unknown; files?: unknown; releases?: unknown };
      if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) throw new Error("invalid manifest");
      priorHashes = Object.fromEntries(Object.entries(parsed.files).map(([path, value]) => {
        if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("invalid manifest hash");
        return [safeRelativePath(path), value];
      }));
      if (parsed.releases !== undefined) {
        if (!Array.isArray(parsed.releases) || parsed.releases.length !== 1 || parsed.releases[0] !== AGENTS_OWNERSHIP_RELEASE) {
          throw new Error("invalid manifest release");
        }
        hasPendingAgentsOwnershipRelease = true;
      }
      if (hasPendingAgentsOwnershipRelease && priorHashes[AGENTS_OWNERSHIP_RELEASE] !== undefined) throw new Error("conflicting manifest release");
    } catch {
      blocked = true;
      diagnostics.push({ code: "ownership-manifest-invalid", severity: "error", message: "The existing Codex ownership manifest is malformed; managed files cannot be updated safely." });
    }
  }

  const confirmedModels = input.confirmedModels === undefined ? undefined : new Set(input.confirmedModels);
  const modelAssignments = Object.entries(input.modelAssignments ?? {}).flatMap(([agentId, modelId]) => {
    const nativeModel = modelId.startsWith("openai-codex/") ? modelId.slice("openai-codex/".length) : modelId;
    if (confirmedModels && !confirmedModels.has(modelId) && !confirmedModels.has(nativeModel)) {
      diagnostics.push({ code: "codex-model-omitted", severity: "warning", message: `Model assignment for ${agentId} is not confirmed by Codex evidence and was omitted.` });
      return [];
    }
    const requestedReasoning = input.thinkingAssignments?.[agentId];
    const supportedReasoning = input.confirmedReasoningByModel
      ? new Set(input.confirmedReasoningByModel[modelId] ?? input.confirmedReasoningByModel[nativeModel] ?? [])
      : undefined;
    const reasoning = requestedReasoning && (!supportedReasoning || supportedReasoning.has(requestedReasoning))
      ? requestedReasoning
      : undefined;
    if (requestedReasoning && reasoning === undefined) diagnostics.push({ code: "codex-reasoning-omitted", severity: "warning", message: `Reasoning assignment for ${agentId} is not confirmed for its Codex model and was omitted.` });
    return [{ agentId, modelId: nativeModel, reasoning }];
  });
  const built = buildDeveloperTeamManifest({ team: DEVELOPER_TEAM, modelAssignments });
  diagnostics.push(...built.warnings.map((message) => ({ code: "manifest-warning", severity: "warning" as const, message })));
  blocked ||= built.errors.length > 0;

  const shadowingInstructions = [...input.existingFiles.keys()].filter((path) =>
    path === "AGENTS.override.md" || path.endsWith("/AGENTS.override.md") || path.endsWith("/AGENTS.md"),
  );
  if (shadowingInstructions.length > 0) diagnostics.push({
    code: "agents-instructions-shadowed",
    severity: "warning",
    message: `Codex instruction precedence may shadow local instructions: ${shadowingInstructions.join(", ")}.`,
  });

  const mutations: CodexMutation[] = [];
  const expected = new Map<string, CodexExpectedFile>();
  const ownershipReleases: string[] = [];
  const ownershipReleaseChecks: CodexOwnershipReleaseCheck[] = [];
  const add = (
    rawPath: string,
    content: string,
    kind: CodexExpectedFile["kind"],
    ownershipKind: CodexMutation["ownership"]["kind"],
    marker: string,
  ): void => {
    const relativePath = safeRelativePath(rawPath);
    const mode = input.existingModes?.get(relativePath) ?? 0o644;
    expected.set(relativePath, { relativePath, hash: hash(content), content, mode, kind });
    const existing = input.existingFiles.get(relativePath);
    if (existing === content) return;
    if (existing !== undefined && (ownershipKind === "deck-file" || ownershipKind === "deck-manifest")) {
      const priorHash = priorHashes[relativePath];
      if (ownershipKind === "deck-file" && priorHash !== hash(existing)) {
        blocked = true;
        diagnostics.push({ code: "unowned-collision", severity: "error", message: `Refusing to overwrite ${relativePath}; durable ownership evidence does not match its current bytes.` });
        return;
      }
      if (ownershipKind === "deck-manifest" && priorManifestSource === undefined) {
        blocked = true;
        diagnostics.push({ code: "ownership-manifest-collision", severity: "error", message: `Refusing to overwrite unowned ${relativePath}.` });
        return;
      }
    }
    mutations.push({
      relativePath,
      expected: existing === undefined ? { kind: "absent" } : { kind: "file", hash: hash(existing), mode },
      postimageHash: hash(content),
      postimageMode: mode,
      ownership: { kind: ownershipKind, marker },
      rollback: existing === undefined ? "delete" : "restore",
      content,
    });
  };
  const addSkill = (path: string, content: string, kind: "agent-skill" | "external-skill" | "bootstrap-skill", skillId: string): void => {
    const parsed = parseSkillDescriptor(content, skillId);
    if (!content.startsWith("---\n") || !parsed.ok) {
      blocked = true;
      diagnostics.push({ code: "invalid-skill-descriptor", severity: "error", message: `Skill ${skillId} does not satisfy Deck's skill discovery contract.` });
      return;
    }
    add(path, content, kind, "deck-file", `manifest:${skillId}`);
  };

  for (const agent of built.manifest.agents) {
    const roleId = agent.agentId.startsWith("deck-") ? agent.agentId : `deck-${agent.agentId}`;
    add(`.codex/agents/${roleId}.toml`, roleContent(agent, roleId, capabilityInstructions), "role", "deck-file", `manifest:${roleId}`);
  }
  for (const skill of built.manifest.skills) {
    const content = composeCapabilityInstructions(skill.body, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId });
    addSkill(`.agents/skills/${skill.skillId}/SKILL.md`, ensureNativeSkillFrontmatter(content, skill.skillId), "agent-skill", skill.skillId);
  }

  const externalIds = getStandaloneSkills().map(({ skillId }) => skillId);
  for (const skillId of externalIds) {
    const bundle = getStandaloneSkill(skillId);
    const skillContent = composeCapabilityInstructions(bundle.SKILL, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId });
    add(`.agents/skills/${safeRelativePath(skillId)}/SKILL.md`, skillContent, "external-skill", "deck-file", `manifest:${skillId}`);
    for (const [packagePath, content] of Object.entries(bundle.files)) {
      add(`.agents/skills/${skillId}/${safeRelativePath(packagePath)}`, content, "external-skill", "deck-file", `manifest:${skillId}`);
    }
  }

  const bootstrap = getBootstrapSkillFiles();
  for (const skill of bootstrap) {
    const content = composeCapabilityInstructions(skill.content, capabilityInstructions, { surface: "skill", teamId: "developer-team", skillId: skill.skillId });
    addSkill(`.agents/skills/${safeRelativePath(skill.relativePath)}`, ensureNativeSkillFrontmatter(content, skill.skillId), "bootstrap-skill", skill.skillId);
  }
  const agentsFile = input.agentsFile
    ?? (input.existingFiles.has(AGENTS_OWNERSHIP_RELEASE)
      ? { state: "file" as const, content: input.existingFiles.get(AGENTS_OWNERSHIP_RELEASE)!, mode: input.existingModes?.get(AGENTS_OWNERSHIP_RELEASE) ?? 0o644 }
      : { state: "absent" as const });
  const mappedAgentsContent = input.existingFiles.get(AGENTS_OWNERSHIP_RELEASE);
  const mappedAgentsMode = input.existingModes?.get(AGENTS_OWNERSHIP_RELEASE) ?? 0o644;
  const agentsSnapshotConsistent = input.agentsFile === undefined
    || (agentsFile.state === "file"
      ? mappedAgentsContent === agentsFile.content && mappedAgentsMode === agentsFile.mode
      : mappedAgentsContent === undefined);
  if (!agentsSnapshotConsistent) {
    blocked = true;
    diagnostics.push({
      code: "agents-file-snapshot-inconsistent",
      severity: "error",
      message: "AGENTS.md planner inputs disagree; the authoritative safe snapshot must match the mutation preimage.",
    });
  }
  const requestAgentsOwnershipRelease = (check?: CodexOwnershipReleaseCheck): void => {
    if (!ownershipReleases.includes(AGENTS_OWNERSHIP_RELEASE)) ownershipReleases.push(AGENTS_OWNERSHIP_RELEASE);
    if (check) ownershipReleaseChecks.push(check);
  };
  if (!agentsSnapshotConsistent) {
    // Do not derive a cleanup mutation from one view and a preimage from another.
  } else if (agentsFile.state === "unsafe") {
    blocked = true;
    diagnostics.push({
      code: "agents-file-unsafe",
      severity: "error",
      message: `AGENTS.md is unsafe for ownership review (${agentsFile.reason}); it must be a readable regular file or confirmed absent.`,
    });
  } else if (agentsFile.state === "file") {
    const agentsCleanup = retireLegacyAgentsBlock(agentsFile.content, priorHashes[AGENTS_OWNERSHIP_RELEASE]);
    if (agentsCleanup.collision) {
      blocked = true;
      diagnostics.push({ code: "agents-marker-cleanup-blocked", severity: "error", message: agentsCleanup.collision });
    } else if (agentsCleanup.content !== undefined) {
      add(AGENTS_OWNERSHIP_RELEASE, agentsCleanup.content, "instructions", "marker-span", `${AGENTS_START}|${AGENTS_END}`);
      requestAgentsOwnershipRelease();
    } else if (priorHashes[AGENTS_OWNERSHIP_RELEASE] !== undefined) {
      const checkedState = { kind: "file" as const, hash: hash(agentsFile.content), mode: agentsFile.mode };
      requestAgentsOwnershipRelease({ relativePath: AGENTS_OWNERSHIP_RELEASE, precondition: checkedState, postcondition: checkedState });
    } else if (hasPendingAgentsOwnershipRelease) {
      requestAgentsOwnershipRelease();
    }
  } else if (priorHashes[AGENTS_OWNERSHIP_RELEASE] !== undefined) {
    requestAgentsOwnershipRelease({
      relativePath: AGENTS_OWNERSHIP_RELEASE,
      precondition: { kind: "absent" },
      postcondition: { kind: "absent" },
    });
  } else if (hasPendingAgentsOwnershipRelease) {
    requestAgentsOwnershipRelease();
  }

  if (materializationScope === "full") {
    add(
      CODEX_EXECUTION_HOOK_PATH,
      readFileSync(typeof executionHookAssetPath === "string" ? executionHookAssetPath : new URL("../assets/codex/hooks/developer-team-execution.generated.js", import.meta.url), "utf-8"),
      "bridge-hook",
      "deck-file",
      "deck-codex-hook-v1",
    );
    const configSource = input.existingFiles.get(".codex/config.toml") ?? "";
    const config = mergeCodexProjectConfig(configSource, { multiAgent: true });
    if (config.status === "blocked") {
      blocked = true;
      diagnostics.push(...config.diagnostics.map((message) => ({ code: "toml-merge-blocked", severity: "error" as const, message })));
    } else {
      let desiredMcp = buildCodexMcpServers({
        packageIds: input.mcpCapabilityIds ?? [],
        memoryProvider: input.memoryProvider ?? "none",
        serenaLauncherAvailable: input.serenaLauncherAvailable,
        serenaProxyAvailable: input.serenaProxyAvailable,
        serenaProxyCommand: input.serenaProxyCommand,
        deckMemoryCommand: input.deckMemoryCommand,
        contextModeCommand: input.contextModeCommand,
        codebaseMemoryCommand: input.codebaseMemoryCommand,
        webSearchProviderSupported: input.webSearchProviderSupported,
        webSearchProviderConfigured: input.webSearchProviderConfigured,
        webSearchProvider: input.webSearchProvider,
        webSearchCredentialAvailable: input.webSearchCredentialAvailable,
        webSearchExecutableAvailable: input.webSearchExecutableAvailable,
        webSearchCommand: input.webSearchCommand,
      });
      if (input.foreignMcpCommands && input.foreignMcpCommands.size > 0) {
        const canon = (path: string) => { try { return realpathSync(path); } catch { return path; } };
        const foreign = [...input.foreignMcpCommands].map(([name, command]) => [name, canon(command)] as const);
        const kept = desiredMcp.servers.filter((server) => {
          if (server.transport !== "stdio" || server.id === "serena") return true;
          const owners = foreign.filter(([name, command]) => name !== server.id && command === canon(server.command)).map(([name]) => name);
          if (owners.length === 0) return true;
          diagnostics.push({ code: "mcp-foreign-duplicate", severity: "info", message: `Deck did not add MCP server '${server.id}' because your own registration '${owners.join("', '")}' already runs the same executable; Deck leaves it untouched.` });
          return false;
        });
        desiredMcp = { ...desiredMcp, servers: kept };
      }
      const supermemoryMcpState = inspectCodexSupermemoryMcpState(configSource);
      if (!supermemoryMcpState.ok && supermemoryMcpState.code === "supermemory-mcp-unmanaged") {
        diagnostics.push({
          code: "supermemory-mcp-unmanaged",
          severity: "warning",
          message: "Existing raw Supermemory Codex MCP configuration is unmanaged and external-unobservable; Deck Runtime did not authorize it as project memory.",
        });
      }
      for (const gap of desiredMcp.gaps) {
        if (gap === "serena-launcher-not-ready") {
          blocked = true;
          diagnostics.push({
            code: gap,
            severity: "error",
            message: "Serena is selected but no healthy Deck-owned launcher is ready. Use the explicitly authorized Serena action in Review before rerunning the full Codex install.",
          });
        } else if (gap === "serena-proxy-not-ready") {
          blocked = true;
          diagnostics.push({
            code: gap,
            severity: "error",
            message: "Serena is selected but the effective `deck` command cannot serve the portable proxy. Update Deck on PATH, then rerun the full Codex install.",
            });
        } else if (gap === "web-search-provider-unsupported") {
          blocked = true;
          diagnostics.push({ code: gap, severity: "error", message: "Web Search is enabled with an unsupported provider selection; no Codex MCP entry was written." });
        } else if (gap === "web-search-provider-unconfigured") {
          diagnostics.push({ code: gap, severity: "warning", message: "Web Search is enabled but no provider is configured; configure a supported provider before materializing Codex MCP." });
        } else if (gap === "web-search-credential-missing") {
          diagnostics.push({ code: gap, severity: "warning", message: "Web Search is enabled but its process credential is unavailable; no credential was persisted." });
        } else if (gap === "web-search-executable-missing") {
          diagnostics.push({ code: gap, severity: "warning", message: "Web Search is enabled but its configured MCP executable prerequisite is unavailable." });
        } else if (gap === "supermemory-raw-mcp-disabled") {
          diagnostics.push({ code: gap, severity: "info", message: "Supermemory is provided by the pinned official plugin hooks; no Supermemory MCP entry is written beside it." });
        } else if (gap === "context-mode-not-ready" || gap === "codebase-memory-not-ready") {
          diagnostics.push({ code: gap, severity: "warning", message: `${gap === "context-mode-not-ready" ? "Context Mode" : "Codebase Memory"} is selected but no verified executable is available; no MCP entry was written. Install it through the Deck TUI (Review & Install) and rerun.` });
        } else if (gap === "supermemory-project-scope-missing") {
          blocked = true;
          diagnostics.push({ code: gap, severity: "error", message: "Supermemory Codex MCP configuration is blocked because no canonical x-sm-project scope was resolved." });
        } else if (gap === "supermemory-project-scope-invalid") {
          blocked = true;
          diagnostics.push({ code: gap, severity: "error", message: "Supermemory Codex MCP configuration is blocked because the resolved x-sm-project scope fingerprint is invalid/redacted." });
        } else {
          diagnostics.push({ code: gap, severity: "warning", message: "Optional provider configuration remains deferred because no verified Codex provider contract is available." });
        }
      }
      const mcp = mergeCodexMcpServers(config.content, desiredMcp.servers);
      if (mcp.status === "blocked") {
        blocked = true;
        diagnostics.push(...mcp.diagnostics.map((message) => ({ code: "mcp-config-collision", severity: "error" as const, message })));
      } else {
        const memoryPlugin = input.memoryProvider === "supermemory";
        const hookBlocks: CodexOwnedHookBlock[] = [];
        // The loopback bridge belongs to Deck's own runtime; the official plugin owns memory alone when selected.
        if (!memoryPlugin) hookBlocks.push(CODEX_MEMORY_BRIDGE_HOOK_BLOCK);
        if (input.rtkHook) {
          add(RTK_HOOK_SCRIPT_PATH, rtkHookScript(input.rtkHook.rtkBinary, "codex"), "bridge-hook", "deck-file", "deck-codex-rtk-hook-v1");
          hookBlocks.push({
            id: "rtk",
            hooks: [{
              event: "PreToolUse",
              matcher: "^Bash$",
              command: `${shellQuote(input.rtkHook.nodeCommand)} ${shellQuote(posix.join(input.codexHome ?? posix.join(input.projectRoot, ".codex"), RTK_HOOK_SCRIPT_PATH.slice(".codex/".length)))}`,
              timeout: 10,
              statusMessage: "Optimizing command with RTK",
            }],
          });
        }
        if (memoryPlugin) {
          if (input.supermemoryHooks) {
            const run = (script: string) => `${shellQuote(input.supermemoryHooks!.nodeCommand)} ${shellQuote(script)}`;
            hookBlocks.push({
              id: "supermemory",
              hooks: [
                { event: "UserPromptSubmit", command: run(input.supermemoryHooks.recallScript), timeout: 60, statusMessage: "Searching memories..." },
                { event: "Stop", command: run(input.supermemoryHooks.flushScript), timeout: 30 },
              ],
            });
          } else {
            blocked = true;
            diagnostics.push({ code: "supermemory-plugin-not-ready", severity: "error", message: "Supermemory is selected but the pinned official Codex plugin hooks are not installed and verified. Install them through the Deck TUI (Review & Install) and rerun; Deck does not register the Supermemory MCP server as a fallback." });
          }
        }
        if (codexHooksFeatureDisabled(configSource) && hookBlocks.length > 0) {
          diagnostics.push({ code: "codex-hooks-feature-disabled", severity: "warning", message: "Codex hooks are disabled by [features] hooks=false; Deck-owned hooks are materialized but will not run until it is enabled." });
        }
        if (input.existingFiles.has(".codex/hooks.json") && hookBlocks.length > 0) {
          diagnostics.push({ code: "codex-hooks-json-coexistence", severity: "info", message: "Your Codex hooks.json exists beside Deck's inline [hooks] entries in config.toml; Codex loads both and may warn. Deck leaves hooks.json untouched." });
        }
        const hooks = mergeCodexOwnedHooks(mcp.content, hookBlocks);
        if (hooks.status === "blocked") {
          blocked = true;
          diagnostics.push(...hooks.diagnostics.map((message) => ({ code: "trusted-hook-config-collision", severity: "error" as const, message })));
        } else {
          if (hookBlocks.length > 0) diagnostics.push({ code: "codex-hook-trust-review", severity: "info", message: "If you start codex directly instead of through Deck, open /hooks once and trust Deck's entries." });
          add(".codex/config.toml", hooks.content, "config", "toml-key", "features.multi_agent|mcp_servers|hooks");
        }
      }
    }
  }

  for (const priorPath of Object.keys(priorHashes)) {
    if (priorPath === "AGENTS.md") continue;
    if (priorPath === manifestPath || expected.has(priorPath)) continue;
    if (materializationScope === "content-only" && isPreservedRuntimePath(priorPath)) continue;
    const existing = input.existingFiles.get(priorPath);
    if (existing === undefined) continue;
    if (hash(existing) !== priorHashes[priorPath]) {
      diagnostics.push({ code: "stale-managed-file-collision", severity: "warning", message: `Stale Codex path ${priorPath} no longer matches Deck ownership evidence and will be preserved.` });
      continue;
    }
    const mode = input.existingModes?.get(priorPath) ?? 0o644;
    mutations.push({
      operation: "delete",
      relativePath: priorPath,
      expected: { kind: "file", hash: hash(existing), mode },
      postimageHash: hash(""),
      postimageMode: mode,
      ownership: { kind: "deck-file", marker: `stale:${priorPath}` },
      rollback: "restore",
      content: "",
    });
    diagnostics.push({ code: "stale-managed-file-removal", severity: "warning", message: `Stale Deck-managed Codex file will be removed after review: ${priorPath}.` });
  }

  const preservedRuntimeHashes = materializationScope === "content-only"
    ? Object.fromEntries(Object.entries(priorHashes).filter(([path]) => isPreservedRuntimePath(path)))
    : {};
  const retainedLegacyAgentsHash = ownershipReleases.includes(AGENTS_OWNERSHIP_RELEASE) ? undefined : priorHashes[AGENTS_OWNERSHIP_RELEASE];
  const ownedFiles = Object.fromEntries([
    ...Object.entries(preservedRuntimeHashes),
    ...(retainedLegacyAgentsHash ? [["AGENTS.md", retainedLegacyAgentsHash] as const] : []),
    ...[...expected.values()].filter((file) => file.relativePath !== "AGENTS.md").map((file) => [file.relativePath, file.hash] as const),
  ].sort(([left], [right]) => left.localeCompare(right)));
  const manifestContent = `${JSON.stringify({
    version: 1,
    files: ownedFiles,
    ...(ownershipReleases.includes(AGENTS_OWNERSHIP_RELEASE) ? { releases: [AGENTS_OWNERSHIP_RELEASE] } : {}),
  }, null, 2)}\n`;
  add(manifestPath, manifestContent, "ownership-manifest", "deck-manifest", "deck-codex-manifest-v1");

  return {
    projectRoot: input.projectRoot,
    mutations,
    expectedFiles: [...expected.values()],
    inventory: {
      agentRoleIds: built.manifest.agents.map((agent) => agent.agentId),
      agentBoundSkillIds: built.manifest.skills.map((skill) => skill.skillId),
      externalStandaloneSkillIds: externalIds,
      bootstrapSkillIds: bootstrap.map((skill) => skill.skillId),
    },
    ownershipReleases,
    ownershipReleaseChecks,
    diagnostics,
    blocked,
  };
}
