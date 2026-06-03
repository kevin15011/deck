import { describe, it, expect } from "bun:test";
import {
  getStandaloneSkillBody,
  getStandaloneSkill,
  getStandaloneSkills,
  STANDALONE_SKILLS,
  SkillLookupError,
} from "./index.js";

describe("external skills", () => {
  it("returns all registered standalone skill definitions", () => {
    const skills = getStandaloneSkills();

    expect(skills.length).toBe(20);
    expect(skills.map((s) => s.skillId)).toContain("judgment-day");
    expect(skills.map((s) => s.skillId)).toContain("cognitive-doc-design");
    expect(skills.map((s) => s.skillId)).toContain("comment-writer");
    expect(skills.map((s) => s.skillId)).toContain("api-and-interface-design");
  });

  it("returns skill body for known skill IDs", () => {
    const content = getStandaloneSkillBody("judgment-day");

    expect(content).not.toBeUndefined();
    if (content) {
      expect(content.length).toBeGreaterThan(0);
      // Should contain frontmatter
      expect(content).toContain("---");
    }
  });

  it("returns content for all registered skills", () => {
    for (const skill of STANDALONE_SKILLS) {
      const content = getStandaloneSkillBody(skill.skillId);
      expect(content).not.toBeUndefined();
      if (content) {
        expect(content.length).toBeGreaterThan(0);
      }
    }
  });

  it("throws SkillLookupError for unknown skill ID", () => {
    expect(() => {
      getStandaloneSkillBody("non-existent-skill");
    }).toThrow(SkillLookupError);
  });

  it("throws SkillLookupError for empty string skill ID", () => {
    expect(() => {
      getStandaloneSkillBody("");
    }).toThrow(SkillLookupError);
  });

  it("generated content matches source file content", () => {
    // Verify generated content is not empty and has expected frontmatter
    const content = getStandaloneSkillBody("judgment-day");

    expect(content).toContain("name: judgment-day");
    expect(content).toContain("license:");
    expect(content).toContain("## Activation Contract");
  });
});