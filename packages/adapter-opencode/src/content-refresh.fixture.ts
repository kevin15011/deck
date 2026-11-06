import { beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { contributionHash, getDefaultDeckConfig } from '@deck/core';
import { buildOpenCodeDeveloperTeamInstallPlan } from './developer-team-install';
import { planOpenCodeRefresh, applyOpenCodeRefresh } from './content-refresh';
import { prepareOpenCodeNativeRole } from './native-role';

export let home: string, root: string;
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
export function setup() {
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'deck-s4-')); root = join(home, 'opencode'); process.env.HOME = home; process.env.XDG_CONFIG_HOME = home; });
afterEach(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; rmSync(home, { recursive: true, force: true }); });
}
export const config = () => getDefaultDeckConfig();
// Render invariant fixture content once; each test still owns an isolated installed tree.
const templateHome = '/__deck_preservation_fixture__';
const nativeTemplate = JSON.stringify(buildOpenCodeDeveloperTeamInstallPlan(templateHome, { configDir: join(templateHome, 'opencode') }));
export async function install() {
  const native: ReturnType<typeof buildOpenCodeDeveloperTeamInstallPlan> = JSON.parse(nativeTemplate.split(templateHome).join(home));
  const desired = [
    { path: 'opencode.json', content: '{}', kind: 'other' as const },
    ...native.skills.filter(f => f.relativePath.includes('deck-quality/')).map(f => ({ path: f.relativePath, content: f.content, kind: 'skill' as const })),
    ...native.promptGenerationPlan.filter(f => f.absolutePath.endsWith('/deck-quality.md')).map(f => ({ path: relative(root, f.absolutePath), content: f.content, kind: 'prompt' as const })),
    { path: native.executionPlugin!.relativePath, content: native.executionPlugin!.content, kind: 'other' as const },
    { path: native.modelVariantsPlugin!.relativePath, content: native.modelVariantsPlugin!.content, kind: 'other' as const },
  ];
  const prepare = () => planOpenCodeRefresh(root, desired, { 'deck-quality': native.agentEntries['deck-quality']! });
  applyOpenCodeRefresh(root, prepare());
  return { prepare, prepareSessionNativeRole: async (id: string, _config: unknown) => {
    const plan = prepare(); applyOpenCodeRefresh(root, plan);
    const role = prepareOpenCodeNativeRole(root, id);
    return { ...role, preparation: [...plan.findings, ...role.preparation ?? []] };
  } };
}
export function drift(path: string) {
  const manifestPath = join(root, 'deck/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(path, 'old Deck generation\n');
  manifest.contributions.find((entry: any) => entry.path === path).hash = contributionHash('old Deck generation\n');
  writeFileSync(manifestPath, JSON.stringify(manifest));
}
