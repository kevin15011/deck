import {afterEach, beforeEach, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureStateLayout, resolveStatePaths, RunnerMutationDeferredError, startDaemon, withIdleRunnerMutation} from '@deck/session-host';
import {releaseRunnerMutationMarker} from '../../../packages/session-host/src/runner-mutation';
import {cleanupRoots, runRunnerCleanupUpdate} from './runner-cleanup-command';
import {reviewRunnerCleanup} from './runner-cleanup-doctor';
import {createBackup, getBackupDir, readBackupManifest, restoreBackup, prepareBackupPostimages} from './upgrade-command/backup-store';
import {createHash} from 'node:crypto';
import {rollbackBackup, rollbackLatest} from './upgrade-command/rollback';
import {buildDefaultState, getStateStorePaths, setActiveOperation, writeState} from './upgrade-command/state-store';
import {_resetDeckPathCache} from './runtime/paths';
import {getDefaultDeckConfig, beginRunnerContributions} from '@deck/core';
import {computeFileSha256} from './upgrade-command/backup-store';
import {runUpgradeOrchestrator, ORCHESTRATOR_ERROR_CODES} from './upgrade-command/orchestrator';
import {readState} from './upgrade-command/state-store';
import {runRunnerSync} from './upgrade-command/runner-sync';
import type {RunnerAdapter} from '@deck/core';

let home: string;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nrp-recovery-'));
  for (const [key, value] of Object.entries({HOME: home, XDG_STATE_HOME: join(home, 's'), XDG_CONFIG_HOME: join(home, 'c'), XDG_CACHE_HOME: join(home, 'b'), XDG_DATA_HOME: join(home, 'd')})) {
    saved[key] = process.env[key]; process.env[key] = value;
  }
  _resetDeckPathCache();
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
  _resetDeckPathCache(); rmSync(home, {recursive: true, force: true});
});
const tree = (root: string, omitState = false): unknown => readdirSync(root, {withFileTypes: true})
  .filter(e=>!omitState||join(root,e.name)!==getStateStorePaths().statePath)
  .sort((a,b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(join(root,e.name),omitState) : readFileSync(join(root,e.name),'utf8')]);
function expectRetainedRollbackState(before: string) {
  const previous=JSON.parse(before);
  expect(JSON.parse(readFileSync(getStateStorePaths().statePath,'utf8'))).toEqual({
    ...previous,activeOperation:{...previous.activeOperation,phase:'rollback'},
  });
}

