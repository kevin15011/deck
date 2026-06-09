import { describe, expect, test } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mergeSettingsPackages } from "./settings-merge";

function createTempProject(): string {
  return mkdtempSync(join(tmpdir(), "deck-test-"));
}

function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}

describe("mergeSettingsPackages", () => {
  test("replaces stale @dreki-gg/pi-context7 with @upstash/context7-mcp", () => {
    const existingPackages = [
      "npm:pi-subagents",
      "npm:@dreki-gg/pi-context7",
      "npm:pi-hud",
    ];

    const result = mergeSettingsPackages({ existingPackages });

    expect(result.success).toBe(true);
    expect(result.replacedStale).toContain("npm:@dreki-gg/pi-context7");
    expect(result.addedStandard).toContain("npm:@upstash/context7-mcp");
    expect(result.finalPackages).not.toContain("npm:@dreki-gg/pi-context7");
    expect(result.finalPackages).toContain("npm:@upstash/context7-mcp");
    expect(result.finalPackages).toEqual([
      "npm:pi-subagents",
      "npm:pi-hud",
      "npm:@upstash/context7-mcp",
    ]);
  });

  test("adds @upstash/context7-mcp when stale is not present", () => {
    const existingPackages = [
      "npm:pi-subagents",
      "npm:pi-hud",
    ];

    const result = mergeSettingsPackages({ existingPackages });

    expect(result.success).toBe(true);
    expect(result.replacedStale).toHaveLength(0);
    expect(result.addedStandard).toContain("npm:@upstash/context7-mcp");
    expect(result.finalPackages).toContain("npm:@upstash/context7-mcp");
  });

  test("does not duplicate when standard already present", () => {
    const existingPackages = [
      "npm:pi-subagents",
      "npm:@upstash/context7-mcp",
      "npm:@dreki-gg/pi-context7", // stale - should be removed
    ];

    const result = mergeSettingsPackages({ existingPackages });

    expect(result.success).toBe(true);
    expect(result.replacedStale).toContain("npm:@dreki-gg/pi-context7");
    // Should only have one occurrence of standard package
    const standardCount = result.finalPackages.filter(
      (p) => p === "npm:@upstash/context7-mcp",
    ).length;
    expect(standardCount).toBe(1);
  });

  test("writes to settings.json when path provided", () => {
    const projectRoot = createTempProject();
    try {
      const settingsPath = join(projectRoot, "settings.json");
      const initialSettings = {
        defaultModel: "gpt-5.5",
        packages: [
          "npm:pi-subagents",
          "npm:@dreki-gg/pi-context7",
        ],
      };

      writeFileSync(settingsPath, JSON.stringify(initialSettings), "utf-8");

      const result = mergeSettingsPackages({
        settingsPath,
        readFile: (path) => require("node:fs").readFileSync(path, "utf-8"),
        writeFile: (path, content) => require("node:fs").writeFileSync(path, content),
      });

      expect(result.success).toBe(true);
      expect(result.replacedStale).toContain("npm:@dreki-gg/pi-context7");

      // Verify file was updated
      const updatedSettings = JSON.parse(
        require("node:fs").readFileSync(settingsPath, "utf-8"),
      );
      expect(updatedSettings.packages).not.toContain("npm:@dreki-gg/pi-context7");
      expect(updatedSettings.packages).toContain("npm:@upstash/context7-mcp");
      expect(updatedSettings.defaultModel).toBe("gpt-5.5"); // preserved
    } finally {
      cleanup(projectRoot);
    }
  });

  test("returns empty when no stale or standard needed", () => {
    const existingPackages = [
      "npm:pi-subagents",
      "npm:@upstash/context7-mcp",
      "npm:pi-hud",
    ];

    const result = mergeSettingsPackages({ existingPackages });

    expect(result.success).toBe(false); // no changes needed
    expect(result.replacedStale).toHaveLength(0);
    expect(result.addedStandard).toHaveLength(0);
    expect(result.finalPackages).toEqual(existingPackages);
  });

  test("handles empty packages array", () => {
    const result = mergeSettingsPackages({ existingPackages: [] });

    expect(result.success).toBe(true);
    expect(result.addedStandard).toContain("npm:@upstash/context7-mcp");
    expect(result.finalPackages).toEqual(["npm:@upstash/context7-mcp"]);
  });
});
