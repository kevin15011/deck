import { spawn as nodeSpawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { InstallableOpenCodeTool } from "./installation-plan";
import {
  resolveOpenCodeInstalledEvidence,
  type OpenCodeEvidenceContext,
  type OpenCodeInstalledEvidence,
  type OpenCodeInstalledEvidenceReason,
  type ResolveOpenCodeInstalledEvidence,
} from "./required-tools";
import {
  bootstrapSerena,
  validateSerenaBootstrapResult,
  validateSerenaOperationAuthorization,
  type SerenaBootstrapEffects,
  type SerenaBootstrapResult,
  type SerenaBootstrapStage,
  type SerenaBootstrapAuthorization,
  type SerenaOperationIdentity,
  type SerenaReadinessEvidence,
  type SerenaBootstrapRequest,
} from "@deck/core";

const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_CAPTURE_BYTES = 65_536;
const MAX_DIAGNOSTIC_LINES = 6;
const MAX_DIAGNOSTIC_SCALARS = 240;
const MAX_DIAGNOSTIC_BYTES = 1_024;
const MAX_CAUSE_LINES = 2;
const MAX_CAUSE_BYTES = 320;

export type InstallCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunInstallCommand = (command: string, args: string[]) => Promise<InstallCommandResult>;

export type OpenCodeToolInstallOutcome = "already-present" | "executed" | "failed" | "skipped";

export type OpenCodeRawInstallDiagnostic = {
  stage: "evidence" | "download" | "install" | "post-install";
  exitCode?: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutBytes: number;
  stderrBytes: number;
};

export type OpenCodeInstallDiagnostic = {
  stage: OpenCodeRawInstallDiagnostic["stage"];
  code: string;
  exitCode?: number;
  lines: readonly string[];
  original?: OpenCodeRawInstallDiagnostic;
};

type OpenCodeToolInstallResultBase = {
  toolId: InstallableOpenCodeTool["id"];
  tool: string;
  message: string;
  cause?: string;
  diagnostic?: OpenCodeInstallDiagnostic;
  raw?: OpenCodeRawInstallDiagnostic;
  /** Private handoff for the evidence-gated Serena config action. */
  serenaReadiness?: SerenaReadinessEvidence;
  /** Core outcome retained for cancellation/partial projection tests and routing. */
  serenaBootstrapOutcome?: SerenaBootstrapResult["outcome"];
};

export type OpenCodeToolInstallResultExact =
  | (OpenCodeToolInstallResultBase & { outcome: "already-present"; success: true; installerInvoked: false })
  | (OpenCodeToolInstallResultBase & { outcome: "executed"; success: true; installerInvoked: true })
  | (OpenCodeToolInstallResultBase & { outcome: "failed"; success: false; installerInvoked: boolean })
  | (OpenCodeToolInstallResultBase & { outcome: "skipped"; success: false; installerInvoked: false });

/**
 * Legacy callback/state compatibility. The installer never emits this shape;
 * it allows the pre-T5 TUI callback accumulator to remain source-compatible.
 */
export type OpenCodeToolInstallResult = OpenCodeToolInstallResultExact | {
  tool?: string;
  success: boolean;
  message?: string;
  toolId?: never;
  outcome?: never;
  installerInvoked?: never;
};

export type DownloadOpenCodeScript = (url: string, signal?: AbortSignal) => Promise<string>;
export type RunOpenCodeShellScript = (script: string, tool: InstallableOpenCodeTool, signal?: AbortSignal) => Promise<InstallCommandResult>;
export type SerenaBootstrapRunner = (
  request: SerenaBootstrapRequest,
  effects?: SerenaBootstrapEffects,
) => Promise<SerenaBootstrapResult>;

export type InstallOpenCodeToolsOptions = {
  commandExists?: (command: string) => boolean;
  evidenceContext?: OpenCodeEvidenceContext;
  resolveEvidence?: ResolveOpenCodeInstalledEvidence;
  evidenceResolver?: ResolveOpenCodeInstalledEvidence;
  downloadScript?: DownloadOpenCodeScript;
  download?: DownloadOpenCodeScript;
  runShellScript?: RunOpenCodeShellScript;
  signal?: AbortSignal;
  projectRoot?: string;
  homeDirectory?: string;
  /** Current-operation authorization required by the Core Serena service. */
  serenaAuthorization?: SerenaBootstrapAuthorization;
  /** Ergonomic alias for callers projecting the Core request directly. */
  authorization?: SerenaBootstrapAuthorization;
  /** Current operation identity; it is never inferred from ordinary selection. */
  serenaOperation?: SerenaOperationIdentity;
  currentOperation?: SerenaOperationIdentity;
  operation?: SerenaOperationIdentity;
  /** Injected Core runner and effects; production callers may supply the service seam. */
  serenaBootstrap?: SerenaBootstrapRunner;
  bootstrapSerena?: SerenaBootstrapRunner;
  serenaBootstrapService?: { bootstrapSerena: SerenaBootstrapRunner };
  serenaEffects?: SerenaBootstrapEffects;
  effects?: SerenaBootstrapEffects;
  onStage?: (stage: SerenaBootstrapStage) => void;
  stageCallback?: (stage: SerenaBootstrapStage) => void;
};

const singleFlights = new Map<string, Promise<OpenCodeToolInstallResultExact>>();

export function commandExistsInPath(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const pathDelimiter = process.platform === "win32" ? ";" : delimiter;
  return pathValue.split(pathDelimiter).some((directory) => {
    try {
      accessSync(join(directory || process.cwd(), command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Install selected OpenCode tools in input order while keeping detection and effects
 * at explicit, injectable boundaries.
 */
export async function installOpenCodeTools(
  command: string | undefined,
  plan: InstallableOpenCodeTool[],
  onResult: (result: OpenCodeToolInstallResultExact) => void,
  runInstallCommand: RunInstallCommand = runDefaultInstallCommand,
  options: InstallOpenCodeToolsOptions = {},
): Promise<OpenCodeToolInstallResultExact[]> {
  if (!command) return [];

  const results: OpenCodeToolInstallResultExact[] = [];
  const seenToolIds = new Set<string>();
  const resolver = options.resolveEvidence ?? options.evidenceResolver ?? (options.evidenceContext ? resolveOpenCodeInstalledEvidence : undefined);
  const context = options.evidenceContext;
  const projectRoot = options.projectRoot ?? context?.projectRoot ?? process.cwd();
  const homeDirectory = options.homeDirectory ?? context?.homeDirectory ?? process.env.HOME ?? "";

  const emit = (result: OpenCodeToolInstallResultExact): void => {
    results.push(result);
    onResult(result);
  };

  for (const tool of plan) {
    if (options.signal?.aborted) {
      emit(createInstallResult(tool, "skipped", false, `${tool.name} installation skipped because cancellation was requested.`));
      continue;
    }
    if (seenToolIds.has(tool.id)) {
      emit(failureFromText(tool, "evidence", "duplicate-tool-id", undefined, "", "Duplicate tool ID in installation plan.", false, context));
      continue;
    }
    seenToolIds.add(tool.id);

    const key = `${resolve(projectRoot)}\u0000${resolve(homeDirectory || projectRoot)}\u0000${tool.id}`;
    const existing = singleFlights.get(key);
    if (existing) {
      if (options.signal?.aborted) {
        emit(createInstallResult(tool, "skipped", false, `${tool.name} installation skipped because cancellation was requested.`));
        continue;
      }
      const leader = await existing;
      if (leader.outcome === "executed" && resolver && context) {
        const after = safeResolve(resolver, tool.id, context);
        if (after?.state === "usable") {
          emit(createInstallResult(tool, "already-present", false, `${tool.name} already present; installer not run.`));
          continue;
        }
      }
      emit(cloneSafeResult(leader));
      continue;
    }

    const work = executeTool(tool, runInstallCommand, resolver, context, options);
    singleFlights.set(key, work);
    try {
      emit(await work);
    } finally {
      if (singleFlights.get(key) === work) singleFlights.delete(key);
    }
  }

  return results;
}

async function executeTool(
  tool: InstallableOpenCodeTool,
  runInstallCommand: RunInstallCommand,
  resolver: ResolveOpenCodeInstalledEvidence | undefined,
  context: OpenCodeEvidenceContext | undefined,
  options: InstallOpenCodeToolsOptions,
): Promise<OpenCodeToolInstallResultExact> {
  if (tool.id === "serena" || tool.installKind === "serena-agent") {
    return executeSerenaTool(tool, options);
  }

  if (resolver && context) {
    const initial = safeResolve(resolver, tool.id, context);
    if (!initial) return evidenceFailure(tool, "evidence", "evidence-resolution-failed");
    if (initial.state === "usable") return createInstallResult(tool, "already-present", false, `${tool.name} already present; installer not run.`);
    if (initial.state === "indeterminate") return evidenceFailure(tool, "evidence", "evidence-indeterminate");
  }

  if (tool.installKind === "external") return createInstallResult(tool, "skipped", false, `Manual install required from ${tool.module}.`);
  if (tool.installKind === "mcp-server") return createInstallResult(tool, "skipped", false, `${tool.name} is an MCP server configured via write-mcp-config action, not install-tools.`);

  try {
    if (tool.installKind === "shell-script" || tool.installKind === "shell-script-plus-mcp") {
      return await executeShellTool(tool, runInstallCommand, resolver, context, options);
    }
    if (tool.installKind === "opencode-plugin") {
      return await executePluginTool(tool, runInstallCommand, resolver, context, options);
    }
    return await executeCommandTool(tool, runInstallCommand, resolver, context, options);
  } catch (error) {
    return failureFromText(tool, "install", "installer-exception", 1, "", error instanceof Error ? error.message : String(error), true, context);
  }
}

async function executeSerenaTool(
  tool: InstallableOpenCodeTool,
  options: InstallOpenCodeToolsOptions,
): Promise<OpenCodeToolInstallResultExact> {
  const operation = options.currentOperation ?? options.serenaOperation ?? options.operation;
  const authorization = validateSerenaOperationAuthorization(options.serenaAuthorization ?? options.authorization, operation);
  if (!authorization.valid || !operation || operation.runner !== "opencode") {
    return serenaFailure(tool, "preparing-uv", "authorization-invalid", "Serena requires explicit selection in the current OpenCode install operation.");
  }

  if (options.signal?.aborted) {
    return serenaCancelled(tool, "preparing-uv", false);
  }

  const runner = options.serenaBootstrapService?.bootstrapSerena
    ?? options.serenaBootstrap
    ?? options.bootstrapSerena
    ?? bootstrapSerena;
  const effects = options.serenaEffects ?? options.effects;
  let result: SerenaBootstrapResult;
  try {
    result = await runner({
      authorization: authorization.authorization,
      runner: operation.runner,
      operationId: operation.operationId,
      operation,
      currentOperation: operation,
      signal: options.signal,
      onStage: options.onStage ?? options.stageCallback,
      effects,
    }, effects);
  } catch {
    return serenaFailure(tool, "installing-serena", "bootstrap-failed", "Serena setup failed before readiness could be established.");
  }

  if (result.outcome === "reused" || result.outcome === "installed") {
    const validated = validateSerenaBootstrapResult(result);
    if (!validated.valid) {
      return serenaFailure(tool, "validating-serena", "invalid-readiness-evidence", "Serena setup completed without valid readiness evidence.");
    }
    const successful = validated.result;
    if (successful.outcome === "reused") {
      return {
        toolId: tool.id,
        tool: tool.name,
        outcome: "already-present",
        success: true,
        installerInvoked: false,
        message: "Serena is ready and was reused.",
        serenaBootstrapOutcome: "reused",
        serenaReadiness: successful.evidence,
      };
    }
    return {
      toolId: tool.id,
      tool: tool.name,
      outcome: "executed",
      success: true,
      installerInvoked: true,
      message: "Serena was installed and validated.",
      serenaBootstrapOutcome: "installed",
      serenaReadiness: successful.evidence,
    };
  }

  if (result.outcome === "cancelled") {
    return serenaCancelled(tool, result.stage, result.mutationStarted);
  }
  if (result.outcome === "partial") {
    return serenaFailure(tool, result.stage, result.code, "Serena setup stopped before termination was confirmed.", true, "partial");
  }
  if (result.outcome === "failed") {
    return serenaFailure(tool, result.stage, result.code, result.diagnostic.message, result.stage !== "preparing-uv");
  }
  return serenaFailure(tool, "validating-serena", "bootstrap-invalid", "Serena setup returned an unsupported outcome.");
}

function serenaCancelled(
  tool: InstallableOpenCodeTool,
  stage: SerenaBootstrapStage,
  _mutationStarted: boolean,
): OpenCodeToolInstallResultExact {
  return {
    toolId: tool.id,
    tool: tool.name,
    outcome: "skipped",
    success: false,
    installerInvoked: false,
    message: "Serena setup was cancelled; configuration was not changed.",
    serenaBootstrapOutcome: "cancelled",
    diagnostic: {
      stage: mapSerenaStage(stage),
      code: "cancelled",
      lines: ["Serena setup was cancelled before configuration."],
    },
  };
}

function serenaFailure(
  tool: InstallableOpenCodeTool,
  stage: SerenaBootstrapStage,
  code: string,
  _message: string,
  installerInvoked = false,
  bootstrapOutcome: "failed" | "partial" = "failed",
): OpenCodeToolInstallResultExact {
  const safeStage = mapSerenaStage(stage);
  const safeCode = /^[a-z0-9-]{1,64}$/.test(code) ? code : "unknown";
  const safeMessage = `Serena setup failed before configuration. Diagnostic: ${safeStage}/${safeCode}.`;
  return {
    toolId: tool.id,
    tool: tool.name,
    outcome: "failed",
    success: false,
    installerInvoked,
    message: "Serena setup failed.",
    cause: safeMessage,
    serenaBootstrapOutcome: bootstrapOutcome,
    diagnostic: {
      stage: safeStage,
      code: safeCode,
      lines: [safeMessage],
    },
  };
}

function mapSerenaStage(stage: SerenaBootstrapStage): OpenCodeRawInstallDiagnostic["stage"] {
  switch (stage) {
    case "preparing-uv": return "evidence";
    case "installing-serena": return "install";
    case "validating-serena": return "post-install";
  }
}

async function executeShellTool(
  tool: InstallableOpenCodeTool,
  runInstallCommand: RunInstallCommand,
  resolver: ResolveOpenCodeInstalledEvidence | undefined,
  context: OpenCodeEvidenceContext | undefined,
  options: InstallOpenCodeToolsOptions,
): Promise<OpenCodeToolInstallResultExact> {
  if (!tool.shellInstallUrl) return failureFromText(tool, "download", "missing-install-url", undefined, "", `Missing shell install URL for ${tool.name}.`, false, context);

  let downloaded: string;
  let downloadResult: InstallCommandResult | undefined;
  try {
    const download = options.downloadScript ?? options.download;
    if (download) downloaded = await download(tool.shellInstallUrl, options.signal);
    else {
      downloadResult = await runInstallCommand("curl", ["-fsSL", tool.shellInstallUrl]);
      if (downloadResult.exitCode !== 0) return failureFromCommand(tool, "download", "download-failed", downloadResult, false, context);
      downloaded = downloadResult.stdout;
    }
  } catch (error) {
    return failureFromText(tool, "download", "download-failed", undefined, "", error instanceof Error ? error.message : String(error), false, context);
  }

  if (Buffer.byteLength(downloaded, "utf8") > MAX_SCRIPT_BYTES) {
    return failureFromText(tool, "download", "download-too-large", undefined, "", "Downloaded installer script exceeded the 1 MiB limit.", false, context);
  }
  if (options.signal?.aborted) return createInstallResult(tool, "skipped", false, `${tool.name} installation skipped because cancellation was requested.`);

  if (resolver && context) {
    const second = safeResolve(resolver, tool.id, context);
    if (!second) return evidenceFailure(tool, "evidence", "evidence-resolution-failed");
    if (second.state === "usable") return createInstallResult(tool, "already-present", false, `${tool.name} already present; installer not run.`);
    if (second.state === "indeterminate") return evidenceFailure(tool, "evidence", "evidence-indeterminate");
  }

  const shellResult = options.runShellScript
    ? await options.runShellScript(downloaded, tool, options.signal)
    : await runDefaultShellScript(downloaded);
  if (shellResult.exitCode !== 0) return failureFromCommand(tool, "install", "installer-failed", shellResult, true, context);

  const postInstall = await runPostInstall(tool, runInstallCommand, context);
  if (postInstall) return postInstall;
  return completeMutation(tool, resolver, context, "executed");
}

async function executeCommandTool(
  tool: InstallableOpenCodeTool,
  runInstallCommand: RunInstallCommand,
  resolver: ResolveOpenCodeInstalledEvidence | undefined,
  context: OpenCodeEvidenceContext | undefined,
  options: InstallOpenCodeToolsOptions,
): Promise<OpenCodeToolInstallResultExact> {
  const result = await runInstallCommand("npm", ["install", "-g", tool.module]);
  if (result.exitCode !== 0) return failureFromCommand(tool, "install", "installer-failed", result, true, context);
  return completeMutation(tool, resolver, context, "executed");
}

async function executePluginTool(
  tool: InstallableOpenCodeTool,
  runInstallCommand: RunInstallCommand,
  resolver: ResolveOpenCodeInstalledEvidence | undefined,
  context: OpenCodeEvidenceContext | undefined,
  options: InstallOpenCodeToolsOptions,
): Promise<OpenCodeToolInstallResultExact> {
  const result = await runInstallCommand("opencode", ["plugin", tool.module, "--global"]);
  if (result.exitCode !== 0) {
    const fallback = await runInstallCommand("npm", ["install", "-g", tool.module]);
    if (fallback.exitCode !== 0) return failureFromCommand(tool, "install", "installer-failed", fallback, true, context);
  }
  return completeMutation(tool, resolver, context, "executed");
}

async function runPostInstall(
  tool: InstallableOpenCodeTool,
  runInstallCommand: RunInstallCommand,
  context: OpenCodeEvidenceContext | undefined,
): Promise<OpenCodeToolInstallResultExact | undefined> {
  if (!tool.postInstallCommand) return undefined;
  const [command, ...args] = tool.postInstallCommand;
  try {
    const result = await runInstallCommand(command!, args);
    if (result.exitCode !== 0) return failureFromCommand(tool, "post-install", "post-installer-failed", result, true, context);
  } catch (error) {
    return failureFromText(tool, "post-install", "post-installer-failed", undefined, "", error instanceof Error ? error.message : String(error), true, context);
  }
  return undefined;
}

async function completeMutation(
  tool: InstallableOpenCodeTool,
  resolver: ResolveOpenCodeInstalledEvidence | undefined,
  context: OpenCodeEvidenceContext | undefined,
  outcome: "executed",
): Promise<OpenCodeToolInstallResultExact> {
  if (resolver && context) {
    const after = safeResolve(resolver, tool.id, context);
    if (!after) return evidenceFailure(tool, "evidence", "evidence-resolution-failed", true);
    if (after.state !== "usable") return evidenceFailure(tool, "post-install", "post-evidence-failed", true);
  }
  return createInstallResult(tool, outcome, true, `${tool.name} installation completed.`);
}

function safeResolve(
  resolver: ResolveOpenCodeInstalledEvidence,
  toolId: InstallableOpenCodeTool["id"],
  context: OpenCodeEvidenceContext,
): OpenCodeInstalledEvidence | undefined {
  try {
    return resolver(toolId, context);
  } catch {
    return undefined;
  }
}

function evidenceFailure(
  tool: InstallableOpenCodeTool,
  stage: "evidence" | "post-install",
  code: string,
  installerInvoked = false,
): OpenCodeToolInstallResultExact {
  return failureFromText(tool, stage, code, undefined, "", stage === "evidence" ? "Installed evidence could not be established safely." : "Installer completed without usable installed evidence.", installerInvoked, undefined);
}

function failureFromCommand(
  tool: InstallableOpenCodeTool,
  stage: "download" | "install" | "post-install",
  code: string,
  result: InstallCommandResult,
  installerInvoked: boolean,
  context: OpenCodeEvidenceContext | undefined,
): OpenCodeToolInstallResultExact {
  return failureFromText(tool, stage, code, result.exitCode, result.stdout, result.stderr, installerInvoked, context);
}

function failureFromText(
  tool: InstallableOpenCodeTool,
  stage: "evidence" | "download" | "install" | "post-install",
  code: string,
  exitCode: number | undefined,
  stdout: string,
  stderr: string,
  installerInvoked: boolean,
  context: OpenCodeEvidenceContext | undefined,
): OpenCodeToolInstallResultExact {
  const capture = buildDiagnostic(stage, code, exitCode, stdout, stderr, context);
  return createInstallResult(tool, "failed", installerInvoked, `${tool.name} installation failed.`, capture);
}

function createInstallResult(
  tool: InstallableOpenCodeTool,
  outcome: OpenCodeToolInstallOutcome,
  installerInvoked: boolean,
  message: string,
  failure?: DiagnosticBuild,
): OpenCodeToolInstallResultExact {
  const result = {
    toolId: tool.id,
    tool: tool.name,
    outcome,
    success: outcome === "already-present" || outcome === "executed",
    installerInvoked,
    message,
    ...(failure?.cause ? { cause: failure.cause } : {}),
    ...(failure?.diagnostic ? { diagnostic: failure.diagnostic } : {}),
  } as OpenCodeToolInstallResultExact & { raw?: OpenCodeRawInstallDiagnostic };
  if (failure?.raw) {
    Object.defineProperty(result, "raw", { value: failure.raw, enumerable: false, configurable: false, writable: false });
    if (result.diagnostic) Object.defineProperty(result.diagnostic, "original", { value: failure.raw, enumerable: false, configurable: false, writable: false });
  }
  return result;
}

function cloneSafeResult(result: OpenCodeToolInstallResultExact): OpenCodeToolInstallResultExact {
  const diagnostic = result.diagnostic ? {
    stage: result.diagnostic.stage,
    code: result.diagnostic.code,
    ...(result.diagnostic.exitCode === undefined ? {} : { exitCode: result.diagnostic.exitCode }),
    lines: [...result.diagnostic.lines],
  } : undefined;
  return {
    toolId: result.toolId,
    tool: result.tool,
    outcome: result.outcome,
    success: result.success,
    installerInvoked: result.installerInvoked,
    message: result.message,
    ...(result.cause ? { cause: result.cause } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    ...(result.serenaBootstrapOutcome ? { serenaBootstrapOutcome: result.serenaBootstrapOutcome } : {}),
    ...(result.serenaReadiness ? { serenaReadiness: result.serenaReadiness } : {}),
  } as OpenCodeToolInstallResultExact;
}

type DiagnosticBuild = {
  cause: string;
  diagnostic: OpenCodeInstallDiagnostic;
  raw: OpenCodeRawInstallDiagnostic;
};

function buildDiagnostic(
  stage: OpenCodeRawInstallDiagnostic["stage"],
  code: string,
  exitCode: number | undefined,
  stdout: string,
  stderr: string,
  context: OpenCodeEvidenceContext | undefined,
): DiagnosticBuild {
  const stdoutCapture = captureTail(stdout);
  const stderrCapture = captureTail(stderr);
  const raw: OpenCodeRawInstallDiagnostic = {
    stage,
    ...(exitCode === undefined ? {} : { exitCode }),
    stdout: stdoutCapture.value,
    stderr: stderrCapture.value,
    stdoutTruncated: stdoutCapture.truncated,
    stderrTruncated: stderrCapture.truncated,
    stdoutBytes: stdoutCapture.bytes,
    stderrBytes: stderrCapture.bytes,
  };
  const lines = sanitizeDiagnostic(stderrCapture.value, stdoutCapture.value, context);
  const fallback = `${stageLabel(stage)} failed${exitCode === undefined ? "." : ` (exit ${exitCode}).`}`;
  const boundedLines = boundLines(lines.length > 0 ? lines : [fallback]);
  const cause = boundCause(boundedLines.length > 0 ? boundedLines : [fallback]);
  const diagnostic: OpenCodeInstallDiagnostic = { stage, code, ...(exitCode === undefined ? {} : { exitCode }), lines: boundedLines };
  return { cause, diagnostic, raw };
}

function captureTail(value: string): { value: string; bytes: number; truncated: boolean } {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= MAX_CAPTURE_BYTES) return { value, bytes, truncated: false };
  const buffer = Buffer.from(value, "utf8");
  let start = buffer.length - MAX_CAPTURE_BYTES;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start++;
  return { value: buffer.subarray(start).toString("utf8"), bytes, truncated: true };
}

function sanitizeDiagnostic(stderr: string, stdout: string, context: OpenCodeEvidenceContext | undefined): string[] {
  const normalized = `${stderr}\n${stdout}`.replace(/\r\n?/g, "\n");
  const withoutVt = stripVTControlCharacters(normalized)
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, "")
    .replace(/\t/g, " ");
  const progress = /[\u2500-\u257f\u2580-\u259f\u2800-\u28ff◐◓◑◒◴◷◶◵⟳]/gu;
  const roots = context ? [
    [context.env.XDG_CONFIG_HOME, "$XDG_CONFIG_HOME"],
    [context.env.XDG_CACHE_HOME, "$XDG_CACHE_HOME"],
    [context.env.XDG_STATE_HOME, "$XDG_STATE_HOME"],
    [context.homeDirectory, "~"],
  ].filter((entry): entry is [string, string] => Boolean(entry[0])).sort((a, b) => b[0].length - a[0].length) : [];
  const urlTokens: string[] = [];
  const protectedUrls = withoutVt.replace(/\b(?:https?|wss?|git\+https?):\/\/[^\s]+/gi, (url) => {
    const redacted = redactUrl(url);
    const token = `__DECK_URL_${urlTokens.length}__`;
    urlTokens.push(redacted);
    return token;
  });
  const sanitized = redactSecrets(protectedUrls)
    .split("\n")
    .map((line) => {
      let result = line.replace(progress, "");
      for (const [root, replacement] of roots) result = result.split(root).join(replacement);
      result = result.replace(/(?<![\w:~])(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, "<path>");
      result = result.replace(/(?<![\w:~/])\/(?:[^\s,;<>"']+\/)*[^\s,;<>"']+/g, "<path>");
      result = redactSecrets(result).replace(/ +/g, " ").trim();
      return result;
    })
    .map((line) => line.replace(/__DECK_URL_(\d+)__/g, (_, index: string) => urlTokens[Number(index)] ?? "<url>"))
    .filter(Boolean);
  const meaningful = sanitized.filter((line) => /error|failed|failure|fatal|denied|permission|not found|no such|unable|cannot|text file busy|etxtbsy|exit|checksum|timeout|timed out|pgrep|copy/iu.test(line));
  const selected = meaningful.length > 0 ? meaningful : sanitized;
  return [...new Set(selected)];
}

function redactSecrets(value: string): string {
  const keys = "token|secret|password|passwd|api-key|api_key|authorization|proxy-authorization|cookie|set-cookie|credential|client-secret|client_secret|access-key|access_key";
  return value
    .replace(new RegExp(`((?:${keys})\\s*[:=]\\s*)[^\\s,;]+`, "giu"), "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "[REDACTED]";
    }
    const secretKeys = /token|secret|password|passwd|key|authorization|credential|cookie/i;
    for (const key of [...parsed.searchParams.keys()]) if (secretKeys.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    return parsed.toString();
  } catch {
    return redactSecrets(value);
  }
}

function boundLines(lines: readonly string[]): string[] {
  const result: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (result.length >= MAX_DIAGNOSTIC_LINES) break;
    const scalarBounded = truncateScalars(line, MAX_DIAGNOSTIC_SCALARS);
    const remaining = MAX_DIAGNOSTIC_BYTES - bytes;
    if (remaining <= 0) break;
    const bounded = truncateUtf8(scalarBounded, remaining);
    if (!bounded) continue;
    result.push(bounded);
    bytes += Buffer.byteLength(bounded, "utf8");
  }
  return result;
}

function boundCause(lines: readonly string[]): string {
  const selected = lines.slice(0, MAX_CAUSE_LINES);
  let cause = "";
  for (const line of selected) {
    const next = cause ? `${cause} · ${line}` : line;
    const bounded = truncateUtf8(next, MAX_CAUSE_BYTES);
    if (!bounded) break;
    cause = bounded;
    if (bounded !== next) break;
  }
  return cause;
}

function truncateScalars(value: string, max: number): string {
  const scalars = [...value];
  if (scalars.length <= max) return value;
  const suffix = "…";
  return scalars.slice(0, Math.max(0, max - suffix.length)).join("") + suffix;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes < suffixBytes) return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
  let output = Buffer.from(value, "utf8").subarray(0, maxBytes - suffixBytes).toString("utf8");
  output += suffix;
  return output;
}

function stageLabel(stage: OpenCodeRawInstallDiagnostic["stage"]): string {
  return stage === "post-install" ? "Post-install" : stage.charAt(0).toUpperCase() + stage.slice(1);
}

function runDefaultInstallCommand(command: string, args: string[]): Promise<InstallCommandResult> {
  return new Promise((resolveResult) => {
    const child = nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolveResult({ exitCode: 1, stdout, stderr: error.message }));
  });
}

function runDefaultShellScript(script: string): Promise<InstallCommandResult> {
  return new Promise((resolveResult) => {
    const shell = process.platform === "darwin" ? "sh" : existsSync("/bin/bash") ? "/bin/bash" : "sh";
    const child = nodeSpawn(shell, ["-s"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdin?.write(script);
    child.stdin?.end();
    child.on("close", (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (error) => resolveResult({ exitCode: 1, stdout, stderr: error.message }));
  });
}
