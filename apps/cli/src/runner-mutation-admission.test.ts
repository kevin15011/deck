import { expect, test } from "bun:test";
import type { RunnerAdapter } from "@deck/core";
import { guardRunnerAdapter } from "./runner-mutation-admission";
// Protects: refresh is read-only follow-up to admitted effects, never an authority bypass.
test("install and reinstall refresh only after admitted success, and refresh failure preserves the install result", async () => {
 let installed = false;
 let refreshed = 0;
 const result = { results: [], changedCount: 1, unchangedCount: 0 };
 const adapter = { applyDeveloperTeamInstall: async () => { installed = true; return result; } } as unknown as RunnerAdapter;
 const denied = guardRunnerAdapter(adapter, async () => { throw new Error("busy"); }, async () => { refreshed++; });
 await expect(denied.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).rejects.toThrow("busy");
 expect(installed).toBe(false);
 expect(refreshed).toBe(0);
 const guarded = guardRunnerAdapter(adapter, async effect => effect(), async root => {
  expect(root).toBe("/project"); expect(installed).toBe(true); refreshed++;
 });
 expect(await guarded.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
 expect(await guarded.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
 expect(refreshed).toBe(2);
 const unavailable = guardRunnerAdapter(adapter, async effect => effect(), async () => { throw new Error("unavailable"); });
 expect(await unavailable.applyDeveloperTeamInstall({ projectRoot: "/project" } as never)).toBe(result);
});

// Protects active invocation bytes: a busy daemon cannot authorize refresh writes.
test("Codex preparation defers writes while active and exposes the preservation warning", async () => {
 const { RunnerMutationDeferredError } = await import('@deck/session-host');
 let writes = 0;
 const adapter = { runnerId: 'codex', prepareSessionNativeRole: async (_role: string, config?: unknown) => {
  if (config) writes++;
  return { runnerId: 'codex', roleId: 'deck-quality', preparation: [] };
 } } as unknown as RunnerAdapter;
 const guarded = guardRunnerAdapter(adapter, async () => { throw new RunnerMutationDeferredError(); });
 const role = await guarded.prepareSessionNativeRole!('deck-quality', {} as never);
 expect(writes).toBe(0);
 expect(role.preparation?.some(item => item.code === 'codex-refresh-deferred')).toBe(true);
});

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writePrivateState } from '@deck/core';
// Oracle: production guard fences every selected write but preserves compatible read-only work.
test('older installs are explicitly not applied and same-semver preparation never rewrites admitted state', async () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-guard-fence-'))),path=join(root,'fence.json');
 let writes=0;
 const self={semver:'1.0.0',commit:'old',channel:'stable' as const};
 const raw={runnerId:'codex',evaluateSessionAdmission:async()=>({verdict:'admit',checks:[]}),applyDeveloperTeamInstall:async()=>{writes++;return {changedCount:1};},prepareSessionNativeRole:async(_role:string,config?:unknown)=>{if(config)writes++;return {runnerId:'codex',roleId:'deck-lead',preparation:[]};}} as unknown as RunnerAdapter;
 try {
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:1,writer:{...self,semver:'2.0.0'}});
  const guarded=guardRunnerAdapter(raw,async effect=>effect(),undefined,{path,self,stateSchema:1});
  await expect(guarded.applyDeveloperTeamInstall({} as never)).rejects.toThrow('not applied: managed-by-newer-deck');
  await guarded.prepareSessionNativeRole!('deck-lead',{} as never);
  expect(writes).toBe(0);
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:1,writer:{...self,channel:'canary',commit:'new'}});
  for(let i=0;i<4;i++)await guarded.prepareSessionNativeRole!('deck-lead',{} as never);
  expect(writes).toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Protects: native contention before managed effects leaves no unrecoverable fence.
