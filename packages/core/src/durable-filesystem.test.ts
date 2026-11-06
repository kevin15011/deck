import { expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureDurableDir } from './durable-filesystem';
import { writePrivateState } from './runner-history';
import { archiveRunnerJournal } from './runner-recovery-archive';
function fixture() { return fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'deck-durable-'))); }
const reference = { kind: 'fixture-journal', id: 'original', operationId: 'original' };
// Protects directory-entry ordering and restrictive creation before any child publication.
test('new directory parents are synchronized before publishing child state', () => {
 const root = fixture(), a = join(root, 'a'), b = join(a, 'b'), path = join(b, 'fence.json');
 const events: string[] = [], sync = fs.fsyncSync, mkdir = fs.mkdirSync;
 const syncSpy = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
  const stat = fs.fstatSync(fd);
  for (const [name, dir] of [['root', root], ['a', a], ['b', b]]) if (fs.existsSync(dir!) && fs.lstatSync(dir!).ino === stat.ino) events.push(`sync:${name}`);
  sync(fd);
 });
 const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(((path: any, options: any) => {
  if (path === a || path === b) events.push(`mkdir:${path === a ? 'a' : 'b'}`);
  return mkdir(path, options);
 }) as typeof fs.mkdirSync);
 try {
  writePrivateState(path, { private: 'state' });
  expect(events.indexOf('sync:root')).toBeGreaterThan(events.indexOf('mkdir:a'));
  expect(events.indexOf('mkdir:b')).toBeGreaterThan(events.indexOf('sync:root'));
  expect(events.indexOf('sync:a')).toBeGreaterThan(events.indexOf('mkdir:b'));
  expect(events.indexOf('sync:b')).toBeGreaterThan(events.indexOf('sync:a'));
  expect(fs.lstatSync(a).mode & 0o777).toBe(0o700); expect(fs.lstatSync(b).mode & 0o777).toBe(0o700);
  expect(fs.lstatSync(path).mode & 0o777).toBe(0o600);
 } finally { mkdirSpy.mockRestore(); syncSpy.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});
// Protects fail-closed barriers and safe retry after mkdir succeeded but parent sync failed.
test('directory barrier failure prevents child publication and retry completes it', () => {
 const root = fixture(), child = join(root, 'a'), path = join(child, 'fence.json');
 const sync = fs.fsyncSync;
 const spy = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
  if (fs.existsSync(child) && fs.fstatSync(fd).ino === fs.lstatSync(root).ino) throw Error('parent barrier');
  sync(fd);
 });
 try {
  expect(() => writePrivateState(path, 'private')).toThrow('parent barrier');
  expect(fs.existsSync(child)).toBe(true); expect(fs.existsSync(path)).toBe(false);
 } finally { spy.mockRestore(); }
 try { writePrivateState(path, 'retry'); expect(JSON.parse(fs.readFileSync(path, 'utf8'))).toBe('retry'); }
 finally { fs.rmSync(root, { recursive: true, force: true }); }
});
// Protects link-before-unlink ordering and resumability when either required barrier fails.
test('archive barrier failures preserve binding evidence and retry the same inode', () => {
 for (const phase of ['archive', 'live-parent'] as const) {
  const root = fixture(), livePath = join(root, 'transaction.pending.json'), archive = join(root, 'recovery-archive');
  fs.writeFileSync(livePath, 'private evidence', { mode: 0o600 }); const original = fs.lstatSync(livePath);
  const sync = fs.fsyncSync; let failed = false;
  const spy = spyOn(fs, 'fsyncSync').mockImplementation(fd => {
   const stat = fs.fstatSync(fd);
   const linked = fs.existsSync(archive) && fs.readdirSync(archive).some(name => name.endsWith('.json'));
   if (linked && (phase === 'archive' ? stat.ino === fs.lstatSync(archive).ino : !fs.existsSync(livePath) && stat.ino === fs.lstatSync(root).ino)) { failed = true; throw Error('barrier failure'); }
   sync(fd);
  });
  try { expect(() => archiveRunnerJournal({ livePath, reference, bound: [reference], journalKinds: ['fixture-journal'] })).toThrow('barrier failure'); expect(failed).toBe(true); expect(fs.existsSync(livePath)).toBe(phase === 'archive'); }
  finally { spy.mockRestore(); }
  try {
   archiveRunnerJournal({ livePath, reference, bound: [reference], journalKinds: ['fixture-journal'] });
   const entries = fs.readdirSync(archive); expect(entries).toHaveLength(1);
   expect(fs.lstatSync(join(archive, entries[0]!)).ino).toBe(original.ino); expect(fs.existsSync(livePath)).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
 }
});
// Protects traversal refusal without turning an unsafe existing directory into trusted state.
test('durable directory creation refuses symlink ancestors and preserves existing modes', () => {
 const root = fixture();
 try {
  const target = join(root, 'target'); fs.mkdirSync(target, { mode: 0o755 }); fs.symlinkSync(target, join(root, 'alias'));
  expect(() => ensureDurableDir(join(root, 'alias', 'child'), 0o700)).toThrow('runner-directory-unsafe');
  expect(fs.existsSync(join(target, 'child'))).toBe(false); ensureDurableDir(target, 0o700);
  expect(fs.lstatSync(target).mode & 0o777).toBe(0o755);
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
