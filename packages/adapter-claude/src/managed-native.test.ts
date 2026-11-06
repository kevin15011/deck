import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { getDefaultDeckConfig } from '@deck/core';
import { createClaudeRunnerAdapter } from './runner-adapter';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

// Protects the reviewed public acquisition path: edited owned bytes must reach pinned repair,
// without executing them or treating an unsafe destination as a successful install.
for (const id of ['rtk', 'codebase-memory'] as const) test(`Claude reviews and repairs edited owned ${id} through the public action`, async () => {
 const home = realpathSync(mkdtempSync(join(tmpdir(), 'claude-native-managed-')));
 try {
  const dataRoot = join(home, 'deck'), binary = Buffer.from('canonical native fixture');
  const name = id === 'rtk' ? 'rtk' : 'codebase-memory-mcp';
  const members = id === 'rtk' ? [name] : [name, 'LICENSE', 'install.sh', 'THIRD_PARTY_NOTICES.md'];
  const archive = gzipSync(Buffer.concat([...members.flatMap(member => {
   const bytes = member === name ? binary : Buffer.from('fixture');
   const header = Buffer.alloc(512); header.write(member); header.write(bytes.length.toString(8).padStart(11, '0'), 124); header[156] = 48;
   return [header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
  }), Buffer.alloc(1024)]));
  const release = { asset: 'fixture', binaryBytes: binary.length, binarySha256: hash(binary), archiveBytes: archive.length, archiveSha256: hash(archive) };
  const root = join(dataRoot, 'claude/tools', id === 'rtk' ? 'rtk-v0.50.0' : 'codebase-native-v0.11.0', `${process.platform}-${process.arch}`);
  mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(join(root, name), 'untrusted bytes', { mode: 0o700 });
  const verify = (path: string) => { expect(readFileSync(path)).toEqual(binary); return true; };
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, resolveCommand: () => undefined,
   rtkReleaseOverride: release, codebaseReleaseOverride: release,
   rtkArtifactEffects: { fetchArchive: async () => archive }, codebaseArtifactEffects: { fetchArchive: async () => archive },
   verifyRtkCommand: verify, verifyCodebaseNative: verify, verifyExistingCodebase: () => false });
  const config = getDefaultDeckConfig(); config.capabilities!['codebase-memory'].enabled = true;
  const input = { projectRoot: home, runnerId: 'claude' as const, environmentId: 'claude-development' as const, deckConfig: config };
  const inventory = await adapter.getCapabilityInventory(input);
  expect(inventory.capabilities.find(entry => entry.capabilityId === id)).toMatchObject({ isInstalled: false, isBlocked: false });
  const plan = adapter.buildReviewPlan({ runnerId: 'claude', environmentId: 'claude-development', selectedCapabilities: {}, packageInstructions: { [id]: true } }, inventory);
  expect(plan.ready).toBe(true);
  const action = plan.groups.automaticInstalls.find(action => action.capabilityId === id)!;
  expect(action).toBeDefined();
  expect((await adapter.runAction(action, { projectRoot: home, runnerId: 'claude', environmentId: 'claude-development' })).status).toBe('executed');
  expect(readFileSync(join(root, name))).toEqual(binary);
 } finally { rmSync(home, { recursive: true, force: true }); }
});
