/**
 * Unit tests for external skills content loading.
 *
 * Tests the bundled skill lookup and fallback behavior.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  STANDALONE_SKILLS,
  getStandaloneSkillBody,
  getStandaloneSkill,
  getStandaloneSkills,
  SKILL_NOT_FOUND,
  SkillLookupError,
} from "../index.js";

describe("external/skills content", () => {
  describe("STANDALONE_SKILLS", () => {
    it("contains exactly 20 skills (REQ-TEST-001)", () => {
      const skills = getStandaloneSkills();
      expect(skills.length).toBe(20);
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

  describe("getStandaloneSkill", () => {
    it("returns full bundle with SKILL and files (REQ-TEST-002)", () => {
      const bundle = getStandaloneSkill("judgment-day");
      const bodyFromAccessor = getStandaloneSkillBody("judgment-day");

      expect(bundle.SKILL).toBe(bodyFromAccessor);
    });

    it("judgment-day bundle files is empty object (REQ-TEST-004)", () => {
      const bundle = getStandaloneSkill("judgment-day");
      expect(Object.keys(bundle.files)).toHaveLength(0);
    });

    it("idea-refine bundle has 4 files (REQ-TEST-005)", () => {
      const bundle = getStandaloneSkill("idea-refine");
      const fileKeys = Object.keys(bundle.files);
      expect(fileKeys).toContain("examples.md");
      expect(fileKeys).toContain("frameworks.md");
      expect(fileKeys).toContain("refinement-criteria.md");
      expect(fileKeys).toContain("scripts/idea-refine.sh");
      expect(fileKeys).toHaveLength(4);
    });

    it("all 20 skills have non-empty SKILL body (REQ-TEST-006)", () => {
      const skills = getStandaloneSkills();
      for (const skill of skills) {
        const bundle = getStandaloneSkill(skill.skillId);
        expect(bundle.SKILL.length).toBeGreaterThan(0);
      }
    });

    it("no system artifacts in bundle files (REQ-TEST-007)", () => {
      const skills = getStandaloneSkills();
      for (const skill of skills) {
        const bundle = getStandaloneSkill(skill.skillId);
        for (const filePath of Object.keys(bundle.files)) {
          expect(filePath.endsWith(":Zone.Identifier")).toBe(false);
          expect(filePath.startsWith("._")).toBe(false);
        }
      }
    });

    it("api-and-interface-design has valid frontmatter (REQ-TEST-008)", () => {
      const body = getStandaloneSkillBody("api-and-interface-design");
      expect(body.length).toBeGreaterThan(0);
      expect(body.startsWith("---")).toBe(true);
    });
  });
});