test('public and direct rollback preserve runner files, created files, backups and recovery state while busy, then retry when idle', async () => {
  const paths = resolveStatePaths(); let busy = true;
  const started = await startDaemon({paths, version:'test', anchorCommand:[process.execPath], recoverOnStart:false,
    createService:() => ({execute:async()=>({ok:true}), openLog:()=>undefined, hasRunningWork:()=>busy, hasActiveSessions:()=>busy})});
  if (!started.ok) throw Error('isolated daemon failed');
  try {
    const config = join(home,'config.toml'), created = join(home,'created.json'); writeFileSync(config,'original');
    const backup = createBackup({operationId:'fixture', deckVersionBefore:'1.0.0', targetVersion:'2.0.0', reason:'rollback-test', files:[
      {id:'config',sourcePath:config,owner:'runner:codex',kind:'config'}, {id:'created',sourcePath:created,owner:'runner:codex',kind:'config'},
    ]});
    const account=prepareBackupPostimages(backup.backupId,[['current',config],['keep until idle',created]].map(([content,sourcePath])=>({sourcePath:sourcePath!,sha256:createHash('sha256').update(content!).digest('hex'),owner:'runner:codex',kind:'config'})));
    writeFileSync(config,'current'); writeFileSync(created,'keep until idle'); account();
    writeState(setActiveOperation(buildDefaultState('2.0.0'), {id:'fixture',version:'2.0.0',phase:'backup',backupId:backup.backupId,startedAt:new Date().toISOString()}));
    const statePath = getStateStorePaths().statePath, beforeState = readFileSync(statePath,'utf8'), beforeBackup = tree(getBackupDir(backup.backupId));
    const publicRollback = async () => {
      const child = Bun.spawn([process.execPath,'run',join(import.meta.dir,'main.tsx'),'rollback','--backup',backup.backupId,'--force'], {env:{...process.env,BUN_RUNTIME_TRANSPILER_CACHE_PATH:'0'},stdout:'pipe',stderr:'pipe'});
      const [exit,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
      return {exit,stdout,stderr};
    };
    for (const restore of [() => restoreBackup(backup.backupId), () => rollbackBackup(backup.manifest,'2.0.0',{force:true}), () => rollbackLatest('2.0.0',{force:true})]) {
      await expect(restore()).rejects.toBeInstanceOf(RunnerMutationDeferredError);
      expect(readFileSync(config,'utf8')).toBe('current'); expect(readFileSync(created,'utf8')).toBe('keep until idle');
      expect(readFileSync(statePath,'utf8')).toBe(beforeState); expect(tree(getBackupDir(backup.backupId))).toEqual(beforeBackup);
    }
    const blocked = await publicRollback(); expect(blocked.exit).toBe(1); expect(blocked.stderr).toContain('deferred');
    expect(readFileSync(config,'utf8')).toBe('current'); expect(readFileSync(statePath,'utf8')).toBe(beforeState);
    busy = false;
    const retried = await publicRollback(); expect(retried.exit).toBe(0); expect(retried.stdout).toContain('Rolled back');
    expect(readFileSync(config,'utf8')).toBe('original'); expect(existsSync(created)).toBe(false);
  } finally {await started.daemon.stop('test');}
}, 30000);

test('direct restore defers unknown offline history without altering recovery state or runner files', async () => {
  const paths = resolveStatePaths(); ensureStateLayout(paths); mkdirSync(join(paths.sessionsDir,'historical'));
  const config = join(home,'config.toml'); writeFileSync(config,'original');
  const backup = createBackup({operationId:'fixture',deckVersionBefore:'1.0.0',reason:'rollback-test',files:[{id:'config',sourcePath:config,owner:'runner:codex',kind:'config'}]});
  writeFileSync(config,'current'); const before = tree(home);
  await expect(Promise.resolve().then(() => restoreBackup(backup.backupId))).rejects.toBeInstanceOf(RunnerMutationDeferredError);
  expect(tree(home)).toEqual(before);
});

test('automatic rollback retains the failed update and its backup when activity starts before restoration', async () => {
  const paths = resolveStatePaths(); let busy = false;
  const started = await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false,
    createService:()=>({execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>busy,hasActiveSessions:()=>busy})});
  if (!started.ok) throw Error('isolated daemon failed');
  try {
    const binary = join(home,'deck-binary'), staged = join(home,'staged-binary');
    writeFileSync(binary,'original'); writeFileSync(staged,'next version');
    const descriptor = {schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),items:[{
      id:'binary-test',kind:'binary',required:true,platform:`${process.platform}-${process.arch}`,asset_name:`deck_v2.0.0_${process.platform}-${process.arch}.tar.gz`,url:'https://example.invalid/deck-binary',sha256:computeFileSha256(staged),notes:'',
    }]};
    let stateAtFailure = '';
    let failure: unknown;
    try {
      await runUpgradeOrchestrator({descriptor,targetVersion:'2.0.0',currentVersion:'1.0.0',deps:{
        installKind:'binary',currentBinaryPath:binary,projectRoot:home,readGlobalDeckConfig:getDefaultDeckConfig,
        adapterRegistry:{list:()=>[],has:()=>false,get:()=>{throw Error('no runner');}},
        resolveStagingDir:()=>home,resolveStagedAsset:()=>staged,
        replaceBinary:async()=>{
          writeFileSync(binary,'next version'); busy = true;
          stateAtFailure = readFileSync(getStateStorePaths().statePath,'utf8');
          throw Error('fixture replacement failed');
        },
      }});
    } catch (error) {failure = error;}
    expect(failure).toMatchObject({code:ORCHESTRATOR_ERROR_CODES.ROLLBACK_FAILED});
    expect((failure as Error).message).toContain('deferred');
    expect(readFileSync(binary,'utf8')).toBe('next version');
    expect(readFileSync(getStateStorePaths().statePath,'utf8')).toBe(stateAtFailure);
    const operation = readState('1.0.0').activeOperation;
    expect(operation?.backupId).toBeDefined(); expect(existsSync(getBackupDir(operation!.backupId!))).toBe(true);
    busy = false;
    await rollbackLatest('1.0.0',{force:true});
    expect(readFileSync(binary,'utf8')).toBe('original'); expect(readState('1.0.0').activeOperation).toBeUndefined();
  } finally {await started.daemon.stop('test');}
});

