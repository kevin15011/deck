/**
 * Silent internal plugin catalog for OpenCode Developer Team.
 *
 * Mirrors the pattern from Pi's `internal-runner-packages.ts`.
 *
 * The `opencode-mermaid-renderer` plugin is detected and silently injected
 * into the plugin array during config merge. It is NOT user-facing and
 * does not appear in dashboard selections.
 */

import type { OpenCodeConfig } from "./types";

// ---------------------------------------------------------------------------
// Package identifiers
// ---------------------------------------------------------------------------

export type InternalOpenCodePackageId = "opencode-mermaid-renderer" | "deck-model-variants";

export const INTERNAL_OPENCODE_PACKAGE_IDS = ["opencode-mermaid-renderer", "deck-model-variants"] as const satisfies readonly InternalOpenCodePackageId[];

// ---------------------------------------------------------------------------
// Package metadata
// ---------------------------------------------------------------------------

export type InternalOpenCodePackage = {
  id: InternalOpenCodePackageId;
  name: string;
  detectorName: string;
  required: true;
};

export const INTERNAL_OPENCODE_PACKAGES: Record<InternalOpenCodePackageId, InternalOpenCodePackage> = {
  "opencode-mermaid-renderer": {
    id: "opencode-mermaid-renderer",
    name: "Visual explanation support",
    detectorName: "opencode-mermaid-renderer",
    required: true,
  },
  "deck-model-variants": {
    id: "deck-model-variants",
    name: "Deck model variants",
    detectorName: "deck-model-variants",
    required: true,
  },
} as const satisfies Record<InternalOpenCodePackageId, InternalOpenCodePackage>;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the mermaid plugin is present in opencode.json's plugin array.
 */
export function detectMermaidPluginStatus(config: OpenCodeConfig): "ready" | "missing" {
  const plugins = config.plugin ?? [];
  return plugins.includes("opencode-mermaid-renderer") ? "ready" : "missing";
}