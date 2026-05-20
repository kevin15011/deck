/**
 * Internal runner packages catalog for Pi.
 *
 * This catalog defines internal (non-user-facing) packages required for runner operation.
 * These packages are installed silently without dashboard selection and must not appear
 * in `PI_INSTALLABLE_TOOLS` or user-facing capability summaries.
 *
 * Design: new internal catalog, not `PI_INSTALLABLE_TOOLS`. Keeps silent required support
 * out of user-facing package choices while reusing the existing Pi install executor path.
 */

import type { PiPreflightResult } from "./preflight";
import type { PiRequiredToolsReview } from "./required-tools";

// ---------------------------------------------------------------------------
// Package identifiers
// ---------------------------------------------------------------------------

export type InternalRunnerPackageId = "pi-mermaid";

export const INTERNAL_RUNNER_PACKAGE_IDS = ["pi-mermaid"] as const satisfies readonly InternalRunnerPackageId[];

// ---------------------------------------------------------------------------
// Package metadata
// ---------------------------------------------------------------------------

export type InternalRunnerPackageSource = `npm:${string}`;

export type InternalRunnerPackageInstallKind = "npm-package";

export type InternalRunnerPackage = {
  id: InternalRunnerPackageId;
  /** Human-readable name for diagnostics. */
  name: string;
  /** Package source spec passed to `pi install`. */
  source: InternalRunnerPackageSource;
  installKind: InternalRunnerPackageInstallKind;
  /** Names used to detect whether the package is already installed. */
  detectorNames: string[];
  /** Whether this package is always required (true) or optional (false). */
  required: true;
};

export const INTERNAL_RUNNER_PACKAGES: Record<InternalRunnerPackageId, InternalRunnerPackage> = {
  "pi-mermaid": {
    id: "pi-mermaid",
    name: "Visual explanation support",
    source: "npm:pi-mermaid",
    installKind: "npm-package",
    detectorNames: ["pi-mermaid", "npm:pi-mermaid"],
    required: true,
  },
} as const satisfies Record<InternalRunnerPackageId, InternalRunnerPackage>;

// ---------------------------------------------------------------------------
// Idempotent install outcome statuses
// ---------------------------------------------------------------------------

/**
 * Externally observable status for an internal package install operation.
 * Covers REQ-ADAPTER-001 idempotent outcomes.
 */
export type InternalRunnerPackageStatus =
  | "not-checked"   // Availability has not been validated yet (e.g., review/preflight data absent)
  | "ready"         // Required package is present and usable
  | "missing"       // Required package is not present
  | "installing"    // Package is being installed
  | "installed"     // Package was installed successfully
  | "unchanged"     // Package was already present; no install action needed
  | "skipped"       // Package was skipped (e.g., validation failed gracefully)
  | "updated"       // Package was updated to a newer version
  | "created"       // Package was newly created/initialised
  | "failed"        // Validation or installation failed
  | "conflict";     // Install cannot proceed due to a conflicting existing item

// ---------------------------------------------------------------------------
// State record
// ---------------------------------------------------------------------------

export type InternalRunnerPackageState = {
  status: InternalRunnerPackageStatus;
  /** Installed detector name that matched, if any. */
  matchedDetectorName?: string;
  diagnostics: string[];
};

// ---------------------------------------------------------------------------
// Install action metadata
// ---------------------------------------------------------------------------

/**
 * Install action produced by the plan phase for a missing internal package.
 * Downstream tasks (Tasks 5–6) use this to schedule automatic installs.
 */
