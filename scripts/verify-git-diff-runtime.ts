/** Run on each native release platform; compilation alone is not qualification. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root=resolve(import.meta.dir,'..');
const output=mkdtempSync(join(tmpdir(),'deck-git-qualification-'));
async function run(args:string[],cwd=root) {
 const process=Bun.spawn(args,{cwd,stdout:'inherit',stderr:'inherit'});
 if(await process.exited!==0)throw Error(`Failed: ${args.join(' ')}`);
}
try {
 await run([process.execPath,'test','packages/session-host/src/__tests__/git-diff.test.ts','packages/session-host/src/__tests__/git-diff-process.test.ts','packages/session-host/src/__tests__/project-files.test.ts']);
 await run([process.execPath,'test','packages/session-host/src/__tests__/session-manager.test.ts','-t','Git queries|Git process|native reader abort']);
 await run([process.execPath,'build','--compile','scripts/git-diff-runtime-smoke.ts','--outfile',join(output,'probe')]);
 // A foreign cwd prevents accidentally resolving the helper from the source tree.
 await run([join(output,'probe')],output);
 // Exercise the canonical CLI entrypoint, not only a reduced probe binary.
 await run([process.execPath,'build','--compile','apps/cli/src/main.tsx','--outfile',join(output,'deck')]);
 const fixture=join(output,'repo');await run(['git','init','-q',fixture]);
 writeFileSync(join(fixture,'small'),'canonical compiled reader\n');
 const token='a'.repeat(64);
 const child=Bun.spawn([join(output,'deck'),'internal-git-reader-v1'],{
  cwd:output,env:{...process.env,DECK_GIT_READER_TOKEN:token,TMPDIR:output},
  stdin:'pipe',
  stdout:'pipe',stderr:'inherit',
 });
 child.stdin.write(JSON.stringify({version:1,token,projectRoot:fixture,selection:{section:'untracked',path:'small'}}));child.stdin.end();
 const reply=await new Response(child.stdout).json() as any;
 if(await child.exited!==0 || reply.token!==token || !reply.result?.data?.patch?.includes('+canonical compiled reader'))throw Error('Canonical compiled reader failed');
 const fileChild=Bun.spawn([join(output,'deck'),'internal-git-reader-v1'],{cwd:output,env:{...process.env,DECK_GIT_READER_TOKEN:token,TMPDIR:output},stdin:'pipe',stdout:'pipe',stderr:'inherit'});
 fileChild.stdin.write(JSON.stringify({version:1,token,projectRoot:fixture,browse:{operation:'read',path:'small',showIgnored:false}}));fileChild.stdin.end();
 const fileReply=await new Response(fileChild.stdout).json() as any;
 if(await fileChild.exited!==0||fileReply.result?.data?.content!=='canonical compiled reader\n')throw Error('Canonical compiled project reader failed');
 console.log(`Native Git diff qualification passed: ${process.platform}-${process.arch}, Bun ${Bun.version}`);
}finally{rmSync(output,{recursive:true,force:true});}
