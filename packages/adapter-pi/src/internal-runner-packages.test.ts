import { describe, expect, test } from "bun:test";

import {
  INTERNAL_RUNNER_PACKAGE_IDS,
  INTERNAL_RUNNER_PACKAGES,
  detectInternalRunnerPackageStatus,
  getAllInternalRunnerPackageInstallActions,
  getInternalPackageErrorCode,
  getInternalPackageErrorMessage,
  getInternalPackageStatusFeedback,
  getInternalRunnerPackageInstallAction,
  isErrorStatus,
  isInstallableStatus,
  isTerminalStatus,
  type InternalRunnerPackageStatus,
} from "./internal-runner-packages";
import type { PiRequiredToolsReview } from "./required-tools";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeReview = (installedPackages: string[] = [], requiredTools: { name: string; installed: boolean }[] = [], tools: { name: string; available?: "found"; ready?: "ready" }[] = []): PiRequiredToolsReview =>
  ({
    installedPackages,
    requiredTools,
    tools,
  }) as PiRequiredToolsReview;

// ---------------------------------------------------------------------------
// Catalog structure
// ---------------------------------------------------------------------------

describe("INTERNAL_RUNNER_PACKAGES catalog", () => {
  test("defines pi-mermaid", () => {
    expect(INTERNAL_RUNNER_PACKAGES["pi-mermaid"]).toBeDefined();
  });

  test("pi-mermaid has required source and detector names", () => {
    const pkg = INTERNAL_RUNNER_PACKAGES["pi-mermaid"];
    expect(pkg.source).toBe("npm:pi-mermaid");
    expect(pkg.detectorNames).toContain("pi-mermaid");
    expect(pkg.detectorNames).toContain("npm:pi-mermaid");
    expect(pkg.required).toBe(true);
  });

  test("INTERNAL_RUNNER_PACKAGE_IDS includes pi-mermaid only", () => {
    expect(INTERNAL_RUNNER_PACKAGE_IDS).toEqual(["pi-mermaid"]);
  });
});

// ---------------------------------------------------------------------------
// Status detection
// ---------------------------------------------------------------------------

