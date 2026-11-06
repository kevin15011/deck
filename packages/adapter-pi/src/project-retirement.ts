import { join, resolve } from 'node:path';
import { assertNoContributionSymlink } from '@deck/core';
import { getBootstrapSkillFiles } from '@deck/core/skills/bootstrap';
import { DEVELOPER_TEAM_AGENTS } from './developer-team-catalog';
import { hashContent } from './pi-manifest';
import type { PiFileIO, PiGlobalPlan } from './pi-global-install';

/** Exact historical generated identities; generic external skill basenames grant no authority. */
export function planPiProjectRetirement(plan: PiGlobalPlan, projectRoot: string, io: PiFileIO): void {
  const root = resolve(projectRoot);
  const paths = piProjectRetirementPaths();
  const entries: { path: string; content: string }[] = [];
  // Inspect every candidate before joining any effects to the global transaction.
  for (const relative of paths) {
    const path = join(root, relative);
    assertNoContributionSymlink(path);
    const content = io.readText(path);
    if (content !== undefined) entries.push({ path, content });
  }
  plan.projectRetirement = { root, entries };
  for (const { path, content } of entries) {
    const preimage = hashContent(content);
    plan.deletes.push({ path, expectedPre: preimage });
    const change = { kind: 'file' as const, action: 'delete' as const, relPath: path, path, preimage, postimage: 'absent' };
    plan.changes.push(change);
    plan.mutationPreview.push({ ...change, ownership: 'Deck legacy Pi project output' });
  }
}

export function piProjectRetirementPaths(): readonly string[] {
  return [
    ...DEVELOPER_TEAM_AGENTS.map(agent => `.pi/agents/${agent.id}.md`),
    ...DEVELOPER_TEAM_AGENTS.map(agent => `.pi/skills/${agent.skillId}/SKILL.md`),
    ...getBootstrapSkillFiles().map(skill => `.pi/skills/${skill.skillId}/SKILL.md`),
    '.deck/pi/profiles/developer-team/system-prompt.md',
    '.deck/pi/profiles/developer-team/extensions/developer-team-execution.js',
  ];
}
