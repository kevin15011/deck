/**
 * RunnerAdapters — factory for resolving the appropriate RunnerAdapter by runnerId.
 *
 * This module provides the TUI layer with a simple way to get the correct adapter
 * without directly coupling to Pi or OpenCode imports.
 *
 * Design: runner-decoupling-refactor / design.md § AdapterRegistry
 */

import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import type { RunnerAdapter } from "@deck/core";

let _piAdapter: RunnerAdapter | undefined;
let _openCodeAdapter: RunnerAdapter | undefined;

/**
 * Get the RunnerAdapter for a given runner ID.
 *
 * @param runnerId - "pi" | "opencode" | "all"
 * @returns The corresponding RunnerAdapter instance
 */
export function getAdapter(runnerId: "pi" | "opencode" | "all"): RunnerAdapter {
  if (runnerId === "opencode" || runnerId === "all") {
    if (!_openCodeAdapter) {
      _openCodeAdapter = createOpenCodeRunnerAdapter();
    }
    return _openCodeAdapter;
  }
  // Default to Pi for "pi" or any other value
  if (!_piAdapter) {
    _piAdapter = createPiRunnerAdapter();
  }
  return _piAdapter;
}

/**
 * Get the Pi RunnerAdapter specifically.
 * Use this when you need Pi-specific behavior regardless of runnerScope.
 */
export function getPiAdapter(): RunnerAdapter {
  if (!_piAdapter) {
    _piAdapter = createPiRunnerAdapter();
  }
  return _piAdapter;
}

/**
 * Get the OpenCode RunnerAdapter specifically.
 * Use this when you need OpenCode-specific behavior regardless of runnerScope.
 */
export function getOpenCodeAdapter(): RunnerAdapter {
  if (!_openCodeAdapter) {
    _openCodeAdapter = createOpenCodeRunnerAdapter();
  }
  return _openCodeAdapter;
}