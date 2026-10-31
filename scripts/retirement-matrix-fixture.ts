/** Test-harness authority only. Never imported by the product migration path. */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { gzipSync } from 'node:zlib';

export const fixtureMarker = 'deck-retirement-isolated-fixture-v1';
/** Capture a known published apply effect omitted by an older facade's file list. */
export function capturePublishedPlanFile(home: string, file: { absolutePath: string; content: string }) {
  assertFixtureHome(home,file.absolutePath);
  if(!readFileSync(file.absolutePath).equals(Buffer.from(file.content)))throw Error('Published apply output differs from original builder');
  return {path:file.absolutePath,content:file.content};
}
/** Older facades return skills while their native apply also writes these exact plans. */
export function capturePublishedOpenCodeFiles(home: string, native: any, captured: readonly {path:string}[]) {
  const known=new Set(captured.map(file=>materializedFixturePath(home,'opencode',file.path)));
  const planned=[...(native.promptGenerationPlan??[]),...(native.commandGenerationPlan??[]),...(native.executionPlugin?[native.executionPlugin]:[])];
  return planned.filter(file=>!known.has(file.absolutePath)).map(file=>capturePublishedPlanFile(home,file));
}
/** Frozen dependencies/installers must not change the verified release inputs. */
export function verifyPublishedSourceFiles(source: string, records: readonly {path:string;blob:string;mode:string}[]) {
  source=resolve(source);
  for(const record of records){
    const path=resolve(source,record.path),rel=relative(source,path);
    if(!rel||rel==='..'||rel.startsWith('../')||isAbsolute(rel))throw Error('Published source path escaped archive');
    for(let parent=dirname(path);;parent=dirname(parent)){
      if(lstatSync(parent).isSymbolicLink())throw Error('Published source ancestor changed to a symlink');
      if(parent===source)break;
    }
    const stat=lstatSync(path),link=record.mode==='120000';
    if(link!==stat.isSymbolicLink()||!link&&!stat.isFile())throw Error(`Published source kind changed: ${record.path}`);
    if(link){
      const target=relative(source,resolve(dirname(path),readlinkSync(path)));
      if(target==='..'||target.startsWith('../')||isAbsolute(target))throw Error('Published source symlink escaped archive');
    }
    const bytes=link?Buffer.from(readlinkSync(path)):readFileSync(path);
    const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if(blob!==record.blob)throw Error(`Published source bytes changed: ${record.path}`);
  }
}
/** Keep exact recovery data without copying all prior source content into every matrix checkpoint. */
export function retainFixtureBackup(home: string, backup: unknown) {
  assertFixtureHome(home);
  const bytes=Buffer.from(JSON.stringify(backup)),sha256=createHash('sha256').update(bytes).digest('hex');
  const compressed=gzipSync(bytes),path=join(home,`candidate-adapter-backup-${sha256}.json.gz`);
  assertFixtureHome(home,path);
  if(existsSync(path)){
    if(!readFileSync(path).equals(compressed))throw Error('Retained backup artifact changed');
  }else writeFileSync(path,compressed,{flag:'wx',mode:0o600});
  return {path,sha256,gzipSha256:createHash('sha256').update(compressed).digest('hex'),bytes:bytes.length,compressedBytes:compressed.length};
}
/** Exact mapping used by the intermediate published Pi adapter's apply method. */
export function remapPublishedPiNativePlan(home: string, native: any) {
  assertFixtureHome(home);
  const agentsDir=join(home,'.pi/agent/agents'),skillsDir=join(home,'.pi/agent/skills');
  const plan={...native,projectRoot:home,agentsDir,skillsDir,
    agents:native.agents.map((file:any)=>({...file,absolutePath:join(agentsDir,file.relativePath.split('/').pop())})),
    skills:native.skills.map((file:any)=>({...file,absolutePath:join(skillsDir,file.agent.skillId,'SKILL.md')})),
    standaloneSkills:native.standaloneSkills.map((file:any)=>({...file,absolutePath:join(skillsDir,file.skillId,file.packagePath)})),
    sddSkillFiles:native.sddSkillFiles.map((file:any)=>({...file,absolutePath:join(skillsDir,file.skillId,'SKILL.md')}))};
  for(const file of [...plan.agents,...plan.skills,...plan.standaloneSkills,...plan.sddSkillFiles])assertFixtureHome(home,file.absolutePath);
  return plan;
}
/** A timed-out installer must not leave descendants applying effects later. */
export function runFixtureProcess(home: string, command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  assertFixtureHome(home);
  if (options.env?.HOME !== home || !options.timeout || options.timeout <= 0) throw Error('Bounded isolated process required');
  const runtime=options.env.CBM_RUNTIME_DIR,cache=options.env.CBM_CACHE_DIR;
  if(!runtime||runtime!==options.env.TMPDIR||cache!==join(home,'codebase-cache'))throw Error('Private Codebase runtime and cache isolation required');
  assertFixtureHome(runtime);assertFixtureHome(home,cache);
  // Bun 1.3.12 does not reliably implement spawnSync's detached option. Use
  // the Linux session boundary explicitly so the returned PID owns the group.
  const setsid = process.platform === 'linux' ? Bun.which('setsid') : undefined;
  if (!setsid) throw Error('Isolated installer process groups require Linux setsid');
  const result = spawnSync(setsid, [command, ...args], { ...options, detached: false });
  // The process group belongs exclusively to this awaited fixture command.
  // Also collect descendants after normal parent exit (e.g. old npm scripts).
  if (result.pid > 0) try { process.kill(-result.pid, 'SIGKILL'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  return result;
}
/** Keep Unix-socket fallbacks private even when the evidence output path is long. */
export function fixtureRuntimeTemp(): string {
  const root = mkdtempSync(join(tmpdir(), 'nrp-'));
  writeFileSync(join(root, '.retirement-fixture'), fixtureMarker, { mode: 0o600 });
  return root;
}
/** Runner-neutral plans have runner-relative paths in some published epochs. */
export function materializedFixturePath(home: string, runner: string, path: string): string {
  const root = runner === 'codex' ? join(home, '.codex') : runner === 'opencode' ? join(home, '.config/opencode')
    : runner === 'pi' ? join(home, '.pi/agent') : join(home, '.local/share/deck/claude');
  // The intermediate Pi adapter reported project-relative .pi/{agents,skills}
  // while its published apply remapped those files to .pi/agent. Accept only
  // that observed source mapping, with an actual uniquely materialized file.
  const piGlobal=runner==='pi'&&/^\.pi\/(?:agents|skills)\//.test(path)?join(root,path.slice(4)):undefined;
  if(piGlobal&&existsSync(piGlobal)&&existsSync(join(home,path)))throw Error('Ambiguous historical Pi materialization path');
  const selected = isAbsolute(path) ? path : piGlobal&&existsSync(piGlobal)?piGlobal:existsSync(join(root, path)) ? join(root, path) : join(home, path);
  assertFixtureHome(home, selected); return selected;
}
export function assertFixtureHome(home: string, target = home): void {
  if (!isAbsolute(home) || resolve(home) !== home || readMarker(home) !== fixtureMarker) throw Error('isolated fixture marker required');
  const rel = relative(home, resolve(target));
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw Error('fixture path escaped isolated HOME');
  for (let path = resolve(target);; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('fixture symlink boundary');
    if (path === home) break;
  }
}
function readMarker(home: string): string | undefined {
  try { return readFileSync(join(home, '.retirement-fixture'), 'utf8'); } catch { return undefined; }
}
export function reviewHistoricalReplacement(home: string, captured: { path: string; content: string }[], selected: string[]) {
  const reviewed = selected.map(path => {
    assertFixtureHome(home, path);
    const entry = captured.find(entry => entry.path === path);
    if (!entry) throw Error('replacement not captured by the historical installer');
    const bytes = readFileSync(path);
    if (!bytes.equals(Buffer.from(entry.content))) throw Error('historical replacement preimage changed');
    const hash = createHash('sha256').update(bytes).digest('hex');
    return { path, bytes, hash, backup: join(home, 'fixture-review-backups', hash), authorization: 'explicit-isolated-fixture-review' as const };
  });
  // Validate the whole review before the first effect; these are fixture confirmations,
  // never ownership receipts and never evidence of consent for an operator's machine.
  for (const entry of reviewed) {
    mkdirSync(dirname(entry.backup), { recursive: true });
    writeFileSync(entry.backup, entry.bytes, { mode: 0o600 });
    unlinkSync(entry.path);
  }
  return reviewed.map(({ bytes, ...entry }) => entry);
}
