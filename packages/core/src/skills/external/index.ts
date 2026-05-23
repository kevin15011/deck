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

/**
 * Read the raw body of a standalone skill by skillId.
 * Returns the verbatim SKILL.md content including frontmatter.
 */
export function getStandaloneSkillBody(skillId: string): string | undefined {
  const def = STANDALONE_SKILLS.find((s) => s.skillId === skillId);
  if (!def) return undefined;

  try {
    return readFileSync(join(__dirname, def.sourcePath), "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Get all standalone skill definitions.
 */
export function getStandaloneSkills(): readonly StandaloneSkillDefinition[] {
  return STANDALONE_SKILLS;
}