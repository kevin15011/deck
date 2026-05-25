/**
 * Doctor report formatter.
 *
 * Renders a structured `DoctorDiagnosticsResult` to console output with
 * visual status indicators and actionable fix suggestions.
 */

import pc from "picocolors";
import type { DoctorCategoryResult, DoctorCheckItem, DoctorDiagnosticsResult, DoctorRuntimeResult, DoctorStatus, DoctorBinaryResult } from "./types";

// ---------------------------------------------------------------------------
// TTY detection
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY ?? false;

/** Wrap text in ANSI codes only when stdout is a TTY; otherwise return plain text. */
function c(ansiFn: (s: string) => string, text: string): string {
  return isTTY ? ansiFn(text) : text;
}

// ---------------------------------------------------------------------------
// Status indicator icons
// ---------------------------------------------------------------------------

const ICONS: Record<DoctorStatus, string> = {
  ok: "✓",
  warning: "⚠",
  error: "✗",
};

const STATUS_COLOR: Record<DoctorStatus, (s: string) => string> = {
  ok: pc.green,
  warning: pc.yellow,
  error: pc.red,
};

// ---------------------------------------------------------------------------
// Section rendering helpers
// ---------------------------------------------------------------------------

/** Render a single check item with icon, message, and optional suggestion. */
function renderItem(item: DoctorCheckItem): void {
  const icon = c(STATUS_COLOR[item.status], ICONS[item.status]);
  const message = c(
    item.status === "error" ? pc.red : item.status === "warning" ? pc.yellow : pc.white,
    item.message,
  );

  if (item.suggestion && (item.status === "warning" || item.status === "error")) {
    console.log(`  ${icon} ${message}`);
    console.log(`    → ${c(pc.dim, item.suggestion)}`);
  } else {
    console.log(`  ${icon} ${message}`);
  }
}

