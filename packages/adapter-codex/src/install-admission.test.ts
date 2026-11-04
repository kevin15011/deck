import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDefaultDeckConfig } from '@deck/core';
import { createCodexRunnerAdapter } from './runner-adapter';
// Oracle: install and preparation agree on preserved, customized executable hooks.
test('install verification refuses a preserved foreign hook without issuing its receipt', async () => {
 const home = realpathSync(mkdtempSync('/tmp/deck-install-admission-'));
 try {
  const adapter = createCodexRunnerAdapter({ userHome: home, codexHome: join(home, '.codex'), journalRoot: join(home, 'journals'), tools: { homeDir:home, dataRoot:join(home,'deck'), resolveCommand:()=>undefined, nodeCommand:process.execPath, verifyNodeRuntime:()=>true } });
  const input = { projectRoot: home, environmentId:'codex-development' as const, deckConfig:getDefaultDeckConfig() };
  const materialize = (plan: ReturnType<typeof adapter.buildDeveloperTeamInstallPlan>) => { for(const file of plan.files) {const path=join(home,file.path); mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,file.content,{mode:0o644});} };
  materialize(adapter.buildDeveloperTeamInstallPlan(input));
  const path=join(home,'.codex/config.toml');
  writeFileSync(path,readFileSync(path,'utf8').replace('deck internal codex-memory-hook','custom-command'));
  const plan=adapter.buildDeveloperTeamInstallPlan(input);
  materialize(plan);
  const verified=await adapter.verifyDeveloperTeamInstall(plan);
  expect(verified.valid).toBe(false);
  expect(verified.admission?.verdict).toBe('blocked');
  expect(verified.admission?.checks[0]?.id).toBe('hook-not-in-manifest:memory-bridge');
  expect(await adapter.evaluateSessionAdmission!({config:input.deckConfig})).toEqual(verified.admission!);
 } finally {rmSync(home,{recursive:true,force:true});}
});

import { withRunnerFence, readRunnerFence, recoverRunnerFence } from '@deck/core';
// Oracle: restart recovery proves actual adapter journal postimages, never just an admission success.
test('pending fence recovers a completed installation from its exact existing transaction journals', async () => {
 const home=realpathSync(mkdtempSync('/tmp/deck-journal-fence-'));
 try {
  const adapter=createCodexRunnerAdapter({userHome:home,codexHome:join(home,'codex'),journalRoot:join(home,'journals'),tools:{homeDir:home,dataRoot:join(home,'deck'),nodeCommand:process.execPath,verifyNodeRuntime:()=>true,resolveCommand:()=>undefined}});
  const input={projectRoot:home,environmentId:'codex-development' as const,deckConfig:getDefaultDeckConfig(),standaloneSkills:[]};
  const plan=adapter.buildDeveloperTeamInstallPlan(input),path=join(home,'state','fence.json');
  await expect(withRunnerFence({path,self:{semver:'1.0.0',commit:'abc',channel:'stable'},stateSchema:1,effect:async()=>{await adapter.applyDeveloperTeamInstall({...input,plan});throw Error('crash-before-fence-promotion');},changed:()=>true})).rejects.toThrow('crash-before-fence-promotion');
  expect(readRunnerFence(path)).toMatchObject({epoch:0,pending:{epoch:1}});
  expect(await recoverRunnerFence(path,pending=>adapter.recoverPendingMutation!(pending.journals!))).toBe(true);
  expect(readRunnerFence(path)).toMatchObject({epoch:1});
  expect((await adapter.evaluateSessionAdmission!()).verdict).not.toBe('blocked');
 }finally{rmSync(home,{recursive:true,force:true});}
},15000);

// Protects: selecting Supermemory cannot report install/admission success without its local launch artifacts.
// Oracle: an otherwise valid default installation lacks the selected plugin, hooks and hosted proxy.
// Fails if: selection is admitted or its reviewed plan is unblocked before those artifacts exist.
test('selected Supermemory requires local plugin, runtime, hooks and official proxy',async()=>{
 const home=realpathSync(mkdtempSync('/tmp/deck-supermemory-admission-'));
 try{
  const adapter=createCodexRunnerAdapter({userHome:home,codexHome:join(home,'codex'),journalRoot:join(home,'journals'),tools:{homeDir:home,dataRoot:join(home,'deck'),resolveCommand:()=>undefined,nodeCommand:process.execPath,verifyNodeRuntime:()=>true}});
  const config=getDefaultDeckConfig(),input={projectRoot:home,environmentId:'codex-development' as const,deckConfig:config,standaloneSkills:[]};
  const initial=adapter.buildDeveloperTeamInstallPlan(input);
  await adapter.applyDeveloperTeamInstall({...input,plan:initial});
  expect((await adapter.evaluateSessionAdmission!({config})).verdict).not.toBe('blocked');
  config.adaptiveMemory={...config.adaptiveMemory,enabled:true,activeProvider:'supermemory'};
  const admission=await adapter.evaluateSessionAdmission!({config});
  expect(admission.verdict).toBe('blocked');
  for(const id of ['supermemory-plugin-unavailable','supermemory-hooks-missing','supermemory-proxy-unconfigured'])expect(admission.checks).toContainEqual(expect.objectContaining({id,required:true,status:'fail'}));
  const plan=adapter.buildDeveloperTeamInstallPlan({...input,deckConfig:config});
  expect(plan.blocked).toBe(true);
 }finally{rmSync(home,{recursive:true,force:true});}
},15000);

