import { describe, expect, test } from "bun:test";

import { getBootstrapSkillFiles } from "./index";

function parseFrontmatter(content: string): unknown {
  const match = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  expect(match, "expected YAML frontmatter block").not.toBeNull();
  return Bun.YAML.parse(match?.[1] ?? "");
}

function getDeckInitContent(): string {
  const file = getBootstrapSkillFiles().find(
    (entry) => entry.relativePath === "deck-init/SKILL.md",
  );

  expect(file).toBeDefined();
  return file?.content ?? "";
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

  test("uses the versioned registry service for authorized fresh generation", () => {
    const content = getDeckInitContent();

    expect(content).toContain("action: initial_generation");
    expect(content).toContain("SkillRegistryWriterV1");
    expect(content).toContain("active-runner scope");
    expect(content).toContain("complete snapshot");
    expect(content).toContain("candidate_count: 0");
    expect(content).toContain("safe ignore coverage");
    expect(content).toContain("fail-open");
    expect(content).not.toContain("glob/find patterns");
    expect(content).not.toContain("Write .atl/skill-registry.md if possible.");
  });

  test("keeps initialized projects read-only until the primary offer or CLI is authorized", () => {
    const content = getDeckInitContent();

    expect(content).toContain("status: ready");
    expect(content).toContain("status: missing");
    expect(content).toContain("status: stale");
    expect(content).toContain("status: invalid");
    expect(content).toContain("status: indeterminate");
    expect(content).toContain("ready/fingerprint_match");
    expect(content).toContain("missing/file_absent");
    expect(content).toContain("stale/fingerprint_mismatch");
    expect(content).toContain("invalid/unsupported_schema_version");
    expect(content).toContain("indeterminate/partial_source_evaluation");
    expect(content).toContain("primary session-start migration/regeneration offer");
    expect(content).toContain("deck skill-registry refresh");
    expect(content).toContain("action: migration");
    expect(content).toContain("action: regeneration");
    expect(content).toContain("do not reinitialize, reindex, rewrite OpenSpec config/history");
    expect(content).toContain("do not write or re-prompt during the same session");
  });

  test("states the fixed no-silent-write and authorization boundary", () => {
    const content = getDeckInitContent();

    expect(content).toContain(
      "## Skill Discovery Authority Boundary",
    );
    expect(content).toContain(
      "Read-only validation and direct discovery must never create, update, delete, repair, or reformat `.atl/skill-registry.md` or `.gitignore`.",
    );
    expect(content).toContain(
      "Generation, migration, and regeneration are separate modifying actions and may run only with applicable user authorization and an exact modifying delegation.",
    );
    expect(content).toContain("CLI flags, and prompt text never grant that authority.");
    expect(content).toContain("Never enumerate another runner's exclusive roots.");
  });

  test("adds an additive skill_registry result without changing index semantics", () => {
    const content = getDeckInitContent();

    expect(content).toContain("interface SkillRegistryInitResultV1");
    expect(content).toContain('path: ".atl/skill-registry.md";');
    expect(content).toContain('action: "generated" | "unchanged" | "authorization_required" | "fallback";');
    expect(content).toContain("skill_registry?: SkillRegistryInitResultV1;");
    expect(content).toContain("Registry failure MUST NOT overwrite index_status");
    expect(content).toContain("registry-specific failure MUST NOT convert a successful initialization into general failure");
  });
});
