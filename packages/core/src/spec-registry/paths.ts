/**
 * OpenSpec path helpers for the Spec Registry.
 *
 * These functions compute paths within the OpenSpec directory layout.
 * They are pure functions — no filesystem access, no side effects.
 *
 * Layout:
 *   openspec/
 *     registry/             — registry index
 *     changes/{name}/       — one directory per change
 *       state.yaml          — change status/phase
 *       events.yaml         — event log
 *       proposal.md         — artifact files
 *       spec.md
 *       design.md
 *       tasks.md
 *       apply-progress.md
 *       verify-report.md
 *       review-report.md
 *       archive-report.md
 *     schemas/developer-team/ — custom schemas for Developer Team
 *       *.schema.json
 *       *-template.md
 */

import type { ArtifactKind } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OPENSPEC_ROOT = "openspec";
export const OPENSPEC_REGISTRY_DIR = "openspec/registry";
export const OPENSPEC_CHANGES_DIR = "openspec/changes";
export const OPENSPEC_SCHEMAS_DIR = "openspec/schemas/developer-team";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the registry directory path.
 */
export function registryPath(root: string): string {
  return `${root}/openspec/registry`;
}

/**
 * Returns the change directory for a given change name.
 */
export function changeDir(root: string, changeName: string): string {
  return `${root}/openspec/changes/${changeName}`;
}

/**
 * Returns the state.yaml path for a given change.
 */
export function statePath(root: string, changeName: string): string {
  return `${root}/openspec/changes/${changeName}/state.yaml`;
}

/**
 * Returns the events.yaml path for a given change.
 */
export function eventsPath(root: string, changeName: string): string {
  return `${root}/openspec/changes/${changeName}/events.yaml`;
}

/**
 * Maps an ArtifactKind to its filename.
 */
export function artifactFileName(kind: ArtifactKind): string {
  return `${kind}.md`;
}

/**
 * Returns the full path for an artifact file.
 */
export function artifactPath(
  root: string,
  changeName: string,
  kind: ArtifactKind,
): string {
  return `${root}/openspec/changes/${changeName}/${artifactFileName(kind)}`;
}

/**
 * Returns the path for a schema file under the Developer Team schemas directory.
 */
export function schemaPath(root: string, schemaFile: string): string {
  return `${root}/openspec/schemas/developer-team/${schemaFile}`;
}

/**
 * Returns the path for a template file under the Developer Team schemas directory.
 * Templates live alongside schemas for discoverability.
 */
export function templatesPath(root: string, templateFile: string): string {
  return `${root}/openspec/schemas/developer-team/${templateFile}`;
}
