/** Standalone skills installed beside, but not materialized as, team agents. */

import { deckArchiveSkillContent } from "./deck-archive-content";
import { deckOnboardSkillContent } from "./deck-onboard-content";

export interface BootstrapSkillFile {
  relativePath: string;
  content: string;
  skillId: string;
}

export function getBootstrapSkillFiles(): readonly BootstrapSkillFile[] {
  return Object.freeze([
    { relativePath: "deck-onboard/SKILL.md", content: deckOnboardSkillContent, skillId: "deck-onboard" },
    { relativePath: "deck-archive/SKILL.md", content: deckArchiveSkillContent, skillId: "deck-archive" },
  ]);
}

export function getBootstrapSkillContent(skillId: string): string | undefined {
  return getBootstrapSkillFiles().find((skill) => skill.skillId === skillId)?.content;
}
