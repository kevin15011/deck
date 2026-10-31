/** Adversarial perturbations of an actual historical install, before its normal migration. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPackageRetirement, planPackageRetirement, beginRunnerContributions, recoverRunnerContributionTransaction } from '../packages/core/src';
import { planRunnerCleanup, type CleanupRoots } from '../apps/cli/src/runner-cleanup-command';
import { assertFixtureHome } from './retirement-matrix-fixture';

export function historicalPreservationScenarios(home: string, runner: string, roots: CleanupRoots) {
  assertFixtureHome(home);
  const plan = () => planRunnerCleanup(roots, [runner]).plans[0]!;
  const initial = plan();
  const results: { scenario: string; status: string; detail?: string }[] = [];
  const root = runner === 'claude' ? join(roots.data, 'claude') : roots[runner as 'codex' | 'pi' | 'opencode'];
  const manifestPath = join(root, runner === 'claude' ? 'manifest.json' : 'deck/manifest.json');
  const original = existsSync(manifestPath) ? readFileSync(manifestPath) : undefined;
  try {
    if (original) unlinkSync(manifestPath);
    const missing = plan();
    if (missing.entries.some(entry => entry.ownership === 'manifest-proven')) throw Error('missing manifest inferred ownership');
    results.push({ scenario: 'missing-manifest', status: 'verified', detail: 'No manifest-proven entry; dedicated-location authority remains distinct.' });
    if (original) {
      const raw = JSON.parse(original.toString());
      if (Array.isArray(raw.contributions)) for (const record of raw.contributions) record.hash = '0'.repeat(64);
      if (raw.mcp?.servers) for (const id of Object.keys(raw.mcp.servers)) raw.mcp.servers[id] = '0'.repeat(64);
      if (raw.files) for (const path of Object.keys(raw.files)) {
        if (typeof raw.files[path] === 'string') raw.files[path] = '0'.repeat(64);
        else if (raw.files[path] && typeof raw.files[path].hash === 'string') raw.files[path].hash = '0'.repeat(64);
      }
      writeFileSync(manifestPath, JSON.stringify(raw));
      if (plan().entries.some(entry => entry.ownership === 'manifest-proven')) throw Error('zero hashes inferred ownership');
      results.push({ scenario: 'zero-manifest', status: 'verified', detail: 'Actual historical manifest with hashes zeroed; no ownership inferred.' });
    } else results.push({ scenario: 'zero-manifest', status: 'not-applicable', detail: 'This historical installation did not produce a manifest.' });
  } finally {
    if (original) writeFileSync(manifestPath, original);
    else if (existsSync(manifestPath)) unlinkSync(manifestPath);
  }
  // Select an actual historical configuration entry, not a newly generated template.
  const selected = initial.entries.find(entry => entry.selector !== 'whole-link' && !entry.generation);
  if (selected) {
    const before = readFileSync(selected.path);
    const single = { ...initial, entries: [selected] };
    try {
      writeFileSync(selected.path, Buffer.concat([before, Buffer.from('\n')]));
      let rejected = false;
      try { applyPackageRetirement(single, [selected]); } catch { rejected = true; }
      if (!rejected || !readFileSync(selected.path).equals(Buffer.concat([before, Buffer.from('\n')]))) throw Error('stale historical preimage was mutated');
      results.push({ scenario: 'edited-preimage', status: 'verified' });
    } finally { writeFileSync(selected.path, before); }
    const backupRoot = join(home, 'scenario-backup-conflict'); mkdirSync(backupRoot, { recursive: true });
    const conflict = join(backupRoot, `${selected.fileHash}.pre-retirement`);
    writeFileSync(conflict, 'SYNTHETIC conflicting backup');
    let rejected = false;
    try { applyPackageRetirement(single, [selected], { backupRoot }); } catch { rejected = true; }
    if (!rejected || !readFileSync(selected.path).equals(before)) throw Error('backup failure mutated historical installation');
    unlinkSync(conflict);
    results.push({ scenario: 'backup-failure-before-retry', status: 'verified' });
  } else results.push({ scenario: 'edited-preimage/backup-failure', status: 'incomplete', detail: 'No eligible nonreferenced historical retired entry.' });
  // Inject a user-owned MCP entry into an actual historical config, preserving
  // its original bytes. This is explicitly an adversarial addition to the
  // installation, never a claim that the release produced the user entry.
  const configPath = runner === 'codex' ? join(root, 'config.toml') : runner === 'pi' ? join(root, 'mcp.json')
    : runner === 'opencode' ? join(root, 'opencode.json') : join(home, '.claude.json');
  const originalConfig = existsSync(configPath) ? readFileSync(configPath) : undefined;
  try {
    let text: string;
    if (runner === 'codex') {
      const parsed = Bun.TOML.parse(originalConfig?.toString() ?? '') as any;
      const synthetic='[mcp_servers.serena]\ncommand = "SYNTHETIC-user-managed-serena"\n';
      const originalText=originalConfig?.toString()??'';
      if(parsed.mcp_servers?.serena){
        const entry=initial.entries.find(entry=>entry.path===configPath&&entry.capability==='serena');
        if(!entry||entry.ranges.length!==1)throw Error('Selected historical Serena TOML entry cannot be safely perturbed');
        const range=entry.ranges[0]!;
        text=originalText.slice(0,range.start)+synthetic+originalText.slice(range.end);
      }else text=originalText+'\n'+synthetic;
    } else {
      const raw = originalConfig ? JSON.parse(originalConfig.toString()) : {};
      const container = runner === 'opencode' ? 'mcp' : 'mcpServers';
      raw[container] ??= {};
      raw[container].serena = runner === 'opencode' ? { type: 'local', command: ['SYNTHETIC-user-managed-serena'] } : { command: 'SYNTHETIC-user-managed-serena' };
      text = JSON.stringify(raw);
    }
    mkdirSync(root, { recursive: true }); writeFileSync(configPath, text);
    const candidate = plan().entries.find(entry => entry.path === configPath && entry.capability === 'serena');
    if (!candidate || candidate.action !== 'conditional-remove') throw Error('user MCP entry was treated as owned');
    applyPackageRetirement({ ...initial, entries: [candidate] }, []);
    if (readFileSync(configPath, 'utf8') !== text) throw Error('unattended user MCP entry changed');
    results.push({ scenario: 'user-entry-and-ambiguity', status: 'verified', detail: originalConfig ? 'Synthetic user entry injected into the actual historical native config; unattended preserves it.' : 'Synthetic user config added alongside the actual historical installation; unattended preserves it.' });
    const externalPath = join(home, 'shared-user/context-mode'); mkdirSync(join(home, 'shared-user'), { recursive: true });
    writeFileSync(externalPath, text);
    const shared = planPackageRetirement({ runnerId: runner, targets: [{ path: externalPath, format: 'file', capability: 'context-mode' }], dedicatedRoots: [] });
    applyPackageRetirement(shared, []);
    if (readFileSync(externalPath, 'utf8') !== text) throw Error('shared user artifact changed');
    results.push({ scenario: 'shared-user-artifact', status: 'verified', detail: 'Synthetic shared artifact preserved independently of the dedicated historical installation.' });
  } finally {
    if (originalConfig) writeFileSync(configPath, originalConfig);
    else if (existsSync(configPath)) unlinkSync(configPath);
  }
  return results;
}

/** Exercise pending recovery against a real migrated file and preserve concurrent user edits. */
export function migratedRecoveryScenario(home: string, runner: string, path: string) {
  assertFixtureHome(home, path);
  const before = readFileSync(path), manifestPath = join(home, 'scenario-recovery/manifest.json');
  const target = { path, selector: { kind: 'file' as const } };
  const begin = () => beginRunnerContributions({ runnerId: runner, root: home, manifestPath, deckVersion: 'fixture', targets: [target] });
  begin().abandon();
  writeFileSync(path, 'SYNTHETIC concurrent user edit');
  let rejected = false;
  try { recoverRunnerContributionTransaction(manifestPath); } catch { rejected = true; }
  if (!rejected || readFileSync(path, 'utf8') !== 'SYNTHETIC concurrent user edit') throw Error('recovery discarded concurrent edit');
  writeFileSync(path, before);
  if (recoverRunnerContributionTransaction(manifestPath) !== 'rolled-back') throw Error('restored historical preimage did not recover');
  begin().abandon();
  if (recoverRunnerContributionTransaction(manifestPath) !== 'rolled-back') throw Error('recovery retry failed');
  return { scenario: 'interrupted-accounting-conflict-restore-retry', status: 'verified', provenance: 'real migrated file; synthetic interruption and concurrent edit' };
}