for (const owned of [false, true]) test(`cleanup rechecks recovery under admission after ${owned ? 'owned' : 'individual'} confirmation`, async () => {
  const roots = cleanupRoots(), paths = resolveStatePaths(), manifest = join(roots.codex,'deck/manifest.json'), pending = `${manifest}.pending`;
  mkdirSync(join(roots.codex,'deck'),{recursive:true});
  const config = owned ? join(roots.codex,'deck/tools/context-mode/launcher') : join(roots.codex,'config.toml');
  if (owned) mkdirSync(join(roots.codex,'deck/tools/context-mode'),{recursive:true});
  writeFileSync(config,owned ? 'owned retired artifact' : '[mcp_servers.serena]\ncommand="user-serena"\n');
  const before = readFileSync(config,'utf8');
  const run = () => runRunnerCleanupUpdate(roots,['codex'],{confirmOwned:owned,admission:effect=>withIdleRunnerMutation(effect,{paths}),ask:async()=>{
    await withIdleRunnerMutation(()=>writeFileSync(pending,'interrupted recovery receipt'),{paths});
    return owned ? 'apply-owned' : 'remove';
  }});
  const result = await run();
  expect(result[0]?.status).toBe('recovery-required'); expect(result[0]?.remaining).toBe(1);
  expect(readFileSync(config,'utf8')).toBe(before); expect(readFileSync(pending,'utf8')).toBe('interrupted recovery receipt');
  expect(existsSync(join(roots.codex,'deck/backups'))).toBe(false); expect(existsSync(manifest)).toBe(false);
  // A subsequent unattended retry must preserve the same pending recovery too.
  expect((await runRunnerCleanupUpdate(roots,['codex']))[0]?.status).toBe('recovery-required');
  expect(readFileSync(config,'utf8')).toBe(before);
});

test('cleanup checks recovery again on later admitted mutations in the same review', async () => {
  const roots = cleanupRoots(), paths = resolveStatePaths(), pending = join(roots.codex,'deck/manifest.json.pending');
  mkdirSync(join(roots.codex,'deck'),{recursive:true});
  const config = join(roots.codex,'config.toml');
  writeFileSync(config,'[mcp_servers.serena]\ncommand="user"\n[mcp_servers.context-mode]\ncommand="user"\n');
  let reviews = 0, beforeSecondEdit = '';
  const result = await runRunnerCleanupUpdate(roots,['codex'],{admission:effect=>withIdleRunnerMutation(effect,{paths}),ask:async()=>{
    if (++reviews === 2) {
      beforeSecondEdit = readFileSync(config,'utf8');
      await withIdleRunnerMutation(()=>writeFileSync(pending,'pending second edit'),{paths});
    }
    return 'remove';
  }});
  expect(reviews).toBe(2); expect(result[0]?.status).toBe('recovery-required'); expect(result[0]?.remaining).toBe(1);
  expect(readFileSync(config,'utf8')).toBe(beforeSecondEdit);
});

