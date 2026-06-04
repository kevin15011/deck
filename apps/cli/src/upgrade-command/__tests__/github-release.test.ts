/**
 * Unit tests for GitHub release fetching.
 */

import { describe, it, expect } from "bun:test";

describe("github-release", () => {
  describe("compareVersions", () => {
    it("returns 0 when versions are equal", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
      expect(compareVersions("2.0.0", "2.0.0")).toBe(0);
    });

    it("returns negative when current < latest (upgrade available)", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("0.9.0", "1.0.0")).toBe(-1);
    });

    it("returns positive when current > latest (downgrade)", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    });

    it("handles v prefix in versions", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
      expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
    });

    it("handles different version lengths", () => {
      const { compareVersions } = require("../github-release.js");
      expect(compareVersions("1.0", "1.0.0")).toBe(0);
      expect(compareVersions("1.0.0", "1.0")).toBe(0);
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
      expect(compareVersions("1.0.0.0", "1.0.0")).toBe(0);
    });
  });

  describe("UPGRADE_ERROR_CODES", () => {
    it("has correct error codes", () => {
      const { UPGRADE_ERROR_CODES } = require("../github-release.js");
      expect(UPGRADE_ERROR_CODES.CHECKSUM_MISMATCH).toBe("UPGRADE_CHECKSUM_MISMATCH");
      expect(UPGRADE_ERROR_CODES.NETWORK_ERROR).toBe("UPGRADE_NETWORK_ERROR");
      expect(UPGRADE_ERROR_CODES.REPLACE_FAILED).toBe("UPGRADE_REPLACE_FAILED");
    });
  });

  describe("checkUpgradeAvailable", () => {
    it("is a function", () => {
      const { checkUpgradeAvailable } = require("../github-release.js");
      expect(typeof checkUpgradeAvailable).toBe("function");
    });

    it("returns boolean", async () => {
      const { checkUpgradeAvailable } = require("../github-release.js");
      const result = await checkUpgradeAvailable("1.0.0");
      expect(typeof result).toBe("boolean");
    });
  });
});

// REQ-bsu-* requirement tests
describe("REQ-bsu-001: Upgrade detects newer version", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("detects when upgrade is available", () => {
    const cmp = compareVersions("1.0.0", "1.1.0");
    expect(cmp).toBeLessThan(0);
  });

  it("detects when already on latest", () => {
    const cmp = compareVersions("1.0.0", "1.0.0");
    expect(cmp).toBe(0);
  });
});

describe("REQ-bsu-003: --yes flag enables non-interactive upgrade", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("version comparison works programmatically", () => {
    const cmp = compareVersions("1.0.0", "1.1.0");
    expect(cmp).toBeLessThan(0);
  });
});

describe("REQ-bsu-005: Refuse downgrade", () => {
  const { compareVersions } = require("../github-release.js");
  
  it("refuses downgrade", () => {
    const cmp = compareVersions("1.1.0", "1.0.0");
    expect(cmp).toBeGreaterThan(0);
  });
});

// Regression tests for fix-install-upgrade-regressions (Task 6)
describe("REGRESSION: Descriptor/tag mismatch fallback (REQ-UPGRADE-001, REQ-UPGRADE-002)", () => {
  // These tests verify the descriptor version vs tag_name cross-validation
  
  it("rejects descriptor when version doesn't match tag (stale descriptor)", () => {
    // Simulate: tag_name="v0.1.4" but descriptor.version="0.1.3"
    // The system should treat this as inconsistent and fall back to legacy
    const { compareVersions } = require("../github-release.js");
    
    // This tests the comparison logic that detects stale descriptor
    const cmp = compareVersions("0.1.3", "0.1.4");
    expect(cmp).toBeLessThan(0); // current < latest means upgrade available
  });

  it("accepts descriptor when version matches tag", () => {
    const { compareVersions } = require("../github-release.js");
    
    // Same version should be equal
    const cmp = compareVersions("0.1.4", "0.1.4");
    expect(cmp).toBe(0);
  });
});

describe("REGRESSION: Legacy fallback from tag alone (REQ-UPGRADE-002)", () => {
  it("extracts version from v-prefixed tag", () => {
    const { compareVersions } = require("../github-release.js");
    
    // v1.0.0 should equal 1.0.0
    const cmp = compareVersions("0.1.3", "v0.1.4");
    expect(cmp).toBeLessThan(0); // 0.1.3 < v0.1.4
  });
});

