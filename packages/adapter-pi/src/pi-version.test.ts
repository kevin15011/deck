import { describe, expect, test } from "bun:test";

import { PI_MIN_VERSION, PI_UPGRADE_HINT, evaluatePiVersion, parsePiVersion } from "./pi-version";

describe("parsePiVersion", () => {
  test("parses a bare semantic version", () => {
    expect(parsePiVersion("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0, raw: "1.0.0" });
    expect(parsePiVersion("  1.2.3\n")?.raw).toBe("1.2.3");
  });

  test("parses a version embedded in text and a leading v", () => {
    expect(parsePiVersion("pi v0.99.3 (build abc)")).toMatchObject({ major: 0, minor: 99, patch: 3 });
  });

  test("ignores prerelease and build suffixes for ordering", () => {
    expect(parsePiVersion("1.0.0-rc.1")).toMatchObject({ major: 1, minor: 0, patch: 0 });
    expect(parsePiVersion("1.4.2+sha.5")).toMatchObject({ major: 1, minor: 4, patch: 2 });
  });

  test("returns undefined when no semantic version is present", () => {
    expect(parsePiVersion("")).toBeUndefined();
    expect(parsePiVersion("unknown")).toBeUndefined();
    expect(parsePiVersion("pi: command failed")).toBeUndefined();
  });
});

describe("evaluatePiVersion", () => {
  test("the minimum supported version is 1.0.0", () => {
    expect(PI_MIN_VERSION).toBe("1.0.0");
  });

  test("supported version", () => {
    const result = evaluatePiVersion("1.0.0");
    expect(result.supported).toBe(true);
    expect(result.version).toBe("1.0.0");
    expect(result.diagnostic).toBeUndefined();
  });

  test("newer versions are supported", () => {
    expect(evaluatePiVersion("1.2.0").supported).toBe(true);
    expect(evaluatePiVersion("2.0.0").supported).toBe(true);
  });

  test("old version is unsupported with an upgrade hint naming the package", () => {
    const result = evaluatePiVersion("0.99.3");
    expect(result.supported).toBe(false);
    expect(result.reason).toBe("below-minimum");
    expect(result.diagnostic).toContain("0.99.3");
    expect(result.diagnostic).toContain("@earendil-works/pi-coding-agent");
    expect(PI_UPGRADE_HINT).toContain("@earendil-works/pi-coding-agent");
  });

  test("unparseable output is unsupported with a diagnostic", () => {
    const result = evaluatePiVersion("no version here");
    expect(result.supported).toBe(false);
    expect(result.reason).toBe("unparseable");
    expect(result.diagnostic).toContain("@earendil-works/pi-coding-agent");
  });

  test("a missing binary is reported separately", () => {
    const result = evaluatePiVersion(undefined);
    expect(result.supported).toBe(false);
    expect(result.reason).toBe("unavailable");
  });
});