for (const evidence of ['history','socket','unreadable-history','mutation-guard','none']) test(`doctor reports offline ${evidence} read-only and agrees with mutation admission`, async () => {
  const roots = cleanupRoots(), paths = resolveStatePaths(); ensureStateLayout(paths);
  if (evidence === 'history') mkdirSync(join(paths.sessionsDir,'historical'));
  if (evidence === 'socket') writeFileSync(paths.socket.path,'leftover socket evidence');
  if (evidence === 'unreadable-history') {rmSync(paths.sessionsDir,{recursive:true}); writeFileSync(paths.sessionsDir,'invalid directory');}
  if (evidence === 'mutation-guard') mkdirSync(join(paths.daemonDir,'runner-mutation.json.gate'));
  const before = tree(home), report = await reviewRunnerCleanup(roots,paths);
  expect(report.status).toBe(evidence === 'none' ? 'ok' : 'warning');
  if (evidence !== 'none') {
    expect(JSON.stringify(report)).toContain('unknown');
    await expect(withIdleRunnerMutation(()=>{throw Error('must not mutate');},{paths})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
  }
  if (evidence === 'mutation-guard') {
    const advice = JSON.stringify(report);
    expect(advice).toContain(join(paths.daemonDir,'runner-mutation.json.gate'));
    expect(advice).toContain('docs/runners.md#offline-runner-mutation-guard-recovery');
    expect(advice.toLowerCase()).toContain('independently');
    expect(advice).toContain('reservation');
  }
  expect(tree(home)).toEqual(before);
});

function cleanupFailureAdapter(failAccounting = false) {
  const paths = resolveStatePaths(), gate = join(paths.daemonDir,'runner-mutation.json.gate');
  const file = join(home,'runner.txt'), manifest = join(home,'runner-manifest.json');
  const backup = {snapshot:'original', path:join(home,'adapter-backup')};
  let writes = 0;
  const original = Error('original manifest read failure');
  const adapter = {
    runnerId:'codex',environmentIds:['codex-development'],
    detectDeckInstall:async()=>({installed:true,managedPaths:[file]}),
    buildDeveloperTeamInstallPlan:()=>({files:[{path:file,content:'changed'}]}),
    backupDeveloperTeamFiles:()=>backup,
    applyDeveloperTeamInstall:async()=>{
      writes++; writeFileSync(file,'changed'); writeFileSync(manifest,'{"fixture":true}');
      return {results:[{status:'written'}],changedCount:1,unchangedCount:0,contributionManifestPath:manifest};
    },
    verifyDeveloperTeamInstall:()=>{
      mkdirSync(gate);
      // A callback failure after apply must retain its exact error and backup too.
      if (failAccounting) Object.defineProperty(adapterResult, 'contributionManifestPath', {get:()=>{throw original;}});
      return {valid:true,diagnostics:[]};
    },
  };
  const apply = adapter.applyDeveloperTeamInstall;
  let adapterResult: Awaited<ReturnType<typeof apply>>;
  adapter.applyDeveloperTeamInstall = async()=>adapterResult=await apply();
  const registry = {list:()=>[adapter as unknown as RunnerAdapter],has:()=>true,get:()=>adapter as unknown as RunnerAdapter};
  return {paths,gate,file,manifest,backup,registry,original,writes:()=>writes};
}

for (const created of [false,true]) for (const edited of [false, true]) test(`public recovery of ${created ? 'created' : 'overwritten'} file ${edited ? 'preserves later edits and unresolved recovery' : 'restores the recorded applied content'}`, async () => {
  const fixture = cleanupFailureAdapter();
  if (!created) writeFileSync(fixture.file, 'original');
  const first = await runUpgradeOrchestrator({currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{
    schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),
    items:[{id:'content',kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''}],
  },deps:{installKind:'development',currentBinaryPath:join(home,'unused'),projectRoot:home,readGlobalDeckConfig:getDefaultDeckConfig,adapterRegistry:fixture.registry}});
  rmdirSync(fixture.gate);
  const marker = JSON.parse(readFileSync(join(fixture.paths.daemonDir,'runner-mutation.json'),'utf8'));
  expect(releaseRunnerMutationMarker(fixture.paths,marker)).toBe(true);
  if (edited) writeFileSync(fixture.file, 'later user edit');
  const beforeState = readFileSync(getStateStorePaths().statePath,'utf8');
  const child = Bun.spawn([process.execPath,'run',join(import.meta.dir,'main.tsx'),'rollback','--backup',first.backupId!,'--force'], {env:{...process.env},stdout:'pipe',stderr:'pipe'});
  const [exit,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  if (created && !edited) expect(existsSync(fixture.file)).toBe(false);
  else expect(readFileSync(fixture.file,'utf8')).toBe(edited ? 'later user edit' : 'original');
  expect(exit).toBe(edited ? 1 : 0);
  if (edited) {
    expect(stderr).toContain('postimage');
    expectRetainedRollbackState(beforeState);
    expect(existsSync(getBackupDir(first.backupId!))).toBe(true);
    await expect(runUpgradeOrchestrator({currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{}})).rejects.toMatchObject({code:'UPGRADE_RECOVERY_REQUIRED',backupId:first.backupId});
  } else {expect(stdout).toContain('Rolled back'); expect(readState('1.0.0').activeOperation).toBeUndefined();}
}, 30000);

for (const recognized of [false,true]) for (const created of [false,true]) test(`${recognized ? 'recognized' : 'unrecognized'} partial ${created ? 'creation' : 'overwrite'} retains recovery and does not repeat another content item`,async()=>{
  const file=join(home,'runner.txt');if (!created) writeFileSync(file,'original');let writes=0;
  const adapter={runnerId:'codex',environmentIds:['codex-development'],detectDeckInstall:async()=>({installed:true,managedPaths:[file]}),
    buildDeveloperTeamInstallPlan:()=>({files:[{path:file,content:'planned'}]}),backupDeveloperTeamFiles:()=>undefined,
    applyDeveloperTeamInstall:async()=>{writes++;writeFileSync(file,recognized ? 'planned' : 'unrecognized partial content');if (recognized) throw Error('failed after known write');return {results:[{status:'written'}],changedCount:1,unchangedCount:0};},
    verifyDeveloperTeamInstall:()=>({valid:true,diagnostics:[]}),
  } as unknown as RunnerAdapter;
  const options={currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),
    items:['first','second'].map(id=>({id,kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''})),
  },deps:{installKind:'development' as const,currentBinaryPath:join(home,'unused'),projectRoot:home,readGlobalDeckConfig:getDefaultDeckConfig,adapterRegistry:{list:()=>[adapter],has:()=>true,get:()=>adapter}}};
  const result=await runUpgradeOrchestrator(options);
  expect(writes).toBe(1);expect(result.status).toBe('partial_failure');
  expect(result.finalState.activeOperation?.backupId).toBe(result.backupId);
  expect(result.content.outcomes?.[0]?.diagnostics.join(' ')).toContain(recognized ? 'failed after known write' : 'postimage is unknown');
  const before=tree(home);
  await expect(runUpgradeOrchestrator(options)).rejects.toMatchObject({code:'UPGRADE_RECOVERY_REQUIRED'});
  expect(tree(home)).toEqual(before);expect(writes).toBe(1);
  if (recognized) {
    await rollbackLatest('2.0.0',{force:true});
    expect(readState('1.0.0').activeOperation).toBeUndefined();
    if (created) expect(existsSync(file)).toBe(false); else expect(readFileSync(file,'utf8')).toBe('original');
  } else {
    const beforeRollbackState=readFileSync(getStateStorePaths().statePath,'utf8'),beforeOtherFiles=tree(home,true);
    await expect(rollbackLatest('2.0.0',{force:true})).rejects.toMatchObject({code:'BACKUP_RESTORE_FAILED'});
    expectRetainedRollbackState(beforeRollbackState);
    expect(tree(home,true)).toEqual(beforeOtherFiles);
  }
});

