import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {startDaemon,resolveStatePaths,withIdleRunnerMutation,RunnerMutationDeferredError} from '@deck/session-host';
import {createDefaultAdapterRegistry} from './runner-adapters';
import {cleanupRoots} from './runner-cleanup-command';
import {reviewRunnerCleanup} from './runner-cleanup-doctor';
import {runRunnerSync} from './upgrade-command/runner-sync';
import {getDefaultDeckConfig} from '@deck/core';
const tree=(root:string):unknown=>readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>e.isDirectory()?[e.name,tree(join(root,e.name))]:[e.name,readFileSync(join(root,e.name),'utf8')]);
test('public filtered JSON planning has no installation/backup/admission effects while busy',()=>{
 const home=mkdtempSync(join(tmpdir(),'nrp-public-plan-')),roots=cleanupRoots({HOME:home});mkdirSync(roots.codex,{recursive:true});writeFileSync(join(roots.codex,'config.toml'),'[mcp_servers.serena]\ncommand="user"\n');const before=tree(home);
 const result=spawnSync(process.execPath,['run',join(import.meta.dir,'main.tsx'),'runner','cleanup','--plan','--runner','codex','--json'],{env:{HOME:home,PATH:process.env.PATH,BUN_RUNTIME_TRANSPILER_CACHE_PATH:"0"},encoding:'utf8',timeout:30000});
 expect(result.status).toBe(0);const report=JSON.parse(result.stdout);expect(report.plans).toHaveLength(1);expect(report.plans[0].entries[0].action).toBe('conditional-remove');expect(tree(home)).toEqual(before);
});
test('default CLI composition blocks all four runner writes, cleanup and rollback while daemon is active',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nrp-composition-')),oldState=process.env.XDG_STATE_HOME;
 process.env.XDG_STATE_HOME=join(home,'state');const paths=resolveStatePaths();
 const started=await startDaemon({paths,version:'test',anchorCommand:[process.execPath],recoverOnStart:false,createService:()=>({execute:async()=>({ok:true}),openLog:()=>undefined,hasRunningWork:()=>true})});
 if(!started.ok)throw Error('daemon');
 try{
  const registry=createDefaultAdapterRegistry({claude:{homeDir:home,dataRoot:join(home,'data/deck')},codex:{userHome:home,codexHome:join(home,'codex')},opencode:{developerTeamConfigDir:join(home,'opencode')},pi:{homeDirectory:home,env:{HOME:home,PI_CODING_AGENT_DIR:join(home,'pi')}}});
  for(const id of ['codex','claude','opencode','pi']){
   const adapter=registry.get(id);
   await expect(adapter.applyDeveloperTeamInstall({projectRoot:home,environmentId:`${id}-development` as never,plan:{files:[]}})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
   await expect(adapter.rollbackDeveloperTeamFiles({})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
   await expect(adapter.runAction({id:'nrp-admission',kind:'nrp-no-effect',title:'fixture'} as never,{projectRoot:home} as never)).rejects.toBeInstanceOf(RunnerMutationDeferredError);
   if(adapter.writeMcpConfig)await expect(adapter.writeMcpConfig({capabilityId:'nrp-no-effect'} as never)).rejects.toBeInstanceOf(RunnerMutationDeferredError);
   if(adapter.cleanupLegacyInstall)await expect(adapter.cleanupLegacyInstall(home,{deckConfig:getDefaultDeckConfig()})).rejects.toBeInstanceOf(RunnerMutationDeferredError);
  }
  const result=await runRunnerSync({config:getDefaultDeckConfig(),registry,projectRoot:home,deckVersion:'test'});
  expect(result.outcomes.map(x=>x.status)).toEqual(['deferred','deferred','deferred','deferred']);
 }finally{await started.daemon.stop('test');if(oldState===undefined)delete process.env.XDG_STATE_HOME;else process.env.XDG_STATE_HOME=oldState;}
});
test('doctor reports pending recovery and unresolved entries without creating installation state',async()=>{
 const home=mkdtempSync(join(tmpdir(),'nrp-doctor-')),roots=cleanupRoots({HOME:home}),state=resolveStatePaths({env:{HOME:home}});
 mkdirSync(join(roots.codex,'deck'),{recursive:true});writeFileSync(join(roots.codex,'config.toml'),'[mcp_servers.serena]\ncommand="user"\n');writeFileSync(join(roots.codex,'deck/manifest.json.pending'),'synthetic pending receipt');
 const before=tree(home),report=await reviewRunnerCleanup(roots,state);expect(report.status).toBe('error');expect(JSON.stringify(report)).toContain('individual reviews');expect(JSON.stringify(report)).toContain('pending contribution recovery');expect(tree(home)).toEqual(before);
});
test('reviewed update replaces a detected stale Claude generation through runner sync',async()=>{
 const {createClaudeRunnerAdapter}=await import('../../../packages/adapter-claude/src/runner-adapter');
 const {dirname,relative}=await import('node:path');
 const {claudeModelMetadata}=await import('../../../packages/adapter-claude/src/models');
 const home=mkdtempSync(join(tmpdir(),'nrp-claude-sync-')),data=join(home,'data/deck'),adapter=createClaudeRunnerAdapter({homeDir:home,dataRoot:data}),config=getDefaultDeckConfig();
 const input={projectRoot:home,environmentId:'claude-development' as never,deckConfig:config};
 const plan=adapter.buildDeveloperTeamInstallPlan(input),newRoot=dirname(dirname(plan.files[0]!.path)),oldRoot=join(data,'claude/developer-team-v1');
 for(const file of plan.files){const target=join(oldRoot,relative(newRoot,file.path));mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,file.content,{mode:0o600});}
 writeFileSync(join(data,'claude/model-assignments.json'),claudeModelMetadata({},[]),{mode:0o600});
 const oldAgent=join(oldRoot,'agents/deck-lead.md');writeFileSync(oldAgent,readFileSync(oldAgent,'utf8')+'\n# old release\n');
 const detected=await adapter.detectDeckInstall!({projectRoot:home});expect(detected.installed).toBe(false);expect(detected.replacementRequired).toBe(true);
 const roots=cleanupRoots({HOME:home,XDG_DATA_HOME:join(home,'data')});
 const sync=await runRunnerSync({config,registry:{list:()=>[adapter],has:()=>true,get:()=>adapter},projectRoot:home,deckVersion:'candidate',retirement:{roots},mutationAdmission:effect=>withIdleRunnerMutation(effect,{paths:resolveStatePaths({env:{HOME:home}})})});
 expect(sync.outcomes.map(outcome=>({status:outcome.status,diagnostics:outcome.diagnostics}))).toEqual([{status:'synced',diagnostics:expect.any(Array)}]);expect(readFileSync(oldAgent,'utf8')).toContain('# old release');expect((await adapter.detectDeckInstall!({projectRoot:home})).installed).toBe(true);
});
