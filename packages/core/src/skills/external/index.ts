/**
 * External standalone skills catalog.
 *
 * These skills are NOT bound to Developer Team agents. They are copied verbatim
 * (with original frontmatter preserved) as standalone reusable skills.
 *
 * Runtime adapters consume this catalog to build standalone skill installation plans.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Error types (Task 22)
// ---------------------------------------------------------------------------

/**
 * Error code for missing skill lookup.
 */
export const SKILL_NOT_FOUND = "SKILL_NOT_FOUND";

export type SkillLookupErrorCode = typeof SKILL_NOT_FOUND;

/**
 * Error class for skill lookup failures.
 */
export class SkillLookupError extends Error {
  readonly code: SkillLookupErrorCode;
  readonly skillId: string;

  constructor(skillId: string, message: string) {
    super(message);
    this.name = "SkillLookupError";
    this.code = SKILL_NOT_FOUND;
    this.skillId = skillId;
  }
}

// ---------------------------------------------------------------------------
// Skill definitions
// ---------------------------------------------------------------------------

export type StandaloneSkillDefinition = {
  skillId: string;
  sourcePath: string; // relative to this file
};

export const STANDALONE_SKILLS: readonly StandaloneSkillDefinition[] = [
  { skillId: "api-and-interface-design", sourcePath: "api-and-interface-design/SKILL.md" },
  { skillId: "ci-cd-and-automation", sourcePath: "ci-cd-and-automation/SKILL.md" },
  { skillId: "code-review-and-quality", sourcePath: "code-review-and-quality/SKILL.md" },
  { skillId: "code-simplification", sourcePath: "code-simplification/SKILL.md" },
  { skillId: "cognitive-doc-design", sourcePath: "cognitive-doc-design/SKILL.md" },
  { skillId: "comment-writer", sourcePath: "comment-writer/SKILL.md" },
  { skillId: "debugging-and-error-recovery", sourcePath: "debugging-and-error-recovery/SKILL.md" },
  { skillId: "deprecation-and-migration", sourcePath: "deprecation-and-migration/SKILL.md" },
  { skillId: "documentation-and-adrs", sourcePath: "documentation-and-adrs/SKILL.md" },
  { skillId: "doubt-driven-development", sourcePath: "doubt-driven-development/SKILL.md" },
  { skillId: "frontend-ui-engineering", sourcePath: "frontend-ui-engineering/SKILL.md" },
  { skillId: "git-workflow-and-versioning", sourcePath: "git-workflow-and-versioning/SKILL.md" },
  { skillId: "idea-refine", sourcePath: "idea-refine/SKILL.md" },
  { skillId: "interview-me", sourcePath: "interview-me/SKILL.md" },
  { skillId: "judgment-day", sourcePath: "judgment-day/SKILL.md" },
  { skillId: "performance-optimization", sourcePath: "performance-optimization/SKILL.md" },
  { skillId: "security-and-hardening", sourcePath: "security-and-hardening/SKILL.md" },
  { skillId: "shipping-and-launch", sourcePath: "shipping-and-launch/SKILL.md" },
  { skillId: "test-driven-development", sourcePath: "test-driven-development/SKILL.md" },
  { skillId: "using-agent-skills", sourcePath: "using-agent-skills/SKILL.md" },
];

// ---------------------------------------------------------------------------
// Bundle type (Task 1)
// ---------------------------------------------------------------------------

/**
 * A complete standalone skill bundle containing the skill body and all associated files.
 */
export type StandaloneSkillBundle = {
  /** The SKILL.md content including frontmatter. */
  SKILL: string;
  /** Map of relative file path to file content. */
  files: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Content loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load generated content (works in binary mode)
// First try STANDALONE_SKILL_BUNDLES (canonical per spec), then SKILL_BUNDLES (alias/backward compat)
let generatedBundles: Record<string, StandaloneSkillBundle> | undefined;
try {
  // eslint-disable-next-line import/extensions
  const generated = require("./content.generated.js") as {
    STANDALONE_SKILL_BUNDLES?: Record<string, StandaloneSkillBundle>;
    SKILL_BUNDLES?: Record<string, StandaloneSkillBundle>;
  };
  // Prefer canonical spec name, fall back to alias
  if (generated?.STANDALONE_SKILL_BUNDLES) {
    generatedBundles = generated.STANDALONE_SKILL_BUNDLES;
  } else if (generated?.SKILL_BUNDLES) {
    generatedBundles = generated.SKILL_BUNDLES;
  }
} catch {
  // Generated content not available - fall back to file reads
}

/**
 * Get a complete standalone skill bundle by skillId.
 *
 * In binary mode: Uses generated bundles.
 * In development mode: Falls back to directory walk.
 *
 * @param skillId - The skill identifier to look up
 * @returns Complete skill bundle with SKILL and files
 * @throws {SkillLookupError} When skill is not found
 */
export function getStandaloneSkill(skillId: string): StandaloneSkillBundle {
  // Validate skillId exists in registry
  const def = STANDALONE_SKILLS.find((s) => s.skillId === skillId);
  if (!def) {
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }

  // Binary mode: use generated bundles
  if (generatedBundles) {
    const bundle = generatedBundles[skillId];
    if (bundle) {
      return bundle;
    }
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }

  // Dev mode fallback: walk directory
  const skillDir = join(__dirname, skillId);
  const files: Record<string, string> = {};

  function shouldExclude(name: string): boolean {
    if (name.endsWith(":Zone.Identifier")) return true;
    if (name.startsWith("._")) return true;
    return false;
  }

  function walk(dir: string, relPath: string = ""): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldExclude(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      // Use POSIX forward-slash for cross-platform consistency per REQ-ESCG-002
      const entryRelPath = relPath
        ? `${relPath}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, entryRelPath);
      } else if (entry.isFile()) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          files[entryRelPath] = content;
        } catch (err) {
          // Fail loudly on unreadable files per REQ-ESCG-003
          throw new Error(
            `Unable to read file ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  try {
    walk(skillDir);
    const SKILL = files["SKILL.md"] || "";
    if (!SKILL) {
      throw new SkillLookupError(
        skillId,
        `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
      );
    }
    const { "SKILL.md": _, ...otherFiles } = files;
    return { SKILL, files: otherFiles };
  } catch (err) {
    if (err instanceof SkillLookupError) throw err;
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }
}

/**
 * Read the raw body of a standalone skill by skillId.
 * Returns the verbatim SKILL.md content including frontmatter.
 *
 * @param skillId - The skill identifier to look up
 * @returns Skill body content
 * @throws {SkillLookupError} When skill is not found
 */
export function getStandaloneSkillBody(skillId: string): string {
  return getStandaloneSkill(skillId).SKILL;
}

/**
 * Get all standalone skill definitions.
 */
export function getStandaloneSkills(): readonly StandaloneSkillDefinition[] {
  return STANDALONE_SKILLS;
}