import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runRunnerCleanupUpdate,cleanupRoots} from './runner-cleanup-command';
import {RunnerMutationDeferredError} from '@deck/session-host';
const fixture=()=>{const home=mkdtempSync(join(tmpdir(),'nrp-update-')),roots=cleanupRoots({HOME:home});mkdirSync(roots.codex,{recursive:true});mkdirSync(join(roots.codex,'deck'),{recursive:true});writeFileSync(join(roots.codex,'config.toml'),'[mcp_servers.serena]\ncommand="user-serena"\n[mcp_servers.context-mode]\ncommand="user-context"\n');writeFileSync(join(roots.codex,'deck/old-serena'),'owned');return roots;};
const idle = async <T>(effect:()=>T|Promise<T>)=>effect();
test('unattended update preserves ambiguity; default, EOF and cancellation never consent',async()=>{
 for(const ask of [undefined,async()=>'',async()=>{throw Error('EOF');}]){
 const roots=fixture(),before=readFileSync(join(roots.codex,'config.toml'),'utf8');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask});
 expect(readFileSync(join(roots.codex,'config.toml'),'utf8')).toBe(before);
 expect(outcome[0]?.status).toBe('review-required');expect(outcome[0]?.remaining).toBe(2);
 }
});
test('interactive review is individual and re-plans sibling preimages after each choice',async()=>{
 const roots=fixture(),questions:string[]=[];
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async q=>{questions.push(q);return 'remove';}});
 expect(questions).toHaveLength(2);expect(questions[0]).toContain('Preimage');expect(questions.join(' ')).toContain('serena');expect(questions.join(' ')).toContain('context-mode');
 expect(outcome[0]?.status).toBe('complete');expect(readFileSync(join(roots.codex,'config.toml'),'utf8')).not.toContain('mcp_servers');
 expect(existsSync(join(roots.codex,'deck/backups'))).toBe(true);
});
test('busy/unknown update defers without writes or backups and retry uses a fresh preimage',async()=>{
 const roots=fixture(),path=join(roots.codex,'config.toml'),before=readFileSync(path,'utf8');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:async()=>{throw new RunnerMutationDeferredError();},ask:async()=> 'remove'});
 expect(outcome[0]?.status).toBe('deferred');expect(readFileSync(path,'utf8')).toBe(before);expect(existsSync(join(roots.codex,'deck/backups'))).toBe(false);
 writeFileSync(path,before+'[user]\nvalue="user addition"\n');
 const retry=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async()=> 'remove'});
 expect(retry[0]?.status).toBe('complete');expect(readFileSync(path,'utf8')).toContain('user addition');
});
test('a change after display cannot inherit approval',async()=>{
 const roots=fixture(),path=join(roots.codex,'config.toml');
 const outcome=await runRunnerCleanupUpdate(roots,['codex'],{admission:idle,ask:async()=>{writeFileSync(path,readFileSync(path,'utf8')+'# changed\n');return 'remove';}});
 expect(outcome[0]?.status).toBe('recovery-required');expect(readFileSync(path,'utf8')).toContain('mcp_servers.serena');
});

// Protects default CLI composition: receipt-only retired files are reachable,
// but admission, modified preimages and continuing capabilities still win.
test('default cleanup removes receipted retired artifacts and preserves customized and unrelated files', async () => {
 const {contributionHash, contributionId} = await import('@deck/core');
 const roots=cleanupRoots({HOME:mkdtempSync(join(tmpdir(),'deck-cleanup-retired-'))});
 mkdirSync(join(roots.home,'.config/deck'),{recursive:true});
 writeFileSync(join(roots.home,'.config/deck/config.json'),JSON.stringify({capabilities:{'codebase-memory':{enabled:true}}}));
 const fixtures=[];
 for(const runnerId of ['codex','claude','opencode','pi'] as const){
  const root=runnerId==='claude'?join(roots.data,'claude'):roots[runnerId];
  const directory=join(root,'deck');mkdirSync(directory,{recursive:true});
  const contributions=[];
  const removed:string[]=[],kept:string[]=[];
  for(const capability of ['supermemory','deck-memory','adaptive-memory','rtk','codebase-memory','unknown']){
   for(const prefix of ['package','capability']){
    const path=join(directory,`${prefix}-${capability}.txt`);
    writeFileSync(path,'recorded bytes');
    const target={path,selector:{kind:'file' as const},sourceItemId:`${prefix}:${capability}`};
    contributions.push({...target,id:contributionId(target),hash:contributionHash('recorded bytes'),encoding:'bytes',ownership:'prior-record',scope:'global'});
    (['supermemory','deck-memory','adaptive-memory'].includes(capability)?removed:kept).push(path);
   }
  }
  const customized=join(directory,'customized.txt');writeFileSync(customized,'user customization');
  const target={path:customized,selector:{kind:'file' as const},sourceItemId:'package:supermemory'};
  contributions.push({...target,id:contributionId(target),hash:contributionHash('recorded bytes'),encoding:'bytes',ownership:'prior-record',scope:'global'});
  const unknown=join(directory,'unreceipted-supermemory.txt');writeFileSync(unknown,'independent file');kept.push(unknown,customized);
  const manifestPath=runnerId==='claude'?join(root,'manifest.json'):join(directory,'manifest.json');
  writeFileSync(manifestPath,JSON.stringify({schema:'deck-runner-contributions-v1',runnerId,root,contributions}));
  fixtures.push({runnerId,removed,kept,customized,manifestPath});
 }
 const busy=await runRunnerCleanupUpdate(roots,undefined,{admission:async()=>{throw new RunnerMutationDeferredError();}});
 expect(busy.map(outcome=>outcome.status)).toEqual(['deferred','deferred','deferred','deferred']);
 for(const fixture of fixtures){
  for(const path of fixture.removed)expect(readFileSync(path,'utf8')).toBe('recorded bytes');
 }
 const outcomes=await runRunnerCleanupUpdate(roots,undefined,{admission:idle});
 expect(outcomes.every(outcome=>outcome.status==='review-required')).toBe(true);
 for(const fixture of fixtures){
  for(const path of fixture.removed)expect(existsSync(path)).toBe(false);
  for(const path of fixture.kept)expect(existsSync(path)).toBe(true);
  expect(readFileSync(fixture.customized,'utf8')).toBe('user customization');
  const receipts=JSON.parse(readFileSync(fixture.manifestPath,'utf8')).contributions;
  expect(receipts.some((entry:{path:string})=>fixture.removed.includes(entry.path))).toBe(false);
  expect(receipts.some((entry:{path:string})=>entry.path===fixture.customized)).toBe(true);
 }
});


