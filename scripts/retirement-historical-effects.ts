/** Real upstream prerequisites for published installers, confined to marked fixtures. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertFixtureHome } from './retirement-matrix-fixture';
import { installOwnedRtk, pinnedOwnedRtkRelease } from '../packages/core/src/owned-tools/rtk-artifact';
import { installOwnedCodebase, pinnedOwnedCodebaseRelease, OWNED_CODEBASE_VERSION } from '../packages/core/src/owned-tools/codebase-native-artifact';

export const upstreamPins = Object.freeze({
  contextMode: 'context-mode@1.0.169',
  pi: '@mariozechner/pi-coding-agent@0.52.12',
  opencode: 'opencode-ai@1.1.4',
  rtkScript: { url: 'https://raw.githubusercontent.com/rtk-ai/rtk/v0.50.0/install.sh', sha256: 'd6eb73a772903e13ff34ee1be8a8b24e896ba9a978f20d2279a08b4083ea6f77', maxBytes: 100000 },
  uv: { url: 'https://github.com/astral-sh/uv/releases/download/0.9.5/uv-x86_64-unknown-linux-gnu.tar.gz', sha256: '2cf10babba653310606f8b49876cfb679928669e7ddaa1fb41fb00ce73e64f66', maxBytes: 22000000 },
  uvBinarySha256: 'd3dc3ca8e29337dd602a9a4df9e6edb15ebc52aed91461debeedb96939dc4ce0',
  serena: 'serena-agent==1.3.0',
  codebaseScript: { url: 'https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/v0.11.0/install.sh', sha256: '13049c7cc51bc508d68b8ecb8a9fd9574ecb7c6f2c9dd5a19bf7d4c187321145', maxBytes: 100000 },
  codebaseChecksums: { url: 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.11.0/checksums.txt', sha256: '5e5a3b25c619ecf8f7349acf38d74f1989b4ec65dfae911d8ceb788969f1cf91', maxBytes: 100000 },
});
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Original installers download the already verified published bytes, without mutable latest inputs. */
export function fixtureArtifactMirror(home: string, files: Record<string, Uint8Array>) {
  assertFixtureHome(home);
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){
    if(request.method!=='GET')return new Response(null,{status:405});
    const key=new URL(request.url).pathname.slice(1);
    return Object.hasOwn(files,key)?new Response(files[key]):new Response(null,{status:404});
  }});
  return {url:`http://127.0.0.1:${server.port}`,stop:()=>server.stop(true)};
}

/** The legacy downloader has a command seam instead of the later downloadScript seam. */
export function pinnedScriptCommand(url: string, script: string, run: typeof runHistoricalCommand) {
  return async (command: string, args: string[]) => {
    if(command==='curl'){
      if(args.length!==2||args[0]!=='-fsSL'||args[1]!==url)throw Error('Unexpected historical shell download');
      return {exitCode:0,stdout:script,stderr:''};
    }
    return run(command,args);
  };
}
/** Freeze only the old mutable shell-script input; execute the published installer unchanged. */
export async function historicalOpenCodeCodebase(installer: any, home: string, command: string, plan: any[], onResult: any, run: any, options: any = {}) {
  assertFixtureHome(home);
  const runtime=process.env.CBM_RUNTIME_DIR,cache=process.env.CBM_CACHE_DIR;
  if(!runtime||runtime!==process.env.TMPDIR||cache!==join(home,'codebase-cache'))throw Error('Private Codebase runtime and cache isolation required');
  assertFixtureHome(runtime);assertFixtureHome(home,cache);
  const release=pinnedOwnedCodebaseRelease();if(!release)throw Error('Pinned global Codebase format unsupported');
  const script=await pinnedDownload(upstreamPins.codebaseScript),checksums=await pinnedDownload(upstreamPins.codebaseChecksums);
  const archive=await pinnedDownload({url:`https://github.com/DeusData/codebase-memory-mcp/releases/download/v${OWNED_CODEBASE_VERSION}/${release.asset}`,sha256:release.archiveSha256,maxBytes:release.archiveBytes});
  const mirror=fixtureArtifactMirror(home,{[release.asset]:archive,'checksums.txt':checksums});
  const previous=process.env.CBM_DOWNLOAD_URL;process.env.CBM_DOWNLOAD_URL=mirror.url;
  const input={method:'unmodified published installer with pinned upstream script, archive and published checksums on loopback',script:upstreamPins.codebaseScript,checksums:upstreamPins.codebaseChecksums,release,runtime,cache};
  writeFileSync(join(home,'historical-global-codebase-input.json'),JSON.stringify(input,null,2));
  try{
    return await installer.installOpenCodeTools(command,plan.map(tool=>tool.id==='codebase-memory'?{...tool,shellInstallUrl:upstreamPins.codebaseScript.url}:tool),onResult,pinnedScriptCommand(upstreamPins.codebaseScript.url,script.toString('utf8'),run??runHistoricalCommand),{...options,homeDirectory:home,projectRoot:home,downloadScript:async(url:string)=>{
      if(url!==upstreamPins.codebaseScript.url)throw Error('Unexpected script in historical Codebase selection');
      return script.toString('utf8');
    }});
  }finally{mirror.stop();if(previous===undefined)delete process.env.CBM_DOWNLOAD_URL;else process.env.CBM_DOWNLOAD_URL=previous;}
}

