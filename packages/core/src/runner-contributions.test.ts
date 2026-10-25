import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectContributionContent, beginRunnerContributions, contributionHash, readRunnerContributions, recordOwnedRunnerArtifactTree, recordRemovedRunnerContributions, recoverRunnerContributionTransaction } from './runner-contributions';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'deck-contributions-'));
  return { root, manifestPath: join(root, 'deck/manifest.json'), runnerId: 'codex', deckVersion: 'test' };
}
test('enlists exact pending and receipt bytes before metadata writes and accounts deletion', () => {
  const input = fixture(), file = join(input.root,'agent.md');
  const events: Array<{path:string;expected:string|null;before:string|null;after:Array<string|null>}> = [];
  const tx = beginRunnerContributions({...input,targets:[{path:file,selector:{kind:'file'},expectedHash:contributionHash('planned')}],
    beforeMetadataWrite(path,expected) {
      const event = {path,expected,before: (()=>{try{return contributionHash(readFileSync(path));}catch{return null;}})(),after:[] as Array<string|null>};
      events.push(event);
      return ()=>{try {event.after.push(contributionHash(readFileSync(path)));}catch {event.after.push(null);}};
    },
  });
  writeFileSync(file,'planned'); tx.commit();
  expect(events.map(event=>event.path)).toEqual([`${input.manifestPath}.pending`,input.manifestPath]);
  for (const event of events) {expect(event.before).toBeNull();expect(event.after[0]).toBe(event.expected);}
  expect(events[0]!.after.at(-1)).toBeNull();
});
test('recovery preserves a manifest whose runner/root identity changed after the pending write', () => {
  const input = fixture(); const path = join(input.root, 'agent.md');
  const tx = beginRunnerContributions({ ...input, targets: [{ path, selector: { kind: 'file' }, expectedHash: contributionHash('new') }] });
  writeFileSync(path, 'new'); tx.abandon();
  const other = JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'other', root: input.root, deckVersion: 'test', contributions: [] });
  writeFileSync(input.manifestPath, other);
  expect(() => recoverRunnerContributionTransaction(input.manifestPath)).toThrow('identity');
  expect(readFileSync(input.manifestPath, 'utf8')).toBe(other);
});
describe('runner contribution accounting', () => {
  test('records actual file and individual shared entry bytes, never sibling secrets', () => {
    const input = fixture();
    const file = join(input.root, 'agent.md');
    const config = join(input.root, 'config.json');
    writeFileSync(config, JSON.stringify({ secret: 'private' }));
    const tx = beginRunnerContributions({ ...input, targets: [{ path: file, selector: { kind: 'file' } }, { path: config, selector: { kind: 'json', keys: ['mcp', 'search'] } }] });
    writeFileSync(file, 'actual');
    writeFileSync(config, JSON.stringify({ secret: 'private', mcp: { search: { command: 'search' } } }));
    const receipts = tx.commit();
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.hash).toBe(contributionHash('actual'));
    expect(readFileSync(input.manifestPath, 'utf8')).not.toContain('private');
    expect(readRunnerContributions(input.manifestPath)?.contributions).toHaveLength(2);
  });
  test('does not adopt discovered existing content, and refuses changed owned preimages', () => {
    const input = fixture(); const file = join(input.root, 'user.md');
    writeFileSync(file, 'user');
    expect(beginRunnerContributions({ ...input, targets: [{ path: file, selector: { kind: 'file' } }] }).commit()).toHaveLength(0);
    const fresh = join(input.root, 'new.md');
    let tx = beginRunnerContributions({ ...input, targets: [{ path: fresh, selector: { kind: 'file' } }] });
    writeFileSync(fresh, 'owned'); tx.commit(); writeFileSync(fresh, 'edited');
    expect(() => beginRunnerContributions({ ...input, targets: [{ path: fresh, selector: { kind: 'file' } }] })).toThrow('changed');
  });
  test('refuses placeholder hashes, symlink traversal and simultaneous writers', () => {
    const input = fixture(); const file = join(input.root, 'new.md');
    const tx = beginRunnerContributions({ ...input, targets: [{ path: file, selector: { kind: 'file' } }] });
    expect(() => beginRunnerContributions({ ...input, targets: [] })).toThrow('pending');
    tx.abort();
    const external = mkdtempSync(join(tmpdir(), 'deck-external-')); symlinkSync(external, join(input.root, 'linked'));
    expect(() => beginRunnerContributions({ ...input, targets: [{ path: join(input.root, 'linked/file'), selector: { kind: 'file' } }] })).toThrow('symlink');
    mkdirSync(join(input.root, 'deck'), { recursive: true });
    writeFileSync(input.manifestPath, JSON.stringify({ schema: 'deck-runner-contributions-v1', runnerId: 'codex', root: input.root, deckVersion: 'test', contributions: [{ id: 'bad', path: file, selector: { kind: 'file' }, hash: '0'.repeat(64) }] }));
    expect(() => readRunnerContributions(input.manifestPath)).toThrow('hash');
  });
});
test('failed publication retries only verified expected postimages and keeps intervening user edits', () => {
  const input = fixture(); const path = join(input.root,'file.md'); const target = { path, selector: { kind: 'file' as const }, expectedHash: contributionHash('expected') };
  const first = beginRunnerContributions({ ...input, targets:[target] }); writeFileSync(path,'expected'); first.abandon();
  const retry = beginRunnerContributions({ ...input, targets:[target] }); retry.commit();
  expect(readRunnerContributions(input.manifestPath)?.contributions[0]?.hash).toBe(contributionHash('expected'));
  const second = beginRunnerContributions({ ...input, targets:[{...target,expectedHash:contributionHash('next')}] }); writeFileSync(path,'user edit'); second.abandon();
  expect(()=>beginRunnerContributions({ ...input, targets:[target] })).toThrow('recovery conflict');
  expect(readFileSync(path,'utf8')).toBe('user edit');
});

