import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { getDefaultDeckConfig, type DashboardState } from '@deck/core';
import { createPiRunnerAdapter } from '@deck/adapter-pi';
import { createPiTools } from '../../../../../packages/adapter-pi/src/pi-owned-tools';
import { normalizeDashboardCapabilityInventory } from './inventory';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const binary = 'verified native fixture';
const archive = gzipSync(Buffer.concat([
  ...['codebase-memory-mcp', 'LICENSE', 'install.sh', 'THIRD_PARTY_NOTICES.md'].flatMap(name => {
    const data = Buffer.from(name === 'codebase-memory-mcp' ? binary : 'fixture');
    const header = Buffer.alloc(512);
    header.write(name); header.write(data.length.toString(8).padStart(11, '0'), 124); header[156] = 48;
    return [header, data, Buffer.alloc((512 - data.length % 512) % 512)];
  }), Buffer.alloc(1024),
]));
const release = { asset: 'fixture.tar.gz', archiveBytes: archive.length, archiveSha256: sha(archive), binaryBytes: binary.length, binarySha256: sha(binary) };

// Protects recovery from the observed empty release slot and drift through the public
// Dashboard boundary; integrity rejection and foreign sibling preservation remain mandatory.
for (const damage of ['empty', 'edited', 'foreign', 'bad-download'] as const) {
  test(`Pi Dashboard can plan pinned Codebase repair: ${damage}`, async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'pi-repair-')));
    try {
      const pi = join(home, 'pi');
      writeFileSync(pi, '#!/bin/sh\nprintf "No packages installed\\n"\n', { mode: 0o700 });
      let probes = 0;
      const tools = createPiTools({ homeDir: home, env: {}, dataRoot: join(home, 'data', 'deck'), resolveCommand: () => undefined,
        codebaseReleaseOverride: release, verifyCodebaseNative: () => { probes++; return true; },
        codebaseArtifactEffects: { fetchArchive: async () => damage === 'bad-download' ? new Uint8Array([1]) : archive } });
      mkdirSync(tools.codebase.root, { recursive: true, mode: 0o700 });
      const command = join(tools.codebase.root, 'codebase-memory-mcp');
      if (damage !== 'empty') writeFileSync(command, 'old unverified bytes', { mode: 0o700 });
      const foreign = join(tools.codebase.root, 'personal');
      if (damage === 'foreign') writeFileSync(foreign, 'keep');
      expect(() => tools.codebase.command()).toThrow('codebase-memory-integrity-failed');
      expect(probes).toBe(0);
      const adapter = createPiRunnerAdapter({ homeDirectory: home, env: { HOME: home }, piCommand: pi, piTools: tools });
      const input = { projectRoot: home, runnerId: 'pi', environmentId: 'pi-development', deckConfig: getDefaultDeckConfig() };
      const inventory = await adapter.getCapabilityInventory(input);
      expect(normalizeDashboardCapabilityInventory(inventory, 'pi', 'pi-development')).toMatchObject({ ok: true });
      expect(inventory.capabilities.find(cap => cap.capabilityId === 'codebase-memory-mcp')?.isInstalled).toBe(false);
      const state = { runnerId: 'pi', environmentId: 'pi-development', selectedCapabilities: { 'codebase-memory-mcp': true }, packageInstructions: {} } satisfies DashboardState;
      const plan = adapter.buildReviewPlan(state, inventory);
      const action = Object.values(plan.groups).flat().find(action => action.capabilityId === 'codebase-memory-mcp' && action.kind === 'install-pi-package');
      expect(action).toBeDefined();
      const result = await adapter.runAction(action!, { projectRoot: home, runnerId: 'pi', environmentId: 'pi-development', runnerCommand: pi });
      if (damage === 'foreign' || damage === 'bad-download') {
        expect(result.status).toBe('failed');
        expect(readFileSync(command, 'utf8')).toBe('old unverified bytes');
        if (damage === 'foreign') expect(readFileSync(foreign, 'utf8')).toBe('keep');
        expect(() => tools.codebase.command()).toThrow('codebase-memory-integrity-failed');
      } else {
        expect(result).toMatchObject({ status: 'executed' });
        expect(readFileSync(tools.codebase.command()!, 'utf8')).toBe(binary);
        const after = await adapter.getCapabilityInventory(input);
        expect(after.capabilities.find(cap => cap.capabilityId === 'codebase-memory-mcp')?.isInstalled).toBe(true);
        if (damage === 'edited') {
          const saved = readdirSync(join(tools.codebase.root, '..', '.replaced'));
          expect(saved).toHaveLength(1);
          expect(readFileSync(join(tools.codebase.root, '..', '.replaced', saved[0]!), 'utf8')).toBe('old unverified bytes');
        }
      }
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