// Protects the public unattended cleanup boundary: a dependency name and its
// dedicated tools directory never prove ownership. Only an exact receipt does.
const cleanupRunners = ['codex', 'claude', 'opencode', 'pi'] as const;
const dependencySections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
const retiredDependencies = ['supermemory', 'deck-memory', 'adaptive-memory'];
type DependencyReceipt = 'absent' | 'matching' | 'customized' | 'invalid';
async function dependencyFixture(runnerId: typeof cleanupRunners[number], receipt: DependencyReceipt) {
 const {canonicalContributionJson, contributionHash, contributionId} = await import('@deck/core');
 const roots=cleanupRoots({HOME:mkdtempSync(join(tmpdir(),'deck-cleanup-dependencies-'))});
 const root=runnerId==='claude'?join(roots.data,'claude'):roots[runnerId];
 const manifestPath=runnerId==='claude'?join(root,'manifest.json'):join(root,'deck/manifest.json');
 const backupRoot=runnerId==='claude'?join(root,'backups'):join(root,'deck/backups');
 const packagePath=join(roots.data,runnerId,'tools/package.json');
 mkdirSync(join(root,'deck'),{recursive:true});
 mkdirSync(join(roots.data,runnerId,'tools'),{recursive:true});
 const contributions=[];
 const value=receipt==='customized'?'file:../user-customization':'1.0.0';
 const document: Record<string,unknown>={name:'independent-tools',scripts:{check:'user-command'}};
 for(const section of dependencySections){
  document[section]=Object.fromEntries([...retiredDependencies.map(id=>[id,value]),['independent-tool','2.0.0'],['supermemory-user','3.0.0']]);
  if(receipt!=='absent')for(const capability of retiredDependencies){
   const target={path:packagePath,selector:{kind:'json' as const,keys:[section,capability]},sourceItemId:`package:${capability}`};
   contributions.push({...target,id:contributionId(target),hash:receipt==='invalid'?'invalid-hash':contributionHash(canonicalContributionJson('1.0.0')),encoding:'canonical-json-v1',ownership:'prior-record',scope:'global'});
  }
 }
 const packageBefore=JSON.stringify(document,null,2)+'\n';
 const manifestBefore=JSON.stringify({schema:'deck-runner-contributions-v1',runnerId,root,contributions});
 writeFileSync(packagePath,packageBefore);writeFileSync(manifestPath,manifestBefore);
 return {roots,packagePath,packageBefore,manifestPath,manifestBefore,backupRoot,document};
}
for(const runnerId of cleanupRunners){
 for(const receipt of ['absent','matching','customized','invalid'] as const){
  test(`${runnerId} unattended dependency cleanup requires exact receipts: ${receipt}`,async()=>{
   const fixture=await dependencyFixture(runnerId,receipt);
   try{
    const outcomes=await runRunnerCleanupUpdate(fixture.roots,undefined,{admission:idle});
    if(receipt==='matching'){
     const expected={...fixture.document};
     for(const section of dependencySections)expected[section]={'independent-tool':'2.0.0','supermemory-user':'3.0.0'};
     expect(JSON.parse(readFileSync(fixture.packagePath,'utf8'))).toEqual(expected);
     expect(JSON.parse(readFileSync(fixture.manifestPath,'utf8')).contributions).toEqual([]);
     expect(existsSync(fixture.backupRoot)).toBe(true);
    }else{
     expect(readFileSync(fixture.packagePath,'utf8')).toBe(fixture.packageBefore);
     expect(readFileSync(fixture.manifestPath,'utf8')).toBe(fixture.manifestBefore);
     expect(existsSync(fixture.backupRoot)).toBe(false);
    }
    expect(outcomes.find(outcome=>outcome.runnerId===runnerId)?.status).toBe(receipt==='matching'?'complete':'review-required');
   }finally{rmSync(fixture.roots.home,{recursive:true,force:true});}
  });
 }
 test(`${runnerId} busy admission preserves receipted dependency config and manifest without backups`,async()=>{
  const fixture=await dependencyFixture(runnerId,'matching');
  try{
   const outcomes=await runRunnerCleanupUpdate(fixture.roots,undefined,{admission:async()=>{throw new RunnerMutationDeferredError();}});
   expect(outcomes.find(outcome=>outcome.runnerId===runnerId)?.status).toBe('deferred');
   expect(readFileSync(fixture.packagePath,'utf8')).toBe(fixture.packageBefore);
   expect(readFileSync(fixture.manifestPath,'utf8')).toBe(fixture.manifestBefore);
   expect(existsSync(fixture.backupRoot)).toBe(false);
  }finally{rmSync(fixture.roots.home,{recursive:true,force:true});}
 });
}
