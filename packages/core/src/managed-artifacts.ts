import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertNoContributionSymlink, canonicalContributionJson, contributionHash, contributionId, readContribution, selectContributionContent, validContributionHash, type ContributionTarget, type RunnerContribution } from './runner-contributions';
import { jsonRanges } from './jsonc-ranges';
import { assertPrivateStatePath, writePrivateState } from './runner-history';

/** Trusted generator inventory, never constructed from receipts, history or discovered filenames.
 * Roots contain ONLY generated leaves. Shared files require exact enumerated selectors.
 * Generic shared names require recognition; a receipt can recognize only an enumerated candidate.
 */
export type ManagedTargetInventory = {
  runnerId: string; root: string; generatedRoots: readonly string[];
  slots: readonly (ContributionTarget & { authority: 'generated' | 'recognized'; recognizeLegacy?: (content: string | Uint8Array) => boolean })[];
};
export type ManagedAuthority = 'generated-root' | 'generated-slot' | 'receipt' | 'history' | 'legacy' | 'canonical' | 'new' | 'ambiguous';
export type ManagedArtifactPolicy = { inventory: ManagedTargetInventory; stateRoot: string; scope?: 'global' | 'project'; history?: readonly RunnerContribution[] };
const inside = (path: string, root: string): boolean => {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
function validateInventory(inventory: ManagedTargetInventory): void {
  if (!/^[a-z]+$/.test(inventory.runnerId) || !isAbsolute(inventory.root)) throw new Error('managed-inventory-identity-invalid');
  assertNoContributionSymlink(inventory.root);
  for (const root of inventory.generatedRoots) {
    if (!isAbsolute(root) || !inside(root, inventory.root)) throw new Error('managed-generated-root-invalid');
    assertNoContributionSymlink(root);
  }
  for (const slot of inventory.slots) {
    if (!isAbsolute(slot.path) || !inside(slot.path, inventory.root)) throw new Error('managed-slot-outside-root');
  }
}
function matchingRecord(target: ContributionTarget, entries: readonly RunnerContribution[]): RunnerContribution | undefined {
  const id = contributionId(target);
  return entries.find(entry => {
    try { return entry.id === id && contributionId(entry) === id && validContributionHash(entry.hash); }
    catch { return false; }
  });
}
/** Recognition authorizes regeneration only; it never grants read-only launch trust. */
export function classifyManagedSlot(input: {
  inventory: ManagedTargetInventory; target: ContributionTarget; content: string | Uint8Array | undefined;
  receipts?: readonly RunnerContribution[]; history?: readonly RunnerContribution[];
}): ManagedAuthority {
  const { inventory, target, content } = input;
  validateInventory(inventory);
  if (!isAbsolute(target.path) || !inside(target.path, inventory.root)) return 'ambiguous';
  if ((target.selector.kind === 'file' || target.selector.kind === 'symlink') && inventory.generatedRoots.some(root => inside(target.path, root))) return 'generated-root';
  const slot = inventory.slots.find(slot => contributionId(slot) === contributionId(target));
  if (!slot) return 'ambiguous';
  if (slot.authority === 'generated') return 'generated-slot';
  if (matchingRecord(target, input.receipts ?? [])) return 'receipt';
  if (matchingRecord(target, input.history ?? [])) return 'history';
  if (content === undefined) return 'new';
  if (slot.recognizeLegacy?.(content)) return 'legacy';
  if (validContributionHash(target.expectedHash) && contributionHash(content) === target.expectedHash) return 'canonical';
  return 'ambiguous';
}
/** Read-only: compare installed bytes with installed receipts, never with this peer's generator.
 * Caller must supply receipts from the matching runner/root envelope. Missing receipts are drift.
 */
export function inspectManagedDrift(input: {
  inventory: ManagedTargetInventory; targets: readonly ContributionTarget[];
  receipts?: readonly RunnerContribution[]; history?: readonly RunnerContribution[];
}): { drift: boolean; targets: ContributionTarget[]; ambiguous: ContributionTarget[] } {
  const targets: ContributionTarget[] = [], ambiguous: ContributionTarget[] = [];
  // Validate the complete caller inventory once, then classify each exact slot.
  // Keep first-match semantics and no cache beyond this read-only assessment.
  validateInventory(input.inventory);
  const slots = new Map<string, ManagedTargetInventory['slots'][number]>();
  for (const slot of input.inventory.slots) { const id = contributionId(slot); if (!slots.has(id)) slots.set(id, slot); }
  for (const target of input.targets) {
    const slot = slots.get(contributionId(target));
    const scoped = { ...input, inventory: { ...input.inventory, slots: slot ? [slot] : [] } };
    if (classifyManagedSlot({ ...scoped, target, content: undefined }) === 'ambiguous') { ambiguous.push(target); continue; }
    const content = readContribution(target);
    if (classifyManagedSlot({ ...scoped, target, content }) === 'ambiguous') { ambiguous.push(target); continue; }
    const receipt = matchingRecord(target, input.receipts ?? []);
    if (!receipt || content === undefined || contributionHash(content) !== receipt.hash) targets.push(target);
  }
  return { drift: targets.length > 0, targets, ambiguous };
}
/** Keep original JSON value bytes/comments for recovery, while receipts use canonical JSON. */
function readManagedPreimage(target: ContributionTarget): { content?: string | Uint8Array; preimage?: string | Uint8Array } {
  const selector = target.selector;
  if (selector.kind !== 'json' && selector.kind !== 'json-array') {
    const content = readContribution(target); return { content, preimage: content };
  }
  assertNoContributionSymlink(target.path);
  if (!existsSync(target.path)) return {};
  const text = readFileSync(target.path, 'utf8');
  const content = selectContributionContent(text, selector);
  if (content === undefined) return {};
  let node = jsonRanges(text);
  for (const key of selector.keys) {
    const child = node.properties?.get(key)?.node ?? (/^(0|[1-9]\d*)$/.test(key) ? node.elements?.[Number(key)]?.node : undefined);
    if (!child) throw new Error('managed-preimage-selector-invalid');
    node = child;
  }
  if (selector.kind === 'json-array') {
    const child = node.elements?.find(item => canonicalContributionJson(item.node.value) === selector.identity)?.node;
    if (!child) throw new Error('managed-preimage-selector-invalid');
    node = child;
  }
  return { content, preimage: text.slice(node.start, node.end) };
}
export function planManagedWrites(input: {
  policy: ManagedArtifactPolicy; runnerId: string; root: string; targets: readonly ContributionTarget[]; receipts: readonly RunnerContribution[];
}) {
  const { inventory } = input.policy;
  if (inventory.runnerId !== input.runnerId || resolve(inventory.root) !== resolve(input.root)) throw new Error('managed-inventory-identity-mismatch');
  validateInventory(inventory);
  const slots = new Map<string, ManagedTargetInventory['slots'][number]>();
  for (const slot of inventory.slots) { const id = contributionId(slot); if (!slots.has(id)) slots.set(id, slot); }
  const ids = new Set<string>();
  return input.targets.map(original => {
    // Freeze all adapter-owned metadata before effects, including nested selector arrays.
    const target: ContributionTarget = JSON.parse(JSON.stringify(original));
    const id = contributionId(target);
    if (ids.has(id)) throw new Error('managed-target-duplicate');
    ids.add(id);
    if (!validContributionHash(target.expectedHash)) throw new Error('managed-expected-postimage-required');
    const slot = slots.get(id);
    const scoped = { ...inventory, slots: slot ? [slot] : [] };
    if (classifyManagedSlot({ inventory: scoped, target, content: undefined }) === 'ambiguous') throw new Error('managed-target-ambiguous');
    const { content, preimage } = readManagedPreimage(target);
    const authority = classifyManagedSlot({ inventory: scoped, target, content, receipts: input.receipts, history: input.policy.history });
    if (authority === 'ambiguous') throw new Error('managed-target-ambiguous');
    return { target, content, preimage, id, before: content === undefined ? undefined : contributionHash(content), authority };
  });
}

const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
// Current complete OpenCode generated inventory is ~34 MiB (execution bundle ~17 MiB).
// Bound decoded input independently of compression; retain the existing on-disk budget.
const MAX_BACKUP_RAW_BYTES = 64 * 1024 * 1024;
const MAX_BACKUPS = 5;
/** Private, bounded inert recovery material. Never used as receipts or automatically restored.
 * Runs under the caller's existing exclusive runner mutation lease, before installation effects.
 */
export function backupManagedPreimages(input: {
  stateRoot: string; runnerId: string; root: string;
  entries: readonly { target: ContributionTarget; content: string | Uint8Array | undefined }[];
}): string | undefined {
  const entries = input.entries.filter(entry => entry.content !== undefined);
  if (!entries.length) return undefined;
  if (!/^[a-z]+$/.test(input.runnerId) || !isAbsolute(input.stateRoot)) throw new Error('managed-backup-identity-invalid');
  const rawBytes = entries.reduce((sum, entry) => sum + (typeof entry.content === 'string' ? Buffer.byteLength(entry.content) : entry.content!.byteLength), 0);
  if (rawBytes > MAX_BACKUP_RAW_BYTES) throw new Error('managed-backup-capacity');
  const directory = join(input.stateRoot, 'replaced', `${input.runnerId}-${contributionHash(resolve(input.root)).slice(0, 16)}`);
  assertPrivateStatePath(join(directory, 'boundary'));
  const prior = existsSync(directory) ? readdirSync(directory).filter(name => /^\d{13}-[a-f0-9-]{36}\.json$/.test(name)).sort() : [];
  const files = prior.map(name => {
    const path = join(directory, name); assertPrivateStatePath(path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.mode & 0o077) throw new Error('managed-backup-file-unsafe');
    return { path, size: stat.size };
  });
  const value = { schema: 2, entries: entries.map(({ target, content }) => {
    const raw = Buffer.from(content!);
    const compressed = raw.length >= 64 * 1024 ? gzipSync(raw) : undefined;
    const useGzip = compressed !== undefined && compressed.length < raw.length;
    return {
      path: resolve(target.path), selector: target.selector, bytes: raw.length,
      encoding: useGzip ? 'gzip-base64' : 'base64',
      content: (useGzip ? compressed! : raw).toString('base64'),
    };
  }) };
  const bytes = Buffer.byteLength(JSON.stringify(value) + '\n');
  if (bytes > MAX_BACKUP_BYTES) throw new Error('managed-backup-capacity');
  const path = join(directory, `${Date.now()}-${randomUUID()}.json`);
  writePrivateState(path, value);
  // Include serialized bytes (base64 overhead and metadata) in the hard bound.
  let total = bytes + files.reduce((sum, file) => sum + file.size, 0), count = files.length + 1;
  for (const file of files) {
    if (count <= MAX_BACKUPS && total <= MAX_BACKUP_BYTES) break;
    assertPrivateStatePath(file.path); unlinkSync(file.path); total -= file.size; count--;
  }
  return path;
}
