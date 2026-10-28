import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { NativeRoleDescriptor } from '@deck/core/session/driver';
import { parseAgentMarkdown } from '../pi-extensions/subagents/agents';
import { verifiedPiGeneration } from '../pi-extensions/subagents/verified-role';
import { readDeckPiExtensionBundle } from '../pi-extension-assets';

export function preparePiSessionRole(agentDir: string, roleId: string): NativeRoleDescriptor {
  // This transport adds only cross-runner Setup. Native Pi roles retain their own launcher.
  if (roleId !== 'deck-setup') throw new Error('pi-session-role-unsupported');
  const root = join(agentDir, 'deck/package');
  const roleRef = `agents/${roleId}.md`;
  const raw = readFileSync(join(root, roleRef), 'utf8');
  const agent = parseAgentMarkdown(roleId, raw);
  for(const name of ['deck-tool-policy','deck-subagents'] as const) {
    if(readFileSync(join(root,'extensions',name,'impl.js'),'utf8')!==readDeckPiExtensionBundle(name))throw new Error('pi-session-reinstall-required');
  }
  return { runnerId:'pi', roleId, roleRef, generation:verifiedPiGeneration(root, agent),
    source:{root:agentDir,files:{'deck/manifest.json':createHash('sha256').update(readFileSync(join(agentDir,'deck/manifest.json'))).digest('hex')}},
    instructions:agent.body, model:agent.model, effort:agent.thinking, hooks:[] };
}

export function verifyPiSessionRole(role: NativeRoleDescriptor) {
  const current = preparePiSessionRole(role.source.root, role.roleId);
  if (JSON.stringify(current) !== JSON.stringify(role)) throw new Error('pi-session-generation-changed');
  return parseAgentMarkdown(role.roleId, readFileSync(join(role.source.root,'deck/package',role.roleRef),'utf8'));
}
