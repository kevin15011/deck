/**
 * Unit tests for external skills content loading.
 *
 * Tests the bundled skill lookup and fallback behavior.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  STANDALONE_SKILLS,
  getStandaloneSkillBody,
  getStandaloneSkills,
  SKILL_NOT_FOUND,
  SkillLookupError,
} from "../index.js";

describe("external/skills content", () => {
  describe("STANDALONE_SKILLS", () => {
    it("contains expected skill definitions", () => {
      const skillIds = STANDALONE_SKILLS.map((s) => s.skillId);

      // Should contain judgment-day, cognitive-doc-design, comment-writer
      expect(skillIds).toContain("judgment-day");
      expect(skillIds).toContain("cognitive-doc-design");
      expect(skillIds).toContain("comment-writer");
    });

    it("each skill has valid sourcePath", () => {
      for (const skill of STANDALONE_SKILLS) {
        expect(typeof skill.skillId).toBe("string");
        expect(skill.skillId.length).toBeGreaterThan(0);
        expect(typeof skill.sourcePath).toBe("string");
        expect(skill.sourcePath.length).toBeGreaterThan(0);
        expect(skill.sourcePath.endsWith(".md")).toBe(true);
      }
    });
  });

  describe("getStandaloneSkills", () => {
    it("returns all skill definitions", () => {
      const skills = getStandaloneSkills();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });

    it("returns array of skills", () => {
      const skills = getStandaloneSkills();
      expect(Array.isArray(skills)).toBe(true);
    });
  });

  describe("getStandaloneSkillBody", () => {
    it("returns string for valid skill in dev mode", () => {
      // In dev mode, should return actual content from file
      const body = getStandaloneSkillBody("judgment-day");

      expect(typeof body).toBe("string");
      expect(body.length).toBeGreaterThan(0);
      // Should contain frontmatter
      expect(body.includes("---")).toBe(true);
    });

    it("includes skill metadata in content", () => {
      const body = getStandaloneSkillBody("cognitive-doc-design");

      expect(body.includes("name:")).toBe(true);
      expect(body.includes("description:")).toBe(true);
    });

    it("throws SkillLookupError for unknown skill", () => {
      expect(() => {
        getStandaloneSkillBody("nonexistent-skill-xyz");
      }).toThrow(SkillLookupError);
    });

    it("error object has correct properties", () => {
      try {
        getStandaloneSkillBody("unknown-skill-abc");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(SkillLookupError);
        const lookupError = error as SkillLookupError;
        expect(lookupError.skillId).toBe("unknown-skill-abc");
        expect(lookupError.code).toBe(SKILL_NOT_FOUND);
      }
    });

    it("can load all known skills without throwing", () => {
      const skills = getStandaloneSkills();

      for (const skill of skills) {
        const body = getStandaloneSkillBody(skill.skillId);
        expect(typeof body).toBe("string");
        expect(body.length).toBeGreaterThan(0);
      }
    });
  });

  describe("SkillLookupError", () => {
    it("has correct name and code", () => {
      const error = new SkillLookupError("test-skill", "Test error message");

      expect(error.name).toBe("SkillLookupError");
      expect(error.code).toBe(SKILL_NOT_FOUND);
      expect(error.skillId).toBe("test-skill");
      expect(error.message).toBe("Test error message");
    });
  });
});