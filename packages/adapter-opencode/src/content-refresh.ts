import { INTERNAL_OPENCODE_PACKAGE_IDS } from "./internal-opencode-packages";
import type { RunnerPreparationFinding } from "@deck/core/session/driver";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoContributionSymlink, beginRunnerContributions, canonicalContributionJson, contributionHash, contributionId, readRunnerContributions, selectContributionContent, type ContributionTarget, type DeveloperTeamInstallFile } from '@deck/core';
import { jsonRanges } from '../../core/src/jsonc-ranges';

const read = (path: string): string | undefined => { assertNoContributionSymlink(path); return existsSync(path) ? readFileSync(path, 'utf8') : undefined; };
type Write = { path: string; before?: string; after: string };
export type OpenCodeRefresh = { files: DeveloperTeamInstallFile[]; writes: Write[]; targets: ContributionTarget[]; findings: RunnerPreparationFinding[]; manifestBefore?: string };

class CommentedFieldError extends Error {}

/** Edit one effective field, leaving all surrounding JSONC bytes intact. */
function setField(text: string, keys: string[], value: unknown): string {
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
  // Strip strings before checking comments: URLs and prompt literals are not comments.
  const body = text.slice(node.start, node.end).replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (/\/\/|\/\*/.test(body)) throw new CommentedFieldError();
  return text.slice(0, node.start) + JSON.stringify(value, null, 2) + text.slice(node.end);
}

export function planOpenCodeRefresh(root: string, desired: readonly DeveloperTeamInstallFile[], agents: Record<string, unknown>): OpenCodeRefresh {
  const manifestPath = join(root, 'deck/manifest.json');
  const manifestBefore = read(manifestPath), manifest = readRunnerContributions(manifestPath);
  if (manifest && (manifest.runnerId !== 'opencode' || manifest.root !== root)) throw new Error('OpenCode ownership root mismatch; review deck/manifest.json');
  const receipts = new Map(manifest?.contributions.map(e => [e.id, e]));
  const result: OpenCodeRefresh = { files: [], writes: [], targets: [], findings: [], manifestBefore };
  const warn = (item: string) => result.findings.push({ kind: 'W', code: 'opencode-custom-content-preserved', item, message: `Preserved customized or unreceipted OpenCode content: ${item}. Review this item to restore automatic refresh.` });
  for (const file of desired) {
    const path = join(root, file.path), before = read(path);
    let after = file.content;
    if (file.path === 'opencode.json') {
      after = before ?? '{}\n';
      try {
        jsonRanges(after);
        const pluginNode = jsonRanges(after).properties?.get('plugin')?.node;
        if (pluginNode && !pluginNode.elements) warn('plugin');
        else for (const plugin of INTERNAL_OPENCODE_PACKAGE_IDS) {
          const node = jsonRanges(after).properties?.get('plugin')?.node;
          if ((node?.value as unknown[] | undefined)?.includes(plugin)) continue;
          if (!node) after = setField(after, ['plugin'], [plugin]);
          else {
            const last = node.elements!.at(-1);
            after = after.slice(0, node.end - 1) + `${last && last.comma === undefined ? ',' : ''}\n${JSON.stringify(plugin)}\n` + after.slice(node.end - 1);
          }
          result.targets.push({ path, selector: { kind: 'json-array', keys: ['plugin'], identity: canonicalContributionJson(plugin) }, expectedHash: contributionHash(canonicalContributionJson(plugin)) });
        }
        for (const [id, fields] of Object.entries(agents)) {
          const whole: ContributionTarget = { path, selector: { kind: 'json', keys: ['agent', id] } };
          const old = receipts.get(contributionId(whole));
          const wholeContent = selectContributionContent(after, whole.selector);
          // Older installations receipted whole agents. Only migrate an unchanged whole entry.
          const legacyOwned = old && wholeContent !== undefined && contributionHash(wholeContent) === old.hash;
          for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
            const target: ContributionTarget = { path, selector: { kind: 'json', keys: ['agent', id, key] } };
            const current = selectContributionContent(after, target.selector), prior = receipts.get(contributionId(target));
            if (current !== undefined && !(prior && contributionHash(current) === prior.hash) && !legacyOwned) {
              if (current !== canonicalContributionJson(value)) warn(`agent.${id}.${key}`);
              continue;
            }
            // A legacy whole-agent receipt remains the accounting boundary until migration.
            try { after = setField(after, ['agent', id, key], value); }
            catch (error) {
              if (!(error instanceof CommentedFieldError)) throw error;
              warn(`agent.${id}.${key}`);
              continue;
            }
            if (!legacyOwned) result.targets.push({ ...target, expectedHash: contributionHash(canonicalContributionJson(value)) });
          }
          if (legacyOwned) result.targets.push({ ...whole, expectedHash: contributionHash(selectContributionContent(after, whole.selector)!) });
        }
      } catch (error) {
        // Malformed or conflicting config is preserved; selected-role validation owns refusal.
        after = before ?? '{}\n'; result.targets = result.targets.filter(t => t.path !== path); warn('opencode.json');
      }
    } else {
      const target: ContributionTarget = { path, selector: { kind: 'file' } }, prior = receipts.get(contributionId(target));
      if (before !== undefined && (!prior || prior.hash !== contributionHash(before))) {
        after = before; warn(file.path);
      } else result.targets.push({ ...target, expectedHash: contributionHash(after) });
    }
    result.files.push({ ...file, content: after });
    if (before !== after) result.writes.push({ path, before, after });
  }
  return result;
}

/** Account only admitted writes. Preimages and conditional rollback preserve concurrent edits. */
export function applyOpenCodeRefresh(root: string, plan: OpenCodeRefresh, beforeMetadataWrite?: (path: string, hash: string | null) => () => void) {
  if (!plan.writes.length) return { changedCount: 0, unchangedCount: plan.files.length, results: [] };
  if (read(join(root, 'deck/manifest.json')) !== plan.manifestBefore) throw new Error('OpenCode ownership changed during preparation; retry');
  for (const write of plan.writes) if (read(write.path) !== write.before) throw new Error(`OpenCode content changed during preparation: ${write.path}; retry`);
  const accounting = beginRunnerContributions({ runnerId: 'opencode', root, manifestPath: join(root, 'deck/manifest.json'), deckVersion: '0.14.0', targets: plan.targets, beforeMetadataWrite });
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
    return { contributions, contributionManifestPath: join(root, 'deck/manifest.json'), changedCount: applied.length, unchangedCount: plan.files.length - applied.length, results: [] };
  } catch (error) {
    try {
      for (const write of applied.reverse()) {
        if (read(write.path) !== write.after) throw new Error(`OpenCode rollback conflict: ${write.path}`);
        if (write.before === undefined) unlinkSync(write.path); else publish(write.path, write.before, write.after);
      }
      accounting.abort();
    } catch { accounting.abandon(); }
    throw error;
  }
}
