import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, win32 } from "node:path";

import { type InstallableOpenCodeTool, OPENCODE_INSTALLABLE_TOOLS, type InstallableOpenCodeToolId } from "./installation-plan";
import { getUserFacingOpenCodeCapability } from "./capability-catalog";
import {
  enumerateOpenCodeConfigCandidates,
  parseJsonc,
  type OpenCodeConfigCandidate,
} from "./model-discovery-context";
import { createToolStatus, type EnvironmentToolStatus } from "./tool-status";

export type OpenCodeToolStatus = {
  name: string;
  installed: boolean;
};

export type OpenCodeInstalledEvidenceState =
  | "usable"
  | "declared"
  | "broken"
  | "absent"
  | "indeterminate";

export type OpenCodeInstalledEvidenceSource = "configured" | "PATH" | "canonical-target" | "absent";

export type OpenCodeInstalledEvidenceReason =
  | "configured-usable"
  | "configured-disabled"
  | "configured-remote"
  | "configured-command-invalid"
  | "configured-target-missing"
  | "configured-target-not-file"
  | "configured-target-empty"
  | "configured-target-not-executable"
  | "configured-unreadable"
  | "configured-malformed"
  | "PATH-usable"
  | "PATH-missing"
  | "PATH-non-file"
  | "PATH-empty"
  | "PATH-non-executable"
  | "PATH-dangling-symlink"
  | "canonical-target-usable"
  | "canonical-target-missing"
  | "declaration-only"
  | "no-evidence";

export type OpenCodeInstalledEvidence = {
  toolId: InstallableOpenCodeToolId;
  state: OpenCodeInstalledEvidenceState;
  source: OpenCodeInstalledEvidenceSource;
  reasonCodes: readonly OpenCodeInstalledEvidenceReason[];
};

export type OpenCodeEvidenceStat = {
  size: number;
  mode: number;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
};

export type OpenCodeEvidenceContext = {
  projectRoot: string;
  workspaceRoot: string;
  homeDirectory: string;
  currentDirectory?: string;
  cwd?: string;
  platform: string;
  env: Readonly<Record<string, string | undefined>>;
  readFile: (path: string) => string;
  stat: (path: string) => OpenCodeEvidenceStat;
  realpath: (path: string) => string;
  access: (path: string, mode: number) => void;
  /** Optional deterministic seam used by legacy review callers. */
  commandExists?: (command: string) => boolean;
  /** Optional injected delimiter for a simulated platform; defaults to the platform delimiter. */
  pathDelimiter?: string;
};

export type ResolveOpenCodeInstalledEvidence = (
  toolId: InstallableOpenCodeToolId,
  context: OpenCodeEvidenceContext,
) => OpenCodeInstalledEvidence;

export type OpenCodeToolsReview = {
  installedPackages: string[];
  tools: OpenCodeToolStatus[];
  toolStatuses: EnvironmentToolStatus[];
  evidence?: Partial<Record<InstallableOpenCodeToolId, OpenCodeInstalledEvidence>>;
  error?: string;
};

export type ReviewOpenCodeToolsOptions = {
  homeDirectory?: string;
  projectRoot?: string;
  workspaceRoot?: string;
  currentDirectory?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  packageManifest?: string;
  configPath?: string;
  evidenceContext?: OpenCodeEvidenceContext;
  commandExists?: (command: string) => boolean;
  pathExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
  stat?: (path: string) => OpenCodeEvidenceStat;
  realpath?: (path: string) => string;
  access?: (path: string, mode: number) => void;
};

const OPENCODE_TOOLS: readonly { id: InstallableOpenCodeToolId; name: string }[] = [
  { id: "rtk", name: "RTK" },
  { id: "context-mode", name: "context-mode" },
  { id: "codebase-memory", name: "codebase-memory" },
  { id: "context7", name: "Context7" },
  { id: "serena", name: "Serena" },
];

type ConfigSnapshot = {
  mcp: Record<string, unknown>;
  commandDirectories: Record<string, string>;
  declarations: string[];
  hasConfig: boolean;
  issueReasons: OpenCodeInstalledEvidenceReason[];
};

type ConfigAssessment = {
  kind: "none" | "usable" | "declared" | "broken" | "indeterminate";
  reasons: OpenCodeInstalledEvidenceReason[];
};

