import { describe, expect, test } from "bun:test";

import { getBootstrapSkillFiles } from "./index";

function parseFrontmatter(content: string): unknown {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  expect(match, "expected YAML frontmatter block").not.toBeNull();
  return Bun.YAML.parse(match?.[1] ?? "");
}

describe("bootstrap skill registry", () => {
  test("returns exactly the deck-init and deck-onboard skill files", () => {
    const files = getBootstrapSkillFiles();

    expect(files).toHaveLength(2);
    expect(files.map((file) => file.relativePath).sort()).toEqual([
      "deck-init/SKILL.md",
      "deck-onboard/SKILL.md",
    ]);
  });

  test("contains no path traversal in relative paths", () => {
    const files = getBootstrapSkillFiles();

    for (const file of files) {
      expect(file.relativePath).not.toContain("..");
    }
  });

  test("deck-init/SKILL.md has valid YAML frontmatter", () => {
    const file = getBootstrapSkillFiles().find(
      (entry) => entry.relativePath === "deck-init/SKILL.md",
    );

    expect(file).toBeDefined();
    const frontmatter = parseFrontmatter(file?.content ?? "") as Record<string, unknown>;

    expect(frontmatter.name).toBe("deck-init");
    expect(frontmatter["user-invocable"]).toBe(false);
    expect(frontmatter["disable-model-invocation"]).toBe(true);
  });

  test("deck-onboard/SKILL.md has valid YAML frontmatter", () => {
    const file = getBootstrapSkillFiles().find(
      (entry) => entry.relativePath === "deck-onboard/SKILL.md",
    );

    expect(file).toBeDefined();
    const frontmatter = parseFrontmatter(file?.content ?? "") as Record<string, unknown>;

    expect(frontmatter.name).toBe("deck-onboard");
    expect(frontmatter["user-invocable"]).toBe(true);
  });
});
