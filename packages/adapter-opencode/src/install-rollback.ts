import { jsonRanges, type JsonNode } from '../../core/src/jsonc-ranges';
import { setField } from './content-refresh';
import { parseJsonc } from "./model-discovery-context";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoContributionSymlink, contributionHash, readContribution, canonicalContributionJson, contributionId, readRunnerContributions, selectContributionContent, sharedJsonContributionTargets, recoverRunnerContributionTransaction, type ContributionTarget, type RunnerContributions } from '@deck/core';

type Change = { target: ContributionTarget; before?: string; after?: string };
export type OpenCodeInstallRollback = {
  root: string; recoveryTargets: ContributionTarget[]; rollbackPreimages: { target: ContributionTarget; hash: string }[];
  manifestPath: string; before?: RunnerContributions; after?: RunnerContributions;
  selectedIds: Set<string>; changes: Change[]; shared: Map<string, { before?: string; after: string }>;
};
const read = (path: string): string | undefined => { assertNoContributionSymlink(path); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; };

/** Snapshot only this plan's files/entries. Independent receipts never belong to its rollback. */
export function backupOpenCodeInstall(root: string, files: readonly { path: string; content: string }[], legacy: readonly { absolutePath: string; previousContent: string | null }[], recoveryTargets?: readonly ContributionTarget[]): OpenCodeInstallRollback {
  const manifestPath = join(root, 'deck/manifest.json');
  const state: OpenCodeInstallRollback = { root, recoveryTargets: [], rollbackPreimages: [], manifestPath, before: readRunnerContributions(manifestPath), changes: [], shared: new Map(), selectedIds: new Set() };
  const add = (target: ContributionTarget, before?: string, after?: string) => {
    if (!state.selectedIds.has(contributionId(target))) {
      state.recoveryTargets.push({ ...target, expectedHash: after === undefined ? undefined : contributionHash(after) });
      state.rollbackPreimages.push({ target, hash: before === undefined ? 'absent' : contributionHash(before) });
    }
    state.selectedIds.add(contributionId(target));
    if (before !== after) state.changes.push({ target, before, after });
  };
  for (const file of files) {
    const path = join(root, file.path), before = read(path);
    if (file.path === 'opencode.json' || file.path === 'opencode.jsonc') {
      state.shared.set(path, { before, after: file.content });
      const targets = [...sharedJsonContributionTargets(path, parseJsonc(before ?? '{}') as Record<string, unknown>), ...sharedJsonContributionTargets(path, parseJsonc(file.content) as Record<string, unknown>)];
      for (const target of new Map(targets.map(target => [contributionId(target), target])).values()) add(target, selectContributionContent(before ?? '{}', target.selector), selectContributionContent(file.content, target.selector));
    } else add({ path, selector: { kind: 'file' } }, before, file.content);
  }
  const planned = new Set(files.map(file => join(root, file.path)));
  for (const entry of legacy) if (!planned.has(entry.absolutePath)) add({ path: entry.absolutePath, selector: { kind: 'file' } }, entry.previousContent ?? undefined, undefined);
  if (recoveryTargets) {
    state.recoveryTargets = [...recoveryTargets];
    state.rollbackPreimages = recoveryTargets.map(target => {
      const content = readContribution(target);
      return { target, hash: content === undefined ? 'absent' : contributionHash(content) };
    });
  }
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
// Delete syntax separately so comments between entries survive.
function removeRange(text: string, start: number, end: number, comma?: number, previousComma?: number): string {
  const separator = comma ?? previousComma;
  if (separator !== undefined && separator >= end) text = text.slice(0, separator) + text.slice(separator + 1);
  text = text.slice(0, start) + text.slice(end);
  if (separator !== undefined && separator < start) text = text.slice(0, separator) + text.slice(separator + 1);
  return text;
}
function removeField(text: string, keys: string[]): string {
  let node: JsonNode | undefined = jsonRanges(text);
  for (const key of keys.slice(0, -1)) node = node?.properties?.get(key)?.node;
  const property = node?.properties?.get(keys.at(-1)!);
  return property ? removeRange(text, property.start, property.node.end, property.comma, property.previousComma) : text;
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
    const shared = state.shared.get(target.path);
    if (shared && originals.get(target.path) === shared.after) { outputs.set(target.path, shared.before); continue; }
    let text = outputs.get(target.path) ?? '{}';
    const selector = target.selector;
    if (selector.kind !== 'json' && selector.kind !== 'json-array') throw new Error('Unsupported rollback selector');
    if (selector.kind === 'json-array') {
      const array = (source: string) => {
        let node: JsonNode | undefined = jsonRanges(source);
        for (const key of selector.keys) node = node?.properties?.get(key)?.node;
        return node;
      };
      if (before === undefined) {
        for (;;) {
          const element = array(text)?.elements?.find(item => canonicalContributionJson(item.node.value) === selector.identity);
          if (!element) break;
          text = removeRange(text, element.node.start, element.node.end, element.comma, element.previousComma);
        }
      } else {
        const original = array(shared?.before ?? '{}')?.elements ?? [];
        const priorEntries = original.filter(item => canonicalContributionJson(item.node.value) === selector.identity);
        const observedCount = array(text)?.elements?.filter(item => canonicalContributionJson(item.node.value) === selector.identity).length ?? 0;
        for (let index = observedCount; index < Math.max(1, priorEntries.length); index++) {
          const node = array(text);
          if (!node) { text = setField(text, selector.keys, [JSON.parse(before)]); continue; }
          // Reinsert before the next surviving original sibling, retaining its
          // load order and every concurrent foreign element/comment.
          const following = original.slice(original.indexOf(priorEntries[index]!) + 1);
          const next = following.map(item => node.elements?.find(candidate => canonicalContributionJson(candidate.node.value) === canonicalContributionJson(item.node.value))).find(Boolean);
          if (next) text = text.slice(0, next.node.start) + before + ',' + text.slice(next.node.start);
          else {
            const last = node.elements?.at(-1);
            text = text.slice(0, node.end - 1) + `${last && last.comma === undefined ? ',' : ''}${before}` + text.slice(node.end - 1);
          }
        }
      }
    } else if (before !== undefined) text = setField(text, selector.keys, JSON.parse(before));
    else text = removeField(text, selector.keys);
    outputs.set(target.path, text);
  }
  for (const [path, content] of outputs) publish(path, content, originals.get(path));
  // Preserve concurrent package receipts, restoring only selected identities and their original order.
  const contributions = [...(state.before?.contributions ?? []).filter(entry => state.selectedIds.has(entry.id)), ...(observed?.contributions ?? []).filter(entry => !state.selectedIds.has(entry.id))];
  const next = observed ? { ...observed, contributions } : state.before;
  const nextText = next ? JSON.stringify(next, null, 2) + '\n' : undefined;
  publish(state.manifestPath, nextText, observedText);
  if (existsSync(`${state.manifestPath}.pending`)) recoverRunnerContributionTransaction(state.manifestPath, { runnerId: 'opencode', root: state.root, targets: state.recoveryTargets, rollbackPreimages: state.rollbackPreimages });
  return { status: 'rolled-back', conflicts: [], diagnostics: [] };
}
