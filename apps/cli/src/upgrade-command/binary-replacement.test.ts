import {expect,test} from 'bun:test';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runUpgradeOrchestrator,buildDefaultOrchestratorDeps} from './orchestrator';
import {_resetDeckPathCache} from '../runtime/paths';
import {getDefaultDeckConfig} from '@deck/core';
// Protects: production rename replacement completes and synchronizes with the verified new executable.
// Oracle: installed bytes equal staged bytes after the staged path is consumed by the default replacer.
// Fails if: post-replace verification rereads a moved staging path or synchronization uses unverified bytes.
test('default rename replacement reaches new-binary sync with the pre-swap digest',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-rename-upgrade-')));
 const saved=Object.fromEntries(['XDG_CONFIG_HOME','XDG_STATE_HOME','XDG_CACHE_HOME'].map(k=>[k,process.env[k]]));
 try{
  for(const key of Object.keys(saved))process.env[key]=join(root,key);
  _resetDeckPathCache();
  const current=join(root,'deck'),staged=join(root,'candidate'),content=join(root,'content');
  writeFileSync(current,'old');writeFileSync(staged,'new executable');writeFileSync(content,'content');
  const sha=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const digest=sha(staged);let synced=false,extracted='';
  const asset=`deck_v99.0.0_${process.platform}-${process.arch}.tar.gz`;
  const archiveSource=join(root,'deck');
  writeFileSync(archiveSource,'new executable');
  execFileSync('tar',['-czf',join(root,asset),'-C',root,'deck']);
  writeFileSync(current,'old');
  const defaults=await buildDefaultOrchestratorDeps();
  const version='99.0.0',platform=`${process.platform}-${process.arch}`;
  const descriptor={schemaVersion:1,version,tag_name:`v${version}`,channel:'stable',published_at:'2026-06-23T00:00:00.000Z',items:[
   {id:'binary',kind:'binary',required:true,platform,asset_name:asset,url:'https://example.com/candidate',sha256:sha(join(root,asset))},
   {id:'content',kind:'content',required:true,content_kinds:['skills'],asset_name:'content',url:'https://example.com/content',sha256:sha(content)},
  ]};
  const result=await runUpgradeOrchestrator({descriptor,currentVersion:'1.0.0',targetVersion:version,deps:{...defaults,projectRoot:root,currentBinaryPath:current,installKind:'binary',resolveStagingDir:()=>root,resolveStagedAsset:(_v,name)=>join(root,name),readGlobalDeckConfig:getDefaultDeckConfig,replaceBinary:async input=>{extracted=input.stagedAssetPath;return defaults.replaceBinary!(input);},syncNewBinary:input=>{
   expect(input.executable).toBe(current);expect(input.expectedDigest).toBe(digest);expect(sha(current)).toBe(digest);expect(existsSync(extracted)).toBe(false);synced=true;return {outcomes:[],manifestEntries:[]};
  }}});
  expect(result.binary).toMatchObject({status:'completed',verifiedDigest:digest});expect(synced).toBe(true);
 }finally{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}_resetDeckPathCache();rmSync(root,{recursive:true,force:true});}
});