type ExecutableAssessment =
  | { kind: "usable"; reason: "usable" }
  | { kind: "missing"; reason: "missing" }
  | { kind: "non-file"; reason: "non-file" }
  | { kind: "empty"; reason: "empty" }
  | { kind: "non-executable"; reason: "non-executable" }
  | { kind: "dangling"; reason: "dangling" };

const TOOL_BY_ID = new Map(OPENCODE_INSTALLABLE_TOOLS.map((tool) => [tool.id, tool]));

/**
 * Resolve package-relevant installed evidence without executing a package or health command.
 * All filesystem and configuration reads are supplied through the synchronous context.
 */
export function resolveOpenCodeInstalledEvidence(
  toolId: InstallableOpenCodeToolId,
  context: OpenCodeEvidenceContext,
): OpenCodeInstalledEvidence {
  const snapshot = readConfigSnapshot(context);
  const tool = TOOL_BY_ID.get(toolId);
  const configured = assessConfiguredEvidence(toolId, tool, snapshot, context);
  const reasons = uniqueReasons([...configured.reasons, ...snapshot.issueReasons]);

  if (configured.kind === "usable") {
    return makeEvidence(toolId, "usable", "configured", uniqueReasons(reasons));
  }

  const pathEvidence = assessPathEvidence(toolId, tool, context);
  if (pathEvidence.kind === "usable") {
    reasons.push("PATH-usable");
    return makeEvidence(toolId, "usable", "PATH", uniqueReasons(reasons));
  }
  if (pathEvidence.reason) reasons.push(pathReason(pathEvidence.reason));

  const canonicalEvidence = assessCanonicalEvidence(toolId, tool, context);
  if (canonicalEvidence.kind === "usable") {
    reasons.push("canonical-target-usable");
    return makeEvidence(toolId, "usable", "canonical-target", uniqueReasons(reasons));
  }
  if (canonicalEvidence.reason) reasons.push(canonicalReason(canonicalEvidence.reason));

  if (snapshot.issueReasons.length > 0) {
    return makeEvidence(toolId, "indeterminate", configured.kind === "none" ? "absent" : "configured", uniqueReasons(reasons));
  }
  if (configured.kind === "broken") return makeEvidence(toolId, "broken", "configured", uniqueReasons(reasons));
  if (configured.kind === "declared" || hasDeclaration(toolId, tool, snapshot.declarations)) {
    reasons.push("declaration-only");
    return makeEvidence(toolId, "declared", configured.kind === "none" ? "absent" : "configured", uniqueReasons(reasons));
  }

  reasons.push("no-evidence");
  return makeEvidence(toolId, "absent", "absent", uniqueReasons(reasons));
}

export function reviewOpenCodeTools(options: ReviewOpenCodeToolsOptions = {}): OpenCodeToolsReview {
  const context = createOpenCodeEvidenceContext(options);
  const reviewContext = options.evidenceContext || !options.configPath
    ? context
    : { ...context, env: { ...context.env, OPENCODE_CONFIG: options.configPath } };
  const evidence = Object.fromEntries(
    OPENCODE_TOOLS.map(({ id }) => [id, resolveOpenCodeInstalledEvidence(id, reviewContext)]),
  ) as Partial<Record<InstallableOpenCodeToolId, OpenCodeInstalledEvidence>>;

  const installedPackages: string[] = [];
  let manifestPackages: string[] = [];
  const manifestPath = options.packageManifest ?? join(configHomeFor(reviewContext), "package.json");
  const manifestPresent = readableFileExists(reviewContext, manifestPath, options.pathExists);
  let error: string | undefined;
  if (manifestPresent) {
    try {
      manifestPackages = readPackageManifestPackages(reviewContext.readFile(manifestPath));
      installedPackages.push(...manifestPackages);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Unable to read OpenCode package manifest.";
    }
  }

  const snapshot = readConfigSnapshot(reviewContext);
  installedPackages.push(...snapshot.declarations);
  const commandExists = options.commandExists;
  for (const command of ["rtk", "codebase-memory-mcp"] as const) {
    if (commandExists?.(command)) installedPackages.push(command);
  }

  for (const tool of OPENCODE_TOOLS) {
    const current = evidence[tool.id]!;
    if (current.state === "absent" && hasDeclaration(tool.id, TOOL_BY_ID.get(tool.id), manifestPackages)) {
      evidence[tool.id] = makeEvidence(tool.id, "declared", "absent", uniqueReasons([...current.reasonCodes, "declaration-only"]));
      continue;
    }
    // Preserve the legacy injected command seam as executable evidence, but never treat
    // package/config declarations as proof. Production uses the filesystem resolver above.
    if (current.state !== "usable" && commandExists && commandForTool(tool.id) && commandExists(commandForTool(tool.id)!)) {
      evidence[tool.id] = makeEvidence(tool.id, "usable", "PATH", uniqueReasons([...current.reasonCodes, "PATH-usable"]));
    }
  }

  const tools = OPENCODE_TOOLS.map((tool) => ({ name: tool.name, installed: evidence[tool.id]?.state === "usable" }));
  if (!manifestPresent && !snapshot.hasConfig && tools.every((tool) => !tool.installed)) {
    error = error ?? "OpenCode package manifest not found.";
  }

  return {
    installedPackages: [...new Set(installedPackages)],
    tools,
    evidence,
    toolStatuses: tools.map((tool) => createToolStatus(tool.name, tool.installed ? "found" : "missing", tool.installed ? "configured" : "missing")),
    ...(error ? { error } : {}),
  };
}

