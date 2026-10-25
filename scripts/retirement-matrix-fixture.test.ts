import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { reviewHistoricalReplacement, assertFixtureHome, fixtureMarker, materializedFixturePath, fixtureRuntimeTemp } from './retirement-matrix-fixture';
import { resolveStatePaths } from '../packages/session-host/src';
import { historicalPreservationScenarios, migratedRecoveryScenario } from './retirement-historical-scenarios';
import { cleanupRoots } from '../apps/cli/src/runner-cleanup-command';
import { beginRunnerContributions } from '../packages/core/src';
import { verifyNativeTooling } from './retirement-historical-effects';
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'retirement-review-'));
  writeFileSync(join(home, '.retirement-fixture'), fixtureMarker); return home;
}

test('fixture replacement requires a captured exact preimage and preserves changed and user files', () => {
  const home = fixture();
  const path = join(home, 'skills/deck-lead/SKILL.md'); mkdirSync(join(home, 'skills/deck-lead'), { recursive: true });
  writeFileSync(path, 'historical');
  const reviewed = { path, content: 'historical' };
  writeFileSync(path, 'user edit');
  expect(() => reviewHistoricalReplacement(home, [reviewed], [path])).toThrow('changed');
  expect(readFileSync(path, 'utf8')).toBe('user edit');
  expect(() => reviewHistoricalReplacement(home, [reviewed], [join(home, 'user.md')])).toThrow('not captured');
  writeFileSync(path, 'historical');
  const result = reviewHistoricalReplacement(home, [reviewed], [path]);
  expect(readFileSync(result[0]!.backup, 'utf8')).toBe('historical');
  expect(result[0]!.authorization).toBe('explicit-isolated-fixture-review');
});

test('fixture boundaries reject real homes, lexical escapes and symlink ancestors', () => {
  expect(() => assertFixtureHome('/home/kevin15011', '/home/kevin15011')).toThrow();
  const home = fixture();
  expect(() => assertFixtureHome(home, join(home, '../escape'))).toThrow();
  symlinkSync(tmpdir(), join(home, 'link'));
  expect(() => assertFixtureHome(home, join(home, 'link/file'))).toThrow();
});

test('relative published plan paths resolve to the actual runner installation', () => {
  const home = fixture(); const root = join(home, '.config/opencode'); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'opencode.json'), '{}');
  expect(materializedFixturePath(home, 'opencode', 'opencode.json')).toBe(join(root, 'opencode.json'));
  expect(() => materializedFixturePath(home, 'opencode', '../../escape')).toThrow();
  mkdirSync(join(home,'.pi/agent/agents'),{recursive:true});
  writeFileSync(join(home,'.pi/agent/agents/deck-lead.md'),'actual published apply output');
  expect(materializedFixturePath(home,'pi','.pi/agents/deck-lead.md')).toBe(join(home,'.pi/agent/agents/deck-lead.md'));
});

test('adversarial harness restores exact config/receipts and recovery preserves conflicting bytes', () => {
  // Helper contract fixture, deliberately not reported as a historical installation.
  const home = fixture(), roots = cleanupRoots({ HOME: home });
  const path = join(roots.codex, 'config.toml'), manifestPath = join(roots.codex, 'deck/manifest.json');
  mkdirSync(roots.codex, { recursive: true });
  const transaction = beginRunnerContributions({ runnerId: 'codex', root: roots.codex, manifestPath, deckVersion: 'helper-test', targets: [{ path, selector: { kind: 'toml', header: 'mcp_servers.context-mode' } }] });
  const config = '[mcp_servers.context-mode]\ncommand = "context-mode"\n';
  writeFileSync(path, config); transaction.commit();
  const receipt = readFileSync(manifestPath, 'utf8');
  const result = historicalPreservationScenarios(home, 'codex', roots);
  expect(result.filter(entry => entry.status === 'verified')).toHaveLength(6);
  expect(readFileSync(path, 'utf8')).toBe(config);
  expect(readFileSync(manifestPath, 'utf8')).toBe(receipt);
  expect(migratedRecoveryScenario(home, 'codex', path).status).toBe('verified');
  expect(readFileSync(path, 'utf8')).toBe(config);
});

