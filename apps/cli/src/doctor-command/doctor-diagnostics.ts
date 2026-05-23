/**
 * Doctor diagnostics orchestrator.
 *
 * Runs a battery of isolated diagnostic checks across runtimes, packages,
 * memory providers, and MCP configuration. Each sub-check is wrapped in
 * try/catch so a single failure does not abort the others (REQ-DIAG-007).
 *
 * The function never throws — it always returns a structured result
 * (REQ-DIAG-008) and never exposes credentials in any message (REQ-DIAG-009).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { inspectPiEnvironment, redact, redactDiagnostic, reviewPiRequiredTools, validateSupermemoryPiMcpConfig } from "@deck/adapter-pi";
import { inspectOpenCodeEnvironment, reviewOpenCodeTools } from "@deck/adapter-opencode";

import { detectSelectedRuntimes, type EnvironmentId } from "../runtime-detection";
import type {
  DoctorCategoryResult,
  DoctorCheckItem,
  DoctorDiagnosticsResult,
  DoctorRuntimeResult,
  DoctorStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Known environment IDs
// ---------------------------------------------------------------------------
const ALL_ENVIRONMENT_IDS: EnvironmentId[] = [
  "pi-development",
  "opencode-development",
  "claude-development",
  "codex-development",
];

// ---------------------------------------------------------------------------
// Known memory provider binaries (checked without instantiating providers)
// ---------------------------------------------------------------------------
const MEMORY_PROVIDERS = [
  { id: "engram", label: "Engram", command: "engram" },
  { id: "supermemory", label: "Supermemory", command: "supermemory" },
] as const;

// ---------------------------------------------------------------------------
// Known MCP server entries to validate in OpenCode's opencode.json
// ---------------------------------------------------------------------------
const KNOWN_OPENCODE_MCP_SERVERS = [
  { name: "supermemory", label: "Supermemory MCP" },
  { name: "codebase-memory-mcp", label: "Codebase Memory MCP" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns "ok" if no items are in error state, "error" if any item is in error, otherwise "warning". */
function deriveCategoryStatus(items: DoctorCheckItem[]): DoctorStatus {
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "warning")) return "warning";
  return "ok";
}

/** Check if a binary exists in PATH without instantiating any provider. */
function memoryBinaryAvailable(command: string): boolean {
  const path = process.env.PATH ?? "";
  const isWindows = process.platform === "win32";
  const suffixes = isWindows ? ["", ".exe"] : [""];
  return path.split(delimiter).some((dir) => {
    return suffixes.some((suffix) => {
      try {
        return existsSync(join(dir, command + suffix));
      } catch {
        return false;
      }
    });
  });
}

