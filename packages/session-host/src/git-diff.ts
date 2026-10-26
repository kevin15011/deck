import type {ProjectBrowse} from '../../core/src/session/project-files';
/** Host admission and process supervision. Native reads never run in the host. */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GIT_READER_COMMAND, MAX_REQUEST, MAX_RESPONSE, MAX_FILE_RESPONSE } from './git-diff-process';
import type { CommandOutcome } from './protocol';
const active=new Set<string>();
const failed=(message:string):CommandOutcome=>({ok:false,code:'git-unavailable',message});
async function request(projectRoot:string,selection?:{section:unknown,path:unknown,content?:boolean},browse?:ProjectBrowse):Promise<CommandOutcome> {
 const key=resolve(projectRoot);
 if(active.has(key)||active.size>=4)return {ok:false,code:'git-busy',message:'Another Git view request is running. Try again.'};
 active.add(key);
 let temporaryRoot:string|undefined;
 try {
  const token=randomBytes(32).toString('hex');
  let input:string;
  try {
   if(selection && (typeof selection.section!=='string'||typeof selection.path!=='string'))throw Error();
   input=JSON.stringify({version:1,token,projectRoot,selection,browse});
   if(Buffer.byteLength(input)>MAX_REQUEST)throw Error();
  }catch{return {ok:false,code:'git-invalid',message:'Invalid Git selection.'};}
  temporaryRoot=await realpath(await mkdtemp(join(tmpdir(),'deck-git-process-')));
  const args=import.meta.url.includes('/$bunfs/')
   ? [GIT_READER_COMMAND] : [fileURLToPath(new URL('./git-diff-process.ts',import.meta.url))];
  return await new Promise<CommandOutcome>(done=>{
   const child=spawn(process.execPath,args,{cwd:temporaryRoot,detached:true,stdio:['pipe','pipe','pipe'],
    env:{...process.env,TMPDIR:temporaryRoot,DECK_GIT_READER_TOKEN:token}});
   let size=0,limited=false;const chunks:Buffer[]=[];
   const kill=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{}};
   const timer=setTimeout(()=>{limited=true;kill();},30000);
   child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(browse?MAX_FILE_RESPONSE:MAX_RESPONSE)){limited=true;kill();}else chunks.push(chunk);});
   child.stderr.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(browse?MAX_FILE_RESPONSE:MAX_RESPONSE)){limited=true;kill();}}); // Drain crash diagnostics without exposing repository data.
   child.stdin.on('error',()=>{});
   child.once('error',()=>{clearTimeout(timer);done(failed('Git reader could not start.'));});
   child.once('exit',kill); // Best effort on exit; the deadline also covers inherited pipes held by descendants.
   child.once('close',(code,signal)=>{
    clearTimeout(timer);kill(); // Also reap any Git descendants after a native abort.
    if(limited){done({ok:false,code:'git-limit',message:'Git reader exceeded its time or output limit.'});return;}
    if(code!==0||signal){done(failed('Git reader process failed. Retry the request.'));return;}
    try {
     const reply=JSON.parse(Buffer.concat(chunks).toString());
     if(reply.version!==1||reply.token!==token||typeof reply.result?.ok!=='boolean')throw Error();
     done(reply.result);
    }catch{done(failed('Git reader returned an invalid response.'));}
   });
   child.stdin.end(input);
  });
 }catch{return failed('Git reader could not start.');}
 finally {
  try{if(temporaryRoot)await rm(temporaryRoot,{recursive:true,force:true});}
  finally{active.delete(key);}
 }
}
export function listGitChanges(projectRoot:string){return request(projectRoot);}
export function readGitDiff(projectRoot:string,section:unknown,path:unknown){return request(projectRoot,{section,path});}

export function readGitContent(projectRoot:string,section:unknown,path:unknown){return request(projectRoot,{section,path,content:true});}

export function browseProject(projectRoot:string,browse:ProjectBrowse){return request(projectRoot,undefined,browse);}