test('replacement snapshots the admitted plan after owned retirement and preserves its independent receipts',async()=>{
  const roots=cleanupRoots(),root=roots.codex;mkdirSync(root,{recursive:true});
  const file=join(root,'config.toml'),manifest=join(root,'deck/manifest.json');
  const tx=beginRunnerContributions({runnerId:'codex',root,manifestPath:manifest,deckVersion:'old',targets:[{path:file,selector:{kind:'toml',header:'mcp_servers.serena'}}]});
  writeFileSync(file,'[mcp_servers.serena]\ncommand="serena"\n');tx.commit();
  let writes=0;
  const adapter={runnerId:'codex',environmentIds:['codex-development'],detectDeckInstall:async()=>({installed:true,managedPaths:[file]}),
    buildDeveloperTeamInstallPlan:()=>({files:[{path:file,content:readFileSync(file,'utf8')+'# refreshed\n'}]}),backupDeveloperTeamFiles:()=>undefined,
    applyDeveloperTeamInstall:async(input:any)=>{writes++;writeFileSync(file,input.plan.files[0].content);return {results:[{status:'written'}],changedCount:1,unchangedCount:0};},
    verifyDeveloperTeamInstall:()=>({valid:true,diagnostics:[]}),
  } as unknown as RunnerAdapter;
  const result=await runUpgradeOrchestrator({currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),
    items:[{id:'content',kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''}],
  },deps:{installKind:'development',currentBinaryPath:join(home,'unused'),projectRoot:home,readGlobalDeckConfig:getDefaultDeckConfig,adapterRegistry:{list:()=>[adapter],has:()=>true,get:()=>adapter}}});
  expect(result.status).toBe('completed');expect(writes).toBe(1);
  expect(readFileSync(file,'utf8')).not.toContain('serena');expect(existsSync(join(root,'deck/backups'))).toBe(true);
  const receipt=readFileSync(manifest,'utf8');
  await rollbackLatest('2.0.0');
  expect(readFileSync(file,'utf8')).not.toContain('serena');expect(readFileSync(file,'utf8')).not.toContain('refreshed');
  expect(readFileSync(manifest,'utf8')).toBe(receipt);
});

