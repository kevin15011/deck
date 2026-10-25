// Runs in a separate process: every adapter, state store and public CLI sees only this HOME.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import type { RunnerAdapter } from '@deck/core';

const runner = process.argv[2]!;
const scenario = process.argv[3] ?? 'clean';
const home = mkdtempSync(join(tmpdir(), `nrp-composition-${runner}-`));
Object.assign(process.env, { HOME: home, XDG_STATE_HOME: join(home,'state'), XDG_CONFIG_HOME: join(home,'config'), XDG_CACHE_HOME: join(home,'cache'), XDG_DATA_HOME: join(home,'data') });
process.chdir(home);
const { _resetDeckPathCache } = await import('../../runtime/paths'); _resetDeckPathCache();
const { getDefaultDeckConfig, recordOwnedRunnerArtifactTree, readContribution, contributionHash } = await import('@deck/core');
const { runUpgradeOrchestrator } = await import('../orchestrator');
const { readBackupManifest } = await import('../backup-store');
const { readState, writeState, setActiveOperation } = await import('../state-store');
const { readManifest, writeManifest, upsertManifestFile, buildDefaultManifest, getManifestPath, detectManifestDrift } = await import('../manifest-store');
const { checkManifest } = await import('../../doctor-command/doctor-checks');
const config = getDefaultDeckConfig();
let adapter: RunnerAdapter, target: string, receipt: string;
try {
  if (runner === 'opencode') {
    const { createOpenCodeRunnerAdapter } = await import('@deck/adapter-opencode');
    const root = join(home,'config/opencode'); adapter = createOpenCodeRunnerAdapter({developerTeamConfigDir:root});
    target = join(root,'prompts/deck-team/deck-lead.md'); receipt = join(root,'deck/manifest.json');
  } else if (runner === 'codex') {
    const { createCodexRunnerAdapter } = await import('@deck/adapter-codex');
    const { testTools } = await import('../../../../../packages/adapter-codex/src/test-tools');
    const root = join(home,'install'); mkdirSync(root);
    adapter = createCodexRunnerAdapter({tools:testTools({homeDir:home,dataRoot:join(home,'data/deck')}),codexHome:join(root,'.codex'),userHome:root,journalRoot:join(home,'journals')});
    target = join(root,'.codex/agents/deck-lead.toml'); receipt = join(root,'.codex/deck/manifest.json');
  } else if (runner === 'pi') {
    const { createPiRunnerAdapter } = await import('@deck/adapter-pi');
    adapter = createPiRunnerAdapter({homeDirectory:home,env:{},piVersionProbe:()=>({exitCode:0,stdout:'1.0.0'})});
    target = join(home,'.pi/agent/deck/profiles/developer-team/system-prompt.md'); receipt = join(home,'.pi/agent/deck/manifest.json');
  } else {
    const { createClaudeRunnerAdapter } = await import('../../../../../packages/adapter-claude/src/runner-adapter');
    adapter = createClaudeRunnerAdapter({homeDir:home,dataRoot:join(home,'data/deck'),resolveCommand:()=>process.execPath,verifyExistingCodebase:()=>true});
    config.capabilities!['codebase-memory'].enabled = true;
    target = join(home,'data/deck/claude/model-assignments.json'); receipt = join(home,'data/deck/claude/manifest.json');
  }
  const input = {projectRoot:home,environmentId:adapter.environmentIds[0]!,deckConfig:config};
  const initial = adapter.buildDeveloperTeamInstallPlan({...input,...(runner === 'claude' ? {capabilityIds:['codebase-memory']} : {})});
  assert(!initial.blocked, initial.diagnostics?.join('\n'));
  await adapter.applyDeveloperTeamInstall({...input,plan:initial});
  assert((await adapter.verifyDeveloperTeamInstall(initial)).valid);
  if (runner === 'codex') {
    // Simulate a previous owned release using its actual legacy manifest format.
    const text = readFileSync(target,'utf8')+'\n# previous release\n'; writeFileSync(target,text);
    const value = JSON.parse(readFileSync(receipt,'utf8')), hash = createHash('sha256').update(text).digest('hex');
    value.files['.codex/agents/deck-lead.toml'] = hash;
    for (const entry of value.contributions ?? []) if (entry.path === target) entry.hash = hash;
    writeFileSync(receipt,JSON.stringify(value,null,2)+'\n');
  }
  // An independent contribution present before update must survive both apply and recovery.
  const unrelated = join(home,'independent-tool'); writeFileSync(unrelated,'independent contribution');
  recordOwnedRunnerArtifactTree({runnerId:runner,root:join(receipt,'../..'),manifestPath:receipt,artifactRoot:unrelated,sourceItemId:'package:fixture'});
  if (scenario === 'unrecorded-receipt' || (runner === 'claude' && scenario === 'legacy-inventory')) rmSync(receipt);
  let inventoryBefore = upsertManifestFile(buildDefaultManifest('1.0.0'),{path:unrelated,owner:'deck',deck_version:'1.0.0',kind:'content'},'1.0.0');
  if (existsSync(receipt)) inventoryBefore = upsertManifestFile(inventoryBefore,{path:receipt,owner:`runner:${runner}`,deck_version:'1.0.0',kind:'state'},'1.0.0');
  writeManifest(inventoryBefore);
  const legacy = join(home,'config/opencode/agents/deck-developer-orchestrator.md');
  if (scenario === 'legacy') { mkdirSync(join(legacy,'..'),{recursive:true}); writeFileSync(legacy,'previous active Deck role'); }
  const before = readFileSync(target,'utf8'), beforeReceipt = existsSync(receipt) ? readFileSync(receipt,'utf8') : null;
  const previous = structuredClone(config);
  config.orchestratorPersonality = 'guia';
  config.capabilities!['codebase-memory'].enabled = false;
  const selected = scenario === 'apply-failure' ? new Proxy(adapter,{get(target,key) {
    if (key === 'applyDeveloperTeamInstall') return async (input: Parameters<RunnerAdapter['applyDeveloperTeamInstall']>[0])=>{await target.applyDeveloperTeamInstall(input);throw Error('fixture failure after actual adapter writes');};
    const value = Reflect.get(target,key); return typeof value === 'function' ? value.bind(target) : value;
  }}) : adapter;
  const result = await runUpgradeOrchestrator({currentVersion:'1.0.0',targetVersion:'2.0.0',descriptor:{schemaVersion:1,version:'2.0.0',tag_name:'v2.0.0',channel:'stable',published_at:new Date().toISOString(),items:[{id:'content',kind:'content',required:true,asset_name:'content.json',sha256:'a'.repeat(64),url:'https://example.invalid/content',content_kinds:['skills'],notes:''}]},deps:{installKind:'development',currentBinaryPath:join(home,'unused'),projectRoot:home,readGlobalDeckConfig:()=>config,adapterRegistry:{list:()=>[selected],has:()=>true,get:()=>selected}}});
  assert.equal(result.status,scenario === 'apply-failure' ? 'partial_failure' : 'completed',JSON.stringify(result.content));
  if (scenario === 'apply-failure') assert.match(result.content.outcomes![0]!.diagnostics.join(' '),/fixture failure after actual adapter writes/);
  else assert.notEqual(readFileSync(target,'utf8'),before,'fixture must exercise an actual content/selection change');
  if (scenario === 'legacy') assert(!existsSync(legacy),'update must retire the fixture legacy active path');
  const backup = readBackupManifest(result.backupId!);
  if (scenario === 'legacy-inventory') {
    delete backup.inventoryChanges;
    writeFileSync(join(home,'cache/deck/backups',result.backupId!,'backup-manifest.json'),JSON.stringify(backup,null,2)+'\n');
  }
  // Central inventory additions made after the upgrade are not part of recovery.
  const laterFile = join(home,'later-tool'); writeFileSync(laterFile,'later contribution');
  const inventoryAfter = upsertManifestFile(readManifest('2.0.0'),{path:laterFile,owner:'runner:other',deck_version:'3.0.0',kind:'state'},'3.0.0');
  const laterEntry = inventoryAfter.files.find(e=>e.path === laterFile)!;
  if (scenario === 'inventory-drift') {
    inventoryAfter.files.find(e=>e.path === receipt)!.sourceItemId = 'later inventory edit';
    writeState(setActiveOperation(readState('2'),{id:'fixture-recovery',version:'2',phase:'verify',backupId:result.backupId!,startedAt:new Date().toISOString()}));
  }
  writeManifest(inventoryAfter);
  if (scenario === 'drift' || scenario === 'receipt-drift') {
    writeState(setActiveOperation(readState('2'),{id:'fixture-recovery',version:'2',phase:'verify',backupId:result.backupId!,startedAt:new Date().toISOString()}));
    if (scenario === 'drift') writeFileSync(target,'later user edit');
    else recordOwnedRunnerArtifactTree({runnerId:runner,root:join(receipt,'../..'),manifestPath:receipt,artifactRoot:unrelated,sourceItemId:'package:later-contribution'});
  }
  const receiptBeforeRollback = readFileSync(receipt,'utf8');
  const recoveryCwd = join(home,'another-project'); mkdirSync(recoveryCwd);
  const rollback = async () => {
    const child = Bun.spawn([process.execPath,'run',join(import.meta.dir,'../../main.tsx'),'rollback','--backup',result.backupId!,'--force'],{env:{...process.env},cwd:recoveryCwd,stdout:'pipe',stderr:'pipe'});
    const [exit,stdout,stderr] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
    return {exit,stdout,stderr};
  };
  if (scenario === 'inventory-failure') {
    writeState(setActiveOperation(readState('2'),{id:'fixture-recovery',version:'2',phase:'verify',backupId:result.backupId!,startedAt:new Date().toISOString()}));
    // Make inventory unreadable; physical recovery must survive this failure.
    renameSync(getManifestPath(),getManifestPath()+'.saved');
    mkdirSync(getManifestPath());
    const failed = await rollback();
    assert.equal(failed.exit,1,failed.stdout);
    assert.equal(readFileSync(receipt,'utf8'),beforeReceipt);
    assert.equal(readState('2').activeOperation?.backupId,result.backupId);
    rmSync(getManifestPath(),{recursive:true});
    renameSync(getManifestPath()+'.saved',getManifestPath());
  }
  const {exit,stdout,stderr} = await rollback();
  if (scenario === 'inventory-drift') {
    assert.equal(exit,1,'later inventory edit must block recovery finalization');
    assert.match(stderr,/inventory/i);
    assert.deepEqual(readManifest('2').files,inventoryAfter.files);
    assert.equal(readState('2').activeOperation?.backupId,result.backupId);
    console.log(JSON.stringify({runner,scenario,exit,recoveryRetained:true}));
  } else if (scenario === 'drift' || scenario === 'receipt-drift') {
    assert.equal(exit,1,'drift must refuse public rollback');
    assert.match(stderr,/postimage/);
    if (scenario === 'drift') assert.equal(readFileSync(target,'utf8'),'later user edit');
    else assert.equal(readFileSync(receipt,'utf8'),receiptBeforeRollback,'later unrelated receipts must be preserved');
    assert.equal(readFileSync(unrelated,'utf8'),'independent contribution');
    assert.equal(readState('1').activeOperation?.backupId,result.backupId);
    assert(existsSync(join(home,'cache/deck/backups',result.backupId!)));
    console.log(JSON.stringify({runner,scenario,exit,recoveryRetained:true}));
  } else {
    assert.equal(exit,0,stderr);
    if (scenario === 'legacy') assert.equal(readFileSync(legacy,'utf8'),'previous active Deck role');
    assert.equal(readFileSync(target,'utf8'),before,'actual target must be restored');
    assert.equal(existsSync(receipt) ? readFileSync(receipt,'utf8') : null,beforeReceipt,'ownership receipts must match restored content');
    assert(backup.entries.some(e=>e.sourcePath === target),'physical target missing from backup');
    assert(backup.entries.some(e=>e.sourcePath === receipt),'ownership receipt missing from backup');
    assert.equal(readFileSync(unrelated,'utf8'),'independent contribution');
    assert.equal(readState('1').activeOperation,undefined);
    const inventory = readManifest('1.0.0');
    assert.deepEqual(inventory.files.find(e=>e.path === unrelated),inventoryBefore.files[0],'prior unrelated inventory must be exact');
    assert.deepEqual(inventory.files.find(e=>e.path === laterFile),laterEntry,'later unrelated inventory must be exact');
    assert.deepEqual(detectManifestDrift(inventory).changed,[]);
    assert.deepEqual(detectManifestDrift(inventory).missing,[]);
    assert.equal(checkManifest().status,'ok',JSON.stringify(checkManifest()));
    if (scenario === 'clean') {
      writeFileSync(laterFile,'later user edit');
      assert.deepEqual(detectManifestDrift(readManifest('1')).changed.map(e=>e.path),[laterFile]);
      assert.equal(checkManifest().status,'warning','unrelated real drift must remain visible to doctor');
    }
    if (scenario === 'inventory-failure') {
      const recovered = readFileSync(getManifestPath(),'utf8');
      const repeated = await rollback();
      assert.equal(repeated.exit,0,repeated.stderr);
      assert.match(repeated.stdout,/restored 0, deleted 0/);
      assert.equal(readFileSync(getManifestPath(),'utf8'),recovered,'retry must not repeat reconciled inventory writes');
    }
    for (const entry of (existsSync(receipt) ? JSON.parse(readFileSync(receipt,'utf8')).contributions : []) ?? []) {
      const content = readContribution(entry); assert.notEqual(content,undefined,`missing contribution ${entry.path}`);
      assert.equal(contributionHash(content!),entry.hash,`stale receipt ${entry.path}`);
    }
    const next = adapter.buildDeveloperTeamInstallPlan({...input,deckConfig:previous,materializationScope:'content-only'});
    assert(!next.blocked,next.diagnostics?.join('\n'));
    if (runner === 'claude') {
      const launch = await adapter.buildLaunchPlan!({projectRoot:home,teamId:'developer-team',mode:'interactive',deckConfig:previous});
      assert.equal(launch.status,'ready',JSON.stringify(launch.diagnostics));
    }
    console.log(JSON.stringify({runner,backupEntries:backup.entries.length,rollback:stdout.trim(),replanBlocked:next.blocked ?? false}));
  }
} finally { rmSync(home,{recursive:true,force:true}); }