// Protects: all local launch requirements remain identical across install verification, admission and launch.
// Oracle: a pinned fixture artifact and canonical plan admit; removing each local prerequisite blocks all consumers.
// Fails if: a missing Node, hook or hosted proxy is treated as optional, or a healthy selection cannot launch.
test('installed selected Supermemory shares launch checks and admits only complete local artifacts',async()=>{
 const {createHash}=await import('node:crypto');
 const {createCodexTools}=await import('./tools');
 const {inspectCodexSupermemoryReadiness}=await import('./supermemory-readiness');
 const {CODEX_SUPERMEMORY_ROOT_NAME}=await import('./supermemory-artifact');
 const {assertCodexSupermemoryReady}=await import('../../../apps/cli/src/codex-supermemory-launch');
 const {unlinkSync}=await import('node:fs');
 const home=realpathSync(mkdtempSync('/tmp/deck-supermemory-complete-'));
 try{
  const codexHome=join(home,'codex'),dataRoot=join(home,'deck'),root=join(dataRoot,'codex/tools',CODEX_SUPERMEMORY_ROOT_NAME);
  mkdirSync(root,{recursive:true,mode:0o700});
  const manifest=['recall.js','flush.js','mcp-proxy.js'].map(name=>{writeFileSync(join(root,name),name,{mode:0o600});return [name,name,createHash('sha256').update(name).digest('hex'),name.length] as const;});
  const tools={homeDir:home,dataRoot,resolveCommand:()=>undefined,nodeCommand:process.execPath,verifyNodeRuntime:()=>true,supermemoryManifest:manifest};
  const adapter=createCodexRunnerAdapter({userHome:home,codexHome,journalRoot:join(home,'journals'),tools});
  const config=getDefaultDeckConfig();config.adaptiveMemory={...config.adaptiveMemory,enabled:true,activeProvider:'supermemory'};
  const input={projectRoot:home,environmentId:'codex-development' as const,deckConfig:config,standaloneSkills:[]};
  const plan=adapter.buildDeveloperTeamInstallPlan(input);expect(plan.blocked).toBe(false);
  await adapter.applyDeveloperTeamInstall({...input,plan});
  expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(true);
  const path=join(codexHome,'config.toml'),source=readFileSync(path,'utf8');
  // Use a distinct project root: global CODEX_HOME is not a project config.
  const project=join(home,'project');mkdirSync(project);
  expect(()=>assertCodexSupermemoryReady(project,{home,codexHome,tools})).not.toThrow();
  for(const [id,changed]of [
   ['supermemory-hooks-missing',source.replace(/^# deck-codex-hook:supermemory:start$[\s\S]*?^# deck-codex-hook:supermemory:end$/m,'')],
   ['supermemory-proxy-unconfigured',source.replace('mcp-proxy.js','custom-proxy.js')],
  ]){
   writeFileSync(path,changed!);
   const admission=await adapter.evaluateSessionAdmission!({config});
   expect(admission.checks).toContainEqual(expect.objectContaining({id,required:true,status:'fail'}));
   expect((await adapter.verifyDeveloperTeamInstall(plan)).valid).toBe(false);
   expect(()=>assertCodexSupermemoryReady(project,{home,codexHome,tools})).toThrow();
  }
  writeFileSync(path,source);
  const noNode=createCodexTools({...tools,nodeCommand:undefined,verifyNodeRuntime:()=>false});
  expect(inspectCodexSupermemoryReadiness(source,noNode)).toContainEqual(expect.objectContaining({id:'supermemory-node-unavailable',required:true,status:'fail'}));
  unlinkSync(join(root,'recall.js'));
  expect((await adapter.evaluateSessionAdmission!({config})).checks).toContainEqual(expect.objectContaining({id:'supermemory-plugin-unavailable',required:true,status:'fail'}));
 }finally{rmSync(home,{recursive:true,force:true});}
},15000);