test('matrix refuses to replay partial successful effects in an occupied output root', () => {
  const output = fixture();
  const result = spawnSync(process.execPath, [join(import.meta.dir, 'verify-retirement-published-matrix.ts'), '--version=v0.13.0', `--output=${output}`], { encoding: 'utf8', timeout: 10000 });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('fresh output directory');
  expect(readFileSync(join(output, '.retirement-fixture'), 'utf8')).toBe(fixtureMarker);
});

test('preservation scenarios exercise user edits when Serena was actually selected and installed', () => {
  const home=fixture(),roots=cleanupRoots({HOME:home}),path=join(roots.codex,'config.toml');
  mkdirSync(roots.codex,{recursive:true});
  const original='[mcp_servers.serena]\ncommand="historical-selected-serena"\n[mcp_servers.keep]\ncommand="user"\n';
  writeFileSync(path,original);
  const result=historicalPreservationScenarios(home,'codex',roots);
  expect(result.find(scenario=>scenario.scenario==='user-entry-and-ambiguity')?.status).toBe('verified');
  expect(readFileSync(path,'utf8')).toBe(original);
});

test('concurrent long fixture homes have separate private socket fallback namespaces', () => {
  const first=fixtureRuntimeTemp(),second=fixtureRuntimeTemp();
  const home=join(tmpdir(),'long-evidence-root-'.repeat(12));
  const a=resolveStatePaths({env:{HOME:home,TMPDIR:first},tmpdir:first});
  const b=resolveStatePaths({env:{HOME:home,TMPDIR:second},tmpdir:second});
  expect(a.socket.path).not.toBe(b.socket.path);
  expect(a.socket.path.startsWith(first+'/')).toBe(true);
  expect(Buffer.byteLength(a.socket.path)).toBeLessThan(108);
});

test('native prerequisite reuse rejects unmarked roots and drifted installation locks', () => {
  expect(()=>verifyNativeTooling('/home/kevin15011/native')).toThrow();
  const root=fixture(),home=join(root,'native-tooling-home'),prefix=join(home,'native');
  mkdirSync(prefix,{recursive:true});writeFileSync(join(home,'.retirement-fixture'),fixtureMarker);
  writeFileSync(join(prefix,'package-lock.json'),'{}');
  writeFileSync(join(root,'native-tooling-identity.json'),JSON.stringify({lockSha256:'wrong'}));
  expect(()=>verifyNativeTooling(prefix)).toThrow('lock identity changed');
});

test('bounded fixture commands collect installer descendants after timeout', async () => {
  const { runFixtureProcess } = await import('./retirement-matrix-fixture');
  const home = fixture(), runtime = fixtureRuntimeTemp(), descendant = join(home, 'descendant.ts'), parent = join(home, 'parent.ts');
  writeFileSync(descendant, 'setInterval(() => {}, 1000)');
  writeFileSync(parent, `const child = Bun.spawn([process.execPath, ${JSON.stringify(descendant)}]); console.log(child.pid); setInterval(() => {}, 1000);`);
  const result = runFixtureProcess(home, process.execPath, [parent], { env: { ...process.env, HOME: home, TMPDIR: runtime, CBM_RUNTIME_DIR: runtime, CBM_CACHE_DIR: join(home, 'codebase-cache') }, encoding: 'utf8', timeout: 500 });
  expect(result.error?.code).toBe('ETIMEDOUT');
  const pid = Number(result.stdout.trim()); expect(pid).toBeGreaterThan(0);
  // A killed child may remain briefly as a reparented zombie; neither it nor
  // the parent can execute another installation effect.
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2];
      if (state === 'Z') return;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await Bun.sleep(10);
  }
  throw Error('Fixture installer descendant survived timeout');
});

