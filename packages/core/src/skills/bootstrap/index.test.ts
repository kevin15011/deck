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

  test("Onboard is user-invocable and routes through the adaptive team", () => {
    const content = getBootstrapSkillContent("deck-onboard")!;
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter["user-invocable"]).toBe(true);
    expect(content).toContain("deck-lead");
    expect(content).toContain("deck-investigate");
    expect(content).toContain("deck-architect");
    expect(content).toContain("deck-apply-fast");
    expect(content).toContain("deck-quality");
    expect(content).not.toContain("deck-developer-");
  });

  test("Archive is delegated to Lead and does not create an archive agent", () => {
    const content = getBootstrapSkillContent("deck-archive")!;
    const frontmatter = parseFrontmatter(content);
    expect(frontmatter["user-invocable"]).toBe(false);
    expect((frontmatter.metadata as Record<string, unknown>).delegate_only).toBe(true);
    expect(content).toContain("Lead");
    expect(content).toContain("not an agent");
  });
});
