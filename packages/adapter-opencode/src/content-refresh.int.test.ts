import { afterAll, afterEach, beforeEach, expect, test, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contributionHash, getDefaultDeckConfig } from '@deck/core';
import * as standaloneSkills from '../../core/src/skills/external';
import { createOpenCodeRunnerAdapter } from './runner-adapter';

// Keep vendor-resource materialization outside this roles/plugin refresh contract.
const skills = spyOn(standaloneSkills, 'getStandaloneSkills').mockReturnValue([]);
afterAll(() => skills.mockRestore());
let home: string, root: string;
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'deck-s4-')); root = join(home, 'opencode'); process.env.HOME = home; process.env.XDG_CONFIG_HOME = home; });
afterEach(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(home, { recursive: true, force: true }); });
const config = () => getDefaultDeckConfig();
async function install() {
  const adapter = createOpenCodeRunnerAdapter({ developerTeamConfigDir: root });
  const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: 'opencode-development', deckConfig: config(), standaloneSkills: [] });
  await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: 'opencode-development', plan });
  return adapter;
}
function drift(path: string) {
  const manifestPath = join(root, 'deck/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(path, 'old Deck generation\n');
  manifest.contributions.find((entry: any) => entry.path === path).hash = contributionHash('old Deck generation\n');
  writeFileSync(manifestPath, JSON.stringify(manifest));
}
// Protects refresh-before-selection and no-op persistence, using owned old bytes as the oracle.
test('owned prompt/plugin drift heals before selection; second preparation writes no installed files', async () => {
  const adapter = await install();
  const prompt = join(root, 'prompts/deck-team/deck-quality.md'), plugin = join(root, 'plugins/developer-team-execution.js');
  drift(prompt); drift(plugin);
  const role = await adapter.prepareSessionNativeRole!('deck-quality', config());
  expect(role.instructions).not.toBe('old Deck generation\n');
  expect(role.preparation?.some(f => f.kind === 'H')).toBe(true);
  const paths = [prompt, plugin, join(root, 'deck/manifest.json'), join(root, 'opencode.json')];
  const before = paths.map(p => statSync(p).mtimeMs);
  await adapter.prepareSessionNativeRole!('deck-quality', config());
  expect(paths.map(p => statSync(p).mtimeMs)).toEqual(before);
});
