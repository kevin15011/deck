import { constants, existsSync, mkdirSync, renameSync, statSync, writeFileSync, accessSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { SupermemoryRuntimeMetric } from "@deck/adapter-supermemory/runtime";

export type SupermemoryObservabilitySink = Readonly<{
  path: string;
  healthy: boolean;
  diagnostics: readonly string[];
  observe(metric: SupermemoryRuntimeMetric): void;
  health(): { healthy: boolean; diagnostics: readonly string[] };
}>;

const MAX_SINK_BYTES = 256 * 1024;

export function createSupermemoryObservabilitySink(input: { stateHome?: string; now?: () => string } = {}): SupermemoryObservabilitySink {
  const stateHome = input.stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const path = join(stateHome, "deck", "supermemory-runtime.jsonl");
  const diagnostics: string[] = [];
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    rotateIfNeeded(path);
    writeFileSync(path, "", { flag: "a", mode: 0o600 });
  } catch (error) {
    diagnostics.push(`Supermemory observability sink is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { path, healthy: false, diagnostics, observe() {}, health: () => ({ healthy: false, diagnostics }) };
  }

  let healthy = true;

  return {
    path,
    get healthy() { return healthy; },
    diagnostics,
    observe(metric) {
      try {
        rotateIfNeeded(path);
        const event = {
          schema: "deck.supermemory.runtime.metric.v1",
          at: input.now?.() ?? new Date().toISOString(),
          provider: metric.provider,
          operation: metric.operation,
          channel: metric.channel,
          status: metric.status,
          reason: metric.reason,
          durationMs: metric.durationMs,
          runnerId: metric.runnerId,
          role: metric.role,
          scopeFingerprint: metric.scopeFingerprint,
          approximateInputTokens: metric.approximateInputTokens,
          approximateInjectedTokens: metric.approximateInjectedTokens,
          resultCount: metric.resultCount,
          dependency: metric.dependency,
        };
        writeFileSync(path, `${JSON.stringify(event)}\n`, { flag: "a", mode: 0o600 });
      } catch (error) {
        healthy = false;
        diagnostics.push(`Supermemory observability write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    health: () => ({ healthy, diagnostics }),
  };
}

export function checkSupermemoryObservabilitySink(input: { stateHome?: string } = {}): { ok: boolean; path: string; diagnostics: readonly string[] } {
  const stateHome = input.stateHome ?? process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const path = join(stateHome, "deck", "supermemory-runtime.jsonl");
  const diagnostics: string[] = [];
  const directory = dirname(path);
  try {
    if (existsSync(path)) {
      const stat = statSync(path);
      if (!stat.isFile()) diagnostics.push("Supermemory observability path exists but is not a regular file.");
      if ((stat.mode & 0o077) !== 0) diagnostics.push("Supermemory observability file is not owner-only.");
      accessSync(path, constants.R_OK | constants.W_OK);
    } else if (existsSync(directory)) {
      const stat = statSync(directory);
      if (!stat.isDirectory()) diagnostics.push("Supermemory observability parent path exists but is not a directory.");
      if ((stat.mode & 0o077) !== 0) diagnostics.push("Supermemory observability directory is not owner-only.");
      accessSync(directory, constants.R_OK | constants.W_OK | constants.X_OK);
      diagnostics.push("Supermemory observability file is not initialized yet; Doctor did not create it.");
    } else {
      diagnostics.push("Supermemory observability directory is not initialized yet; Doctor did not create it.");
    }
  } catch (error) {
    diagnostics.push(`Supermemory observability sink is not currently writable/readable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: diagnostics.every((diagnostic) => /not initialized yet/.test(diagnostic)), path, diagnostics };
}

function rotateIfNeeded(path: string): void {
  if (!existsSync(path)) return;
  if (statSync(path).size <= MAX_SINK_BYTES) return;
  renameSync(path, `${path}.1`);
}