// Oracle: a real use lease refuses a real adapter install, then releasing it permits the same plan.
// Fails if: contention leaves pending evidence or a retry stays recovery-blocked.
test('native lease contention permits a later guarded production install', async () => {
 const {createCodexRunnerAdapter}=await import('@deck/adapter-codex');
 const {getDefaultDeckConfig,readRunnerFence}=await import('@deck/core');
 const {acquireInstallationUse}=await import('../../../packages/core/src/installation-use');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-guard-native-'))),codexHome=join(root,'codex'),path=join(root,'fence.json');
 const adapter=createCodexRunnerAdapter({userHome:root,codexHome,journalRoot:join(root,'journals'),tools:{homeDir:root,dataRoot:join(root,'deck'),resolveCommand:()=>undefined,nodeCommand:process.execPath,verifyNodeRuntime:()=>true}});
 const guarded=guardRunnerAdapter(adapter,async effect=>effect(),undefined,{path,self:{semver:'1.0.0',commit:'abc',channel:'stable'},stateSchema:1});
 const input={projectRoot:root,environmentId:'codex-development' as const,deckConfig:getDefaultDeckConfig(),standaloneSkills:[]};
 const plan=guarded.buildDeveloperTeamInstallPlan(input),use=acquireInstallationUse(codexHome);
 try {
  await expect(guarded.applyDeveloperTeamInstall({...input,plan})).rejects.toMatchObject({code:'runner-installation-in-use'});
  expect(readRunnerFence(path)).toBeUndefined();
  use.release();
  expect((await guarded.applyDeveloperTeamInstall({...input,plan})).changedCount).toBeGreaterThan(0);
  expect(readRunnerFence(path)).toMatchObject({epoch:1});
  const next=guardRunnerAdapter(adapter,async effect=>effect(),undefined,{path,self:{semver:'2.0.0',commit:'def',channel:'stable'},stateSchema:1});
  const busy=acquireInstallationUse(codexHome);
  try {
   const role=await next.prepareSessionNativeRole!('deck-quality',input.deckConfig);
   expect(role.preparation?.some(f=>f.code==='codex-refresh-deferred')).toBe(true);
   expect(readRunnerFence(path)).toMatchObject({epoch:1});
   expect((readRunnerFence(path) as {pending?:unknown}).pending).toBeUndefined();
  }finally{busy.release();}
 }finally{use.release();rmSync(root,{recursive:true,force:true});}
},15000);

// Protects: the real guard cannot promote a fence or settle while admitted nested effects remain.
// Oracle: RIR-03 orders descendant completion before fence promotion/settlement and lease release.
// Fails if: success advances early, rejection settles early, or native readers/writers enter early.
for (const operation of ['install', 'prepare'] as const) for (const rejects of [false, true]) test(`guard drains nested ${operation} effects before ${rejects ? 'rejection' : 'promotion'}`, async () => {
 const {withInstallationMutation,acquireInstallationUse}=await import('../../../packages/core/src/installation-use');
 const {readRunnerFence}=await import('@deck/core');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-guard-drain-'))),path=join(root,'fence.json');
 let release!:()=>void,enter!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{enter=resolve;});
 const failure=new Error('guarded parent failed');
 let finished=false,settled=false,generation=0;
 const effect=async()=>{
  const child=withInstallationMutation(root,async()=>{enter();await gate;finished=true;generation++;});
  if(rejects)await Promise.all([child,Promise.reject(failure)]);
  return {changedCount:1,runnerId:'codex',roleId:'deck-quality',preparation:[]};
 };
 const adapter={runnerId:'codex',mutationRoot:root,readPreparationGeneration:()=>generation,evaluateSessionAdmission:async()=>({verdict:'blocked',checks:[]}),applyDeveloperTeamInstall:effect,prepareSessionNativeRole:effect} as unknown as RunnerAdapter;
 const guarded=guardRunnerAdapter(adapter,async effect=>effect(),undefined,{path,self:{semver:'1.0.0',commit:'abc',channel:'stable'},stateSchema:1});
 const running=operation==='install'?guarded.applyDeveloperTeamInstall({} as never):guarded.prepareSessionNativeRole!('deck-quality',{} as never);
 const outcome=running.then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
 try {
  await entered;
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(settled).toBe(false);
  expect(finished).toBe(false);
  expect(readRunnerFence(path)).toMatchObject({epoch:0,pending:{epoch:1}});
  expect(()=>acquireInstallationUse(root)).toThrow('refresh deferred');
  await expect(withInstallationMutation(root,async()=>{})).rejects.toThrow('refresh deferred');
  release();
  const result=await outcome;
  expect(finished).toBe(true);
  if(rejects){expect(result).toEqual({error:failure});expect(readRunnerFence(path)).toMatchObject({epoch:0,pending:{epoch:1}});}
  else {expect(result).toHaveProperty('value');expect(readRunnerFence(path)).toMatchObject({epoch:1});expect((readRunnerFence(path) as {pending?:unknown}).pending).toBeUndefined();}
  const use=acquireInstallationUse(root);use.release();
 }finally{release();await outcome;rmSync(root,{recursive:true,force:true});}
});