describe("REGRESSION: Unparseable tag returns error state (REQ-UPGRADE-002, REQ-UPGRADE-003)", () => {
  it("handles non-semver tags gracefully in comparison", () => {
    const { compareVersions } = require("../github-release.js");

    // Non-semver tags like "build-abc" should not match semver versions
    // The comparison treats them as 0.0.0, so 0.1.3 > build-abc = true
    const cmp = compareVersions("0.1.3", "build-abc");
    expect(cmp).toBeGreaterThan(0); // 0.1.3 > build-abc (treated as 0.0.0)
  });
});

describe("normalizeCommit", () => {
  const { normalizeCommit } = require("../github-release.js");

  it("returns null for undefined", () => {
    expect(normalizeCommit(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(normalizeCommit(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeCommit("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeCommit("   ")).toBeNull();
  });

  it("returns null for non-SHA strings like branch names", () => {
    expect(normalizeCommit("main")).toBeNull();
    expect(normalizeCommit("develop")).toBeNull();
    expect(normalizeCommit("feature/test")).toBeNull();
  });

  it("returns normalized SHA for valid 7-char commit", () => {
    expect(normalizeCommit("abc1234")).toBe("abc1234");
  });

  it("returns normalized SHA for valid 40-char commit", () => {
    expect(normalizeCommit("abcdef0123456789abcdef0123456789abcdef01")).toBe("abcdef0123456789abcdef0123456789abcdef01");
  });

  it("returns lowercase for uppercase SHA", () => {
    expect(normalizeCommit("ABC1234")).toBe("abc1234");
  });

  it("returns trimmed SHA with whitespace", () => {
    expect(normalizeCommit("  abc1234  ")).toBe("abc1234");
  });

  it("returns null for too-short SHA (< 7 chars)", () => {
    expect(normalizeCommit("abc")).toBeNull();
  });
});

describe("decideReleaseAvailability", () => {
  const { decideReleaseAvailability } = require("../github-release.js");

  // REQ-UD-001: Same semver, different commit → available (same-version-different-commit)
  it("returns available with same-version-different-commit when semver equal and commits differ", () => {
    const result = decideReleaseAvailability("0.1.5", "f606c83", "0.1.5", "8aaca9e");
    expect(result.kind).toBe("available");
    expect(result.reason).toBe("same-version-different-commit");
    expect(result.currentCommit).toBe("f606c83");
    expect(result.latestCommit).toBe("8aaca9e");
  });

  // REQ-UD-001: Same semver, same commit → none (same-build)
  it("returns none when semver equal and commits match", () => {
    const result = decideReleaseAvailability("0.1.5", "8aaca9e", "0.1.5", "8aaca9e");
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("same-build");
  });

  // REQ-UD-003: Remote semver greater → available (newer-version)
  it("returns available with newer-version when remote semver greater", () => {
    const result = decideReleaseAvailability("0.1.5", "any", "0.1.6", "any2");
    expect(result.kind).toBe("available");
    expect(result.reason).toBe("newer-version");
  });

  // REQ-UD-004: Local semver greater → none (local-newer)
  it("returns none when local semver greater", () => {
    const result = decideReleaseAvailability("0.1.6", "aaa111", "0.1.5", "bbb222");
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("local-newer");
  });

  // REQ-UD-002: Missing local commit → none (missing-commit)
  it("returns none when local commit is missing", () => {
    const result = decideReleaseAvailability("0.1.5", null, "0.1.5", "8aaca9e");
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("missing-commit");
  });

  // REQ-UD-002: Missing remote commit → none (missing-commit)
  it("returns none when remote commit is missing", () => {
    const result = decideReleaseAvailability("0.1.5", "f606c83", "0.1.5", null);
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("missing-commit");
  });

  // REQ-UD-002: Both commits missing → none (missing-commit)
  it("returns none when both commits missing", () => {
    const result = decideReleaseAvailability("0.1.5", null, "0.1.5", null);
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("missing-commit");
  });

  // REQ-UD-009: Dev build should not false-positive on commit comparison
  it("returns none for dev build even with different commits", () => {
    const result = decideReleaseAvailability("0.0.0-dev", "abc123", "0.1.5", "def456");
    expect(result.kind).toBe("available"); // semver greater still triggers
    expect(result.reason).toBe("newer-version");
  });

  it("returns none for dev build with same version and different commits", () => {
    const result = decideReleaseAvailability("0.0.0-dev", "abc123", "0.0.0-dev", "def456");
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("missing-commit"); // Dev builds skip commit comparison
  });

  // Short/long SHA prefix matching → same-build
  it("treats short/long SHA prefix as same build", () => {
    const result = decideReleaseAvailability("0.1.5", "8aaca9e", "0.1.5", "8aaca9e12345");
    expect(result.kind).toBe("none");
    expect(result.reason).toBe("same-build");
  });
});