test('accounting a second package tree retains earlier trees and shared-file receipts', () => {
  const input = fixture();
  const config = join(input.root, 'config.json');
  const tx = beginRunnerContributions({ ...input, targets: [{ path: config, selector: { kind: 'json', keys: ['hook'] }, sourceItemId: 'package:rtk' }] });
  writeFileSync(config, '{"hook":"rtk"}'); tx.commit();
  const first = join(input.root, 'package-one'), second = join(input.root, 'package-two');
  mkdirSync(first); mkdirSync(second); writeFileSync(join(first, 'binary'), 'first'); writeFileSync(join(second, 'plugin'), 'second');
  recordOwnedRunnerArtifactTree({ ...input, artifactRoot: first, sourceItemId: 'package:rtk' });
  recordOwnedRunnerArtifactTree({ ...input, artifactRoot: second, sourceItemId: 'package:rtk' });
  expect(readRunnerContributions(input.manifestPath)?.contributions.map(entry => entry.path).sort()).toEqual([config, join(first, 'binary'), join(second, 'plugin')].sort());
});

test('publication retains external artifact receipts completed while files were being installed', () => {
  const input = { ...fixture(), runnerId: 'claude' };
  const path = join(input.root, 'agent.md');
  const tx = beginRunnerContributions({ ...input, targets: [{ path, selector: { kind: 'file' }, expectedHash: contributionHash('agent') }] });
  const artifactRoot = join(input.root, 'tools'); mkdirSync(artifactRoot); writeFileSync(join(artifactRoot, 'binary'), 'verified installed binary');
  recordOwnedRunnerArtifactTree({ ...input, artifactRoot, sourceItemId: 'package:rtk' });
  writeFileSync(path, 'agent'); tx.commit();
  const entries = readRunnerContributions(input.manifestPath)!.contributions;
  expect(entries.map(entry => entry.path).sort()).toEqual([path, join(artifactRoot, 'binary')].sort());
  for (const entry of entries) expect(entry.hash).toBe(contributionHash(readFileSync(entry.path)));
});

