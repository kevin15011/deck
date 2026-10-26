/** Run on each native release platform; compilation alone is not qualification. */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=realpathSync(resolve(import.meta.dir,'..'));
const target=process.argv[process.argv.indexOf('--target')+1];
const artifactArg=process.argv[process.argv.indexOf('--artifact')+1];
if(!process.argv.includes('--target') || target!==`${process.platform}-${process.arch}`)throw Error('Native target mismatch or missing --target');
const machine=Bun.spawnSync(['uname','-m']).stdout.toString().trim();
if(!(process.arch==='x64' ? machine==='x86_64' : ['aarch64','arm64'].includes(machine)))throw Error('Host architecture mismatch');
if(process.platform==='darwin' && Bun.spawnSync(['/usr/sbin/sysctl','-in','sysctl.proc_translated']).stdout.toString().trim()==='1')throw Error('Translated execution is not native qualification');
if(Bun.version!=='1.3.12')throw Error('Qualification requires Bun 1.3.12');
if(!process.argv.includes('--artifact') || !artifactArg)throw Error('Supply --artifact <extracted canonical release executable>');
const artifact=realpathSync(artifactArg);
if(artifact.startsWith(root+'/'))throw Error('Extract artifact outside checkout');
const commit=Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:root}).stdout.toString().trim();
console.log(JSON.stringify({target,machine,bun:Bun.version,commit,version:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,artifact,sha256:new Bun.CryptoHasher('sha256').update(readFileSync(artifact)).digest('hex')}));
const output=mkdtempSync(join(tmpdir(),'deck-git-qualification-'));
async function run(args:string[],cwd=root) {
 const process=Bun.spawn(args,{cwd,stdout:'inherit',stderr:'inherit'});
 if(await process.exited!==0)throw Error(`Failed: ${args.join(' ')}`);
}
const home=join(output,'home');mkdirSync(home);
const env={PATH:process.env.PATH!,HOME:home,TMPDIR:output,LANG:'C.UTF-8'};
let prefix:string[];
if(process.platform==='linux'){
 const launcher=join(output,'deny.py');copyFileSync(join(root,'scripts/checkout-read-denial.py'),launcher);
 prefix=['python3',launcher,realpathSync(root)];
}else if(process.platform==='darwin'){
 const profile=join(output,'deny.sb');
 writeFileSync(profile,`(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(realpathSync(root))}))`);
 prefix=['/usr/bin/sandbox-exec','-f',profile];
}else throw Error('Unsupported qualification host');
try {
 // A successful read without confinement plus a failed descendant read proves enforcement.
 const control=join(root,'package.json');
 const readable=Bun.spawnSync(['/bin/cat',control],{cwd:output,stdout:'pipe',stderr:'pipe'});
 if(readable.exitCode!==0 || !readable.stdout.length)throw Error('Unconfined control was not readable');
 const denied=Bun.spawn([...prefix,'/bin/sh','-c','exec /bin/cat "$1"','control',control],{cwd:output,env,stdout:'pipe',stderr:'pipe'});
 const denial=await new Response(denied.stderr).text();
 if(await denied.exited===0 || !/Permission denied|Operation not permitted/.test(denial))throw Error('Checkout read denial control failed: '+denial);
 console.log('PASS checkout read denied in descendant process');
 const version=Bun.spawn([...prefix,artifact,'version'],{cwd:output,env,stdout:'pipe',stderr:'inherit'});
 const versionText=await new Response(version.stdout).text();
 console.log(versionText.trim());
 if(await version.exited!==0 || !versionText.split(/\r?\n/).includes('deck '+JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version) || !versionText.split(/\r?\n/).includes('target: '+target))throw Error('Extracted artifact version mismatch');
 await run([process.execPath,'test','--timeout','30000','packages/session-host/src/__tests__/git-diff.test.ts','packages/session-host/src/__tests__/git-diff-process.test.ts','packages/session-host/src/__tests__/project-files.test.ts']);
 await run([process.execPath,'test','--timeout','30000','packages/session-host/src/__tests__/session-manager.test.ts','-t','Git queries|Git process|native reader abort']);
 await run([process.execPath,'build','--compile','scripts/git-diff-runtime-smoke.ts','--outfile',join(output,'probe')]);
 // Confinement is inherited by the compiled probe and its native reader descendants.
 const probe=Bun.spawn([...prefix,join(output,'probe')],{cwd:output,env,stdout:'inherit',stderr:'inherit'});
 if(await probe.exited!==0)throw Error('Confined compiled probe failed');
 // Exercise the canonical CLI entrypoint, not only a reduced probe binary.
 // The canonical executable is extracted by the caller from the release archive.
 const fixture=join(output,'repo');await run(['git','init','-q',fixture]);
 writeFileSync(join(fixture,'small'),'canonical compiled reader\n');
 const token='a'.repeat(64);
 const child=Bun.spawn([...prefix,artifact,'internal-git-reader-v1'],{
  cwd:output,env:{...env,DECK_GIT_READER_TOKEN:token},
  stdin:'pipe',
  stdout:'pipe',stderr:'inherit',
 });
 child.stdin.write(JSON.stringify({version:1,token,projectRoot:fixture,selection:{section:'untracked',path:'small'}}));child.stdin.end();
 const reply=await new Response(child.stdout).json() as any;
 if(await child.exited!==0 || reply.token!==token || !reply.result?.data?.patch?.includes('+canonical compiled reader'))throw Error('Canonical compiled reader failed');
 const fileChild=Bun.spawn([...prefix,artifact,'internal-git-reader-v1'],{cwd:output,env:{...env,DECK_GIT_READER_TOKEN:token},stdin:'pipe',stdout:'pipe',stderr:'inherit'});
 fileChild.stdin.write(JSON.stringify({version:1,token,projectRoot:fixture,browse:{operation:'read',path:'small',showIgnored:false}}));fileChild.stdin.end();
 const fileReply=await new Response(fileChild.stdout).json() as any;
 if(await fileChild.exited!==0||fileReply.result?.data?.content!=='canonical compiled reader\n')throw Error('Canonical compiled project reader failed');
 console.log(`Native Git diff qualification passed: ${process.platform}-${process.arch}, Bun ${Bun.version}`);
}finally{rmSync(output,{recursive:true,force:true});}