test('intermediate published Pi verification uses the exact global apply mapping for all file classes', async () => {
  const { remapPublishedPiNativePlan } = await import('./retirement-matrix-fixture');
  const home=fixture();
  const file={relativePath:'.pi/agents/deck-lead.md',absolutePath:join(home,'.pi/agents/deck-lead.md'),content:'source output'};
  const plan=remapPublishedPiNativePlan(home,{projectRoot:home,agents:[file],skills:[{...file,agent:{skillId:'deck-lead'}}],standaloneSkills:[{...file,skillId:'external',packagePath:'support/data.json'}],sddSkillFiles:[{...file,skillId:'deck-init'}]});
  expect(plan.agents[0].absolutePath).toBe(join(home,'.pi/agent/agents/deck-lead.md'));
  expect(plan.skills[0].absolutePath).toBe(join(home,'.pi/agent/skills/deck-lead/SKILL.md'));
  expect(plan.standaloneSkills[0].absolutePath).toBe(join(home,'.pi/agent/skills/external/support/data.json'));
  expect(plan.sddSkillFiles[0].absolutePath).toBe(join(home,'.pi/agent/skills/deck-init/SKILL.md'));
  expect(()=>remapPublishedPiNativePlan(home,{...plan,standaloneSkills:[{...file,skillId:'../../../../../escape',packagePath:'data'}]})).toThrow('escaped');
});

test('backup evidence retains exact recovery data once as a checked compressed artifact', async () => {
  const { retainFixtureBackup } = await import('./retirement-matrix-fixture');
  const { gunzipSync } = await import('node:zlib');
  const home=fixture(),backup={entries:[{path:join(home,'old.md'),previousContent:'old content\n'.repeat(10000)}]};
  const saved=retainFixtureBackup(home,backup);
  expect(JSON.parse(gunzipSync(readFileSync(saved.path)).toString('utf8'))).toEqual(backup);
  expect(saved.compressedBytes).toBeLessThan(saved.bytes);
  expect(retainFixtureBackup(home,backup)).toEqual(saved);
  writeFileSync(saved.path,'changed artifact');
  expect(()=>retainFixtureBackup(home,backup)).toThrow('changed');
});

test('pinned artifact mirror serves exact bytes on loopback and exposes no other route', async () => {
  const { fixtureArtifactMirror } = await import('./retirement-historical-effects');
  const home=fixture(),bytes=Buffer.from('synthetic archive contract bytes');
  const mirror=fixtureArtifactMirror(home,{'artifact.tar.gz':bytes});
  try{
    expect(Buffer.from(await (await fetch(mirror.url+'/artifact.tar.gz')).arrayBuffer())).toEqual(bytes);
    expect((await fetch(mirror.url+'/unknown')).status).toBe(404);
    expect((await fetch(mirror.url+'/artifact.tar.gz',{method:'POST'})).status).toBe(405);
  }finally{mirror.stop();}
});

test('published source verification checks actual Git blob bytes and rejects changed kinds', async () => {
  const { verifyPublishedSourceFiles } = await import('./retirement-matrix-fixture');
  const { createHash } = await import('node:crypto');
  const home=fixture(),path=join(home,'installer.ts'),content='published code';writeFileSync(path,content);
  const blob=createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
  const records=[{path:'installer.ts',blob,mode:'100644'}];
  expect(()=>verifyPublishedSourceFiles(home,records)).not.toThrow();
  writeFileSync(path,'changed code');expect(()=>verifyPublishedSourceFiles(home,records)).toThrow('changed');
  expect(()=>verifyPublishedSourceFiles(home,[{...records[0]!,path:'../escape'}])).toThrow('escaped');
  unlinkSync(path);symlinkSync('../outside',path);
  expect(()=>verifyPublishedSourceFiles(home,records)).toThrow('kind');
  const linkBlob=createHash('sha1').update(`blob ${Buffer.byteLength('../outside')}\0../outside`).digest('hex');
  expect(()=>verifyPublishedSourceFiles(home,[{...records[0]!,mode:'120000',blob:linkBlob}])).toThrow('escaped');
});

