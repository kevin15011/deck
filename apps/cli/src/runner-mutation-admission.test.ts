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

// Protects: equal-version peers repair receipt drift without ping-ponging on generator differences.
// Oracle: managed authority design decision 5; newer writers and pending evidence still veto repair.
test('managed drift reaches the production refresh fence without bypassing newer or pending writers', async () => {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-managed-fence-'))),path=join(root,'fence.json');
 const self={semver:'1.0.0',commit:'stable',channel:'stable' as const};
 let drift=true,writes=0;
 const raw={runnerId:'opencode',evaluateSessionAdmission:()=>({verdict:'admit',checks:[]}),
  readManagedContentDrift:()=>drift,
  prepareSessionNativeRole:async(_role:string,config?:unknown)=>{if(config){writes++;drift=false;}return {runnerId:'opencode',roleId:'deck-quality'};},
 } as unknown as RunnerAdapter;
 const guarded=guardRunnerAdapter(raw,async effect=>effect(),undefined,{path,self,stateSchema:1});
 try {
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:1,writer:{...self,commit:'peer',channel:'canary'}});
  await guarded.prepareSessionNativeRole!('deck-quality',{} as never);
  expect(writes).toBe(1);
  await guarded.prepareSessionNativeRole!('deck-quality',{} as never);expect(writes).toBe(1);
  drift=true;
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:2,writer:{...self,semver:'2.0.0'}});
  await guarded.prepareSessionNativeRole!('deck-quality',{} as never);expect(writes).toBe(1);
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:2,writer:self,pending:{epoch:3,writer:self,stateSchema:1}});
  await guarded.prepareSessionNativeRole!('deck-quality',{} as never);expect(writes).toBe(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

// Protects restart provenance and exclusion before any adapter recovery callback.
// Oracle: both committed and pending compatibility, plus the existing mutation
// lease, are prerequisites; a compatible pending writer cannot downgrade newer state.
for (const incompatible of ['version', 'schema', 'lease'] as const) test(`recovery preserves pending evidence when committed ${incompatible} prevents mutation`, async () => {
 const { acquireInstallationUse } = await import('../../../packages/core/src/installation-use');
 const { readRunnerFence } = await import('@deck/core');
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-recovery-precheck-'))), path = join(root, 'fence.json');
 const self = { semver: '1.0.0', commit: 'current', channel: 'stable' as const };
 const record = { fenceSchema: 1 as const, epoch: 1, stateSchema: incompatible === 'schema' ? 2 : 1,
  writer: { ...self, semver: incompatible === 'version' ? '2.0.0' : '1.0.0' },
  pending: { epoch: 2, stateSchema: 1, writer: self, journals: [{ kind: 'fixture', id: 'original', operationId: 'original' }] } };
 let recoveries = 0, writes = 0;
 const raw = { runnerId: 'codex', mutationRoot: root, evaluateSessionAdmission: () => ({ verdict: 'admit', checks: [] }),
  recoverPendingMutation: async () => { recoveries++; return 'preimage'; },
  applyDeveloperTeamInstall: async () => { writes++; return { changedCount: 1 }; },
 } as unknown as RunnerAdapter;
 writePrivateState(path, record);
 const use = incompatible === 'lease' ? acquireInstallationUse(root) : undefined;
 try {
  const guarded = guardRunnerAdapter(raw, async effect => effect(), undefined, { path, self, stateSchema: 1 });
  await expect(guarded.applyDeveloperTeamInstall({} as never)).rejects.toThrow();
  expect(recoveries).toBe(0);
  expect(writes).toBe(0);
  expect(readRunnerFence(path)).toEqual(record);
 } finally { use?.release(); rmSync(root, { recursive: true, force: true }); }
});

// Protects: invalid explicit project scope refuses before opening durable pending state.
// Oracle: scope must be independently resolvable before any fenced effect.
test('Pi missing project refuses before opening a fence', async () => {
 const { createPiRunnerAdapter } = await import('@deck/adapter-pi');
 const { getDefaultDeckConfig, readRunnerFence } = await import('@deck/core');
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'pi-project-preflight-'))), path = join(root, 'fence.json');
 try {
  const raw = createPiRunnerAdapter({ homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: join(root, 'agent') }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
  const adapter = guardRunnerAdapter(raw, async effect => effect(), undefined, { path, self: { semver: '0.14.0', commit: 'current', channel: 'stable' }, stateSchema: 1 });
  const input = { projectRoot: join(root, 'missing'), environmentId: 'pi-development', deckConfig: getDefaultDeckConfig() };
  await expect(adapter.applyDeveloperTeamInstall({ ...input, plan: adapter.buildDeveloperTeamInstallPlan(input) })).rejects.toThrow();
  expect(readRunnerFence(path)).toBeUndefined();
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects malformed/newer writer refusal before rollback callbacks or writes.
// Oracle: accepted recovery compatibility applies to committed and pending provenance.
for (const slot of ['committed', 'pending'] as const) for (const version of ['1.0.0+.', '9007199254740993.0.0', '2.0.0-beta.1+build.42']) test(`version precheck refuses ${slot} ${version}`, async () => {
 const { readFileSync } = await import('node:fs');
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-version-guard-'))), path = join(root, 'fence.json');
 const self = { semver: version.startsWith('900') ? '9007199254740992.0.0' : '1.0.0', commit: 'current', channel: 'stable' as const };
 let effects = 0;
 const raw = { runnerId: 'codex', recoverPendingMutation: async () => { effects++; return 'preimage'; }, applyDeveloperTeamInstall: async () => { effects++; return { changedCount: 1 }; } } as unknown as RunnerAdapter;
 try {
  writePrivateState(path, { fenceSchema: 1, epoch: 0, stateSchema: 1, writer: { ...self, semver: slot === 'committed' ? version : self.semver }, pending: { epoch: 1, stateSchema: 1, writer: { ...self, semver: slot === 'pending' ? version : self.semver } } });
  const before = readFileSync(path, 'utf8');
  await expect(guardRunnerAdapter(raw, async effect => effect(), undefined, { path, self, stateSchema: 1 }).applyDeveloperTeamInstall({} as never)).rejects.toThrow();
  expect(effects).toBe(0); expect(readFileSync(path, 'utf8')).toBe(before);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects valid same-release prerelease/build recovery through the public guard.
test('public recovery admits prerelease plus build metadata as a release peer', async () => {
 const { readRunnerFence } = await import('@deck/core');
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-version-peer-'))), path = join(root, 'fence.json');
 const self = { semver: '1.0.0', commit: 'current', channel: 'stable' as const }; let recoveries = 0, writes = 0;
 const raw = { runnerId: 'codex', recoverPendingMutation: async () => { recoveries++; return 'preimage'; }, applyDeveloperTeamInstall: async () => { writes++; return { changedCount: 1 }; } } as unknown as RunnerAdapter;
 try {
  const peer = { ...self, semver: '1.0.0-beta.1+build.42' };
  writePrivateState(path, { fenceSchema: 1, epoch: 0, stateSchema: 1, writer: peer, pending: { epoch: 1, stateSchema: 1, writer: peer } });
  await guardRunnerAdapter(raw, async effect => effect(), undefined, { path, self, stateSchema: 1 }).applyDeveloperTeamInstall({} as never);
  expect(recoveries).toBe(1); expect(writes).toBe(1); expect(readRunnerFence(path)).toMatchObject({ epoch: 1, writer: self });
 } finally { rmSync(root, { recursive: true, force: true }); }
});

// Protects the observed legacy empty-reference pending fence. Absence of journals
// cannot prove no effects; both install and rollback must preserve all evidence.
test('an incomplete operation without journal proof refuses install and rollback unchanged', async () => {
 const { readFileSync } = await import('node:fs');
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-empty-pending-'))),path=join(root,'fence.json');
 const self={semver:'1.0.0',commit:'abc',channel:'canary' as const};
 let effects=0;
 const raw={runnerId:'codex',mutationRoot:root,recoverPendingMutation:async()=>undefined,
  evaluateSessionAdmission:async()=>({verdict:'blocked',checks:[]}),
  applyDeveloperTeamInstall:async()=>{effects++;},rollbackDeveloperTeamFiles:async()=>{effects++;},
 } as unknown as RunnerAdapter;
 try {
  writePrivateState(path,{fenceSchema:1,stateSchema:1,epoch:4,writer:self,pending:{epoch:5,writer:self,stateSchema:1,journals:[]}});
  const before=readFileSync(path);
  const adapter=guardRunnerAdapter(raw,async effect=>effect(),undefined,{path,self,stateSchema:1});
  for(const effect of [()=>adapter.applyDeveloperTeamInstall({projectRoot:root} as never),()=>adapter.rollbackDeveloperTeamFiles({})]) {
   await expect(effect()).rejects.toMatchObject({code:'runner-write-not-applied',reason:'runner-write-recovery-required'});
   expect(readFileSync(path)).toEqual(before);
  }
  expect(effects).toBe(0);
 } finally {rmSync(root,{recursive:true,force:true});}
});

// Protects: explicit pending recovery vetoes role preparation after asynchronous admission.
// Oracle: MA-EXPLICIT-RECOVERY-ADMISSION-01 requires rejection before adapter effects,
// even when the initial legacy pending fence permits ordinary read-only preparation.
for (const outcome of ['reserved', 'deferred', 'installation-busy'] as const) test(`explicit recovery appearing during ${outcome} admission refuses role preparation`, async () => {
 const { RunnerMutationDeferredError } = await import('@deck/session-host');
 const { InstallationBusyError } = await import('../../../packages/core/src/installation-use');
 const { readRunnerFence } = await import('@deck/core');
 const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-recovery-admission-'))), path = join(root, 'fence.json');
 const self = { semver: '1.0.0', commit: 'current', channel: 'canary' as const };
 let preparations = 0;
 const raw = { runnerId: 'codex', mutationRoot: root, prepareSessionNativeRole: async () => {
  preparations++;
  return { runnerId: 'codex', roleId: 'deck-quality' };
 } } as unknown as RunnerAdapter;
 let enter!: () => void, resume!: () => void;
 const entered = new Promise<void>(resolve => { enter = resolve; });
 const resumed = new Promise<void>(resolve => { resume = resolve; });
 const guarded = guardRunnerAdapter(raw, async effect => {
  enter();
  await resumed;
  if (outcome === 'deferred') throw new RunnerMutationDeferredError();
  if (outcome === 'installation-busy') throw new InstallationBusyError();
  return effect();
 }, undefined, { path, self, stateSchema: 1 });
 try {
  writePrivateState(path, { fenceSchema: 1, stateSchema: 1, epoch: 4, writer: self,
   pending: { epoch: 5, writer: self, stateSchema: 1, journals: [] } });
  const preparing = guarded.prepareSessionNativeRole!('deck-quality');
  await entered;
  const pending = { fenceSchema: 1 as const, stateSchema: 1, epoch: 5, writer: self,
   pending: { epoch: 6, writer: self, stateSchema: 1, journals: [{ kind: 'canonical-recovery-v1', id: 'new', operationId: 'new' }] } };
  writePrivateState(path, pending);
  resume();
  await expect(preparing).rejects.toMatchObject({ code: 'runner-write-not-applied', reason: 'runner-write-recovery-required' });
  expect(preparations).toBe(0);
  expect(readRunnerFence(path)).toEqual(pending);
 } finally { resume(); rmSync(root, { recursive: true, force: true }); }
});
