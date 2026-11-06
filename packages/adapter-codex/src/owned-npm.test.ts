import { ownedNpmRoot } from '../../adapter-claude/src/npm-tools';
import { expect, test, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexTools } from './tools';
import { createClaudeRunnerAdapter } from '../../adapter-claude/src/runner-adapter';
import { contributionId, contributionHash } from '@deck/core';
import { acquireInstallationUse } from '../../core/src/installation-use';

// Protects default adapter composition (only acquisition/network is replaced): no version/presence
// acceptance, no in-place install, receipt issuance only after verification, and runner-reader leases.
for (const [runner, id] of [['codex', 'context7'], ['claude', 'context7'], ['claude', 'web-search']] as const) test(`${runner} public ${id} npm install repairs whole trees and records acquired leaves`, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), `deck-${runner}-npm-`))), dataRoot = join(home, 'deck');
  const toolsRoot = join(dataRoot, runner, 'tools'), root = ownedNpmRoot(toolsRoot, id);
  const packageName = id === 'context7' ? '@upstash/context7-mcp' : 'tavily-mcp';
  const binName = id === 'context7' ? 'context7-mcp' : 'tavily-mcp';
  let acquisitions = 0, failReceipt = false;
  const manifestPath = runner === 'codex' ? join(home, '.codex', 'deck', 'manifest.json') : join(dataRoot, 'claude', 'manifest.json');
  const effects = { acquire: async (stage: string) => {
    acquisitions++;
    mkdirSync(join(stage, 'node_modules', packageName), { recursive: true });
    writeFileSync(join(stage, 'node_modules', packageName, 'cli.js'), 'canonical', { mode: 0o700 });
    mkdirSync(join(stage, 'node_modules', '.bin'));
    symlinkSync(`../${packageName}/cli.js`, join(stage, 'node_modules', '.bin', binName));
    if (failReceipt) { rmSync(manifestPath); mkdirSync(manifestPath); }
  } };
  const tools = createCodexTools({ homeDir: home, dataRoot, npmArtifactEffects: effects });
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, npmArtifactEffects: effects });
  const install = async () => runner === 'codex' ? tools.context7.install() : (await adapter.runAction({ id: 'test', kind: 'install-claude-tool', title: 'install', status: 'ready', required: true, capabilityId: id }, { projectRoot: home, runnerId: 'claude', environmentId: 'claude-development' })).status === 'executed';
  try {
    expect(await install()).toBe(true);
    const command = join(root, 'node_modules', packageName, 'cli.js');
    writeFileSync(command, 'edited');
    const leaseRoot = runner === 'codex' ? join(home, '.codex') : join(dataRoot, 'claude');
    const held = acquireInstallationUse(leaseRoot);
    try {
      try { await install(); } catch { /* Codex propagates the existing busy error. */ }
      expect(readFileSync(command, 'utf8')).toBe('edited');
      expect(acquisitions).toBe(1);
    } finally { held.release(); }
    const manifestBefore=readFileSync(manifestPath,'utf8');
    failReceipt=true;
    await expect(install()).rejects.toThrow();
    expect(readFileSync(command,'utf8')).toBe('edited');
    expect(statSync(manifestPath).isDirectory()).toBe(true);
    rmSync(manifestPath,{recursive:true});writeFileSync(manifestPath,manifestBefore);
    failReceipt=false;
    expect(await install()).toBe(true);
    expect(readFileSync(command, 'utf8')).toBe('canonical');
    const receipt = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(receipt.contributions.some((entry: any) => entry.path === command && entry.sourceItemId === `package:${id}`)).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// Oracle: a receipt replaced after capture belongs to the concurrent writer. Publication must
// fail, preserve all of that writer's bytes, and restore the exact pre-install package tree.
for (const [runner, id] of [['codex', 'context7'], ['claude', 'context7'], ['claude', 'web-search']] as const) test(`${runner} public ${id} preserves a receipt replaced during publication`, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'deck-npm-receipt-race-'))), dataRoot = join(home, 'deck');
  const root = ownedNpmRoot(join(dataRoot, runner, 'tools'), id);
  const packageName = id === 'context7' ? '@upstash/context7-mcp' : 'tavily-mcp';
  const binName = id === 'context7' ? 'context7-mcp' : 'tavily-mcp';
  const manifestPath = runner === 'codex' ? join(home, '.codex', 'deck', 'manifest.json') : join(dataRoot, 'claude', 'manifest.json');
  const effects = { acquire: async (stage: string) => {
    mkdirSync(join(stage, 'node_modules', packageName), { recursive: true });
    writeFileSync(join(stage, 'node_modules', packageName, 'cli.js'), 'canonical', { mode: 0o700 });
    mkdirSync(join(stage, 'node_modules', '.bin'));
    symlinkSync(`../${packageName}/cli.js`, join(stage, 'node_modules', '.bin', binName));
  } };
  const tools = createCodexTools({ homeDir: home, dataRoot, npmArtifactEffects: effects });
  const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot, npmArtifactEffects: effects });
  const install = async () => runner === 'codex' ? tools.context7.install() : (await adapter.runAction({ id: 'test', kind: 'install-claude-tool', title: 'install', status: 'ready', required: true, capabilityId: id }, { projectRoot: home, runnerId: 'claude', environmentId: 'claude-development' })).status === 'executed';
  let fault: ReturnType<typeof spyOn> | undefined;
  try {
    expect(await install()).toBe(true);
    const command = join(root, 'node_modules', packageName, 'cli.js');
    writeFileSync(command, 'private edited preimage', { mode: 0o700 });
    // Missing accounting forces receipt publication even when reacquisition returns
    // identical pinned bytes. The independent writer adds an unrelated package receipt.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.contributions = [];
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const target = { path: join(home, 'foreign-package'), selector: { kind: 'file' as const }, sourceItemId: 'package:foreign' };
    const foreign = JSON.stringify({ ...manifest, contributions: [{ ...target, id: contributionId(target), hash: contributionHash('concurrent owner'), encoding: 'bytes', scope: 'global', ownership: 'prior-record' }] }) + '\n';
    const write = fs.writeFileSync;
    let interleaved = false;
    fault = spyOn(fs, 'writeFileSync').mockImplementation(((path: any, bytes: any, ...args: any[]) => {
      (write as any)(path, bytes, ...args);
      if (String(path).startsWith(`${manifestPath}.`) && String(path).endsWith('.tmp')) {
        interleaved = true;
        const replacement = `${manifestPath}.foreign`;
        write(replacement, foreign, { mode: 0o600 });
        fs.renameSync(replacement, manifestPath);
      }
    }) as typeof fs.writeFileSync);
    const failure = await install().then(() => undefined, error => error);
    expect(interleaved).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/changed|conflict/i);
    expect(readFileSync(manifestPath, 'utf8')).toBe(foreign);
    expect(readFileSync(command, 'utf8')).toBe('private edited preimage');
    expect(fs.readdirSync(join(manifestPath, '..')).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { fault?.mockRestore(); rmSync(home, { recursive: true, force: true }); }
});