test('global historical Codebase installer refuses missing runtime isolation before effects', async () => {
  const { historicalOpenCodeCodebase } = await import('./retirement-historical-effects');
  const home=fixture(),previous=process.env.CBM_RUNTIME_DIR;delete process.env.CBM_RUNTIME_DIR;
  let invoked=false;
  try{await expect(historicalOpenCodeCodebase({installOpenCodeTools:()=>{invoked=true;}},home,'opencode',[],()=>{},undefined)).rejects.toThrow('isolation required');}
  finally{if(previous===undefined)delete process.env.CBM_RUNTIME_DIR;else process.env.CBM_RUNTIME_DIR=previous;}
  expect(invoked).toBe(false);
});

test('omitted published plugin capture requires exact original builder output and an isolated path', async () => {
  const { capturePublishedPlanFile } = await import('./retirement-matrix-fixture');
  const home=fixture(),path=join(home,'execution.js');writeFileSync(path,'published plugin');
  expect(capturePublishedPlanFile(home,{absolutePath:path,content:'published plugin'})).toEqual({path,content:'published plugin'});
  writeFileSync(path,'neighboring user data');
  expect(()=>capturePublishedPlanFile(home,{absolutePath:path,content:'published plugin'})).toThrow('differs');
  expect(()=>capturePublishedPlanFile(home,{absolutePath:join(home,'../outside'),content:''})).toThrow('escaped');
});

test('fixture process rejects missing or escaped Codebase namespaces before execution', async () => {
  const { runFixtureProcess } = await import('./retirement-matrix-fixture');
  const home=fixture(), runtime=fixtureRuntimeTemp();
  const invoke=(env:NodeJS.ProcessEnv)=>runFixtureProcess(home, '/definitely-not-executed', [], {env,encoding:'utf8',timeout:500});
  expect(()=>invoke({HOME:home})).toThrow('Private Codebase');
  expect(()=>invoke({HOME:home,TMPDIR:runtime,CBM_RUNTIME_DIR:runtime,CBM_CACHE_DIR:'/tmp/shared-cache'})).toThrow('Private Codebase');
  const outside=fixture();symlinkSync(outside,join(home,'codebase-cache'));
  expect(()=>invoke({HOME:home,TMPDIR:runtime,CBM_RUNTIME_DIR:runtime,CBM_CACHE_DIR:join(home,'codebase-cache')})).toThrow('symlink');
});

test('published OpenCode capture includes omitted prompts and commands without adopting neighbors', async () => {
  const { capturePublishedOpenCodeFiles } = await import('./retirement-matrix-fixture');
  const home=fixture(), prompt={absolutePath:join(home,'prompt.md'),content:'published prompt'}, command={absolutePath:join(home,'command.md'),content:'published command'};
  writeFileSync(prompt.absolutePath,prompt.content);writeFileSync(command.absolutePath,command.content);
  writeFileSync(join(home,'user.md'),'unrelated');
  const native={promptGenerationPlan:[prompt],commandGenerationPlan:[command]};
  const files=capturePublishedOpenCodeFiles(home,native,[]);
  expect(files.map(file=>file.path)).toEqual([prompt.absolutePath,command.absolutePath]);
  expect(capturePublishedOpenCodeFiles(home,native,files)).toEqual([]);
  writeFileSync(prompt.absolutePath,'user edit');
  expect(()=>capturePublishedOpenCodeFiles(home,native,[])).toThrow('differs');
  expect(readFileSync(join(home,'user.md'),'utf8')).toBe('unrelated');
});

test('legacy shell downloader receives only verified pinned bytes and rejects mutable URLs', async () => {
  const { pinnedScriptCommand } = await import('./retirement-historical-effects');
  const calls:any[]=[];
  const run=pinnedScriptCommand('https://pinned.invalid/install.sh','verified script',async(command:string,args:string[])=>{calls.push([command,args]);return {exitCode:0,stdout:'executed',stderr:''};});
  expect(await run('curl',['-fsSL','https://pinned.invalid/install.sh'])).toEqual({exitCode:0,stdout:'verified script',stderr:''});
  expect(calls).toEqual([]);
  await expect(run('curl',['-fsSL','https://mutable.invalid/main/install.sh'])).rejects.toThrow('Unexpected');
  await run('/bin/sh',['-c','verified script']);
  expect(calls).toEqual([['/bin/sh',['-c','verified script']]]);
});
