import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoContributionSymlink, canonicalContributionJson, contributionId, readRunnerContributions, selectContributionContent, sharedJsonContributionTargets, recoverRunnerContributionTransaction, type ContributionTarget, type RunnerContributions } from '@deck/core';

type Change = { target: ContributionTarget; before?: string; after?: string };
export type OpenCodeInstallRollback = {
  manifestPath: string; before?: RunnerContributions; after?: RunnerContributions;
  selectedIds: Set<string>; changes: Change[];
};
const read = (path: string): string | undefined => { assertNoContributionSymlink(path); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; };

/** Snapshot only this plan's files/entries. Independent receipts never belong to its rollback. */
export function backupOpenCodeInstall(root: string, files: readonly { path: string; content: string }[], legacy: readonly { absolutePath: string; previousContent: string | null }[]): OpenCodeInstallRollback {
  const manifestPath = join(root, 'deck/manifest.json');
  const state: OpenCodeInstallRollback = { manifestPath, before: readRunnerContributions(manifestPath), changes: [], selectedIds: new Set() };
  const add = (target: ContributionTarget, before?: string, after?: string) => {
    state.selectedIds.add(contributionId(target));
    if (before !== after) state.changes.push({ target, before, after });
  };
  for (const file of files) {
    const path = join(root, file.path), before = read(path);
    if (file.path === 'opencode.json') {
      const targets = [...sharedJsonContributionTargets(path, JSON.parse(before ?? '{}')), ...sharedJsonContributionTargets(path, JSON.parse(file.content))];
      for (const target of new Map(targets.map(target => [contributionId(target), target])).values()) add(target, selectContributionContent(before ?? '{}', target.selector), selectContributionContent(file.content, target.selector));
    } else add({ path, selector: { kind: 'file' } }, before, file.content);
  }
  const planned = new Set(files.map(file => join(root, file.path)));
  for (const entry of legacy) if (!planned.has(entry.absolutePath)) add({ path: entry.absolutePath, selector: { kind: 'file' } }, entry.previousContent ?? undefined, undefined);
  return state;
}
function publish(path: string, text: string | undefined, expected: string | undefined) {
  if (read(path) !== expected) throw new Error(`Rollback preimage changed: ${path}`);
  if (text === expected) return;
  if (text === undefined) { unlinkSync(path); return; }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.rollback`;
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: existsSync(path) ? statSync(path).mode & 0o777 : 0o600 });
    if (read(path) !== expected) throw new Error(`Rollback preimage changed: ${path}`);
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
/** Compare all affected postimages before restoring any. Retry accepts already-restored preimages. */
export function rollbackOpenCodeInstall(state: OpenCodeInstallRollback): { status: 'rolled-back' | 'conflict'; conflicts: string[]; diagnostics: string[] } {
  const conflicts: string[] = [];
  const observedText = read(state.manifestPath), observed = readRunnerContributions(state.manifestPath);
  const expected = new Map((state.after ?? state.before)?.contributions.map(entry => [entry.id, entry]));
  const prior = new Map(state.before?.contributions.map(entry => [entry.id, entry]));
  const current = new Map(observed?.contributions.map(entry => [entry.id, entry]));
  if (observed && (observed.runnerId !== 'opencode' || observed.root !== (state.after ?? state.before)?.root)) conflicts.push(state.manifestPath);
  for (const id of state.selectedIds) {
    const receipt = canonicalContributionJson(current.get(id) ?? null);
    if (receipt !== canonicalContributionJson(expected.get(id) ?? null) && receipt !== canonicalContributionJson(prior.get(id) ?? null)) conflicts.push(state.manifestPath);
  }
  const originals = new Map<string, string | undefined>();
  for (const { target, before, after } of state.changes) {
    if (!originals.has(target.path)) originals.set(target.path, read(target.path));
    const text = originals.get(target.path);
    const content = text === undefined ? undefined : selectContributionContent(text, target.selector);
    if (content !== before && content !== after) conflicts.push(target.path);
  }
  if (conflicts.length) return { status: 'conflict', conflicts: [...new Set(conflicts)], diagnostics: ['Rollback refused: affected content or ownership receipts changed after apply; user edits and receipts were preserved.'] };
  const outputs = new Map(originals);
  for (const { target, before } of state.changes) {
    if (target.selector.kind === 'file') { outputs.set(target.path, before); continue; }
    const value = JSON.parse(outputs.get(target.path) ?? '{}');
    const selector = target.selector;
    if (selector.kind !== 'json' && selector.kind !== 'json-array') throw new Error('Unsupported rollback selector');
    let node = value;
    const keys = selector.kind === 'json' ? selector.keys.slice(0, -1) : selector.keys;
    for (const key of keys) node = node[key] ??= {};
    if (selector.kind === 'json-array') {
      const key = keys.at(-1)!;
      let parent = value; for (const name of keys.slice(0, -1)) parent = parent[name];
      parent[key] = (Array.isArray(node) ? node : []).filter((item: unknown) => canonicalContributionJson(item) !== selector.identity);
      if (before !== undefined) parent[key].push(JSON.parse(before));
    } else if (before === undefined) delete node[selector.keys.at(-1)!];
    else node[selector.keys.at(-1)!] = JSON.parse(before);
    outputs.set(target.path, JSON.stringify(value, null, 2));
  }
  for (const [path, content] of outputs) publish(path, content, originals.get(path));
  // Preserve concurrent package receipts, restoring only selected identities and their original order.
  const contributions = [...(state.before?.contributions ?? []).filter(entry => state.selectedIds.has(entry.id)), ...(observed?.contributions ?? []).filter(entry => !state.selectedIds.has(entry.id))];
  const next = observed ? { ...observed, contributions } : state.before;
  const nextText = next ? JSON.stringify(next, null, 2) + '\n' : undefined;
  publish(state.manifestPath, nextText, observedText);
  if (existsSync(`${state.manifestPath}.pending`)) recoverRunnerContributionTransaction(state.manifestPath);
  return { status: 'rolled-back', conflicts: [], diagnostics: [] };
}
