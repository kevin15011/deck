import { accessSync, constants as fsConstants, existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { piAgentPaths, resolvePiAgentDir } from "./agent-dir";
import { SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA, SKILL_DISCOVERY_SOURCE_SCHEMA } from "../../core/src/skill-discovery/contracts";
import type { OpaqueSkillInventoryResultV1, SkillDiscoveryDiagnosticV1, SkillDiscoverySourceBindingV1, SkillDiscoverySourceDeclarationV1, SkillDiscoverySourceProviderV1, SkillLocatorResolutionV1 } from "../../core/src/skill-discovery/contracts";
const PI_RUNNER_ID = "pi";
export type PiSkillDiscoveryProviderOptions = {
  homeDirectory?: string;
  env?: Readonly<Record<string, string | undefined>>;
  opaqueInventory?: () => Promise<OpaqueSkillInventoryResultV1>;
};
function normalizeRuntimeDirectory(directory: string): string {
  return isAbsolute(directory) ? resolve(directory) : resolve(homedir());
}

type PiFilesystemSourceDefinition = {
  readonly sourceId: string;
  readonly sourceCategory: "project_runner" | "user_runner";
  readonly scope: "project" | "user";
  readonly locatorStrategy: "project_relative" | "runner_relative";
  readonly safeLocatorBase: string;
  readonly getRoot: (projectRoot: string, homeDirectory: string, agentDir: string) => string;
};

const PI_FILESYSTEM_SOURCE_DEFINITIONS: readonly PiFilesystemSourceDefinition[] = [
  {
    sourceId: "pi-project-skills",
    sourceCategory: "project_runner",
    scope: "project",
    locatorStrategy: "project_relative",
    safeLocatorBase: ".pi/skills",
    getRoot: (projectRoot) => join(projectRoot, ".pi", "skills"),
  },
  {
    sourceId: "pi-user-agent-skills",
    sourceCategory: "user_runner",
    scope: "user",
    locatorStrategy: "runner_relative",
    safeLocatorBase: "pi-user-agent-skills",
    getRoot: (_projectRoot, _homeDirectory, agentDir) => join(agentDir, "skills"),
  },
  {
    // Skills shipped inside the Deck-managed global Pi package (agent dir `deck/package/skills`).
    sourceId: "pi-deck-package-skills",
    sourceCategory: "user_runner",
    scope: "user",
    locatorStrategy: "runner_relative",
    safeLocatorBase: "pi-deck-package-skills",
    getRoot: (_projectRoot, _homeDirectory, agentDir) => join(piAgentPaths(agentDir).packageRoot, "skills"),
  },
  {
    sourceId: "pi-user-skills",
    sourceCategory: "user_runner",
    scope: "user",
    locatorStrategy: "runner_relative",
    safeLocatorBase: "pi-user-skills",
    getRoot: (_projectRoot, homeDirectory) => join(homeDirectory, ".pi", "skills"),
  },
];

const PI_OPAQUE_SOURCE_ID = "pi-runner-exposed";

/**
 * Construct the Pi-only source provider. It only declares Pi roots and never
 * consults the bundled standalone-skill catalog or another adapter.
 */
export function createPiSkillDiscoveryProvider(
  options: PiSkillDiscoveryProviderOptions = {},
): SkillDiscoverySourceProviderV1 {
  const homeDirectory = normalizeRuntimeDirectory(options.homeDirectory ?? process.env.HOME ?? homedir());
  const agentDirResolution = resolvePiAgentDir(options.env ?? process.env, homeDirectory);
  const agentDir = agentDirResolution.ok ? agentDirResolution.dir : join(homeDirectory, ".pi", "agent");

  return {
    schema: SKILL_DISCOVERY_SOURCE_PROVIDER_SCHEMA,
    runnerId: PI_RUNNER_ID,

    async listSources(input): Promise<
      | { readonly outcome: "complete"; readonly sources: readonly SkillDiscoverySourceBindingV1[]; readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[] }
      | { readonly outcome: "indeterminate"; readonly sources: readonly SkillDiscoverySourceBindingV1[]; readonly reasonCode: "partial_source_evaluation"; readonly diagnostics: readonly SkillDiscoveryDiagnosticV1[] }
    > {
      const projectRoot = normalizeProjectRoot(input.projectRoot);
      if (!projectRoot) {
        return {
          outcome: "indeterminate",
          sources: [],
          reasonCode: "partial_source_evaluation",
          diagnostics: [piDiagnostic("invalid_project_root")],
        };
      }

      const sources = buildPiFilesystemSources(projectRoot, homeDirectory, agentDir);
      const diagnostics = sources
        .filter((source): source is Extract<SkillDiscoverySourceBindingV1, { readonly kind: "filesystem" }> => source.kind === "filesystem")
        .filter((source) => !isDeclaredRootReadable(source.absoluteRoot))
        .map((source) => piDiagnostic("source_unreadable", source.declaration.sourceId));

      if (options.opaqueInventory) {
        sources.push(buildPiOpaqueSource(options.opaqueInventory));
      }

      if (diagnostics.length > 0) {
        return {
          outcome: "indeterminate",
          sources,
          reasonCode: "partial_source_evaluation",
          diagnostics,
        };
      }

      return { outcome: "complete", sources, diagnostics: [] };
    },

    async resolveLocator(input): Promise<SkillLocatorResolutionV1> {
      const projectRoot = normalizeProjectRoot(input.projectRoot);
      if (!projectRoot || typeof input.locator !== "string") {
        return { status: "rejected", diagnostic: piDiagnostic("invalid_locator") };
      }

      const sources = buildPiFilesystemSources(projectRoot, homeDirectory, agentDir);
      if (options.opaqueInventory) sources.push(buildPiOpaqueSource(options.opaqueInventory));

      if (input.locator.startsWith("project:")) {
        const projectRelativePath = decodeLocatorPath(input.locator.slice("project:".length));
        if (!projectRelativePath || !projectRelativePath.startsWith(".pi/skills/")) {
          return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", "pi-project-skills") };
        }
        const source = sources.find((candidate) => candidate.declaration.sourceId === "pi-project-skills");
        if (!source || source.kind !== "filesystem") return { status: "missing" };
        return resolveFilesystemLocator(source.absoluteRoot, projectRelativePath.slice(".pi/skills/".length), source.declaration.sourceId);
      }

      const runnerLocator = parseRunnerLocator(input.locator);
      if (!runnerLocator) return { status: "rejected", diagnostic: piDiagnostic("invalid_locator") };
      if (runnerLocator.runnerId !== PI_RUNNER_ID) {
        return { status: "rejected", diagnostic: piDiagnostic("runner_mismatch") };
      }

      const source = sources.find((candidate) => candidate.declaration.sourceId === runnerLocator.sourceId);
      if (!source) return { status: "missing" };

      if (source.kind === "opaque_inventory") {
        return resolveOpaqueLocator(source, runnerLocator.resourcePath);
      }

      const relativePath = decodeLocatorPath(runnerLocator.resourcePath);
      if (!relativePath) return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", source.declaration.sourceId) };
      return resolveFilesystemLocator(source.absoluteRoot, relativePath, source.declaration.sourceId);
    },
  };
}

function buildPiFilesystemSources(projectRoot: string, homeDirectory: string, agentDir: string): SkillDiscoverySourceBindingV1[] {
  return PI_FILESYSTEM_SOURCE_DEFINITIONS.map((definition) => {
    const declaration: SkillDiscoverySourceDeclarationV1 = {
      schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
      sourceId: definition.sourceId,
      sourceCategory: definition.sourceCategory,
      scope: definition.scope,
      runnerId: PI_RUNNER_ID,
      locatorStrategy: definition.locatorStrategy,
      expectedContent: "skill_md",
      safeLocatorBase: definition.safeLocatorBase,
    };
    return {
      kind: "filesystem",
      declaration,
      absoluteRoot: definition.getRoot(projectRoot, homeDirectory, agentDir),
      descriptorBasename: "SKILL.md",
    };
  });
}

function buildPiOpaqueSource(readInventory: () => Promise<OpaqueSkillInventoryResultV1>): SkillDiscoverySourceBindingV1 {
  const declaration: SkillDiscoverySourceDeclarationV1 = {
    schema: SKILL_DISCOVERY_SOURCE_SCHEMA,
    sourceId: PI_OPAQUE_SOURCE_ID,
    sourceCategory: "runner_exposed",
    scope: "runner",
    runnerId: PI_RUNNER_ID,
    locatorStrategy: "runner_opaque",
    expectedContent: "opaque_inventory_v1",
    safeLocatorBase: PI_OPAQUE_SOURCE_ID,
  };
  return {
    kind: "opaque_inventory",
    declaration,
    readInventory: async () => {
      try {
        const result = await readInventory();
        if (result && (result.outcome === "complete" || result.outcome === "indeterminate") && Array.isArray(result.observations) && Array.isArray(result.diagnostics)) {
          return result;
        }
      } catch {
        // Convert runner inventory failures into a bounded partial result.
      }
      return {
        outcome: "indeterminate",
        observations: [],
        reasonCode: "partial_source_evaluation",
        diagnostics: [piDiagnostic("opaque_inventory_unavailable", PI_OPAQUE_SOURCE_ID)],
      };
    },
  };
}

function normalizeProjectRoot(projectRoot: string): string | undefined {
  return typeof projectRoot === "string" && projectRoot.length > 0 && isAbsolute(projectRoot) ? resolve(projectRoot) : undefined;
}

function isDeclaredRootReadable(root: string): boolean {
  if (!existsSync(root)) return true;
  try {
    const stats = statSync(root);
    if (!stats.isDirectory() || (stats.mode & 0o444) === 0 || (stats.mode & 0o111) === 0) return false;
    accessSync(root, fsConstants.R_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function parseRunnerLocator(locator: string): { runnerId: string; sourceId: string; resourcePath: string } | undefined {
  if (!locator.startsWith("runner:")) return undefined;
  const remainder = locator.slice("runner:".length);
  const runnerSeparator = remainder.indexOf(":");
  if (runnerSeparator <= 0) return undefined;
  const runnerId = remainder.slice(0, runnerSeparator);
  const token = remainder.slice(runnerSeparator + 1);
  const sourceSeparator = token.indexOf("/");
  if (sourceSeparator <= 0 || sourceSeparator === token.length - 1) return undefined;
  const sourceId = decodeLocatorComponent(token.slice(0, sourceSeparator));
  const resourcePath = token.slice(sourceSeparator + 1);
  return sourceId ? { runnerId, sourceId, resourcePath } : undefined;
}

function decodeLocatorPath(value: string): string | undefined {
  const decoded = decodeLocatorComponent(value);
  if (!decoded || !isSafeRelativeSkillPath(decoded)) return undefined;
  return decoded;
}

function decodeLocatorComponent(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function isSafeRelativeSkillPath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/u.test(value)) return false;
  if (!value.endsWith("/SKILL.md")) return false;
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function resolveFilesystemLocator(root: string, relativePath: string, sourceId: string): SkillLocatorResolutionV1 {
  if (!isSafeRelativeSkillPath(relativePath)) {
    return { status: "rejected", diagnostic: piDiagnostic("invalid_locator", sourceId) };
  }
  if (!isDeclaredRootReadable(root)) {
    return { status: "rejected", diagnostic: piDiagnostic("source_unreadable", sourceId) };
  }

  const candidate = resolve(root, relativePath);
  if (!isContained(root, candidate)) {
    return { status: "rejected", diagnostic: piDiagnostic("locator_outside_root", sourceId) };
  }
  if (!existsSync(candidate)) return { status: "missing" };

  try {
    const canonicalRoot = realpathSync(root);
    const canonicalCandidate = realpathSync(candidate);
    if (!isContained(canonicalRoot, canonicalCandidate)) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_outside_root", sourceId) };
    }
    if (!statSync(candidate).isFile()) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_not_file", sourceId) };
    }
    accessSync(candidate, fsConstants.R_OK);
    if (realpathSync(candidate) !== canonicalCandidate || !statSync(candidate).isFile()) {
      return { status: "rejected", diagnostic: piDiagnostic("locator_changed", sourceId) };
    }
    return { status: "available", loadReference: candidate };
  } catch {
    return { status: "rejected", diagnostic: piDiagnostic("locator_unavailable", sourceId) };
  }
}

async function resolveOpaqueLocator(
  source: Extract<SkillDiscoverySourceBindingV1, { readonly kind: "opaque_inventory" }>,
  resourcePath: string,
): Promise<SkillLocatorResolutionV1> {
  const opaqueId = decodeLocatorComponent(resourcePath);
  if (!opaqueId || !isSafeOpaqueId(opaqueId)) {
    return { status: "rejected", diagnostic: piDiagnostic("invalid_opaque_id", source.declaration.sourceId) };
  }
  const inventory = await source.readInventory();
  if (inventory.outcome !== "complete") {
    return { status: "rejected", diagnostic: piDiagnostic("opaque_inventory_incomplete", source.declaration.sourceId) };
  }
  if (!inventory.observations.some((observation) => observation.opaqueId === opaqueId)) return { status: "missing" };
  return { status: "available", loadReference: `pi:opaque:${encodeURIComponent(opaqueId)}` };
}

function isSafeOpaqueId(value: string): boolean {
  return !value.includes("/") && !value.includes("\\") && !value.startsWith("~") && !isAbsolute(value) && !/^[A-Za-z]:/u.test(value);
}

function isContained(root: string, candidate: string): boolean {
  const result = relative(resolve(root), resolve(candidate));
  return result !== "" && result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result);
}

function piDiagnostic(code: string, sourceId?: string): SkillDiscoveryDiagnosticV1 {
  const messages: Record<string, string> = {
    invalid_project_root: "Pi skill discovery received an invalid project root.",
    invalid_locator: "The Pi skill locator is invalid.",
    runner_mismatch: "The skill locator belongs to a different runner.",
    source_unreadable: "A declared Pi skill source could not be read.",
    locator_outside_root: "The skill locator is outside its declared source.",
    locator_not_file: "The selected Pi skill locator is not a regular file.",
    locator_changed: "The selected Pi skill locator changed during verification.",
    locator_unavailable: "The selected Pi skill locator is unavailable.",
    invalid_opaque_id: "The opaque Pi skill identifier is invalid.",
    opaque_inventory_unavailable: "The Pi skill inventory could not be evaluated completely.",
    opaque_inventory_incomplete: "The Pi skill inventory is incomplete.",
  };
  return {
    code,
    ...(sourceId ? { source_id: sourceId } : {}),
    message: messages[code] ?? "Pi skill discovery could not complete.",
  };
}