export type InternalRunnerPackageInstallAction = {
  packageId: InternalRunnerPackageId;
  name: string;
  source: InternalRunnerPackageSource;
  installKind: InternalRunnerPackageInstallKind;
  reason: string;
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the status represents a final non-error outcome where
 * no further action is needed.
 */
export function isTerminalStatus(status: InternalRunnerPackageStatus): boolean {
  return status === "ready" || status === "unchanged" || status === "skipped";
}

/**
 * Returns true when the status represents a final error outcome.
 */
export function isErrorStatus(status: InternalRunnerPackageStatus): boolean {
  return status === "failed" || status === "conflict";
}

/**
 * Returns true when the status represents an action-pending or in-progress
 * outcome where an install should be attempted.
 * "not-checked" is intentionally excluded — when review/preflight data is absent,
 * we surface validation feedback rather than assuming the package is missing.
 */
export function isInstallableStatus(status: InternalRunnerPackageStatus): boolean {
  return status === "missing";
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function normalizePackageName(name: string): string {
  return name
    .replace(/^npm:/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildInstalledPackageNameSet(review: PiRequiredToolsReview | undefined): Set<string> {
  const values = [
    ...(review?.installedPackages ?? []),
    ...(review?.requiredTools.filter((tool) => tool.installed).map((tool) => tool.name) ?? []),
    ...(review?.tools.filter((tool) => tool.available === "found" || tool.ready === "ready").map((tool) => tool.name) ?? []),
  ];

  return new Set(values.map(normalizePackageName));
}

/**
 * Detect the status of a single internal runner package.
 *
 * Follows validation-before-install semantics (REQ-ADAPTER-002, REQ-PIINSTALL-002).
 * When review/preflight data is absent, returns "not-checked" rather than "missing"
 * to avoid scheduling an automatic install without evidence (Fix #4).
 *
 * @param packageId  - Internal package identifier.
 * @param review     - Preflight/required-tools review data from the Pi runner.
 * @param preflight  - Optional full preflight result for additional diagnostics.
 */
export function detectInternalRunnerPackageStatus(
  packageId: InternalRunnerPackageId,
  review: PiRequiredToolsReview | undefined,
  _preflight?: PiPreflightResult,
): InternalRunnerPackageState {
  const pkg = INTERNAL_RUNNER_PACKAGES[packageId];

  // Fix #4: Absent review/preflight data means we cannot validate presence.
  // Return "not-checked" and surface validation feedback instead of assuming missing.
  if (review === undefined) {
    return {
      status: "not-checked",
      diagnostics: [`${pkg.name} could not be verified — review data is not available.`],
    };
  }

  const installedNames = buildInstalledPackageNameSet(review);

  const matched = pkg.detectorNames.find((detector) => installedNames.has(normalizePackageName(detector)));

  if (matched) {
    return {
      status: "ready",
      matchedDetectorName: matched,
      diagnostics: [`${pkg.name} (${matched}) is installed and ready.`],
    };
  }

  return {
    status: "missing",
    diagnostics: [`${pkg.name} is not installed.`],
  };
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

/**
 * Returns the install action for a missing internal package, or undefined if
 * the package is already present.
 *
 * Produces the silent automatic install action title used by Task 5
 * (capability-plan.ts): "Install visual explanation support".
 *
 * Does NOT return an install action for "not-checked" — that status surfaces
 * validation feedback instead (Fix #4).
 */
export function getInternalRunnerPackageInstallAction(
  packageId: InternalRunnerPackageId,
  review: PiRequiredToolsReview | undefined,
  _preflight?: PiPreflightResult,
): InternalRunnerPackageInstallAction | undefined {
  const pkg = INTERNAL_RUNNER_PACKAGES[packageId];
  const state = detectInternalRunnerPackageStatus(packageId, review, _preflight);

  // Fix #4: Do not schedule install when status is "not-checked" — surface validation feedback instead.
  if (state.status === "ready" || state.status === "not-checked") {
    return undefined;
  }

  return {
    packageId: pkg.id,
    name: pkg.name,
    source: pkg.source,
    installKind: pkg.installKind,
    reason: state.diagnostics[0] ?? `${pkg.name} is required but not installed.`,
  };
}

/**
 * Returns all internal runner package install actions for missing packages.
 */
export function getAllInternalRunnerPackageInstallActions(
  review: PiRequiredToolsReview | undefined,
  _preflight?: PiPreflightResult,
): InternalRunnerPackageInstallAction[] {
  return INTERNAL_RUNNER_PACKAGE_IDS
    .map((id) => getInternalRunnerPackageInstallAction(id, review, _preflight))
    .filter((action): action is InternalRunnerPackageInstallAction => action !== undefined);
}

// ---------------------------------------------------------------------------
// Status diagnostic helpers (for review / action-runner feedback)
// ---------------------------------------------------------------------------

/**
 * Maps an InternalRunnerPackageStatus to a minimal user-facing feedback string
 * suitable for display in the Review & Install section.
 *
 * Covers REQ-DASH-003: minimal install/review feedback only.
 * Covers REQ-ADAPTER-003: technical package name may appear in diagnostics only.
 */
export function getInternalPackageStatusFeedback(status: InternalRunnerPackageStatus): string {
  switch (status) {
    case "ready":
      return "Visual explanation support: ready";
    case "unchanged":
    case "skipped":
      return "Visual explanation support: unchanged";
    case "installed":
    case "created":
    case "updated":
      return "Visual explanation support: installed";
    case "installing":
      return "Visual explanation support: installing";
    case "conflict":
      return "Visual explanation support: conflict";
    case "failed":
      return "Visual explanation support: failed";
    case "missing":
      return "Visual explanation support: missing";
    case "not-checked":
      return "Visual explanation support: could not verify";
  }
}

/**
 * Returns the error code string for a failed status, matching Spec error contracts.
 *
 * Error codes:
 * - "visual_support_validation_failed": Could not verify Pi visual explanation support.
 * - "visual_support_install_failed":    Could not install Pi visual explanation support.
 * - "visual_skill_conflict":            Visual explanation skill could not be installed because
 *                                       an existing skill conflicts.
 */
export function getInternalPackageErrorCode(status: InternalRunnerPackageStatus): string | undefined {
  switch (status) {
    case "failed":
      return "visual_support_validation_failed";
    case "conflict":
      return "visual_skill_conflict";
    default:
      return undefined;
  }
}

/**
 * Returns the diagnostic message for a failed status, matching Spec error contracts.
 */
export function getInternalPackageErrorMessage(
  status: InternalRunnerPackageStatus,
  packageId: InternalRunnerPackageId,
): string | undefined {
  const code = getInternalPackageErrorCode(status);
  if (!code) return undefined;

  if (code === "visual_support_validation_failed") {
    return "Could not verify Pi visual explanation support.";
  }
  if (code === "visual_support_install_failed") {
    return "Could not install Pi visual explanation support.";
  }
  if (code === "visual_skill_conflict") {
    const pkg = INTERNAL_RUNNER_PACKAGES[packageId];
    return `Visual explanation skill could not be installed because an existing skill conflicts.`;
  }
  return undefined;
}