function commandExistsInPath(command: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const pathValue = env.PATH ?? "";
  const pathDelimiter = process.platform === "win32" ? ";" : delimiter;
  return pathValue.split(pathDelimiter).some((directory) => {
    const candidate = join(directory || process.cwd(), command);
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function createOpenCodeEvidenceContext(options: ReviewOpenCodeToolsOptions = {}): OpenCodeEvidenceContext {
  if (options.evidenceContext) return options.evidenceContext;
  const environment = options.environment ?? (options.pathExists ? { ...process.env, PATH: "" } : process.env);
  const currentDirectory = options.currentDirectory ?? options.projectRoot ?? process.cwd();
  const pathExists = options.pathExists;
  const stat = options.stat ?? ((path: string): OpenCodeEvidenceStat => {
    if (pathExists && !pathExists(path)) throw Object.assign(new Error(`missing: ${path}`), { code: "ENOENT" });
    return statSync(path);
  });
  return {
    projectRoot: options.projectRoot ?? currentDirectory,
    workspaceRoot: options.workspaceRoot ?? options.projectRoot ?? currentDirectory,
    homeDirectory: options.homeDirectory ?? homedir(),
    currentDirectory,
    platform: process.platform,
    env: environment,
    readFile: options.readFile ?? ((path) => readFileSync(path, "utf8")),
    stat,
    realpath: options.realpath ?? ((path) => realpathSync(path)),
    access: options.access ?? ((path, mode) => accessSync(path, mode)),
    commandExists: options.commandExists,
    pathDelimiter: process.platform === "win32" ? ";" : delimiter,
  };
}

function readConfigSnapshot(context: OpenCodeEvidenceContext): ConfigSnapshot {
  const result: ConfigSnapshot = { mcp: {}, commandDirectories: {}, declarations: [], hasConfig: false, issueReasons: [] };
  if (context.env.OPENCODE_PURE) return result;

  const candidates = enumerateOpenCodeConfigCandidates({
    projectRoot: context.projectRoot,
    workspaceRoot: context.workspaceRoot,
    homeDir: context.homeDirectory,
    env: context.env,
  });
  for (const candidate of candidates) {
    const parsed = readConfigCandidate(context, candidate);
    if (parsed === undefined) continue;
    result.hasConfig = true;
    if (parsed === null) {
      result.issueReasons.push("configured-malformed");
      continue;
    }
    const record = asRecord(parsed);
    if (!record) {
      result.issueReasons.push("configured-malformed");
      continue;
    }
    const mcp = asRecord(record.mcp);
    if (mcp) {
      for (const [name, value] of Object.entries(mcp)) {
        result.mcp[name] = mergeConfigValue(result.mcp[name], value);
        if (asRecord(value) && "command" in asRecord(value)!) result.commandDirectories[name] = candidate.directory;
        result.declarations.push(name);
      }
    }
    if (Array.isArray(record.plugin)) result.declarations.push(...record.plugin.filter((value): value is string => typeof value === "string"));
  }

  if (context.env.OPENCODE_CONFIG_CONTENT !== undefined) {
    try {
      const parsed = asRecord(parseJsonc(context.env.OPENCODE_CONFIG_CONTENT));
      if (!parsed) result.issueReasons.push("configured-malformed");
      else {
        result.hasConfig = true;
        const mcp = asRecord(parsed.mcp);
        if (mcp) {
          for (const [name, value] of Object.entries(mcp)) {
            result.mcp[name] = mergeConfigValue(result.mcp[name], value);
            if (asRecord(value) && "command" in asRecord(value)!) result.commandDirectories[name] = context.projectRoot;
            result.declarations.push(name);
          }
        }
        if (Array.isArray(parsed.plugin)) result.declarations.push(...parsed.plugin.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      result.issueReasons.push("configured-malformed");
    }
  }

  return { ...result, declarations: [...new Set(result.declarations)] };
}

function readConfigCandidate(context: OpenCodeEvidenceContext, candidate: OpenCodeConfigCandidate): unknown | null | undefined {
  try {
    const stats = context.stat(candidate.path);
    if (stats.isFile && !stats.isFile()) return undefined;
    return parseJsonc(context.readFile(candidate.path));
  } catch (caught) {
    if (isMissingError(caught)) return undefined;
    return null;
  }
}

function assessConfiguredEvidence(
  toolId: InstallableOpenCodeToolId,
  tool: InstallableOpenCodeTool | undefined,
  snapshot: ConfigSnapshot,
  context: OpenCodeEvidenceContext,
): ConfigAssessment {
  const aliases = aliasesFor(toolId, tool);
  const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(snapshot.mcp, alias));
  if (!key) return { kind: "none", reasons: [] };
  const rawEntry = snapshot.mcp[key];
  const entry = asRecord(rawEntry);
  if (!entry) return { kind: "declared", reasons: ["configured-command-invalid"] };
  if (entry.enabled === false || entry.disabled === true) return { kind: "declared", reasons: ["configured-disabled"] };
  if (entry.type === "remote" || typeof entry.url === "string") return { kind: "declared", reasons: ["configured-remote"] };

  const commandValue = entry.command;
  if (!Array.isArray(commandValue) || commandValue.length === 0 || commandValue.some((value) => typeof value !== "string")) {
    return { kind: "declared", reasons: ["configured-command-invalid"] };
  }
  const command = commandValue as string[];
  if (toolId === "context7") {
    if (entry.type !== "local" || command[0] !== "npx" || !command.slice(1).some((value) => value === "@upstash/context7-mcp")) {
      return { kind: "declared", reasons: ["configured-command-invalid"] };
    }
  } else {
    const expected = commandForTool(toolId);
    if (!expected || !isExactCommandToken(command[0]!, expected, context)) {
      return { kind: "declared", reasons: ["configured-command-invalid"] };
    }
  }

  const directory = snapshot.commandDirectories[key] ?? context.projectRoot;
  const target = command[0]!;
  const inspected = inspectConfiguredToken(target, directory, context);
  if (inspected.kind === "usable") return { kind: "usable", reasons: ["configured-usable"] };
  return { kind: "broken", reasons: [configuredReason(inspected.reason)] };
}

function assessPathEvidence(toolId: InstallableOpenCodeToolId, tool: InstallableOpenCodeTool | undefined, context: OpenCodeEvidenceContext): ExecutableAssessment {
  const command = commandForTool(toolId, tool);
  if (!command) return { kind: "missing", reason: "missing" };
  if (context.commandExists?.(command)) return { kind: "usable", reason: "usable" };
  const pathValue = context.env.PATH ?? "";
  if (!pathValue) return { kind: "missing", reason: "missing" };
  let best: ExecutableAssessment = { kind: "missing", reason: "missing" };
  const pathDelimiter = context.pathDelimiter ?? (context.platform === "win32" ? ";" : delimiter);
  for (const rawDirectory of pathValue.split(pathDelimiter)) {
    const directory = rawDirectory === "" ? currentDirectory(context) : isAbsolute(rawDirectory) || isWindowsAbsolute(rawDirectory) ? rawDirectory : resolve(currentDirectory(context), rawDirectory);
    const candidates = context.platform === "win32" ? windowsPathCandidates(directory, command, context) : [join(directory, command)];
    for (const candidate of candidates) {
      const inspected = inspectExecutable(candidate, context);
      if (inspected.kind === "usable") return inspected;
      if (best.kind === "missing" || best.kind === "non-executable") best = inspected;
    }
  }
  return best;
}

function assessCanonicalEvidence(toolId: InstallableOpenCodeToolId, tool: InstallableOpenCodeTool | undefined, context: OpenCodeEvidenceContext): ExecutableAssessment {
  const command = commandForTool(toolId, tool);
  if (!command) return { kind: "missing", reason: "missing" };
  return inspectExecutable(join(context.homeDirectory, ".local", "bin", command), context);
}

function inspectConfiguredToken(token: string, directory: string, context: OpenCodeEvidenceContext): ExecutableAssessment {
  if (containsUnsafeCommandSyntax(token)) return { kind: "non-executable", reason: "non-executable" };
  if (!isAbsolute(token) && !isWindowsAbsolute(token) && !token.includes("/") && !token.includes("\\")) {
    const pathEvidence = assessPathEvidenceByToken(token, context);
    return pathEvidence;
  }
  const target = isAbsolute(token) || isWindowsAbsolute(token)
    ? token
    : context.platform === "win32" ? win32.resolve(directory, token) : resolve(directory, token);
  return inspectExecutable(target, context);
}

function assessPathEvidenceByToken(token: string, context: OpenCodeEvidenceContext): ExecutableAssessment {
  const pathValue = context.env.PATH ?? "";
  if (context.commandExists?.(token)) return { kind: "usable", reason: "usable" };
  if (!pathValue) return { kind: "missing", reason: "missing" };
  const pathDelimiter = context.pathDelimiter ?? (context.platform === "win32" ? ";" : delimiter);
  let best: ExecutableAssessment = { kind: "missing", reason: "missing" };
  for (const rawDirectory of pathValue.split(pathDelimiter)) {
    const directory = rawDirectory === "" ? currentDirectory(context) : isAbsolute(rawDirectory) || isWindowsAbsolute(rawDirectory) ? rawDirectory : resolve(currentDirectory(context), rawDirectory);
    const candidates = context.platform === "win32" ? windowsPathCandidates(directory, token, context) : [join(directory, token)];
    for (const candidate of candidates) {
      const inspected = inspectExecutable(candidate, context);
      if (inspected.kind === "usable") return inspected;
      if (best.kind === "missing") best = inspected;
    }
  }
  return best;
}

function inspectExecutable(path: string, context: OpenCodeEvidenceContext): ExecutableAssessment {
  let original: OpenCodeEvidenceStat;
  try {
    original = context.stat(path);
  } catch {
    return { kind: "missing", reason: "missing" };
  }
  if (original.isDirectory?.() || original.isFile?.() === false) return { kind: "non-file", reason: "non-file" };
  if (original.size <= 0) return { kind: "empty", reason: "empty" };

  let resolvedPath: string;
  try {
    resolvedPath = context.realpath(path);
  } catch {
    return { kind: "dangling", reason: "dangling" };
  }
  let resolved: OpenCodeEvidenceStat;
  try {
    resolved = context.stat(resolvedPath);
  } catch {
    return { kind: "dangling", reason: "dangling" };
  }
  if (resolved.isDirectory?.() || resolved.isFile?.() === false) return { kind: "non-file", reason: "non-file" };
  if (resolved.size <= 0) return { kind: "empty", reason: "empty" };
  if (context.platform === "win32") {
    const extensions = (context.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((value) => value.toLowerCase());
    if (!extensions.includes(win32.extname(resolvedPath).toLowerCase())) return { kind: "non-executable", reason: "non-executable" };
  } else {
    try {
      context.access(resolvedPath, constants.X_OK);
    } catch {
      return { kind: "non-executable", reason: "non-executable" };
    }
  }
  return { kind: "usable", reason: "usable" };
}

function windowsPathCandidates(directory: string, command: string, context: OpenCodeEvidenceContext): string[] {
  if (win32.extname(command)) return [win32.join(directory, command)];
  const extensions = (context.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [win32.join(directory, command), ...extensions.map((extension) => win32.join(directory, `${command}${extension}`))];
}

function aliasesFor(toolId: InstallableOpenCodeToolId, tool: InstallableOpenCodeTool | undefined): string[] {
  const capability = getUserFacingOpenCodeCapability(toolId);
  return [...new Set([
    toolId,
    tool?.name,
    tool?.module,
    capability?.toolId,
    ...(capability?.detector.mcpServerNames ?? []),
  ].filter((value): value is string => Boolean(value)))];
}

function commandForTool(toolId: InstallableOpenCodeToolId, tool: InstallableOpenCodeTool | undefined = TOOL_BY_ID.get(toolId)): string | undefined {
  return toolId === "context7" ? "npx" : getUserFacingOpenCodeCapability(toolId)?.detector.commands?.[0] ?? tool?.id;
}

function isExactCommandToken(token: string, expected: string, context: OpenCodeEvidenceContext): boolean {
  if (containsUnsafeCommandSyntax(token)) return false;
  const tokenBase = (context.platform === "win32" ? win32.basename(token) : basename(token)).toLowerCase();
  return tokenBase === expected.toLowerCase();
}

function containsUnsafeCommandSyntax(value: string): boolean {
  return value.length === 0 || value.trim() !== value || /\s|[;&|<>$`()'"`]/.test(value) || value.includes("${") || value.includes("$(");
}

function hasDeclaration(toolId: InstallableOpenCodeToolId, tool: InstallableOpenCodeTool | undefined, declarations: readonly string[]): boolean {
  const normalized = new Set(declarations.map(normalizePackageName));
  return aliasesFor(toolId, tool).some((alias) => normalized.has(normalizePackageName(alias))) || (toolId === "context7" && normalized.has(normalizePackageName("@upstash/context7-mcp")));
}

function readPackageManifestPackages(content: string): string[] {
  const parsed = parseJsonc(content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return Object.keys({ ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) });
}

function mergeConfigValue(previous: unknown, next: unknown): unknown {
  const previousRecord = asRecord(previous);
  const nextRecord = asRecord(next);
  if (!previousRecord || !nextRecord) return next;
  const merged: Record<string, unknown> = { ...previousRecord };
  for (const [key, value] of Object.entries(nextRecord)) merged[key] = mergeConfigValue(merged[key], value);
  return merged;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readableFileExists(context: OpenCodeEvidenceContext, path: string, legacyPathExists?: (path: string) => boolean): boolean {
  try {
    const stats = context.stat(path);
    return !stats.isFile || stats.isFile();
  } catch {
    return legacyPathExists?.(path) ?? false;
  }
}

function configHomeFor(context: OpenCodeEvidenceContext): string {
  return join(context.env.XDG_CONFIG_HOME ?? join(context.homeDirectory, ".config"), "opencode");
}

function currentDirectory(context: OpenCodeEvidenceContext): string {
  return context.currentDirectory ?? context.cwd ?? context.projectRoot;
}

function isWindowsAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function isMissingError(error: unknown): boolean {
  if (typeof error === "object" && error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String((error as { code?: unknown }).code))) return true;
  return error instanceof Error && /missing|not found|no such file|ENOENT/i.test(error.message);
}

function configuredReason(reason: ExecutableAssessment["reason"]): OpenCodeInstalledEvidenceReason {
  switch (reason) {
    case "missing": return "configured-target-missing";
    case "non-file": return "configured-target-not-file";
    case "empty": return "configured-target-empty";
    case "non-executable": return "configured-target-not-executable";
    case "dangling": return "configured-target-missing";
    default: return "configured-command-invalid";
  }
}

function pathReason(reason: ExecutableAssessment["reason"]): OpenCodeInstalledEvidenceReason {
  switch (reason) {
    case "non-file": return "PATH-non-file";
    case "empty": return "PATH-empty";
    case "non-executable": return "PATH-non-executable";
    case "dangling": return "PATH-dangling-symlink";
    default: return "PATH-missing";
  }
}

function canonicalReason(reason: ExecutableAssessment["reason"]): OpenCodeInstalledEvidenceReason {
  return reason === "missing" ? "canonical-target-missing" : "canonical-target-missing";
}

function uniqueReasons(reasons: readonly OpenCodeInstalledEvidenceReason[]): OpenCodeInstalledEvidenceReason[] {
  return [...new Set(reasons)];
}

function makeEvidence(
  toolId: InstallableOpenCodeToolId,
  state: OpenCodeInstalledEvidenceState,
  source: OpenCodeInstalledEvidenceSource,
  reasonCodes: readonly OpenCodeInstalledEvidenceReason[],
): OpenCodeInstalledEvidence {
  return { toolId, state, source, reasonCodes: uniqueReasons(reasonCodes) };
}

function normalizePackageName(value: string): string {
  return value.toLowerCase().replace(/^npm:/, "").replace(/[^a-z0-9@/]+/g, "-").replace(/^-|-$/g, "");
}
