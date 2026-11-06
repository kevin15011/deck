import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireInstallationUse } from '../installation-use';
import { createOwnedNpmTools, type NpmArtifactEffects } from './npm-artifact';

const { installOwnedNpmTool, ownedNpmCommand, ownedNpmRoot } = createOwnedNpmTools({ context7: { lock: { packages: { '': { name: 'fixture', version: '1.0.0' } } }, command: 'context7-mcp', package: '@upstash/context7-mcp' } });

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-npm-')));
  const toolsRoot = join(home, 'tools'); mkdirSync(toolsRoot, { mode: 0o700 });
  const root = ownedNpmRoot(toolsRoot, 'context7');
  const acquire: NpmArtifactEffects['acquire'] = async stage => {
    mkdirSync(join(stage, 'node_modules', '@upstash', 'context7-mcp', 'dist'), { recursive: true });
    writeFileSync(join(stage, 'node_modules', '@upstash', 'context7-mcp', 'dist', 'index.js'), 'canonical', { mode: 0o700 });
    mkdirSync(join(stage, 'node_modules', '.bin'));
    symlinkSync('../@upstash/context7-mcp/dist/index.js', join(stage, 'node_modules', '.bin', 'context7-mcp'));
  };
  return { home, toolsRoot, root, effects: { acquire }, clean: () => rmSync(home, { recursive: true, force: true }) };
}
// Protects whole-tree drift repair, pinned clean acquisition, bounded private preimages and idempotence.
test('npm repair replaces edited dependencies without invoking old executables', async () => {
  const f = fixture();
  try {
    await installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: f.effects });
    expect(ownedNpmCommand(f.toolsRoot, 'context7')).toBeDefined();
    const dependency = join(f.root, 'node_modules', '@upstash', 'context7-mcp', 'dist', 'index.js');
    writeFileSync(dependency, 'malicious');
    expect(ownedNpmCommand(f.toolsRoot, 'context7')).toBeUndefined();
    await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: { acquire: async () => { throw Error('offline'); } } })).rejects.toThrow('offline');
    expect(readFileSync(dependency, 'utf8')).toBe('malicious');
    await installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: f.effects });
    expect(readFileSync(dependency, 'utf8')).toBe('canonical');
    expect(await installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: { acquire: async () => { throw Error('unexpected'); } } })).toBe('unchanged');
    const backups = readdirSync(join(f.toolsRoot, '.npm-replaced'));
    expect(backups.length).toBe(1);
    expect(statSync(join(f.toolsRoot, '.npm-replaced')).mode & 0o077).toBe(0);
    expect(readFileSync(join(f.toolsRoot, '.npm-replaced', backups[0]!, 'node_modules', '@upstash', 'context7-mcp', 'dist', 'index.js'), 'utf8')).toBe('malicious');
  } finally { f.clean(); }
});
// Protects existing readers, foreign siblings, symlink refusal and CAS after asynchronous reacquisition.
test('npm acquisition defers under use and preserves concurrent edits and foreign roots', async () => {
  const f = fixture();
  try {
    const held = acquireInstallationUse(f.toolsRoot);
    try { await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: f.effects })).rejects.toThrow('deferred'); }
    finally { held.release(); }
    writeFileSync(join(f.toolsRoot, 'foreign'), 'preserve');
    mkdirSync(f.root, { mode: 0o700 }); writeFileSync(join(f.root, 'old'), 'old');
    await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: { acquire: async stage => {
      await f.effects.acquire!(stage); writeFileSync(join(f.root, 'old'), 'concurrent');
    } } })).rejects.toThrow('changed');
    expect(readFileSync(join(f.root, 'old'), 'utf8')).toBe('concurrent');
    expect(readFileSync(join(f.toolsRoot, 'foreign'), 'utf8')).toBe('preserve');
    symlinkSync(join(f.home, 'outside'), join(f.root, 'escape'));
    await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: f.effects })).rejects.toThrow();
    expect(existsSync(join(f.toolsRoot, '.npm-replaced'))).toBe(false);
  } finally { f.clean(); }
});
// Protects acquisition trust: failure, altered lock and external links never publish receipts or commands.
test('npm staging rejects changed pins and escaping executable links', async () => {
  for (const defect of ['lock', 'link']) {
    const f = fixture();
    try {
      await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: { acquire: async stage => {
        await f.effects.acquire!(stage);
        if (defect === 'lock') writeFileSync(join(stage, 'package-lock.json'), '{}');
        else { rmSync(join(stage, 'node_modules', '.bin', 'context7-mcp')); symlinkSync(process.execPath, join(stage, 'node_modules', '.bin', 'context7-mcp')); }
      } } })).rejects.toThrow();
      expect(existsSync(f.root)).toBe(false);
      expect(ownedNpmCommand(f.toolsRoot, 'context7')).toBeUndefined();
    } finally { f.clean(); }
  }
});
// Protects synchronous postimage-CAS rollback when external receipt accounting fails.
test('npm receipt failure restores old tree and preserves concurrent publication edits', async () => {
  for (const concurrent of [false, true]) {
    const f = fixture();
    try {
      mkdirSync(f.root, { mode: 0o700 }); writeFileSync(join(f.root, 'old'), 'private original', { mode: 0o600 });
      await expect(installOwnedNpmTool({ toolsRoot: f.toolsRoot, id: 'context7', effects: f.effects, publishReceipt: root => {
        if (concurrent) writeFileSync(join(root, 'concurrent'), 'keep');
        throw Error('receipt failed');
      } })).rejects.toThrow('receipt failed');
      if (concurrent) {
        expect(readFileSync(join(f.root, 'concurrent'), 'utf8')).toBe('keep');
        expect(readdirSync(join(f.toolsRoot, '.npm-replaced')).length).toBe(1);
      } else {
        expect(readFileSync(join(f.root, 'old'), 'utf8')).toBe('private original');
        expect(statSync(join(f.root, 'old')).mode & 0o777).toBe(0o600);
        expect(ownedNpmCommand(f.toolsRoot, 'context7')).toBeUndefined();
      }
    } finally { f.clean(); }
  }
});
