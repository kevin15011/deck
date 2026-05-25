/**
 * Bootstrap skills — deck-init and deck-onboard.
 *
 * These are the two new skills introduced in the SDD change deck-init-onboard-system.
 * They are NOT bound to the existing 12-agent Developer Team.
 *
 * Runtime adapters consume this catalog to build bootstrap skill installation plans.
 */

import { deckInitSkillContent } from "./deck-init-content";
import { deckOnboardSkillContent } from "./deck-onboard-content";

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface BootstrapSkillFile {
  relativePath: string; // e.g. "deck-init/SKILL.md"
  content: string;    // the SKILL.md content
  skillId: string;    // e.g. "deck-init"
}

// ---------------------------------------------------------------------------
// Content Loading
// ---------------------------------------------------------------------------

/**
 * Get all bootstrap skill files.
 * Returns exactly 2 entries: deck-init/SKILL.md, deck-onboard/SKILL.md
 */
export function getBootstrapSkillFiles(): readonly BootstrapSkillFile[] {
  return [
    { relativePath: "deck-init/SKILL.md", content: deckInitSkillContent, skillId: "deck-init" },
    { relativePath: "deck-onboard/SKILL.md", content: deckOnboardSkillContent, skillId: "deck-onboard" },
  ] as const;
}

/**
 * Get bootstrap skill content by skillId.
 * Returns undefined if skillId is not recognized.
 */
export function getBootstrapSkillContent(skillId: string): string | undefined {
  const skill = getBootstrapSkillFiles().find((s) => s.skillId === skillId);
  return skill?.content;
}