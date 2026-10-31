import { jsonRanges, type JsonNode } from './jsonc-ranges';
import { guardRunnerGenerationRetirement } from './runner-generation-references';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertNoContributionSymlink, canonicalContributionJson, contributionHash, contributionId, recordRemovedRunnerContributions, validContributionHash, type ContributionTarget, type RunnerContribution } from './runner-contributions';

export type RetirementTarget = { path: string; format: 'json' | 'toml' | 'file' | 'symlink'; container?: string[]; capability?: string; array?: boolean; /** Exact JSON property name when package metadata uses a path as its key. */ key?: string };
export type RetirementEntry = {
  contribution?: ContributionTarget;
  generation?: { root: string; selectionPath: string };
  id: string; runnerId: string; path: string; selector: string; capability: string;
  ownership: 'dedicated-location' | 'manifest-proven' | 'ambiguous' | 'preserved';
  action: 'remove' | 'conditional-remove' | 'preserve'; reason: string;
  fileHash: string; entryHash: string; preview: string; context: string;
  /** Exact byte edits, without storing configuration content or credentials in a plan. */
  ranges: Array<{ start: number; end: number }>;
};
export type RetirementPlan = { schema: 'deck-package-retirement-v1'; runnerId: string; entries: RetirementEntry[]; diagnostics: string[]; backupRoot?: string };
export type RetirementConfirmation = Pick<RetirementEntry, 'id' | 'entryHash' | 'fileHash'>;
/** Choose separators once for the combined selection, including adjacent trailing removals. */
function combinedJsonRemovalRanges(text: string, entries: RetirementEntry[]): RetirementEntry['ranges'] {
  const root = jsonRanges(text);
  const selected = new Set<number>();
  for (const entry of entries) {
    const selector = entry.contribution?.selector;
    if (!selector || (selector.kind !== 'json' && selector.kind !== 'json-array')) throw new Error('Missing exact JSON retirement selector');
    let node: JsonNode | undefined = root;
    for (const key of selector.keys) node = node?.properties?.get(key)?.node;
    if (selector.kind === 'json-array') {
      const matches = node?.elements?.filter(element => canonicalContributionJson(element.node.value) === selector.identity) ?? [];
      if (matches.length !== 1) throw new Error('Ambiguous JSON retirement selection');
      node = matches[0]!.node;
    }
    if (!node) throw new Error('Missing JSON retirement selection');
    selected.add(node.start);
  }
  const ranges: RetirementEntry['ranges'] = [];
  const visit = (node: JsonNode) => {
    const siblings: Array<{ node: JsonNode; start?: number; comma?: number }> | undefined = node.properties ? [...node.properties.values()] : node.elements;
    if (!siblings) return;
    const changesSiblings = siblings.some(item => selected.has(item.node.start));
    const lastRetained = siblings.reduce((last, item, index) => selected.has(item.node.start) ? last : index, -1);
    for (let i = 0; i < siblings.length; i++) {
      const item = siblings[i]!;
      if (selected.has(item.node.start)) ranges.push({ start: item.start ?? item.node.start, end: item.node.end });
      else visit(item.node);
      // A comma after a retained node separates it from the next retained node,
      // even when selected nodes between them disappear. All other commas go.
      if (changesSiblings && item.comma !== undefined && (selected.has(item.node.start) || i >= lastRetained)) ranges.push({ start: item.comma, end: item.comma + 1 });
    }
  };
  visit(root);
  return ranges;
}
const retired = ['context-mode', 'serena'] as const;
const inRoot = (path: string, root: string) => { const rel = relative(resolve(root), resolve(path)); return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
const sensitiveField = /secret|token|password|credential|api.?key|headers?|^key$|^env$|environment|authorization|authentication/i;
function redact(value: unknown, key = ''): unknown {
  if (sensitiveField.test(key)) return '[redacted]';
  // Arguments are opaque data, including shell/code fragments and flag-looking
  // operands. Never parse them for display or infer safety from credential names.
  if (key === 'args') return Array.isArray(value) ? value.map(() => '[redacted]') : '[redacted]';
  if (key === 'command' && Array.isArray(value)) {
    return value.map((item, index) => index === 0 && typeof item === 'string' ? redact(item, 'command') : '[redacted]');
  }
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  if (typeof value === 'string') {
    if (/(?:bearer\s|sk-[\w-]+)/i.test(value)) return '[redacted]';
    // Keep simple executable/package identity. Everything with quoting, spacing,
    // assignments or other syntax is an opaque fragment and is hidden in full.
    if (!/^[\w./@+-]+$/.test(value)) return '[redacted]';
  }
  return value;
}
export function planPackageRetirement(input: {
  runnerId: string; targets: RetirementTarget[]; dedicatedRoots: string[];
  contributions?: readonly RunnerContribution[]; capabilityIds?: readonly string[];
}): RetirementPlan {
  const capabilityIds = input.capabilityIds ?? retired;
  const plan: RetirementPlan = { schema: 'deck-package-retirement-v1', runnerId: input.runnerId, entries: [], diagnostics: [] };
  // Preserve Array.find's first-record behavior for legacy duplicate IDs. The
  // lookup must not rehash each target for every recorded installation leaf.
  const contributionsById = (input.contributions ?? []).every(record => record != null && typeof record.id === 'string') ? new Map<string, RunnerContribution>() : undefined;
  if (contributionsById) for (const record of input.contributions ?? []) if (!contributionsById.has(record.id)) contributionsById.set(record.id, record);
  for (const target of input.targets) {
    const path = resolve(target.path);
    try {
      assertNoContributionSymlink(path, target.format === 'symlink');
      let stat; try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (!(target.format === 'symlink' ? stat.isSymbolicLink() : stat.isFile())) { plan.diagnostics.push(`Preserved non-file: ${path}`); continue; }
      const bytes = target.format === 'symlink' ? Buffer.from(readlinkSync(path)) : readFileSync(path); const text = bytes.toString('utf8'); const fileHash = contributionHash(bytes);
      const add = (capability: string, selector: string, value: unknown, ranges: RetirementEntry['ranges'], contribution: ContributionTarget, displayValue: unknown = value) => {
        const entryHash = (target.format === 'file' || target.format === 'symlink') ? fileHash : target.format === 'json' ? contributionHash(canonicalContributionJson(value)) : contributionHash(String(value));
        const recordId = contributionId(contribution);
        // Corrupt legacy rows retain the old per-target diagnostic behavior.
        const record = contributionsById ? contributionsById.get(recordId) : input.contributions?.find(item => item.id === recordId);
        const dedicated = input.dedicatedRoots.some(root => inRoot(path, root));
        const manifest = validContributionHash(record?.hash) && record.hash === entryHash;
        const ownership = dedicated ? 'dedicated-location' : manifest ? 'manifest-proven' : 'ambiguous';
        const id = contributionHash(`${input.runnerId}\0${path}\0${selector}`);
        plan.entries.push({ id, runnerId: input.runnerId, path, selector, capability, ownership,
          action: ownership === 'ambiguous' ? 'conditional-remove' : 'remove',
          reason: dedicated ? 'Exact retired contribution inside a dedicated Deck location' : manifest ? 'Current entry matches recorded ownership hash' : record ? 'Recorded entry changed or hash is invalid; individual confirmation required' : 'No granular ownership evidence; individual confirmation required',
          fileHash, entryHash, preview: target.format === "symlink" ? `Retired installation link; unlink this exact path without following its target` : target.format === "file" ? `Retired installation artifact, ${Buffer.byteLength(String(value))} bytes; delete this exact path` : JSON.stringify(redact(displayValue), null, 2),
          contribution, context: `File ${path}; selected ${selector}; preserve every sibling and unrelated section`, ranges });
      };
      if (target.format === 'json') {
        const root = jsonRanges(text); let container = root;
        for (const key of target.container ?? []) { const next = container.properties?.get(key)?.node; if (!next) { container = { value: {}, start: 0, end: 0 }; break; } container = next; }
        if (target.array) {
          for (const element of container.elements ?? []) {
            const value = element.node.value;
            // Names identify candidates, never ownership. Shared arrays still require proof/review.
            const capability = typeof value === 'string' ? capabilityIds.find(id => value === id || value.startsWith(`${id}@`) || value === `npm:${id}` || value.startsWith(`npm:${id}@`)) : undefined;
            if (!capability) continue;
            const ranges = [{ start: element.node.start, end: element.node.end }];
            if (element.comma !== undefined) ranges.push({ start: element.comma, end: element.comma + 1 });
            else if (element.previousComma !== undefined) ranges.push({ start: element.previousComma, end: element.previousComma + 1 });
            const keys = target.container ?? [];
            add(capability, `${keys.join('.')}[${canonicalContributionJson(value)}]`, value, ranges, { path, selector: { kind: 'json-array', keys, identity: canonicalContributionJson(value) } });
            plan.entries.at(-1)!.context = `Array ${keys.join('.')}; surrounding entries: ${JSON.stringify(redact(container.value))}; preserve all siblings.`;
          }
          continue;
        }
        for (const capability of capabilityIds) {
          if (target.capability && capability !== target.capability) continue;
          const propertyKey = target.key ?? capability;
          const property = container.properties?.get(propertyKey); if (!property) continue;
          const ranges = [{ start: property.start, end: property.node.end }];
          if (property.comma !== undefined) ranges.push({ start: property.comma, end: property.comma + 1 });
          else if (property.previousComma !== undefined) ranges.push({ start: property.previousComma, end: property.previousComma + 1 });
          const keys = [...(target.container ?? []), propertyKey];
          add(capability, keys.join('.'), property.node.value, ranges, { path, selector: { kind: 'json', keys } });
          plan.entries.at(-1)!.context = `Container ${(target.container ?? []).join('.') || '(root)'}; surrounding keys: ${[...container.properties!.keys()].join(', ')}; preserve all siblings.`;
        }
      } else if (target.format === 'toml') {
        const parsed = Bun.TOML.parse(text) as Record<string, any>;
        for (const capability of capabilityIds) {
          if (!parsed.mcp_servers?.[capability]) continue;
          const escaped = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const matches = [...text.matchAll(new RegExp(`^\\[mcp_servers\\.(?:${escaped}|"${escaped}")\\][ \\t]*(?:#.*)?$`, 'gm'))];
          if (matches.length !== 1) { plan.diagnostics.push(`Preserved unsupported/ambiguous TOML spelling: ${path}#mcp_servers.${capability}`); continue; }
          const start = matches[0]!.index!; let end = text.length;
          for (const match of text.slice(start + matches[0]![0].length).matchAll(/^\s*\[/gm)) {
            const position = start + matches[0]![0].length + match.index!;
            const line = text.slice(position).split('\n')[0]!.trim();
            if (!line.startsWith(`[mcp_servers.${capability}.`)) { end = position; break; }
          }
          const value = text.slice(start, end).trimEnd();
          add(capability, `mcp_servers.${capability}`, value, [{ start, end: start + value.length }], { path, selector: { kind: 'toml', header: `mcp_servers.${capability}` } }, parsed.mcp_servers[capability]);
        }
      } else if (target.capability && capabilityIds.includes(target.capability)) {
        add(target.capability, target.format === 'symlink' ? 'whole-link' : 'whole-file', text, [{ start: 0, end: text.length }], { path, selector: { kind: target.format === 'symlink' ? 'symlink' : 'file' } });
      }
    } catch (error) {
      // Paths and bounded reason only; parser messages may contain secret-bearing source snippets.
      plan.diagnostics.push(`Preserved unreadable, invalid or symlink-bound resource: ${path} (${error instanceof Error && error.message.startsWith('symlink boundary') ? 'symlink boundary' : 'safe inspection unavailable'})`);
    }
  }
  plan.entries = [...new Map(plan.entries.map(entry => [entry.id, entry])).values()];
  return plan;
}
/** Uses reviewed exact edits; no heuristic matching and no bulk ambiguity approval. */
export function applyPackageRetirement(plan: RetirementPlan, confirmations: readonly RetirementConfirmation[], options: { backupRoot?: string; manifestPath?: string } = {}): { removed: string[]; preserved: string[] } {
  const removed: string[] = [], preserved: string[] = [];
  const byPath = new Map<string, RetirementEntry[]>();
  for (const entry of plan.entries) {
    const confirmed = confirmations.some(c => c.id === entry.id && c.entryHash === entry.entryHash && c.fileHash === entry.fileHash);
    if (entry.action === 'preserve' || (entry.action === 'conditional-remove' && !confirmed)) { preserved.push(entry.id); continue; }
    const list = byPath.get(entry.path) ?? []; list.push(entry); byPath.set(entry.path, list);
  }
  for (const [path, entries] of byPath) {
    const generation = entries[0]?.generation;
    const releaseGeneration = generation ? guardRunnerGenerationRetirement(generation.root, generation.selectionPath) : undefined;
    try {
    const isLink = entries.every(entry => entry.selector === 'whole-link');
    assertNoContributionSymlink(path, isLink); const beforeBytes = isLink ? Buffer.from(readlinkSync(path)) : readFileSync(path); const before = beforeBytes.toString('utf8'); const digest = contributionHash(beforeBytes);
    if (entries.some(entry => entry.fileHash !== digest)) throw new Error(`Retirement preimage changed; review a new plan: ${path}`);
    let after = before;
    const merged: RetirementEntry["ranges"] = [];
    const ranges = entries.every(entry => entry.contribution?.selector.kind === 'json' || entry.contribution?.selector.kind === 'json-array')
      ? combinedJsonRemovalRanges(before, entries) : entries.flatMap(e => e.ranges);
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    for (const range of merged.reverse()) after = after.slice(0, range.start) + after.slice(range.end);
    // Verify before backup/publication; preserves valid JSONC/TOML and siblings.
    if (entries.every(e => e.selector !== 'whole-file' && e.selector !== 'whole-link')) { if (path.endsWith('.toml')) Bun.TOML.parse(after); else if (plan.runnerId === 'opencode' || path.endsWith('.jsonc')) jsonRanges(after); else JSON.parse(after); }
    const backupDir = options.backupRoot || plan.backupRoot ? resolve((options.backupRoot ?? plan.backupRoot)!) : resolve(dirname(plan.entries[0]?.path ?? path), 'deck', 'backups'); assertNoContributionSymlink(backupDir); mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backup = resolve(backupDir, `${digest}.pre-retirement`); if (!existsSync(backup)) writeFileSync(backup, beforeBytes, { flag: 'wx', mode: 0o600 });
    else if (contributionHash(readFileSync(backup)) !== digest) throw new Error(`Retirement backup conflict: ${backup}`);
    if (contributionHash(isLink ? readlinkSync(path) : readFileSync(path)) !== digest) throw new Error(`Retirement preimage changed: ${path}`);
    if (entries.some(e => e.selector === 'whole-file' || e.selector === 'whole-link')) unlinkSync(path);
    else {
      const temporary = `${path}.deck-retirement-${process.pid}.tmp`;
      try { writeFileSync(temporary, after, { flag: 'wx', mode: lstatSync(path).mode & 0o777 }); renameSync(temporary, path); }
      finally { if (existsSync(temporary)) unlinkSync(temporary); }
    }
    if (options.manifestPath) recordRemovedRunnerContributions(options.manifestPath, entries.flatMap(entry => entry.contribution ? [entry.contribution] : []));
    removed.push(...entries.map(e => e.id));
    } finally { releaseGeneration?.(); }
  }
  return { removed, preserved };
}
