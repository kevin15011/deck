import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RunnerLaunchInput, RunnerLaunchPlan } from "@deck/core";
import type { SupermemoryRunnerLoopbackBridge } from "./supermemory-runtime-host";

const STALE_AFTER_MS = 24 * 3600 * 1000;
const PI_DIRECTORY_PREFIX = "pi-memory-";
const CODEX_DIRECTORY_PREFIX = "codex-memory-";

export type PiMemoryTokenHandoff = Readonly<{ tokenFile: string; remove(): void }>;

/**
 * Pi MCP stdio servers inherit the Pi environment, so the per-session loopback bearer token must never be placed
 * there. The token travels through a 0600 file in a 0700 per-session directory instead; only `deck-memory` reads it.
 * `baseDirectory` is the Deck session runtime directory (state home).
 */
export function createPiMemoryTokenHandoff(input: { token: string; baseDirectory: string; now?: () => number; runner?: "pi" | "codex" }): PiMemoryTokenHandoff {
  const now = input.now ?? Date.now;
  const DIRECTORY_PREFIX = input.runner === "codex" ? CODEX_DIRECTORY_PREFIX : PI_DIRECTORY_PREFIX;
  mkdirSync(input.baseDirectory, { recursive: true, mode: 0o700 });
  // Best-effort sweep of directories left behind by a crashed launch.
  try {
    for (const entry of readdirSync(input.baseDirectory)) {
      if (!entry.startsWith(DIRECTORY_PREFIX)) continue;
      const path = join(input.baseDirectory, entry);
      if (now() - statSync(path).mtimeMs > STALE_AFTER_MS) rmSync(path, { recursive: true, force: true });
    }
  } catch { /* the sweep never blocks a launch */ }
  const directory = mkdtempSync(join(input.baseDirectory, DIRECTORY_PREFIX));
  chmodSync(directory, 0o700);
  const tokenFile = join(directory, "token");
  writeFileSync(tokenFile, `${input.token}\n`, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  return Object.freeze({
    tokenFile,
    remove() {
      try { rmSync(directory, { recursive: true, force: true }); } catch { /* already gone */ }
    },
  });
}

/** Pi variant of the loopback overlay: endpoint plus token-file path; no bearer token, no Codex bridge variables. */
export function withPiMemoryLoopback(plan: RunnerLaunchPlan, bridge: SupermemoryRunnerLoopbackBridge, mode: RunnerLaunchInput["mode"], tokenFile: string): RunnerLaunchPlan {
  return {
    ...plan,
    envOverlay: {
      ...(plan.envOverlay ?? {}),
      DECK_RUNNER_MEMORY_ENDPOINT: { value: bridge.endpoint },
      DECK_RUNNER_MEMORY_TOKEN_FILE: { value: tokenFile },
    },
    executionClass: "first-class",
    bridgeBinding: { surface: "deck-runner-memory-loopback-v1", mode, evidence: "ephemeral-loopback-token" },
  };
}

/**
 * Codex variant: only the endpoint and the token-file path are exported (to the Deck memory MCP server, which Codex
 * lets forward exactly those two names). The launch plan keeps its own execution class and bridge binding because the
 * official Supermemory plugin owns automatic memory; this loopback serves the explicit tools only.
 */
export function withCodexMemoryToolsLoopback(plan: RunnerLaunchPlan, bridge: SupermemoryRunnerLoopbackBridge, tokenFile: string): RunnerLaunchPlan {
  return {
    ...plan,
    envOverlay: {
      ...(plan.envOverlay ?? {}),
      DECK_RUNNER_MEMORY_ENDPOINT: { value: bridge.endpoint },
      DECK_RUNNER_MEMORY_TOKEN_FILE: { value: tokenFile },
    },
  };
}