/** Old shared-binary epochs reused an independently provided executable, not a Deck-owned install. */
export async function fixtureSharedCodebase(home: string) {
  assertFixtureHome(home);
  const root=join(home,'fixture-prerequisites/codebase'),release=pinnedOwnedCodebaseRelease();
  if(!release)throw Error('Pinned fixture Codebase prerequisite unsupported');
  mkdirSync(dirname(root),{recursive:true,mode:0o700});await installOwnedCodebase(root,release);
  mkdirSync(join(home,'.local/bin'),{recursive:true});symlinkSync(join(root,'codebase-memory-mcp'),join(home,'.local/bin/codebase-memory-mcp'));
  return {capability:'codebase-memory',method:'fixture-provisioned-shared-prerequisite',historicalDeckInstallEffect:false,path:join(root,'codebase-memory-mcp'),exposedAs:join(home,'.local/bin/codebase-memory-mcp'),sha256:release.binarySha256};
}

/** Reuse only a previously successful, explicitly isolated native prerequisite. */
export function verifyNativeTooling(prefix: string) {
  if(resolve(prefix)!==prefix)throw Error('Absolute native prerequisite path required');
  const home=dirname(prefix);
  assertFixtureHome(home,prefix);
  const identity=JSON.parse(readFileSync(join(dirname(home),'native-tooling-identity.json'),'utf8'));
  const bytes=readFileSync(join(prefix,'package-lock.json'));
  if(hash(bytes)!==identity.lockSha256)throw Error('Native prerequisite lock identity changed');
  const lock=JSON.parse(bytes.toString());
  for(const [name,version] of [['@mariozechner/pi-coding-agent','0.52.12'],['opencode-ai','1.1.4']]){
    if(lock.packages?.[`node_modules/${name}`]?.version!==version)throw Error('Native prerequisite pin mismatch');
  }
  for(const command of ['pi','opencode'])if(!existsSync(join(prefix,'node_modules/.bin',command)))throw Error('Native prerequisite executable missing');
  return identity;
}

