import { jsonRanges } from './jsonc-ranges';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Shared with Pi: sorted object keys, ordered arrays; absent is distinct from JSON null. */
export function canonicalContributionJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, sort(item)])) : v;
  return JSON.stringify(sort(value));
}
export const contributionHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const validContributionHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
export type ContributionSelector = { kind: 'file' } | { kind: 'symlink' } | { kind: 'json'; keys: string[] } | { kind: 'text'; start: string; end: string } | { kind: 'toml'; header: string } | { kind: 'toml-key'; table: string; key: string } | { kind: 'json-array'; keys: string[]; identity: string };
export type ContributionTarget = { path: string; selector: ContributionSelector; sourceItemId?: string; expectedHash?: string; sharedWith?: string[] };
export type RunnerContribution = ContributionTarget & {
  id: string; hash: string; encoding: 'bytes' | 'canonical-json-v1' | 'link-target';
  ownership: 'new-write' | 'prior-record' | 'dedicated-location'; scope: 'global' | 'project';
};
export type RunnerContributions = { schema: 'deck-runner-contributions-v1'; runnerId: string; root: string; deckVersion: string; contributions: RunnerContribution[] };
export function assertNoContributionSymlink(path: string, allowLeaf = false): void {
  let cursor = resolve(path);
  if (allowLeaf) cursor = dirname(cursor);
  for (;;) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`symlink boundary: ${cursor}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
export function readContribution(target: ContributionTarget): string | Uint8Array | undefined {
  assertNoContributionSymlink(target.path, target.selector.kind === 'symlink');
  if (target.selector.kind === 'symlink') {
    try { return readlinkSync(target.path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  if (!existsSync(target.path)) return undefined;
  if (target.selector.kind === 'file') return readFileSync(target.path);
  return selectContributionContent(readFileSync(target.path, 'utf8'), target.selector);
}
export function selectContributionContent(text: string, selector: ContributionSelector): string | undefined {
  if (selector.kind === 'file' || selector.kind === 'symlink') return text;
  if (selector.kind === 'toml-key') {
    const parsed = Bun.TOML.parse(text) as Record<string, any>;
    const table = selector.table ? selector.table.split('.').reduce((node, key) => node?.[key], parsed) : parsed;
    return table && Object.hasOwn(table, selector.key) ? canonicalContributionJson(table[selector.key]) : undefined;
  }
  if (selector.kind === 'toml') {
    const start = `[${selector.header}]`;
    const lines = text.split('\n'); const indices = lines.flatMap((line, i) => line.trim() === start ? [i] : []);
    if (!indices.length) return undefined;
    if (indices.length !== 1) throw new Error(`ambiguous contribution: configuration`);
    let end = indices[0]! + 1;
    while (end < lines.length && (!/^\s*\[/.test(lines[end]!) || lines[end]!.trim().startsWith(`[${selector.header}.`))) end++;
    // Comments between tables can belong to the following hook or native section.
    // Preserve them independently instead of adopting them as MCP ownership bytes.
    while (end > indices[0]! + 1 && /^\s*(?:#.*)?$/.test(lines[end - 1]!)) end--;
    return lines.slice(indices[0], end).join('\n').trimEnd();
  }
  if (selector.kind === 'text') {
    const { start, end } = selector; const at = text.indexOf(start);
    if (at < 0) return undefined;
    const until = text.indexOf(end, at + start.length);
    if (until < 0 || text.indexOf(start, at + start.length) >= 0) throw new Error(`ambiguous contribution: configuration`);
    return text.slice(at, until + end.length);
  }
  let value: unknown = jsonRanges(text).value;
  for (const key of selector.keys) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  if (selector.kind === 'json-array') {
    if (!Array.isArray(value)) throw new Error(`Invalid array contribution: configuration`);
    const identity = selector.identity;
    const matches = value.filter(item => canonicalContributionJson(item) === identity);
    if (matches.length > 1) throw new Error(`ambiguous contribution: configuration`);
    return matches.length ? canonicalContributionJson(matches[0]) : undefined;
  }
  return canonicalContributionJson(value);
}
export const contributionId = (target: ContributionTarget): string => contributionHash(`${resolve(target.path)}\0${canonicalContributionJson(target.selector)}`);
/** Raw, strictly read-only reader. Never migrates/bootstrap/writes, including legacy manifests. */
export function readRunnerContributions(path: string): RunnerContributions | undefined {
  assertNoContributionSymlink(path);
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as RunnerContributions;
  if (value.schema !== 'deck-runner-contributions-v1') throw new Error(`Unsupported contribution manifest: ${path}`);
  if (!Array.isArray(value.contributions) || !isAbsolute(value.root)) throw new Error(`Invalid contribution manifest: ${path}`);
  for (const entry of value.contributions) {
    if (!validContributionHash(entry.hash)) throw new Error(`Invalid contribution hash: ${path}`);
    if (!isAbsolute(entry.path) || entry.id !== contributionId(entry)) throw new Error(`Invalid contribution identity: ${path}`);
  }
  return value;
}
function atomic(path: string, value: unknown): void {
  assertNoContributionSymlink(path);
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(path) && readFileSync(path, 'utf8') === serialized) return;
  assertNoContributionSymlink(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temporary, serialized, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
const activeContributionTransactions = new Set<string>();
function accountedWrite(write: () => void, account?: () => void): void {
  try { write(); }
  catch (error) {
    try { account?.(); }
    catch (accountError) { throw new AggregateError([error, accountError], 'Metadata write and backup accounting failed'); }
    throw error;
  }
  account?.();
}
const inside = (path: string, root: string): boolean => { const rel = relative(resolve(root), resolve(path)); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
/**
 * Accounting boundary around the adapter's existing plan/apply/verify transaction. Pending state contains
 * identities/hashes only. It is never created by planning. Unknown existing files are not adopted.
 */
export function beginRunnerContributions(input: {
  runnerId: string; root: string; manifestPath: string; deckVersion: string;
  targets: ContributionTarget[]; dedicatedRoots?: string[];
  beforeMetadataWrite?: (path: string, sha256: string | null) => () => void;
}): { commit(): RunnerContribution[]; abort(): void; abandon(): void } {
  const pending = `${input.manifestPath}.pending`;
  assertNoContributionSymlink(pending);
  if (existsSync(pending)) {
    if (activeContributionTransactions.has(pending)) throw new Error(`Contribution transaction pending recovery: ${pending}`);
    const owner = JSON.parse(readFileSync(pending, "utf8")).pid;
    if (owner !== process.pid && typeof owner === "number") {
      let alive = false; try { process.kill(owner, 0); alive = true; } catch { /* dead owner */ }
      if (alive) throw new Error(`Contribution transaction pending in another process: ${pending}`);
    }
    recoverRunnerContributionTransaction(input.manifestPath);
  }
  const previous = readRunnerContributions(input.manifestPath);
  if (previous && (previous.runnerId !== input.runnerId || resolve(previous.root) !== resolve(input.root))) throw new Error('Contribution manifest root identity mismatch');
  const prior = new Map(previous?.contributions.map(entry => [entry.id, entry]));
  const snapshots = input.targets.map(original => {
    const target = { sourceItemId: "developer-team", ...original };
    const id = contributionId(target); const content = readContribution(target);
    const before = content === undefined ? undefined : contributionHash(content);
    const owned = prior.get(id);
    if (owned && before !== undefined && owned.hash !== before) throw new Error(`Owned contribution changed: ${target.path}`);
    const dedicated = input.dedicatedRoots?.some(root => inside(target.path, root)) === true;
    if (!owned && !dedicated && before !== undefined && target.expectedHash && before !== target.expectedHash) throw new Error(`Unowned contribution conflicts with desired content: ${target.path}`);
    return { target, id, before, ownership: owned ? owned.ownership : dedicated ? 'dedicated-location' as const : before === undefined ? 'new-write' as const : undefined };
  });
  mkdirSync(dirname(pending), { recursive: true, mode: 0o700 });
  const pendingText = JSON.stringify({ pid: process.pid, runnerId: input.runnerId, root: resolve(input.root), deckVersion: input.deckVersion,
    targets: snapshots.map(({ target, id, before, ownership }) => ({ target, id, ownership, preimage: before ?? "absent", postimage: target.expectedHash ?? "verify-after-apply" })) });
  const accountPending = input.beforeMetadataWrite?.(pending, contributionHash(pendingText));
  accountedWrite(()=>writeFileSync(pending, pendingText, { flag: 'wx', mode: 0o600 }), accountPending);
  activeContributionTransactions.add(pending);
  let finished = false;
  return {
    commit() {
      if (finished) throw new Error('Contribution transaction already finished');
      // Package installers may finish during an adapter's asynchronous publication. Preserve their
      // independent receipts instead of publishing the manifest snapshot captured before the await.
      const observed = readRunnerContributions(input.manifestPath);
      if (observed && (observed.runnerId !== input.runnerId || resolve(observed.root) !== resolve(input.root))) throw new Error('Contribution manifest root identity changed during apply');
      if (previous && !observed) throw new Error('Contribution manifest disappeared during apply');
      const observedRecords = new Map(observed?.contributions.map(entry => [entry.id, entry]));
      for (const { id } of snapshots) {
        if (canonicalContributionJson(prior.get(id) ?? null) !== canonicalContributionJson(observedRecords.get(id) ?? null)) throw new Error('Selected contribution receipt changed during apply');
      }
      prior.clear();
      for (const [id, receipt] of observedRecords) prior.set(id, receipt);
      const receipts: RunnerContribution[] = [];
      for (const { target, id, ownership } of snapshots) {
        if (!ownership) continue;
        const content = readContribution(target);
        if (content === undefined) { prior.delete(id); continue; }
        const hash = contributionHash(content);
        if (target.expectedHash && hash !== target.expectedHash) throw new Error(`Contribution postimage mismatch: ${target.path}`);
        const { expectedHash: _, ...metadata } = target;
        const receipt: RunnerContribution = { ...metadata, id, hash, ownership, scope: 'global', encoding: (target.selector.kind === 'json' || target.selector.kind === 'json-array') ? 'canonical-json-v1' : target.selector.kind === 'symlink' ? 'link-target' : 'bytes' };
        prior.set(id, receipt); receipts.push(receipt);
      }
      const next = { schema: 'deck-runner-contributions-v1', runnerId: input.runnerId, root: resolve(input.root), deckVersion: input.deckVersion, contributions: [...prior.values()] };
      const accountManifest = input.beforeMetadataWrite?.(input.manifestPath, contributionHash(JSON.stringify(next, null, 2) + '\n'));
      accountedWrite(()=>atomic(input.manifestPath, next), accountManifest);
      accountedWrite(()=>unlinkSync(pending), accountPending);
      activeContributionTransactions.delete(pending); finished = true; return receipts;
    },
    // Only called after the existing adapter rollback succeeds. Failed/uncertain writes retain the pending journal.
    abort() { if (!finished) {
      for (const { target, before } of snapshots) {
        const current = readContribution(target);
        if ((current === undefined ? undefined : contributionHash(current)) !== before) throw new Error(`Contribution rollback preimage changed: ${target.path}`);
      }
      accountedWrite(()=>unlinkSync(pending), accountPending);
      activeContributionTransactions.delete(pending); finished = true;
    } },
    abandon() { activeContributionTransactions.delete(pending); finished = true; },
  };
}

/** Select shared entries rather than taking ownership of a user's configuration file. */
export function sharedJsonContributionTargets(path: string, desired: Record<string, unknown>): ContributionTarget[] {
  const targets: ContributionTarget[] = [];
  for (const [key, value] of Object.entries(desired)) {
    if (Array.isArray(value)) {
      for (const entry of value) targets.push({ path, selector: { kind: 'json-array', keys: [key], identity: canonicalContributionJson(entry) } });
    } else if (value && typeof value === 'object') {
      for (const name of Object.keys(value)) targets.push({ path, selector: { kind: 'json', keys: [key, name] } });
    } else targets.push({ path, selector: { kind: 'json', keys: [key] } });
  }
  return targets;
}

/** Add verified installed leaves to the runner's existing manifest, including Codex/Pi legacy envelopes. */
export function recordOwnedRunnerArtifactTree(input: { runnerId: string; root: string; manifestPath: string; artifactRoot: string; sourceItemId: string; expectedFiles?: string[] }): RunnerContribution[] {
  assertNoContributionSymlink(input.artifactRoot); assertNoContributionSymlink(input.manifestPath);
  const fs = require('node:fs') as typeof import('node:fs');
  const leaves: RunnerContribution[] = [];
  const walk = (path: string) => {
    const stat = fs.lstatSync(path);
    if (stat.isDirectory()) { for (const name of fs.readdirSync(path).sort()) walk(resolve(path, name)); return; }
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`Unsupported installed artifact: ${path}`);
    const target: ContributionTarget = { path, selector: { kind: stat.isSymbolicLink() ? 'symlink' : 'file' }, sourceItemId: input.sourceItemId };
    const content = stat.isSymbolicLink() ? fs.readlinkSync(path) : fs.readFileSync(path);
    leaves.push({ ...target, id: contributionId(target), hash: contributionHash(content), encoding: stat.isSymbolicLink() ? 'link-target' : 'bytes', scope: 'global', ownership: 'dedicated-location' });
  };
  if (input.expectedFiles) for (const file of input.expectedFiles) { const path = resolve(input.artifactRoot, file); if (!inside(path, input.artifactRoot)) throw new Error("Unsafe package receipt path"); walk(path); }
  else walk(input.artifactRoot);
  let previous: Record<string, any>;
  if (existsSync(input.manifestPath)) previous = JSON.parse(readFileSync(input.manifestPath, 'utf8'));
  else if (input.runnerId === 'codex') previous = { version: 1, files: {} };
  else if (input.runnerId === 'pi') previous = { schema: 'deck-pi-manifest-v1', files: {}, settings: { packages: [], addedPackages: [], skillExclusions: [] }, mcp: { servers: {} } };
  else previous = { schema: 'deck-runner-contributions-v1', root: resolve(input.root), deckVersion: '0.13.0' };
  const current: RunnerContribution[] = Array.isArray(previous.contributions) ? previous.contributions : [];
  // Replace only this physical tree; a package can also own entries or leaves elsewhere.
  const retained = current.filter(entry => entry.sourceItemId !== input.sourceItemId || !inside(entry.path, input.artifactRoot));
  atomic(input.manifestPath, { ...previous, runnerId: input.runnerId, contributions: [...retained, ...leaves] });
  return leaves;
}

/** Read-only proof for launch overlays. Legacy full-file hashes and marker names never count as entry ownership. */
export function hasRunnerContributionProof(manifestPath: string, target: ContributionTarget): boolean {
  try {
    assertNoContributionSymlink(manifestPath);
    const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (!(raw.schema === 'deck-runner-contributions-v1' || raw.schema === 'deck-pi-manifest-v1' || (raw.version === 1 && raw.runnerId === 'codex'))) return false;
    const entry = (Array.isArray(raw.contributions) ? raw.contributions as RunnerContribution[] : []).find(item => item.id === contributionId(target));
    const current = readContribution(target);
    return validContributionHash(entry?.hash) && current !== undefined && contributionHash(current) === entry.hash;
  } catch { return false; }
}

/** Recovery performs no installation writes. It accounts only verified postimages or an unchanged rollback. */
export function recoverRunnerContributionTransaction(manifestPath: string): "rolled-back" | "completed" | "recovered-partial" {
  const pending = `${manifestPath}.pending`;
  assertNoContributionSymlink(pending);
  if (activeContributionTransactions.has(pending)) throw new Error("Contribution transaction is active");
  const transaction = JSON.parse(readFileSync(pending, "utf8")) as { runnerId: string; root: string; deckVersion: string; targets: Array<{ target: ContributionTarget; id: string; ownership?: RunnerContribution["ownership"]; preimage: string; postimage: string }> };
  if (!Array.isArray(transaction.targets) || !isAbsolute(transaction.root)) throw new Error("Invalid contribution recovery journal");
  const states = transaction.targets.map(entry => {
    if (entry.id !== contributionId(entry.target)) throw new Error("Invalid recovery identity");
    const content = readContribution(entry.target); const hash = content === undefined ? "absent" : contributionHash(content);
    return { entry, hash, pre: hash === entry.preimage, post: validContributionHash(entry.postimage) && hash === entry.postimage };
  });
  if (states.every(state => state.pre)) { unlinkSync(pending); return "rolled-back"; }
  if (!states.every(state => state.post || state.pre)) throw new Error("Contribution recovery conflict: changed postimages preserved; restore the reviewed adapter backup before retrying");
  const partial = states.some(state => !state.post && state.entry.ownership);
  const previous = readRunnerContributions(manifestPath);
  if (previous && (previous.runnerId !== transaction.runnerId || resolve(previous.root) !== resolve(transaction.root))) throw new Error('Contribution recovery manifest identity changed');
  const records = new Map(previous?.contributions.map(entry => [entry.id, entry]));
  for (const { entry, hash } of states) {
    if (!entry.ownership || hash === "absent" || hash !== entry.postimage) continue;
    const { expectedHash: _, ...target } = entry.target;
    records.set(entry.id, { ...target, id: entry.id, hash, ownership: entry.ownership, scope: "global", encoding: target.selector.kind === "json" || target.selector.kind === "json-array" ? "canonical-json-v1" : target.selector.kind === "symlink" ? "link-target" : "bytes" });
  }
  atomic(manifestPath, { schema: "deck-runner-contributions-v1", runnerId: transaction.runnerId, root: transaction.root, deckVersion: transaction.deckVersion, contributions: [...records.values()] });
  unlinkSync(pending); return partial ? "recovered-partial" : "completed";
}

/** Release only absent selected contributions after a verified removal. Legacy envelopes stay intact. */
// Bounded to one receipt and reused only after an exact fresh byte comparison.
// Large unreceipted package trees must not reparse the same multi-megabyte
// manifest for every leaf. Any mutation/failure invalidates this parsed view.
let unchangedRemovalReceipt: { path: string; text: string; raw: any } | undefined;
export function recordRemovedRunnerContributions(manifestPath: string, targets: readonly ContributionTarget[]): void {
  // Dedicated-location cleanup can remove many unreceipted historical leaves.
  // No contribution changed: preserve the receipt bytes and avoid rewriting the
  // complete manifest once per leaf.
  if (!targets.length) return;
  assertNoContributionSymlink(manifestPath);
  if (!existsSync(manifestPath)) return;
  const before = readFileSync(manifestPath, 'utf8');
  const cached = unchangedRemovalReceipt;
  unchangedRemovalReceipt = undefined;
  let raw: any;
  try { raw = cached?.path === manifestPath && cached.text === before ? cached.raw : JSON.parse(before); } catch { return; } // Preserve invalid historical evidence; never infer/adopt ownership.
  if (!raw || !(raw.schema === 'deck-runner-contributions-v1' || raw.schema === 'deck-pi-manifest-v1' || raw.version === 1 && raw.runnerId === 'codex')) return;
  const ids = new Set<string>();
  let changed = false;
  for (const target of targets) {
    if (readContribution(target) !== undefined) throw new Error('Removed contribution still exists; accounting preserved');
    ids.add(contributionId(target));
    if (target.selector.kind === 'file' && raw.files && typeof raw.files === 'object') {
      const root = resolve(dirname(dirname(manifestPath))), path = resolve(target.path), rel = relative(root, path);
      const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
      for (const key of Object.keys(raw.files)) {
        // Ordinary root-relative content keys cannot name shared tools outside
        // the runner root. Preserve absolute/traversing legacy aliases, while
        // avoiding millions of redundant path resolutions for package leaves.
        if (outside && !isAbsolute(key) && !key.split(sep).includes('..')) continue;
        if (resolve(root, key) === path) { delete raw.files[key]; changed = true; }
      }
    }
    if (target.selector.kind === 'json' && target.selector.keys.length === 2 && target.selector.keys[0] === 'mcpServers'
      && resolve(target.path) === resolve(dirname(dirname(manifestPath)), 'mcp.json') && raw.schema === 'deck-pi-manifest-v1'
      && raw.mcp?.servers && Object.hasOwn(raw.mcp.servers, target.selector.keys[1]!)) { delete raw.mcp.servers[target.selector.keys[1]!]; changed = true; }
  }
  const retained = (raw.contributions ?? []).filter((entry: RunnerContribution) => !ids.has(entry.id));
  if (retained.length !== (raw.contributions ?? []).length) { raw.contributions = retained; changed = true; }
  if (!changed) { unchangedRemovalReceipt = { path: manifestPath, text: before, raw }; return; }
  if (readFileSync(manifestPath, 'utf8') !== before) throw new Error('Removal receipt manifest changed; retry accounting');
  atomic(manifestPath, raw);
}