/** Read and parse opencode.json MCP section using sync fs (avoids async top-level issues). */
function readOpenCodeMcpSection(): Record<string, unknown> | null {
  try {
    const configPath = join(homedir(), ".config", "opencode", "opencode.json");
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return (parsed.mcp as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Runtime checks
// ---------------------------------------------------------------------------

function checkPiRuntime(command: string): DoctorRuntimeResult {
  const result: DoctorRuntimeResult = {
    runtimeId: "pi",
    name: "Pi",
    installed: true,
    checks: [],
  };

  // Version + config directory
  try {
    const inspection = inspectPiEnvironment({ command });
    result.version = inspection.version;
    result.checks.push({
      category: "Runtime",
      status: "ok",
      items: [
        {
          status: "ok",
          message:
            inspection.version !== "unknown"
              ? `Pi v${inspection.version} detected`
              : "Pi detected (version unknown)",
        },
      ],
    });
  } catch (err) {
    result.checks.push({
      category: "Runtime",
      status: "error",
      items: [{ status: "error", message: `Unable to inspect Pi runtime: ${redact(String(err))}` }],
    });
  }

  // Package review
  try {
    const review = reviewPiRequiredTools({ command });
    if (review.error) {
      result.checks.push({
        category: "Packages",
        status: "error",
        items: [{ status: "error", message: redact(review.error) }],
      });
    } else {
      const items: DoctorCheckItem[] = review.requiredTools.map((tool) => ({
        status: tool.installed ? "ok" : "error",
        message: `${tool.name}: ${tool.installed ? "installed" : "not found"}`,
        suggestion: tool.installed ? undefined : `Install Pi package: ${tool.name}`,
      }));
      result.checks.push({
        category: "Packages",
        status: deriveCategoryStatus(items),
        items,
      });
    }
  } catch (err) {
    result.checks.push({
      category: "Packages",
      status: "error",
      items: [{ status: "error", message: `Package review failed: ${redact(String(err))}` }],
    });
  }

  return result;
}

function checkOpenCodeRuntime(command: string): DoctorRuntimeResult {
  const result: DoctorRuntimeResult = {
    runtimeId: "opencode",
    name: "OpenCode",
    installed: true,
    checks: [],
  };

  // Version + config directory
  try {
    const inspection = inspectOpenCodeEnvironment({ command });
    result.version = inspection.version;
    result.checks.push({
      category: "Runtime",
      status: "ok",
      items: [
        {
          status: "ok",
          message:
            inspection.version !== "unknown"
              ? `OpenCode v${inspection.version} detected`
              : "OpenCode detected (version unknown)",
        },
      ],
    });
  } catch (err) {
    result.checks.push({
      category: "Runtime",
      status: "error",
      items: [{ status: "error", message: `Unable to inspect OpenCode runtime: ${redact(String(err))}` }],
    });
  }

  // Package review
  try {
    const review = reviewOpenCodeTools();
    if (review.error) {
      result.checks.push({
        category: "Packages",
        status: "error",
        items: [{ status: "error", message: redact(review.error) }],
      });
    } else {
      const items: DoctorCheckItem[] = review.tools.map((tool) => ({
        status: tool.installed ? "ok" : "error",
        message: `${tool.name}: ${tool.installed ? "installed" : "not found"}`,
        suggestion: tool.installed ? undefined : `Install OpenCode package: ${tool.name}`,
      }));
      result.checks.push({
        category: "Packages",
        status: deriveCategoryStatus(items),
        items,
      });
    }
  } catch (err) {
    result.checks.push({
      category: "Packages",
      status: "error",
      items: [{ status: "error", message: `Package review failed: ${redact(String(err))}` }],
    });
  }

  return result;
}

function checkClaudeOrCodexRuntime(runtime: "claude" | "codex", installed: boolean): DoctorRuntimeResult {
  const name = runtime === "claude" ? "Claude" : "Codex";
  return {
    runtimeId: runtime,
    name,
    installed,
    version: undefined,
    checks: [
      {
        category: "Runtime",
        status: installed ? "ok" : "warning",
        items: [
          installed
            ? { status: "ok", message: `${name} detected` }
            : {
                status: "warning",
                message: `${name} not detected in PATH`,
                suggestion: `Install ${name} to enable this runtime`,
              },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Memory provider checks
// ---------------------------------------------------------------------------

function checkMemoryProviders(): DoctorCategoryResult[] {
  const results: DoctorCategoryResult[] = [];

  for (const provider of MEMORY_PROVIDERS) {
    const items: DoctorCheckItem[] = [];
    try {
      const available = memoryBinaryAvailable(provider.command);
      items.push({
        status: available ? "ok" : "warning",
        message: available
          ? `${provider.label} binary found in PATH`
          : `${provider.label} binary not found in PATH`,
        suggestion: available
          ? undefined
          : `Install ${provider.label} or ensure it is on your PATH`,
      });
    } catch (err) {
      items.push({
        status: "error",
        message: `Unable to check ${provider.label}: ${redact(String(err))}`,
      });
    }

    results.push({
      category: provider.label,
      status: deriveCategoryStatus(items),
      items,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// MCP validation
// ---------------------------------------------------------------------------

function checkPiMcp(): DoctorCategoryResult {
  try {
    const validation = validateSupermemoryPiMcpConfig();
    const items: DoctorCheckItem[] = validation.diagnostics.map((d) => ({
      status: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "ok",
      message: redactDiagnostic(d).message,
    }));
    return {
      category: "Pi MCP",
      status: validation.ok ? "ok" : "error",
      items,
    };
  } catch (err) {
    return {
      category: "Pi MCP",
      status: "error",
      items: [{ status: "error", message: `MCP validation threw: ${redact(String(err))}` }],
    };
  }
}

function checkOpenCodeMcp(): DoctorCategoryResult {
  const items: DoctorCheckItem[] = [];

  try {
    const mcpSection = readOpenCodeMcpSection();
    if (!mcpSection) {
      items.push({
        status: "warning",
        message: "opencode.json not found or mcp section missing",
        suggestion: "Configure MCP servers in opencode.json to enable memory features",
      });
    } else {
      for (const known of KNOWN_OPENCODE_MCP_SERVERS) {
        const entry = mcpSection[known.name];
        if (entry && typeof entry === "object" && entry !== null) {
          const record = entry as Record<string, unknown>;
          const hasUrl = typeof record["url"] === "string";
          const hasType = typeof record["type"] === "string";
          items.push({
            status: hasUrl && hasType ? "ok" : "warning",
            message: `${known.label}: ${hasUrl && hasType ? "configured" : "partial config"}`,
            suggestion:
              hasUrl && hasType
                ? undefined
                : `${known.label} is missing required fields (url, type)`,
          });
        } else {
          items.push({
            status: "warning",
            message: `${known.label}: not configured`,
            suggestion: `Add ${known.name} to the mcp section in opencode.json`,
          });
        }
      }
    }
  } catch (err) {
    items.push({
      status: "error",
      message: `Unable to read opencode.json MCP section: ${redact(String(err))}`,
    });
  }

  return {
    category: "OpenCode MCP",
    status: deriveCategoryStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all doctor diagnostics and return a structured result.
 *
 * Never throws — every sub-check is wrapped in try/catch so one failure
 * does not prevent others from running (REQ-DIAG-007).
 *
 * @returns DoctorDiagnosticsResult
 */
export async function runDoctorDiagnostics(): Promise<DoctorDiagnosticsResult> {
  const runtimes: DoctorRuntimeResult[] = [];
  let memoryCritical = false;

  // 1. Runtime detection
  let runtimeStatuses: Awaited<ReturnType<typeof detectSelectedRuntimes>> = [];
  try {
    runtimeStatuses = detectSelectedRuntimes(ALL_ENVIRONMENT_IDS);
  } catch {
    runtimeStatuses = [];
  }

  // 2. Per-runtime checks
  for (const status of runtimeStatuses) {
    if (!status.installed) {
      const name = status.runtime.charAt(0).toUpperCase() + status.runtime.slice(1);
      runtimes.push({
        runtimeId: status.runtime,
        name,
        installed: false,
        version: undefined,
        checks: [
          {
            category: "Runtime",
            status: "warning",
            items: [
              {
                status: "warning",
                message: `${name} not detected`,
                suggestion: `Install ${name} to use it with Deck`,
              },
            ],
          },
        ],
      });
      continue;
    }

    if (status.runtime === "pi") {
      runtimes.push(checkPiRuntime(status.command!));
    } else if (status.runtime === "opencode") {
      runtimes.push(checkOpenCodeRuntime(status.command!));
    } else if (status.runtime === "claude" || status.runtime === "codex") {
      runtimes.push(checkClaudeOrCodexRuntime(status.runtime, status.installed));
    }
  }

  // 3. Memory providers
  let memoryResults: DoctorCategoryResult[] = [];
  try {
    memoryResults = checkMemoryProviders();
  } catch (err) {
    memoryResults = [
      {
        category: "Memory Providers",
        status: "error",
        items: [{ status: "error", message: `Memory check failed: ${redact(String(err))}` }],
      },
    ];
  }

  if (memoryResults.some((r) => r.status === "error")) {
    memoryCritical = true;
  }

  // 4. MCP validation (synchronous, called directly)
  const piMcpResult = checkPiMcp();
  const opencodeMcpResult = checkOpenCodeMcp();
  const mcpResults: DoctorCategoryResult[] = [piMcpResult, opencodeMcpResult];

  // 5. Determine hasCriticalErrors
  const noRuntimes = runtimes.length === 0 || runtimes.every((r) => r.installed === false);
  const hasCriticalErrors =
    noRuntimes ||
    memoryCritical ||
    mcpResults.some((r) => r.status === "error") ||
    runtimes.some((r) => r.checks.some((c) => c.category === "Runtime" && c.status === "error"));

  return {
    runtimes,
    memory: memoryResults,
    mcp: mcpResults,
    hasCriticalErrors,
  };
}