test('force rollback of an unrelated backup cannot clear another unresolved operation',async()=>{
  ensureStateLayout(resolveStatePaths());
  const file=join(home,'file');writeFileSync(file,'original');
  const older=createBackup({operationId:'older',deckVersionBefore:'1',reason:'upgrade',files:[{id:'file',sourcePath:file,owner:'deck',kind:'config'}]});
  const active=createBackup({operationId:'active',deckVersionBefore:'1',reason:'upgrade',files:[]});
  writeState(setActiveOperation(buildDefaultState('1'),{id:'active',version:'2',phase:'verify',backupId:active.backupId,startedAt:new Date().toISOString()}));
  const before=tree(home);
  await expect(rollbackBackup(older.manifest,'2',{force:true})).rejects.toMatchObject({code:'ROLLBACK_PROTECTED'});
  expect(tree(home)).toEqual(before);
});

for (const fails of [false,true]) test(`sync retains completed writes and backup when cleanup fails ${fails ? 'alongside original callback error' : 'after successful callback'}`, async()=>{
  const fixture = cleanupFailureAdapter(fails);
  const result = await runRunnerSync({config:getDefaultDeckConfig(),registry:fixture.registry,projectRoot:home,deckVersion:'fixture',retirement:false});
  expect(fixture.writes()).toBe(1); expect(readFileSync(fixture.file,'utf8')).toBe('changed');
  expect(result.outcomes[0]).toMatchObject({status:'failed',filesWritten:[fixture.file],adapterBackup:fixture.backup});
  expect(result.outcomes[0]?.diagnostics.join(' ')).toContain('cleanup');
  expect(result.recoveryError?.code).toBe('runner-mutation-cleanup-failed');
  if (fails) expect(result.recoveryError?.operation).toMatchObject({status:'rejected',reason:fixture.original});
  else expect(result.manifestEntries[0]?.path).toBe(fixture.manifest);
});

