import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  resolveCanonicalSupermemoryProjectScope,
} from "@deck/core";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";

import { mergeCodexProjectConfig, mergeCodexTrustedHookConfig } from "./codex-config";
import { translateCodexCapabilityInstructions, validateCodexInstructionTranslation } from "./instruction-translation";
import { buildCodexMcpServers, mergeCodexMcpServers } from "./mcp-config";
import type { CodexExpectedFile, CodexMutation, CodexMutationPlan } from "./types";

const OWNED_MARKER = "deck-codex-v1";
const AGENTS_START = "<!-- deck:developer-team:start -->";
const AGENTS_END = "<!-- deck:developer-team:end -->";

export type BuildCodexInstallPlanInput = {
  projectRoot: string;
  existingFiles: ReadonlyMap<string, string>;
  existingModes?: ReadonlyMap<string, number>;
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
  webSearchProviderSupported?: boolean;
  webSearchProviderConfigured?: boolean;
  webSearchProvider?: WebSearchProviderDescriptorV1;
  webSearchCredentialAvailable?: boolean;
  webSearchExecutableAvailable?: boolean;
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


function isPreservedRuntimePath(path: string): boolean {
  return path === ".codex/config.toml" || path === ".codex/hooks/developer-team-execution.js";
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function roleContent(agent: { agentId: string; displayName: string; instruction: string; model?: string; reasoning?: string }, bundle?: CapabilityInstructionBundle): string {
  const instruction = composeCapabilityInstructions(agent.instruction, bundle, { surface: "agent", teamId: "developer-team", agentId: agent.agentId });
  return [
    `# ${OWNED_MARKER}`,
    `name = ${tomlString(agent.displayName)}`,
    `description = ${tomlString(`Deck Developer Team role ${agent.agentId}`)}`,
    `developer_instructions = ${tomlString(instruction)}`,
    ...(agent.model ? [`model = ${tomlString(agent.model)}`] : []),
    ...(agent.reasoning ? [`model_reasoning_effort = ${tomlString(agent.reasoning)}`] : []),
    "",
  ].join("\n");
}

function instructionBlock(bundle: CapabilityInstructionBundle | undefined): string {
  const base = [
    AGENTS_START,
    "## Deck Developer Team (static-compatible)",
    "Use the Deck-provided native roles and skills for collaboration.",
    "Protected invocation authorization, controlled effects, centralized registry writes, and bound verification are not host-enforced on this launch route.",
  ].join("\n");
  return [
    composeCapabilityInstructions(base, bundle, { surface: "session", teamId: "developer-team" }).trimEnd(),
    AGENTS_END,
  ].join("\n");
}

function mergeAgents(source: string, bundle: CapabilityInstructionBundle | undefined): { content?: string; collision?: string } {
  const starts = source.split(AGENTS_START).length - 1;
  const ends = source.split(AGENTS_END).length - 1;
  if (starts !== ends || starts > 1) return { collision: "AGENTS.md contains duplicate or malformed Deck markers." };
  const block = instructionBlock(bundle);
  if (starts === 0) {
    const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
    return { content: `${source}${separator}${block}\n` };
  }
  const start = source.indexOf(AGENTS_START);
  const end = source.indexOf(AGENTS_END, start) + AGENTS_END.length;
  return { content: source.slice(0, start) + block + source.slice(end) };
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

function resolveCodexSupermemoryProjectScope(projectRoot: string): string | undefined {
  try {
    const remote = execSync("git remote get-url origin", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const resolved = resolveCanonicalSupermemoryProjectScope({ projectRoot, remotes: remote ? [remote] : [] });
    return resolved.ok ? resolved.scope : undefined;
  } catch {
    return undefined;
  }
}

export function buildCodexDeveloperTeamInstallPlan(input: BuildCodexInstallPlanInput): CodexMutationPlan {
  const materializationScope = input.materializationScope ?? "full";
  const manifestPath = ".codex/deck-manifest.json";
  const diagnostics: RunnerDiagnostic[] = [];
  const capabilityInstructions = translateCodexCapabilityInstructions(input.capabilityInstructions);
  const derivedSupermemoryProjectScope = input.memoryProvider === "supermemory"
    ? (input.supermemoryProjectScope ?? resolveCodexSupermemoryProjectScope(input.projectRoot))
    : undefined;
  if (capabilityInstructions) {
    for (const message of validateCodexInstructionTranslation(capabilityInstructions)) diagnostics.push({ code: "codex-instruction-translation-invalid", severity: "error", message });
  }
  let blocked = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const priorManifestSource = input.existingFiles.get(manifestPath);
  let priorHashes: Record<string, string> = {};
  if (priorManifestSource !== undefined) {
    try {
      const parsed = JSON.parse(priorManifestSource) as { version?: unknown; files?: unknown };
      if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object" || Array.isArray(parsed.files)) throw new Error("invalid manifest");
      priorHashes = Object.fromEntries(Object.entries(parsed.files).map(([path, value]) => {
        if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("invalid manifest hash");
        return [safeRelativePath(path), value];
      }));
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
    message: `Codex instruction precedence may shadow Deck's root block: ${shadowingInstructions.join(", ")}.`,
  });

  const mutations: CodexMutation[] = [];
  const expected = new Map<string, CodexExpectedFile>();
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
    add(`.codex/agents/${roleId}.toml`, roleContent(agent, capabilityInstructions), "role", "deck-file", `manifest:${roleId}`);
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
  const agentsMerge = mergeAgents(input.existingFiles.get("AGENTS.md") ?? "", capabilityInstructions);
  if (agentsMerge.collision) {
    blocked = true;
    diagnostics.push({ code: "agents-marker-collision", severity: "error", message: agentsMerge.collision });
  } else if (agentsMerge.content !== undefined) {
    add("AGENTS.md", agentsMerge.content, "instructions", "marker-span", `${AGENTS_START}|${AGENTS_END}`);
  }

  if (materializationScope === "full") {
    add(
      ".codex/hooks/developer-team-execution.js",
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
      const desiredMcp = buildCodexMcpServers({
        packageIds: input.mcpCapabilityIds ?? [],
        memoryProvider: input.memoryProvider ?? "none",
        supermemoryProjectScope: derivedSupermemoryProjectScope,
        serenaLauncherAvailable: input.serenaLauncherAvailable,
        serenaProxyAvailable: input.serenaProxyAvailable,
        webSearchProviderSupported: input.webSearchProviderSupported,
        webSearchProviderConfigured: input.webSearchProviderConfigured,
        webSearchProvider: input.webSearchProvider,
        webSearchCredentialAvailable: input.webSearchCredentialAvailable,
        webSearchExecutableAvailable: input.webSearchExecutableAvailable,
      });
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
        const hooks = mergeCodexTrustedHookConfig(mcp.content, true);
        if (hooks.status === "blocked") {
          blocked = true;
          diagnostics.push(...hooks.diagnostics.map((message) => ({ code: "trusted-hook-config-collision", severity: "error" as const, message })));
        } else {
          add(".codex/config.toml", hooks.content, "config", "toml-key", "features.multi_agent|mcp_servers|hooks");
        }
      }
    }
  }

  for (const priorPath of Object.keys(priorHashes)) {
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
  const ownedFiles = Object.fromEntries([
    ...Object.entries(preservedRuntimeHashes),
    ...[...expected.values()].map((file) => [file.relativePath, file.hash] as const),
  ].sort(([left], [right]) => left.localeCompare(right)));
  const manifestContent = `${JSON.stringify({ version: 1, files: ownedFiles }, null, 2)}\n`;
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
    diagnostics,
    blocked,
  };
}
