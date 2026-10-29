import { describe, expect, test } from "bun:test";

import { getBootstrapSkillContent, getBootstrapSkillFiles } from "./index";

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  expect(match).not.toBeNull();
  return Bun.YAML.parse(match?.[1] ?? "") as Record<string, unknown>;
}

describe("standalone Developer Team skills", () => {
  test("installs Onboard and Archive as skills, never Init as an eighth agent skill", () => {
    const files = getBootstrapSkillFiles();
    expect(files.map((file) => file.skillId)).toEqual(["deck-onboard", "deck-archive"]);
    expect(files.some((file) => file.skillId === "deck-init")).toBe(false);
    for (const file of files) expect(file.relativePath).not.toContain("..");
  });

  test("Onboard frontmatter permits user invocation", () => {
    const content = getBootstrapSkillContent("deck-onboard")!;
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter["user-invocable"]).toBe(true);
  });

  test("Archive frontmatter permits delegation only", () => {
    const content = getBootstrapSkillContent("deck-archive")!;
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter["user-invocable"]).toBe(false);
    expect((frontmatter.metadata as Record<string, unknown>).delegate_only).toBe(true);
  });
});
