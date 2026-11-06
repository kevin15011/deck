import { recognizeOpenCodeLegacyFile } from './legacy-content';
import { internalOpenCodePluginSpecifiers } from "./internal-opencode-packages";
import type { RunnerPreparationFinding } from "@deck/core/session/driver";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoContributionSymlink, beginRunnerContributions, canonicalContributionJson, contributionHash, contributionId, readRunnerContributions, selectContributionContent, type ContributionTarget, type DeveloperTeamInstallFile, classifyManagedSlot, inspectManagedDrift, backupManagedPreimages, type ManagedArtifactPolicy } from '@deck/core';
import { DEVELOPER_TEAM_AGENTS } from '@deck/core/developer-team-catalog';
import { readRunnerHistory, runnerHistoryPath } from '../../core/src/runner-history';
import { jsonRanges } from '../../core/src/jsonc-ranges';

const read = (path: string): string | undefined => { assertNoContributionSymlink(path); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; };
type Write = { path: string; before?: string; after: string };
export type OpenCodeRefresh = { files: DeveloperTeamInstallFile[]; writes: Write[]; targets: ContributionTarget[]; findings: RunnerPreparationFinding[]; manifestBefore?: string; repairManifest?: boolean; managed: ManagedArtifactPolicy; drift: boolean };



/** Edit one effective field, leaving all surrounding JSONC bytes intact. */
export function setField(text: string, keys: string[], value: unknown): string {
  let node = jsonRanges(text);
  for (let i = 0; i < keys.length; i++) {
    if (!node.properties) throw new Error('OpenCode configuration field is not an object');
    const key = keys[i]!, property = node.properties.get(key);
    if (!property) {
      let nested = value;
      for (let j = keys.length - 1; j > i; j--) nested = { [keys[j]!]: nested };
      const last = [...node.properties.values()].at(-1);
      const comma = last && last.comma === undefined ? ',' : '';
      return text.slice(0, node.end - 1) + `${comma}\n${JSON.stringify(key)}: ${JSON.stringify(nested, null, 2)}\n` + text.slice(node.end - 1);
    }
    node = property.node;
  }
  if (canonicalContributionJson(node.value) === canonicalContributionJson(value)) return text;
  if (node.properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // Reconcile the complete generated object while retaining comments between fields.
    for (const key of [...node.properties.keys()].reverse()) {
      if (Object.hasOwn(value, key)) continue;
      // Each removal changes comma ownership and offsets for the next field.
      let current = jsonRanges(text);
      for (const segment of keys) current = current.properties!.get(segment)!.node;
      const property = current.properties!.get(key)!;
      const comma = property.comma ?? property.previousComma;
      // Remove syntax separately so comments between properties survive.
      if (comma !== undefined && comma >= property.node.end) {
        text = text.slice(0, comma) + text.slice(comma + 1);
      }
      text = text.slice(0, property.start) + text.slice(property.node.end);
      if (comma !== undefined && comma < property.start) {
        text = text.slice(0, comma) + text.slice(comma + 1);
      }
    }
    for (const [key, child] of Object.entries(value)) text = setField(text, [...keys, key], child);
    return text;
  }
  return text.slice(0, node.start) + JSON.stringify(value, null, 2) + text.slice(node.end);
}