for (const fails of [false,true]) test(`orchestrator retains cleanup recovery, completed/partial accounting and backups ${fails ? 'with original callback error' : 'after successful writes'}`, async()=>{
  const fixture = cleanupFailureAdapter(fails);
  writeFileSync(fixture.file,'original');
  const result = await runUpgradeOrchestrator({currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{
    schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),
    items:['content','second-content'].map(id=>({id,kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''})),
  },deps:{installKind:'development',currentBinaryPath:join(home,'unused'),projectRoot:home,
    readGlobalDeckConfig:getDefaultDeckConfig,adapterRegistry:fixture.registry}});
  expect(result.status).toBe('partial_failure');
  expect(result.content.outcomes?.[0]).toMatchObject({status:'failed',filesWritten:[fixture.file],adapterBackup:fixture.backup});
  expect(result.content.recoveryError?.code).toBe('runner-mutation-cleanup-failed');
  if (fails) expect(result.content.recoveryError?.operation).toMatchObject({status:'rejected',reason:fixture.original});
  else expect(result.finalManifest.files.some(entry=>entry.path===fixture.manifest)).toBe(true);
  expect(result.backupId).toBeDefined(); expect(existsSync(getBackupDir(result.backupId!))).toBe(true);
  expect(result.finalState.activeOperation?.backupId).toBe(result.backupId);
  expect(fixture.writes()).toBe(1);
});

test('a later callback/accounting failure retains earlier runner manifest evidence during cleanup failure', async()=>{
  const fixture = cleanupFailureAdapter(true);
  const firstFile=join(home,'first-runner.txt'),firstManifest=join(home,'first-manifest.json');
  const firstBackup={snapshot:'first backup'};
  const first={...fixture.registry.get(),runnerId:'pi',
    buildDeveloperTeamInstallPlan:()=>({files:[{path:firstFile,content:'first'}]}),
    backupDeveloperTeamFiles:()=>firstBackup,
    applyDeveloperTeamInstall:async()=>{writeFileSync(firstFile,'first');writeFileSync(firstManifest,'{}');return {results:[{status:'written'}],changedCount:1,unchangedCount:0,contributionManifestPath:firstManifest};},
    verifyDeveloperTeamInstall:()=>({valid:true,diagnostics:[]}),
  } as unknown as RunnerAdapter;
  const second=fixture.registry.get(), registry={list:()=>[first,second],has:()=>true,get:(id:string)=>id==='pi'?first:second};
  const result=await runRunnerSync({config:getDefaultDeckConfig(),registry,projectRoot:home,deckVersion:'fixture',retirement:false});
  expect(result.outcomes).toHaveLength(2);
  expect(result.outcomes[0]).toMatchObject({runnerId:'pi',filesWritten:[firstFile],adapterBackup:firstBackup});
  expect(result.outcomes[1]).toMatchObject({runnerId:'codex',filesWritten:[fixture.file],adapterBackup:fixture.backup});
  expect(result.manifestEntries[0]?.path).toBe(firstManifest);
  expect(result.recoveryError?.operation).toMatchObject({status:'rejected',reason:fixture.original});
});