test('removal receipts preserve legacy envelopes, unrelated entries and changed artifacts', () => {
  for (const runnerId of ['codex', 'claude', 'opencode', 'pi']) {
    const input = { ...fixture(), runnerId }; const path = join(input.root, 'owned');
    const tx = beginRunnerContributions({ ...input, targets: [{ path, selector: { kind: 'file' } }] });
    writeFileSync(path, 'owned'); tx.commit();
    const raw = JSON.parse(readFileSync(input.manifestPath, 'utf8')); raw.extra = 'preserve';
    if (runnerId === 'pi') raw.schema = 'deck-pi-manifest-v1';
    if (runnerId === 'codex') { delete raw.schema; raw.version = 1; }
    writeFileSync(input.manifestPath, JSON.stringify(raw));
    const target = { path, selector: { kind: 'file' as const } };
    expect(() => recordRemovedRunnerContributions(input.manifestPath, [target])).toThrow('still exists');
    unlinkSync(path);
    recordRemovedRunnerContributions(input.manifestPath, [target]);
    const after = JSON.parse(readFileSync(input.manifestPath, 'utf8'));
    expect(after.contributions).toEqual([]); expect(after.extra).toBe('preserve'); expect(after.schema).toBe(raw.schema); expect(after.version).toBe(raw.version);
    recordRemovedRunnerContributions(input.manifestPath, [target]);
  }
});

test('dedicated-location removals without contribution receipts do not rewrite the manifest', () => {
  const input = fixture(); mkdirSync(join(input.root, 'deck'));
  const before = '{ "version": 1, "runnerId": "codex", "extra": "preserve exact evidence" }\n';
  writeFileSync(input.manifestPath, before);
  recordRemovedRunnerContributions(input.manifestPath, []);
  expect(readFileSync(input.manifestPath, 'utf8')).toBe(before);
});

test('collecting an unreceipted historical leaf preserves unrelated receipt bytes exactly', () => {
  const input = fixture(); mkdirSync(join(input.root, 'deck'));
  const before = '{ "version": 1, "runnerId": "codex", "extra": "historical envelope", "contributions": [] }\n';
  writeFileSync(input.manifestPath, before);
  recordRemovedRunnerContributions(input.manifestPath, [{path:join(input.root,'retired-unreceipted-leaf'),selector:{kind:'file'}}]);
  expect(readFileSync(input.manifestPath, 'utf8')).toBe(before);
});

test('legacy file accounting preserves outside-root aliases and unrelated keys', () => {
  const input=fixture(),manifestPath=join(input.root,'native/deck/manifest.json');
  mkdirSync(join(input.root,'native/deck'),{recursive:true});
  const path=join(input.root,'external/removed');
  writeFileSync(manifestPath,JSON.stringify({version:1,runnerId:'codex',files:{'../external/removed':'one',[path]:'two','keep.md':'keep'}}));
  recordRemovedRunnerContributions(manifestPath,[{path,selector:{kind:'file'}}]);
  expect(JSON.parse(readFileSync(manifestPath,'utf8')).files).toEqual({'keep.md':'keep'});
});

test('unreceipted leaf accounting rereads later receipts and user metadata', () => {
  const input=fixture(),owned=join(input.root,'owned');
  const tx=beginRunnerContributions({...input,targets:[{path:owned,selector:{kind:'file'}}]});writeFileSync(owned,'owned');tx.commit();
  recordRemovedRunnerContributions(input.manifestPath,[{path:join(input.root,'unreceipted'),selector:{kind:'file'}}]);
  const raw=JSON.parse(readFileSync(input.manifestPath,'utf8'));raw.userMetadata={keep:true};writeFileSync(input.manifestPath,JSON.stringify(raw));
  unlinkSync(owned);
  recordRemovedRunnerContributions(input.manifestPath,[{path:owned,selector:{kind:'file'}}]);
  const after=JSON.parse(readFileSync(input.manifestPath,'utf8'));
  expect(after.contributions).toEqual([]);expect(after.userMetadata).toEqual({keep:true});
});


test('TOML MCP receipt excludes following hook comments across native trust insertion', () => {
  const mcp = '[mcp_servers.codebase-memory]\ncommand = "/private/codebase-memory-mcp"';
  const hook = '\n\n# deck-codex-hook:rtk:start\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"';
  const trust = '\n\n[projects."/private/project"]\ntrust_level = "trusted"';
  const selector = { kind: 'toml' as const, header: 'mcp_servers.codebase-memory' };
  const before = selectContributionContent(mcp + hook, selector);
  expect(before).toBe(mcp);
  expect(selectContributionContent(mcp + trust + hook, selector)).toBe(before);
  expect(selectContributionContent(mcp.replace('/private/', '/changed/') + hook, selector)).not.toBe(before);
  // Previously stored raw hashes must not silently become valid under the new selection.
  expect(contributionHash(before!)).not.toBe(contributionHash(mcp + '\n\n# deck-codex-hook:rtk:start'));
});
