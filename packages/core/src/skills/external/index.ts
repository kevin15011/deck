/**
 * External standalone skills catalog.
 *
 * These skills are NOT bound to Developer Team agents. They are copied verbatim
 * (with original frontmatter preserved) as standalone reusable skills.
 *
 * Runtime adapters consume this catalog to build standalone skill installation plans.
 */

import { readFileSync } from "node:fs";
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
  {
    skillId: "judgment-day",
    sourcePath: "judgment-day/SKILL.md",
  },
  {
    skillId: "cognitive-doc-design",
    sourcePath: "cognitive-doc-design/SKILL.md",
  },
  {
    skillId: "comment-writer",
    sourcePath: "comment-writer/SKILL.md",
  },
];

// ---------------------------------------------------------------------------
// Content loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load generated content (works in binary mode)
let generatedContent: Record<string, string> | undefined;
try {
  // eslint-disable-next-line import/extensions
  const generated = require("./content.generated.js") as {
    SKILL_CONTENT: Record<string, string>;
  };
  if (generated?.SKILL_CONTENT) {
    generatedContent = generated.SKILL_CONTENT;
  }
} catch {
  // Generated content not available - fall back to file reads
}

/**
 * Read the raw body of a standalone skill by skillId.
 * Returns the verbatim SKILL.md content including frontmatter.
 *
 * In binary mode: Uses generated content map.
 * In development mode: Falls back to reading source files.
 *
 * @param skillId - The skill identifier to look up
 * @returns Skill body content
 * @throws {SkillLookupError} When skill is not found (in binary mode)
 */
export function getStandaloneSkillBody(skillId: string): string {
  const def = STANDALONE_SKILLS.find((s) => s.skillId === skillId);
  if (!def) {
    // Skill definition doesn't exist
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }

  // Try generated content first (binary mode)
  if (generatedContent) {
    const content = generatedContent[skillId];
    if (content !== undefined) {
      return content;
    }
    // Skill not in generated content map - suggests binary reinstall needed
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }

  // Fall back to file read (development mode)
  try {
    const content = readFileSync(join(__dirname, def.sourcePath), "utf-8");
    return content;
  } catch {
    // File doesn't exist or can't be read
    throw new SkillLookupError(
      skillId,
      `Skill ${skillId} not found in bundled resources. Reinstall deck binary.`,
    );
  }
}

/**
 * Get all standalone skill definitions.
 */
export function getStandaloneSkills(): readonly StandaloneSkillDefinition[] {
  return STANDALONE_SKILLS;
}