export function planOpenCodeRefresh(root: string, desired: readonly DeveloperTeamInstallFile[], agents: Record<string, unknown>): OpenCodeRefresh {
  const manifestPath = join(root, 'deck/manifest.json');
  const manifestBefore = read(manifestPath);
  if (manifestBefore !== undefined) {
    let declared: unknown;
    try { declared = JSON.parse(manifestBefore).schema; } catch { /* Invalid ordinary metadata is recoverable. */ }
    const version = typeof declared === 'string' ? /^deck-runner-contributions-v(\d+)$/.exec(declared) : null;
    if (version && Number(version[1]) > 1) throw new Error('managed-by-newer-schema');
  }
  let manifest: ReturnType<typeof readRunnerContributions>, repairManifest = false;
  try {
    manifest = readRunnerContributions(manifestPath);
    if (manifest && (manifest.runnerId !== 'opencode' || manifest.root !== root)) throw new Error('ownership root mismatch');
  } catch { repairManifest = true; manifest = undefined; }
  const managed: ManagedArtifactPolicy = { stateRoot: join(root, 'deck/recovery-state'), inventory: {
    runnerId: 'opencode', root, generatedRoots: [join(root, 'prompts/deck-team')], slots: [],
  } };
  managed.history = Object.values(readRunnerHistory(runnerHistoryPath(managed.stateRoot, 'opencode', root))).flat();
  const slots: ManagedArtifactPolicy['inventory']['slots'][number][] = [];
  const result: OpenCodeRefresh = { files: [], writes: [], targets: [], findings: [], manifestBefore, repairManifest, managed, drift: repairManifest };
  const warn = (item: string) => result.findings.push({ kind: 'W', code: 'opencode-ambiguous-content-preserved', item, message: `Preserved an unrecognized shared OpenCode slot: ${item}.` });
  const roleIds = new Set(DEVELOPER_TEAM_AGENTS.map(agent => agent.id));
  const overlay = read(join(root, 'opencode.jsonc'));
  const overlayRoles = overlay === undefined ? undefined : jsonRanges(overlay).properties?.get('agent')?.node.properties;
  const files = [...desired];
  if (overlay !== undefined && ((overlayRoles && [...overlayRoles.keys()].some(id => roleIds.has(id))) || (jsonRanges(overlay).properties?.get('plugin')?.node.value as unknown[] | undefined)?.includes('deck-model-variants'))) files.push({ path: 'opencode.jsonc', content: overlay!, kind: 'other' });
  // Shared skill identity is a bundle boundary: never add resources beneath an
  // unrecognized SKILL.md, and never report that preserved bundle as installed.
  const sharedBundles = new Map<string, typeof files>();
  for (const file of files) {
    if (file.kind !== 'standalone-skill') continue;
    const match = /^skills\/([^/]+)\//.exec(file.path);
    if (!match) throw new Error('Invalid shared skill target');
    const bundle = sharedBundles.get(match[1]!) ?? []; bundle.push(file); sharedBundles.set(match[1]!, bundle);
  }
  const blockedBundles = new Set<string>();
  const recognizedBundles = new Set<string>();
  for (const [id, bundle] of sharedBundles) {
    const entry = bundle.find(file => file.path === `skills/${id}/SKILL.md`);
    if (!entry) throw new Error('Shared skill bundle has no entry point');
    const target: ContributionTarget = { path: join(root, entry.path), selector: { kind: 'file' }, expectedHash: contributionHash(entry.content) };
    const inventory = { ...managed.inventory, slots: [{ ...target, authority: 'recognized' as const, recognizeLegacy: (content: string | Uint8Array) => recognizeOpenCodeLegacyFile(entry.path, content) }] };
    const content = read(target.path);
    const authority = classifyManagedSlot({ inventory, target, content, receipts: manifest?.contributions, history: managed.history });
    const hasForeignResource = content === undefined && bundle.some(file => {
      const resource: ContributionTarget = { path: join(root, file.path), selector: { kind: 'file' }, expectedHash: contributionHash(file.content) };
      return classifyManagedSlot({ inventory: { ...inventory, slots: [{ ...resource, authority: 'recognized' }] }, target: resource, content: read(resource.path), receipts: manifest?.contributions, history: managed.history }) === 'ambiguous';
    });
    if (authority === 'ambiguous' || hasForeignResource) {
      blockedBundles.add(id);
      result.findings.push({ kind: 'B', code: 'opencode-shared-skill-conflict', item: id, message: `Shared skill ${id} is custom or ambiguous; its complete bundle was preserved and is not installed by Deck.` });
    } else if (content !== undefined) recognizedBundles.add(id);
  }
  for (const file of files) {
    const sharedId = file.kind === 'standalone-skill' ? /^skills\/([^/]+)\//.exec(file.path)?.[1] : undefined;
    if (sharedId && blockedBundles.has(sharedId)) continue;
    const path = join(root, file.path), before = read(path);
    let after = file.content;
    if (file.path === 'opencode.json' || file.path === 'opencode.jsonc') {
      after = before ?? '{}\n';
      try {
        // Native OpenCode inserts this on first load. Initialize it before the
        // launch captures exact config bytes, preserving any existing schema.
        if (file.path === 'opencode.json' && !jsonRanges(after).properties?.has('$schema')) after = setField(after, ['$schema'], 'https://opencode.ai/config.json');
        const pluginNode = jsonRanges(after).properties?.get('plugin')?.node;
        if (pluginNode && !pluginNode.elements) warn('plugin');
        else {
          // Replace only the exact historical Deck package identity; retain user entries and comments.
          const localPlugin = internalOpenCodePluginSpecifiers(root)[1]!;
          for (const element of [...(pluginNode?.elements ?? [])].reverse()) {
            if (element.node.value === 'deck-model-variants') after = after.slice(0, element.node.start) + JSON.stringify(localPlugin) + after.slice(element.node.end);
          }
        }
        if (!pluginNode || pluginNode.elements) for (const plugin of file.path === 'opencode.json' ? internalOpenCodePluginSpecifiers(root) : (pluginNode?.value as unknown[] | undefined)?.includes('deck-model-variants') ? [internalOpenCodePluginSpecifiers(root)[1]!] : []) {
          const node = jsonRanges(after).properties?.get('plugin')?.node;
          const target: ContributionTarget = { path, selector: { kind: 'json-array', keys: ['plugin'], identity: canonicalContributionJson(plugin) }, expectedHash: contributionHash(canonicalContributionJson(plugin)) };
          slots.push({ ...target, authority: 'generated' }); result.targets.push(target);
          if ((node?.value as unknown[] | undefined)?.includes(plugin)) continue;
          if (!node) after = setField(after, ['plugin'], [plugin]);
          else {
            const last = node.elements!.at(-1);
            after = after.slice(0, node.end - 1) + `${last && last.comma === undefined ? ',' : ''}\n${JSON.stringify(plugin)}\n` + after.slice(node.end - 1);
          }
        }
        for (const [id, fields] of Object.entries(agents)) {
          if (file.path === 'opencode.jsonc' && !overlayRoles?.has(id)) continue;
          if (!roleIds.has(id)) throw new Error('Unknown generated OpenCode role');
          const target: ContributionTarget = { path, selector: { kind: 'json', keys: ['agent', id] }, expectedHash: contributionHash(canonicalContributionJson(fields)) };
          slots.push({ ...target, authority: 'generated' });
          after = setField(after, ['agent', id], fields);
          result.targets.push(target);
        }
      } catch (error) {
        throw new Error('opencode-config-malformed: cannot regenerate managed slots', { cause: error });
      }
    } else {
      const target: ContributionTarget = { path, selector: { kind: 'file' }, expectedHash: contributionHash(after) };
      // Explicit generated slots. Standalone skill names are shared and require recognition.
      const generated = file.path === 'plugins/developer-team-execution.js' || file.path === 'plugins/deck-model-variants.js'
        || file.kind === 'prompt' && file.path.startsWith('prompts/deck-team/')
        || file.kind === 'command' && /^commands\/deck-[^/]+\.md$/.test(file.path)
        || file.kind === 'skill' && /^skills\/deck-[^/]+\//.test(file.path);
      slots.push({ ...target, authority: generated ? 'generated' : 'recognized', recognizeLegacy: sharedId && recognizedBundles.has(sharedId) ? () => true : content => recognizeOpenCodeLegacyFile(file.path, content) });
      managed.inventory.slots = slots;
      if (classifyManagedSlot({ inventory: { ...managed.inventory, slots: [slots.at(-1)!] }, target, content: before, receipts: manifest?.contributions, history: managed.history }) === 'ambiguous') {
        after = before!; warn(file.path);
      } else result.targets.push(target);
    }
    result.files.push({ ...file, content: after });
    if (before !== after) result.writes.push({ path, before, after });
  }
  managed.inventory.slots = slots;
  result.drift ||= inspectManagedDrift({ inventory: managed.inventory, targets: result.targets, receipts: manifest?.contributions, history: managed.history }).drift;
  return result;
}

