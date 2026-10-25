import { expect, test } from 'bun:test';
import { getAgentContent } from './content-registry';
import { getDeveloperTeamCatalog } from './catalog';
import { buildCapabilityInstructionBundle } from './instruction-bundles';
import { getBootstrapSkillFiles } from '../../skills/bootstrap';
for (const runnerId of ['codex', 'claude', 'opencode', 'pi']) for (const promptProfile of ['compact', 'legacy'] as const) {
  test(`${runnerId}/${promptProfile}: every rendered role and skill excludes retired packages`, () => {
    for (const role of getDeveloperTeamCatalog()) {
      const rendered = getAgentContent(role.id, { promptProfile, capabilityInstructions: buildCapabilityInstructionBundle(['code-economy', 'rtk', 'codebase-memory']) });
      expect(JSON.stringify(rendered)).not.toMatch(/serena|context.mode/i);
    }
    for (const file of getBootstrapSkillFiles()) expect(JSON.stringify(file)).not.toMatch(/serena|context.mode/i);
  });
}