for (const fails of [false,true]) test(`updates preserve unresolved recovery across repeated retries and allow explicit recovery ${fails ? 'with original callback error' : 'after completed writes'}`, async()=>{
  const fixture = cleanupFailureAdapter(fails);
  writeFileSync(fixture.file,'original');
  const descriptor = {
    schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),
    items:[{id:'content',kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''}],
  };
  const options = {currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor,deps:{
    installKind:'development' as const,currentBinaryPath:join(home,'unused'),projectRoot:home,
    readGlobalDeckConfig:getDefaultDeckConfig,adapterRegistry:fixture.registry,
  }};
  const first = await runUpgradeOrchestrator({...options,operationId:'original'});
  expect(first.status).toBe('partial_failure');
  expect(first.content.outcomes?.[0]).toMatchObject({filesWritten:[fixture.file],adapterBackup:fixture.backup});
  expect(first.content.recoveryError?.code).toBe('runner-mutation-cleanup-failed');
  if (fails) expect(first.content.recoveryError?.operation).toMatchObject({status:'rejected',reason:fixture.original});
  const originalState = readState('1.0.0'), before = tree(home);
  expect(originalState.activeOperation?.backupId).toBe(first.backupId);

  // Exceed the five-backup retention threshold without sleeps or in-memory
  // recovery state. Every invocation reloads state from disk.
  const failures: unknown[] = [];
  for (let retry = 0; retry < 7; retry++) {
    try { await runUpgradeOrchestrator({...options,operationId:`retry-${retry}`,force:true}); }
    catch (error) { failures.push(error); }
  }
  expect(readState('1.0.0')).toEqual(originalState);
  expect(existsSync(getBackupDir(first.backupId!))).toBe(true);
  expect(tree(home)).toEqual(before); // includes backup bytes, manifest, marker and history
  expect(failures).toHaveLength(7);
  for (const failure of failures) expect(failure).toMatchObject({code:'UPGRADE_RECOVERY_REQUIRED',backupId:first.backupId});
  expect(fixture.writes()).toBe(1);

  // Refusal precedes descriptor error finalization and backup collection. Neither
  // failure path may replace the original operation, even with force=true.
  for (const overrides of [
    {descriptor:{}},
    {deps:{...options.deps,resolveStagedAsset:()=>{throw Error('must not collect a new backup');}}},
  ]) {
    await expect(runUpgradeOrchestrator({...options,...overrides})).rejects.toMatchObject({code:'UPGRADE_RECOVERY_REQUIRED',backupId:first.backupId});
    expect(tree(home)).toEqual(before);
  }

  // This fixture owns all activity and the completed callback has returned.
  // Simulate explicit offline coordination recovery, then use the existing
  // admitted rollback contract to resolve the persisted operation.
  rmdirSync(fixture.gate);
  const marker = JSON.parse(readFileSync(join(fixture.paths.daemonDir,'runner-mutation.json'),'utf8'));
  expect(releaseRunnerMutationMarker(fixture.paths,marker)).toBe(true);
  // Idle alone must never replay a completed/partly completed operation.
  await expect(runUpgradeOrchestrator(options)).rejects.toMatchObject({code:'UPGRADE_RECOVERY_REQUIRED',backupId:first.backupId});
  const recovered = await rollbackBackup(readBackupManifest(first.backupId!), '2.0.0', {force:true});
  expect(recovered.backupId).toBe(first.backupId!);
  expect(readFileSync(fixture.file,'utf8')).toBe('original');
  expect(readState('1.0.0').activeOperation).toBeUndefined();
  expect(fixture.writes()).toBe(1);

  fixture.registry.get().verifyDeveloperTeamInstall = ()=>({valid:true,diagnostics:[]});
  const retried = await runUpgradeOrchestrator({...options,operationId:'after-explicit-recovery'});
  expect(retried.status).toBe('completed');
  expect(retried.finalState.activeOperation).toBeUndefined();
  expect(readFileSync(fixture.file,'utf8')).toBe('changed');
  expect(fixture.writes()).toBe(2);
});