/** Render a category section with its status header and all items. */
function renderCategory(category: DoctorCategoryResult): void {
  const icon = c(STATUS_COLOR[category.status], ICONS[category.status]);
  const headerColor = category.status === "error" ? pc.red : category.status === "warning" ? pc.yellow : pc.green;
  console.log(`${c(headerColor, icon)} ${c(pc.bold, category.category)}`);

  for (const item of category.items) {
    renderItem(item);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Runtime section rendering
// ---------------------------------------------------------------------------

function renderRuntime(runtime: DoctorRuntimeResult): void {
  const installed = runtime.installed;

  if (!installed) {
    const icon = c(pc.red, ICONS.error);
    console.log(`${icon} ${c(pc.bold, runtime.name)} — ${c(pc.dim, "not installed")}`);
    for (const category of runtime.checks) {
      for (const item of category.items) {
        if (item.suggestion) {
          console.log(`    → ${c(pc.dim, item.suggestion)}`);
        }
      }
    }
    console.log();
    return;
  }

  // Installed — show version if available and render sub-categories
  const versionSuffix = runtime.version ? ` (${c(pc.dim, runtime.version)})` : "";
  const runtimeOk = runtime.checks.every((c) => c.status === "ok");
  const runtimeIcon = c(runtimeOk ? pc.green : runtime.checks.some((c) => c.status === "error") ? pc.red : pc.yellow,
    runtimeOk ? ICONS.ok : runtime.checks.some((c) => c.status === "error") ? ICONS.error : ICONS.warning);

  console.log(`${runtimeIcon} ${c(pc.bold, runtime.name)}${versionSuffix}`);

  for (const category of runtime.checks) {
    renderCategory(category);
  }
}

// ---------------------------------------------------------------------------
// Binary section rendering
// ---------------------------------------------------------------------------

/**
 * Render binary-specific diagnostics.
 */
function renderBinary(binary: DoctorBinaryResult): void {
  // Build Info
  if (binary.buildInfo) {
    console.log(c(pc.bold, "▸ Binary"));
    console.log();
    console.log(`  ${c(pc.green, ICONS.ok)} ${c(pc.bold, "Build Information")}`);
    console.log(`    Version:   ${binary.buildInfo.version}`);
    console.log(`    Commit:   ${binary.buildInfo.commit}`);
    console.log(`    Date:     ${binary.buildInfo.date}`);
    console.log(`    Target:   ${binary.buildInfo.target}`);
    console.log(`    Channel:  ${binary.buildInfo.channel}`);
    console.log();
  }

  // Executable Path
  if (binary.executablePath) {
    console.log(`  ${c(pc.green, ICONS.ok)} ${c(pc.bold, "Executable")}`);
    console.log(`    Path:     ${binary.executablePath}`);
    console.log();
  }

  // Global Config
  console.log(
    `  ${binary.globalConfigExists ? c(pc.green, ICONS.ok) : c(pc.yellow, ICONS.warning)} ${c(pc.bold, "Global Config")}`
  );
  console.log(`    Directory: ${binary.globalConfigDir}`);
  console.log(`    Exists:   ${binary.globalConfigExists ? "Yes" : "No (will be created)"}`);
  console.log();

  // Bundled Skills
  console.log(c(pc.green, ICONS.ok) + " Bundled Skills: " + binary.bundledSkillCount);
  console.log();

  // Upgrade Available
  if (binary.upgradeAvailable) {
    console.log(c(pc.green, ICONS.ok) + " Upgrade available");
  } else {
    console.log(c(pc.dim, "─") + " No upgrade available");
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the doctor diagnostics result to stdout.
 *
 * Output is organized in sections: Runtimes, Packages (per runtime),
 * Memory Providers, MCP Configuration, and Binary (if running as binary).
 *
 * Each item shows a status icon (✓/⚠/✗), the diagnostic message,
 * and an actionable fix suggestion for non-OK items.
 *
 * ANSI colors are suppressed when stdout is not a TTY (non-interactive
 * pipe or redirect), satisfying REQ-RPT-004 and REQ-RPT-005.
 */
export function renderDoctorReport(result: DoctorDiagnosticsResult): void {
  console.log();
  console.log(c(pc.bold, "═".repeat(50)));

  const titleColor = result.hasCriticalErrors ? pc.red : pc.green;
  const titleText = result.hasCriticalErrors ? "✗ Doctor Report — Critical Issues Found" : "✓ Doctor Report — All Checks Passed";
  console.log(c(titleColor, ` ${titleText} `));
  console.log(c(pc.bold, "═".repeat(50)));
  console.log();

  // ── Runtimes ─────────────────────────────────────────────────────────────
  if (result.runtimes.length > 0) {
    console.log(c(pc.bold, "▸ Runtimes"));
    console.log();
    for (const runtime of result.runtimes) {
      renderRuntime(runtime);
    }
  }

  // ── Memory Providers ────────────────────────────────────────────────────
  if (result.memory.length > 0) {
    console.log(c(pc.bold, "▸ Memory Providers"));
    console.log();
    for (const category of result.memory) {
      renderCategory(category);
    }
  }

  // ── MCP Configuration ───────────────────────────────────────────────────
  if (result.mcp.length > 0) {
    console.log(c(pc.bold, "▸ MCP Configuration"));
    console.log();
    for (const category of result.mcp) {
      renderCategory(category);
    }
  }

  // ── Binary (if available) ─────────────────────────────────────────
  if (result.binary) {
    renderBinary(result.binary);
  }

  // Footer summary
  const allOk = result.runtimes.every((r) => r.checks.every((c) => c.status === "ok"))
    && result.memory.every((c) => c.status === "ok")
    && result.mcp.every((c) => c.status === "ok");

  if (allOk && !result.hasCriticalErrors) {
    console.log(c(pc.green, "All checks passed. Your environment looks good!"));
  } else if (result.hasCriticalErrors) {
    console.log(c(pc.red, "Critical issues were detected. Please fix the errors above."));
  } else {
    console.log(c(pc.yellow, "Some warnings were detected. Review the suggestions above."));
  }
  console.log();
}

/**
 * Determine whether `deck doctor` should exit with a non-zero code.
 *
 * Returns `true` when `result.hasCriticalErrors` is `true`, meaning
 * at least one critical check failed that prevents Deck from functioning.
 * Returns `false` when there are only warnings or all checks pass,
 * satisfying REQ-NF-002.
 */
export function shouldExitWithError(result: DoctorDiagnosticsResult): boolean {
  return result.hasCriticalErrors === true;
}
