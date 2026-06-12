/**
 * CLI adapter for `deck openspec validate`.
 *
 * This module:
 * - Resolves project root from args or cwd
 * - Calls core validator
 * - Renders JSON output (stable machine format) or human output (TTY detection)
 * - Maps severity to exit codes: 0 (no errors), 1 (errors found), 2 (runtime failure)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ParsedArgs } from "./cli-args";
import { validateOpenSpecRegistry } from "@deck/core/spec-registry";

/**
 * Result of running the validate command.
 */
export type ValidateCommandResult = {
  /** Exit code: 0 = success, 1 = errors found, 2 = runtime failure */
  exitCode: 0 | 1 | 2;
  /** JSON output (when --json flag is set) */
  json?: unknown;
  /** Human output (when --json is not set) */
  human?: string;
  /** Error message for runtime failures */
  error?: string;
};

/**
 * Run the `deck openspec validate` command.
 *
 * @param parsedArgs - Parsed CLI arguments
 * @returns Command result with exit code and output
 */
export async function runOpenspecValidate(
  parsedArgs: ParsedArgs & { command: "openspec-validate" }
): Promise<ValidateCommandResult> {
  const { flags } = parsedArgs;
  const rootDir = flags.root
    ? path.resolve(flags.root)
    : process.cwd();

  // Validate project root exists
  try {
    await fs.access(rootDir);
  } catch {
    return {
      exitCode: 2,
      error: `Project root not found: ${rootDir}`,
      json: {
        schema: "openspec-registry-validation-result-v1",
        ok: false,
        rootDir,
        error: `Project root not found: ${rootDir}`,
        summary: {
          totalChanges: 0,
          totalActiveChanges: 0,
          totalArchivedChanges: 0,
          totalErrors: 1,
          totalWarnings: 0,
          validChanges: 0,
          changesWithErrors: 0,
          changesWithWarnings: 0,
        },
        issues: [
          {
            severity: "error",
            rule: "runtime.error",
            message: `Project root not found: ${rootDir}`,
            path: rootDir,
          },
        ],
        changes: [],
      },
    };
  }

  try {
    // Call the core validator
    const result = await validateOpenSpecRegistry({
      rootDir,
      changeId: flags.changeId,
    });

    // Check if a specific change was requested but not found
    if (flags.changeId && result.changes.length === 0) {
      // Change not found - this is a runtime failure (exit 2)
      return {
        exitCode: 2,
        error: `Change not found: ${flags.changeId}`,
        json: {
          schema: "openspec-registry-validation-result-v1",
          ok: false,
          rootDir,
          error: `Change not found: ${flags.changeId}`,
          summary: {
            totalChanges: 0,
            totalActiveChanges: 0,
            totalArchivedChanges: 0,
            changesWithErrors: 0,
            changesWithWarnings: 0,
            totalErrors: 1,
            totalWarnings: 0,
            validChanges: 0,
          },
          issues: [
            {
              severity: "error",
              rule: "change.not_found",
              message: `Change not found: ${flags.changeId}`,
              path: rootDir,
              changeId: flags.changeId,
            },
          ],
          changes: [],
        },
      };
    }

    // Determine exit code
    const exitCode: 0 | 1 = result.summary.totalErrors > 0 ? 1 : 0;

    // JSON output mode
    if (flags.json) {
      return {
        exitCode,
        json: {
          schema: result.schema,
          ok: result.ok,
          command: "deck openspec validate",
          rootDir: result.rootDir,
          summary: result.summary,
          issues: result.issues,
          changes: result.changes,
        },
      };
    }

    // Human output mode
    const human = renderHumanOutput(result, flags.changeId);
    return {
      exitCode,
      human,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 2,
      error: message,
json: {
          schema: "openspec-registry-validation-result-v1",
          ok: false,
          rootDir,
          error: message,
          summary: {
            totalChanges: 0,
            totalActiveChanges: 0,
            totalArchivedChanges: 0,
            totalErrors: 1,
            totalWarnings: 0,
            validChanges: 0,
            changesWithErrors: 0,
            changesWithWarnings: 0,
          },
        issues: [
          {
            severity: "error",
            rule: "runtime.error",
            message,
            path: rootDir,
          },
        ],
        changes: [],
      },
    };
  }
}

/**
 * Render human-readable output.
 */
function renderHumanOutput(
  result: Awaited<ReturnType<typeof validateOpenSpecRegistry>>,
  changeId?: string
): string {
  const lines: string[] = [];

  lines.push(`OpenSpec Registry Validation`);
  lines.push(`========================`);
  lines.push(``);
  lines.push(`Root: ${result.rootDir}`);
  lines.push(
    `Summary: ${result.summary.totalChanges} changes, ` +
      `${result.summary.totalErrors} errors, ${result.summary.totalWarnings} warnings`
  );
  lines.push(``);

  if (result.issues.length === 0) {
    lines.push(`No issues found.`);
  } else {
    // Group issues by change
    const byChange = new Map<string, typeof result.issues>();
    for (const issue of result.issues) {
      const cid = issue.changeId || "(unknown)";
      if (!byChange.has(cid)) {
        byChange.set(cid, []);
      }
      byChange.get(cid)!.push(issue);
    }

    for (const [cid, issues] of byChange) {
      lines.push(`## ${cid}`);
      for (const issue of issues) {
        const icon = issue.severity === "error" ? "❌" : "⚠️";
        lines.push(`  ${icon} [${issue.severity}] ${issue.rule}`);
        lines.push(`     ${issue.message}`);
        if (issue.file) {
          lines.push(`     file: ${issue.file}`);
        }
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}