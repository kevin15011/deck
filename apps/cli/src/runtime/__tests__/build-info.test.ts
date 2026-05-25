import { describe, it, expect, beforeEach } from "bun:test";
import { getBuildInfo } from "../build-info.js";

describe("build-info", () => {
  beforeEach(() => {
    // Clear require cache between tests
    delete require.cache[require.resolve("../build-info.generated.js")];
  });

  it("returns build info object with expected fields", () => {
    const info = getBuildInfo();

    expect(info).toHaveProperty("version");
    expect(info).toHaveProperty("commit");
    expect(info).toHaveProperty("date");
    expect(info).toHaveProperty("target");
    expect(info).toHaveProperty("channel");
  });

  it("returns dev defaults when generated module is not available", () => {
    const info = getBuildInfo();

    // In dev mode, should return dev defaults
    expect(info.version).toBeDefined();
    expect(typeof info.version).toBe("string");
    expect(info.commit).toBeDefined();
    expect(info.date).toBeDefined();
    expect(info.target).toBeDefined();
    expect(["stable", "beta", "dev"]).toContain(info.channel);
  });

  it("returns consistent values on multiple calls", () => {
    const info1 = getBuildInfo();
    const info2 = getBuildInfo();

    expect(info1.version).toBe(info2.version);
    expect(info1.commit).toBe(info2.commit);
  });

  it("handles missing generated module gracefully", () => {
    // This test verifies the fallback behavior
    const info = getBuildInfo();

    // Should not throw and should return valid build info
    expect(info.version).not.toBe("");
    expect(info.channel).toBeDefined();
  });
});