/** Account only admitted writes. Preimages and conditional rollback preserve concurrent edits. */
export function applyOpenCodeRefresh(root: string, plan: OpenCodeRefresh, beforeMetadataWrite?: (path: string, hash: string | null) => () => void) {
  if (!plan.writes.length && !plan.drift) return { changedCount: 0, unchangedCount: plan.files.length, results: [] };
  if (read(join(root, 'deck/manifest.json')) !== plan.manifestBefore) throw new Error('OpenCode ownership changed during preparation; retry');
  for (const write of plan.writes) if (read(write.path) !== write.before) throw new Error(`OpenCode content changed during preparation: ${write.path}; retry`);
  // Never discard transaction evidence to recover an ownership-only envelope.
  if (plan.repairManifest && existsSync(join(root, 'deck/manifest.json.pending'))) throw new Error('Contribution transaction pending recovery');
  let metadataBackup: string | undefined;
  if (plan.repairManifest) {
    metadataBackup = backupManagedPreimages({ stateRoot: plan.managed.stateRoot, runnerId: 'opencode', root, entries: [{ target: { path: join(root, 'deck/manifest.json'), selector: { kind: 'file' } }, content: plan.manifestBefore }] });
    const empty = JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'opencode', root, deckVersion: '0.14.0', contributions: [] });
    const account = beforeMetadataWrite?.(join(root, 'deck/manifest.json'), contributionHash(empty));
    writeFileSync(join(root, 'deck/manifest.json'), empty, { mode: 0o600 }); account?.();
  }
  let accounting: ReturnType<typeof beginRunnerContributions>;
  try {
    accounting = beginRunnerContributions({ runnerId: 'opencode', root, manifestPath: join(root, 'deck/manifest.json'), deckVersion: '0.14.0', targets: plan.targets, managed: plan.managed, beforeMetadataWrite });
  } catch (error) {
    if (plan.repairManifest && plan.manifestBefore !== undefined) writeFileSync(join(root, 'deck/manifest.json'), plan.manifestBefore);
    throw error;
  }
  const applied: Write[] = [];
  const publish = (path: string, content: string, expected?: string) => {
    if (read(path) !== expected) throw new Error(`OpenCode concurrent edit preserved: ${path}`);
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
      if (read(path) !== expected) throw new Error(`OpenCode concurrent edit preserved: ${path}`);
      renameSync(temp, path);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  };
  try {
    for (const write of plan.writes) { publish(write.path, write.after, write.before); applied.push(write); }
    const contributions = accounting.commit();
    return { contributions, backupPath: accounting.backupPath ?? metadataBackup, replacedCount: accounting.replacedCount, contributionManifestPath: join(root, 'deck/manifest.json'), changedCount: applied.length, unchangedCount: plan.files.length - applied.length, results: [] };
  } catch (error) {
    try {
      for (const write of applied.reverse()) {
        if (read(write.path) !== write.after) throw new Error(`OpenCode rollback conflict: ${write.path}`);
        if (write.before === undefined) unlinkSync(write.path); else publish(write.path, write.before, write.after);
      }
      accounting.abort();
      if (plan.repairManifest && plan.manifestBefore !== undefined) writeFileSync(join(root, 'deck/manifest.json'), plan.manifestBefore);
    } catch { accounting.abandon(); }
    throw error;
  }
}
