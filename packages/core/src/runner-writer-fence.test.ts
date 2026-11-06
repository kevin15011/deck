import { expect, test } from 'bun:test';
import { decideRunnerWrite, type RunnerFence } from './runner-writer-fence';
const build = (semver = '1.0.0', channel: 'stable' | 'canary' = 'stable') => ({ semver, channel, commit: 'abc' });
const record: RunnerFence = { fenceSchema: 1, stateSchema: 1, epoch: 2, writer: build('2.0.0') };
// Oracle: build identity never orders same-version peers; unknown transactions never authorize mutation.
test('older writers and unsupported schemas are read-only', () => {
 expect(decideRunnerWrite(record, build(), 'explicit', true, 1)).toBe('managed-by-newer-deck');
 expect(decideRunnerWrite({...record,stateSchema:2},build('3.0.0'),'explicit',true,1)).toBe('managed-by-newer-schema');
});
test('equal-version compatible peers converge without writes, broken state can be repaired', () => {
 for(const channel of ['stable','canary'] as const) {
  expect(decideRunnerWrite({...record,writer:build()},build('1.0.0',channel),'refresh',true,1)).toBe('compatible-installed-state');
  expect(decideRunnerWrite({...record,writer:build()},build('1.0.0',channel),'refresh',false,1)).toBe('write');
 }
 expect(decideRunnerWrite({...record,pending:{epoch:3,writer:build('3.0.0'),stateSchema:1}},build('4.0.0'),'explicit',true,1)).toBe('runner-write-recovery-required');
 expect(decideRunnerWrite('unreadable',build(),'explicit',false,1)).toBe('runner-fence-unreadable');
});

import { mkdtempSync, realpathSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readRunnerFence, withRunnerFence, recoverRunnerFence } from './runner-writer-fence';
// Oracle: uncertain effects remain pending; recovery requires journal proof and no-op epochs do not advance.
test('fence retains interrupted effects, rejects stale CAS, and recovers only proved outcomes', async () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-fence-'))),path=join(root,'state','fence.json');
 try {
  await expect(withRunnerFence({path,self:build(),stateSchema:1,effect:async()=>{throw Error('crash after write');},changed:()=>true})).rejects.toThrow('crash');
  expect(readRunnerFence(path)).toMatchObject({epoch:0,pending:{epoch:1}});
  const before=readFileSync(path,'utf8');
  expect(await recoverRunnerFence(path,async()=>undefined)).toBe(false);
  expect(readFileSync(path,'utf8')).toBe(before);
  expect(await recoverRunnerFence(path,async()=>'postimage')).toBe(true);
  const current=readRunnerFence(path);
  await withRunnerFence({path,self:build(),stateSchema:1,expected:current,effect:async()=>({changed:false}),changed:r=>r.changed});
  expect(readRunnerFence(path)).toEqual(current);
  await expect(withRunnerFence({path,self:build(),stateSchema:1,expected:record,effect:async()=>{},changed:()=>true})).rejects.toThrow('runner-fence-changed');
 }finally{rmSync(root,{recursive:true,force:true});}
});
// Protects release ordering when valid SemVer includes build metadata.
test('build metadata never hides a newer committed release', () => {
 expect(decideRunnerWrite({...record, writer:build('2.0.0+build.42')},build('1.0.0'),'explicit',true,1)).toBe('managed-by-newer-deck');
});

import { compareReleaseVersions, validBuildIdentity } from './runner-writer-fence';
// Protects one complete grammar and exact release ordering; channels intentionally converge.
test('version identity and comparison share exact SemVer parsing', () => {
 for (const version of ['1.0.0+.', '1.0.0-', '1.0.0-a..b', '01.0.0', '1.0.0-01', '1.0.0+', '1.0.0\n']) {
  expect(validBuildIdentity(build(version))).toBe(false);
  expect(() => compareReleaseVersions(version, '1.0.0')).toThrow();
 }
 expect(validBuildIdentity(build('1.0.0-beta.1+build.42'))).toBe(true);
 expect(compareReleaseVersions('1.0.0-beta.1+build.42', '1.0.0')).toBe(0);
 expect(compareReleaseVersions('9007199254740993.0.0', '9007199254740992.0.0')).toBeGreaterThan(0);
});
