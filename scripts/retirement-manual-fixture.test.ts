import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { needsManualFixture, probePublishedManualEpoch, historicalMigrationPreimages, publishManualNativeConfiguration } from './retirement-manual-fixture';

// Protects the mapping to actual published behavior. Oracle: immutable inventory
// commits, original catalog/installer bytes and a rejecting process seam.
// Fails if a manual return is converted to an automatic acquisition claim.
test('all four pre-adapter rows preserve original source and manual installer outcomes', async () => {
  const inventory = await Bun.file(join(import.meta.dir, 'fixtures/retirement-releases.json')).json();
  const rows=inventory.rows.filter((row:any)=>needsManualFixture(row.version,row.runner));
  expect(rows).toHaveLength(4);
  // Captured git-show bytes from both pinned commits; probePublishedManualEpoch
  // verifies the independent publication hashes before executing either installer.
  // No network or historical objects are required in shallow/source-only checkouts.
  const published = await Bun.file(join(import.meta.dir, 'fixtures/retirement-manual-source.json')).json();
  const root=mkdtempSync(join(tmpdir(),'deck-manual-probe-'));
  try {
    for(const row of rows){
      expect(published.commits).toContain(row.commit);
      const source=join(root,`${row.version}-${row.runner}`);
      const paths=['packages/core/src/index.ts',...['installation-plan.ts','install-tools.ts'].map(name=>`packages/adapter-${row.runner}/src/${name}`)];
      for(const path of paths){
        expect(typeof published.files[path]).toBe('string');
        mkdirSync(dirname(join(source,path)),{recursive:true});writeFileSync(join(source,path),published.files[path]);
      }
      const evidence=await probePublishedManualEpoch(source,row.runner);
      expect(evidence.commands).toBe(0);
      expect(evidence.historicalDeckInstallEffect).toBe(false);
      expect(evidence.outcome[0].success).toBe(row.runner==='pi');
      if(row.runner==='pi')expect(evidence.outcome[0].status).toBe('manual');
      writeFileSync(join(source,paths[0]!), 'changed published bytes');
      await expect(probePublishedManualEpoch(source,row.runner)).rejects.toThrow('Unmapped manual epoch source');
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});

// Protects the producer-to-review migration path: original installer bytes remain
// attribution evidence while exact operator output is the migration preimage.
// Fails if review uses stale bytes or adopts arbitrary edited configuration.
test.each(['0.0.1','0.0.2'])('OpenCode %s manual postimage reaches real replacement review and candidate sync', async version => {
  const {createHash}=await import('node:crypto');
  const {fixtureMarker,reviewHistoricalReplacement}=await import('./retirement-matrix-fixture');
  const {publishedManualHashes}=await import('./retirement-publication-contract');
  const {upstreamPins}=await import('./retirement-historical-effects');
  const {createOpenCodeRunnerAdapter}=await import('../packages/adapter-opencode/src/runner-adapter');
  const {getDefaultDeckConfig}=await import('../packages/core/src');
  const {runRunnerSync}=await import('../apps/cli/src/upgrade-command/runner-sync');
  const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
  const home=realpathSync(mkdtempSync(join(tmpdir(),'deck-manual-migration-')));
  try {
    writeFileSync(join(home,'.retirement-fixture'),fixtureMarker);
    const path=join(home,'.config/opencode/opencode.json');mkdirSync(dirname(path),{recursive:true});
    const original=JSON.stringify({instructions:['historical.md'],mcp:{}});
    const captured=[{path,content:original}];
    writeFileSync(path,original);
    const artifacts=['serena','codebase-memory'].map(capability=>{
      const path=join(home,capability==='serena'?'fixture-prerequisites/serena/venv/bin/serena':'fixture-prerequisites/codebase/codebase-memory-mcp');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,capability);
      const lockPath=join(home,'requirements.txt');writeFileSync(lockPath,'locked');
      return {capability,path,sha256:hash(capability),pin:capability==='serena'?'serena-agent==1.3.0':'codebase-memory-mcp@0.11.0',lockPath,lockSha256:hash('locked'),uvSha256:upstreamPins.uvBinarySha256,method:'fixture-provisioned-shared-prerequisite',historicalDeckInstallEffect:false,probeStatus:0};
    });
    const source=join(home,'source'),format='packages/adapter-opencode/src/opencode-mcp-config.ts';
    mkdirSync(dirname(join(source,format)),{recursive:true});writeFileSync(join(source,format),'native format fixture input');
    const configuration=publishManualNativeConfiguration(source,'opencode',home,artifacts);
    const postimage=readFileSync(path,'utf8');
    expect(JSON.parse(postimage).mcp).toEqual({
      serena:{type:'local',command:[artifacts[0]!.path,'start-mcp-server'],enabled:true},
      'codebase-memory':{type:'local',command:[artifacts[1]!.path],enabled:true},
    });
    const manual={model:'manual-external-tool-fixture-v1',version,runner:'opencode',artifacts,
      historicalProbe:{historicalDeckInstallEffect:false,commands:0,serenaInCatalog:false,codebaseInstallKind:'external',outcome:[{success:false}],inputs:['core','opencode/catalog','opencode/installer'].map(key=>({path:key,sha256:publishedManualHashes[key]}))},configuration};
    writeFileSync(join(home,'historical-files.json'),JSON.stringify(captured));
    const originalSnapshot=readFileSync(join(home,'historical-files.json'));
    for (const mutate of [
      (f:any)=>{f.runner='pi';},
      (f:any)=>{f.configuration.path=join(home,'foreign.json');},
      (f:any)=>{f.configuration.beforeContent='{}';},
      (f:any)=>{f.artifacts[0].pin='serena-agent==9.0.0';},
      (f:any)=>{f.artifacts[0].uvSha256=hash('unverified uv');},
      (f:any)=>{f.artifacts[0].path=join(home,'foreign/serena');f.configuration.commands.serena[0]=f.artifacts[0].path;},
      (f:any)=>{f.artifacts[0].sha256=hash('edited executable');},
      (f:any)=>{f.artifacts[0].lockSha256=hash('edited lock');},
    ]) {
      const changed=structuredClone(manual);mutate(changed);
      expect(()=>historicalMigrationPreimages(home,'opencode',captured,changed)).toThrow();
      expect(readFileSync(path,'utf8')).toBe(postimage);
    }
    const foreign=JSON.stringify({...JSON.parse(postimage),foreign:'unreviewed'});
    writeFileSync(path,foreign);
    const edited=structuredClone(manual);edited.configuration.sha256=hash(foreign);
    expect(()=>historicalMigrationPreimages(home,'opencode',captured,edited)).toThrow('postimage changed');
    expect(readFileSync(path,'utf8')).toBe(foreign);
    writeFileSync(path,postimage);
    const preimages=historicalMigrationPreimages(home,'opencode',captured,manual);
    writeFileSync(path,foreign);
    expect(()=>reviewHistoricalReplacement(home,preimages,[path])).toThrow('preimage changed');
    expect(readFileSync(path,'utf8')).toBe(foreign);
    writeFileSync(path,postimage);
    const config=getDefaultDeckConfig();
    const adapter=createOpenCodeRunnerAdapter({developerTeamConfigDir:dirname(path)});
    const plan=adapter.buildDeveloperTeamInstallPlan({projectRoot:home,environmentId:'opencode-development',deckConfig:config,materializationScope:'content-only'});
    expect(plan.files.some(file=>file.path===path||file.path==='opencode.json')).toBe(true);
    // Real historical installs also leave managed detection files after config review.
    writeFileSync(join(dirname(path),'packageInstructions.json'),'{}');
    const reviewed=reviewHistoricalReplacement(home,preimages,[path]);
    expect(reviewed[0]!.hash).toBe(hash(postimage));
    expect(readFileSync(reviewed[0]!.backup,'utf8')).toBe(postimage);
    expect(readFileSync(join(home,'historical-files.json'))).toEqual(originalSnapshot);
    const synced=await runRunnerSync({config,registry:{list:()=>[adapter],has:()=>true,get:()=>adapter},projectRoot:home,deckVersion:'candidate',runnerIds:['opencode'],mutationAdmission:async effect=>effect()});
    expect(synced.outcomes[0]?.status,JSON.stringify(synced.outcomes)).toBe('synced');
    expect(existsSync(path)).toBe(true);
    for(const artifact of artifacts)expect(hash(readFileSync(artifact.path))).toBe(artifact.sha256);
  } finally {rmSync(home,{recursive:true,force:true});}
});

// Protects actual Pi native command creation, independently of the publication
// validator. Oracle: Pi's executable/args split and the Serena MCP subcommand.
test('manual Pi publication emits exact executable and args and preserves collisions', () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-manual-pi-config-')));
  try {
    writeFileSync(join(root,'.retirement-fixture'),'deck-retirement-isolated-fixture-v1');
    const format=join(root,'packages/adapter-pi/src/pi-mcp-config.ts');
    mkdirSync(dirname(format),{recursive:true});writeFileSync(format,'native format fixture input');
    const artifacts=[{capability:'serena',path:join(root,'serena')},{capability:'codebase-memory',path:join(root,'codebase')}];
    const configuration=publishManualNativeConfiguration(root,'pi',root,artifacts);
    const before=readFileSync(configuration.path,'utf8');
    expect(JSON.parse(before)).toEqual({mcpServers:{
      serena:{command:artifacts[0]!.path,args:['start-mcp-server']},
      'codebase-memory':{command:artifacts[1]!.path,args:[]},
    }});
    expect(()=>publishManualNativeConfiguration(root,'pi',root,artifacts)).toThrow('collision');
    expect(readFileSync(configuration.path,'utf8')).toBe(before);
  } finally {rmSync(root,{recursive:true,force:true});}
});