describe("detectInternalRunnerPackageStatus", () => {
  test("pi-mermaid: ready when installedPackages contains pi-mermaid", () => {
    const review = makeReview(["pi-mermaid"]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
    expect(state.matchedDetectorName).toBe("pi-mermaid");
    expect(state.diagnostics).toHaveLength(1);
  });

  test("pi-mermaid: ready when installedPackages contains npm:pi-mermaid (prefix stripped during match)", () => {
    const review = makeReview(["npm:pi-mermaid"]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
    // matchedDetectorName reflects the detector entry that matched; npm: prefix is normalized internally
    expect(state.matchedDetectorName).toBeDefined();
  });

  test("pi-mermaid: ready when requiredTools contains pi-mermaid", () => {
    const review = makeReview([], [{ name: "pi-mermaid", installed: true }]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
  });

  test("pi-mermaid: ready when tools contains pi-mermaid with available=found", () => {
    const review = makeReview([], [], [{ name: "pi-mermaid", available: "found" }]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
  });

  test("pi-mermaid: ready when tools contains pi-mermaid with ready=ready", () => {
    const review = makeReview([], [], [{ name: "pi-mermaid", ready: "ready" }]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
  });

  // Fix #4: Absent review data → "not-checked" to avoid assuming package is missing
  test("pi-mermaid: not-checked when review is undefined (Fix #4: not missing)", () => {
    const state = detectInternalRunnerPackageStatus("pi-mermaid", undefined);
    expect(state.status).toBe("not-checked");
    expect(state.diagnostics[0]).toContain("could not be verified");
  });

  test("pi-mermaid: missing when review has no matching entries", () => {
    const review = makeReview(["some-other-package"]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("missing");
  });

  test("pi-mermaid: detection is case-insensitive", () => {
    const review = makeReview(["PI-MERMAID"]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
  });

  test("pi-mermaid: detection strips npm: prefix", () => {
    const review = makeReview(["npm:pi-mermaid"]);
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.status).toBe("ready");
  });

  test("pi-mermaid: missing diagnostic includes package name", () => {
    const review = makeReview();
    const state = detectInternalRunnerPackageStatus("pi-mermaid", review);
    expect(state.diagnostics[0]).toContain("Visual explanation support");
  });
});

// ---------------------------------------------------------------------------
// Install action generation
// ---------------------------------------------------------------------------

describe("getInternalRunnerPackageInstallAction", () => {
  test("returns undefined when pi-mermaid is ready", () => {
    const review = makeReview(["pi-mermaid"]);
    const action = getInternalRunnerPackageInstallAction("pi-mermaid", review);
    expect(action).toBeUndefined();
  });

  test("returns install action when pi-mermaid is missing", () => {
    const review = makeReview();
    const action = getInternalRunnerPackageInstallAction("pi-mermaid", review);
    expect(action).toBeDefined();
    expect(action!.packageId).toBe("pi-mermaid");
    expect(action!.source).toBe("npm:pi-mermaid");
    expect(action!.installKind).toBe("npm-package");
    expect(action!.name).toBe("Visual explanation support");
    expect(action!.reason).toContain("not installed");
  });

  test("returns undefined when pi-mermaid is ready via requiredTools", () => {
    const review = makeReview([], [{ name: "pi-mermaid", installed: true }]);
    const action = getInternalRunnerPackageInstallAction("pi-mermaid", review);
    expect(action).toBeUndefined();
  });
});

describe("getAllInternalRunnerPackageInstallActions", () => {
  test("returns empty array when all packages are ready", () => {
    const review = makeReview(["pi-mermaid"]);
    const actions = getAllInternalRunnerPackageInstallActions(review);
    expect(actions).toHaveLength(0);
  });

  test("returns one action for missing pi-mermaid", () => {
    const review = makeReview();
    const actions = getAllInternalRunnerPackageInstallActions(review);
    expect(actions).toHaveLength(1);
    expect(actions[0].packageId).toBe("pi-mermaid");
  });
});

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

describe("isTerminalStatus", () => {
  const cases: [InternalRunnerPackageStatus, boolean][] = [
    ["ready", true],
    ["unchanged", true],
    ["skipped", true],
    ["missing", false],
    ["not-checked", false],
    ["installing", false],
    ["installed", false],
    ["created", false],
    ["updated", false],
    ["failed", false],
    ["conflict", false],
  ];

  test.each(cases)("isTerminalStatus(%s) = %s", (status, expected) => {
    expect(isTerminalStatus(status)).toBe(expected);
  });
});

describe("isErrorStatus", () => {
  const cases: [InternalRunnerPackageStatus, boolean][] = [
    ["failed", true],
    ["conflict", true],
    ["ready", false],
    ["unchanged", false],
    ["skipped", false],
    ["missing", false],
    ["not-checked", false],
    ["installing", false],
    ["installed", false],
    ["created", false],
    ["updated", false],
  ];

  test.each(cases)("isErrorStatus(%s) = %s", (status, expected) => {
    expect(isErrorStatus(status)).toBe(expected);
  });
});

describe("isInstallableStatus", () => {
  // Fix #4: not-checked is NOT installable — when review data is absent, we surface
  // validation feedback rather than assuming the package is missing.
  const cases: [InternalRunnerPackageStatus, boolean][] = [
    ["missing", true],
    ["not-checked", false],  // changed: review data absent = not-checked, not installable
    ["ready", false],
    ["unchanged", false],
    ["skipped", false],
    ["installing", false],
    ["installed", false],
    ["created", false],
    ["updated", false],
    ["failed", false],
    ["conflict", false],
  ];

  test.each(cases)("isInstallableStatus(%s) = %s", (status, expected) => {
    expect(isInstallableStatus(status)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Feedback helpers
// ---------------------------------------------------------------------------

describe("getInternalPackageStatusFeedback", () => {
  test("returns minimal feedback strings for each status", () => {
    expect(getInternalPackageStatusFeedback("ready")).toBe("Visual explanation support: ready");
    expect(getInternalPackageStatusFeedback("unchanged")).toBe("Visual explanation support: unchanged");
    expect(getInternalPackageStatusFeedback("skipped")).toBe("Visual explanation support: unchanged");
    expect(getInternalPackageStatusFeedback("installed")).toBe("Visual explanation support: installed");
    expect(getInternalPackageStatusFeedback("created")).toBe("Visual explanation support: installed");
    expect(getInternalPackageStatusFeedback("updated")).toBe("Visual explanation support: installed");
    expect(getInternalPackageStatusFeedback("installing")).toBe("Visual explanation support: installing");
    expect(getInternalPackageStatusFeedback("missing")).toBe("Visual explanation support: missing");
    // Fix #4: not-checked means review data absent — surface "could not verify" instead of "missing"
    expect(getInternalPackageStatusFeedback("not-checked")).toBe("Visual explanation support: could not verify");
    expect(getInternalPackageStatusFeedback("conflict")).toBe("Visual explanation support: conflict");
    expect(getInternalPackageStatusFeedback("failed")).toBe("Visual explanation support: failed");
  });
});

describe("getInternalPackageErrorCode", () => {
  test("maps failed to visual_support_validation_failed", () => {
    expect(getInternalPackageErrorCode("failed")).toBe("visual_support_validation_failed");
  });

  test("maps conflict to visual_skill_conflict", () => {
    expect(getInternalPackageErrorCode("conflict")).toBe("visual_skill_conflict");
  });

  test("returns undefined for non-error statuses", () => {
    expect(getInternalPackageErrorCode("ready")).toBeUndefined();
    expect(getInternalPackageErrorCode("missing")).toBeUndefined();
    expect(getInternalPackageErrorCode("installed")).toBeUndefined();
  });
});

describe("getInternalPackageErrorMessage", () => {
  test("returns validation message for failed status", () => {
    const msg = getInternalPackageErrorMessage("failed", "pi-mermaid");
    expect(msg).toBe("Could not verify Pi visual explanation support.");
  });

  test("returns conflict message for conflict status", () => {
    const msg = getInternalPackageErrorMessage("conflict", "pi-mermaid");
    expect(msg).toBe("Visual explanation skill could not be installed because an existing skill conflicts.");
  });

  test("returns undefined for non-error statuses", () => {
    expect(getInternalPackageErrorMessage("ready", "pi-mermaid")).toBeUndefined();
    expect(getInternalPackageErrorMessage("missing", "pi-mermaid")).toBeUndefined();
    expect(getInternalPackageErrorMessage("installed", "pi-mermaid")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PI_INSTALLABLE_TOOLS boundary
// ---------------------------------------------------------------------------

describe("PI_INSTALLABLE_TOOLS boundary", () => {
  test("pi-mermaid is NOT in PI_INSTALLABLE_TOOLS (imported from installation-plan)", async () => {
    const { PI_INSTALLABLE_TOOLS } = await import("./installation-plan");
    const ids = PI_INSTALLABLE_TOOLS.map((tool) => tool.id);
    expect(ids).not.toContain("pi-mermaid");
  });

  test("INTERNAL_RUNNER_PACKAGE_IDS contains pi-mermaid", () => {
    expect(INTERNAL_RUNNER_PACKAGE_IDS).toContain("pi-mermaid");
  });
});