export async function pinnedDownload(pin: { url: string; sha256: string; maxBytes: number }): Promise<Buffer> {
  const response = await fetch(pin.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`Pinned upstream unavailable: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > pin.maxBytes || hash(bytes) !== pin.sha256) throw Error('Pinned upstream content identity mismatch');
  return bytes;
}

/** Uses original default process effects. Only the originally mutable package input is pinned. */
export async function historicalSerenaEffects(core: any, home: string) {
  assertFixtureHome(home);
  if (!core.createDefaultSerenaBootstrapEffects) throw Error('This source epoch has no Serena bootstrap');
  if (process.platform !== 'linux' || process.arch !== 'x64') throw Error('Pinned UV prerequisite supports linux-x64 only');
  const root = join(home, '.local/share/deck/tools/serena'), uv = join(root, 'uv');
  const archive = join(home, 'pinned-uv.tar.gz');
  if(!existsSync(join(uv,'uv'))){
    writeFileSync(archive, await pinnedDownload(upstreamPins.uv));
    mkdirSync(uv, { recursive: true, mode: 0o700 });
    const unpack = spawnSync('tar', ['-xzf', archive, '--strip-components=1', '-C', uv], { encoding: 'utf8' });
    if (unpack.status !== 0) throw Error('Pinned UV extraction failed');
  }
  assertFixtureHome(home,join(uv,'uv'));
  if(hash(readFileSync(join(uv,'uv')))!==upstreamPins.uvBinarySha256)throw Error('Existing UV prerequisite differs from the pinned artifact');
  const original = core.createDefaultSerenaBootstrapEffects();
  return { ...original, spawn: (spec: any) => original.spawn({ ...spec,
    args: spec.args.map((arg: string) => arg === 'serena-agent' ? upstreamPins.serena : arg),
  }) };
}

/** Captures real command effects; timeout/unsupported is a gap, never a fabricated install. */
export async function runHistoricalCommand(command: string, args: string[]) {
  assertFixtureHome(process.env.HOME ?? '');
  const result = spawnSync(command, args, { cwd: process.env.HOME, env: process.env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr || result.error?.message || '' };
}

export async function historicalOpenCodeRtk(installer: any, tool: any, home: string) {
  assertFixtureHome(home);
  const binary = join(home, '.local/bin/rtk');
  process.env.PATH = `${dirname(binary)}:${process.env.PATH}`;
  process.env.RTK_VERSION = 'v0.50.0';
  process.env.RTK_INSTALL_DIR = dirname(binary);
  const script = await pinnedDownload(upstreamPins.rtkScript);
  // The release's installer still performs its download, checksum verification,
  // install and original post-install command. No script body is rewritten.
  const outcomes = await installer.installOpenCodeTools(process.env.NRP_NATIVE_OPENCODE ?? process.execPath,
    [{ ...tool, shellInstallUrl: upstreamPins.rtkScript.url }], () => {}, pinnedScriptCommand(upstreamPins.rtkScript.url,script.toString('utf8'),runHistoricalCommand),
    { homeDirectory: home, projectRoot: home, downloadScript: async () => script.toString('utf8') });
  const probe = existsSync(binary) ? spawnSync(binary, ['--version'], { env: process.env, encoding: 'utf8', timeout: 10000 }) : undefined;
  return { method: 'historical-installer-with-pinned-upstream', originalUrl: tool.shellInstallUrl,
    pin: upstreamPins.rtkScript, version: 'v0.50.0', outcomes, binary,
    binaryHash: existsSync(binary) ? hash(readFileSync(binary)) : undefined, probeStatus: probe?.status,
    gap: outcomes.length !== 1 || !outcomes[0].success || probe?.status !== 0 ? 'Historical OpenCode RTK install/post-install did not complete' : undefined };
}

/** Historical manual/external epochs require an independently installed prerequisite. */
export async function fixtureSharedRtk(home: string) {
  assertFixtureHome(home);
  const root = join(home, 'fixture-prerequisites/rtk');
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 });
  const release = pinnedOwnedRtkRelease();
  if (!release) throw Error('Pinned fixture RTK prerequisite unsupported');
  await installOwnedRtk(root, release);
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  symlinkSync(join(root, 'rtk'), join(home, '.local/bin/rtk'));
  return { capability: 'rtk', method: 'fixture-provisioned-shared-prerequisite', historicalDeckInstallEffect: false,
    version: '0.50.0', binaryHash: release.binarySha256 };
}

export async function fixtureSharedContextMode(home: string) {
  assertFixtureHome(home);
  const outcome=await runHistoricalCommand('npm',['install','-g','--no-audit','--no-fund',upstreamPins.contextMode]);
  if(outcome.exitCode!==0)throw Error('Pinned manual Context Mode prerequisite failed');
  return {capability:'context-mode',method:'fixture-provisioned-shared-prerequisite',historicalDeckInstallEffect:false,package:upstreamPins.contextMode};
}
