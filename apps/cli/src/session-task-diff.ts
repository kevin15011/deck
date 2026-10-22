import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {projectRelativePath,utf8Bytes} from '@deck/core/session/task-handoff';
import {redactText} from '@deck/core/session/redaction';
import type {ScopedDiffProvider} from '@deck/session-host';
const exec=promisify(execFile);
type GitRead=(args:string[],options:{cwd:string;signal:AbortSignal;maxBuffer:number;timeout:number;env:NodeJS.ProcessEnv})=>Promise<{stdout:string;stderr:string}>;
/** CLI owns Git effects. Membership must come from task-attributed edits, never git status/diff discovery. */
export function createScopedTaskDiff(read:GitRead=(args,options)=>exec('git',args,options)):ScopedDiffProvider {
 return async input=>{
  if(input.paths.length>256 || !input.paths.every(projectRelativePath))throw new Error('task-diff-path-invalid');
  const paths=[...new Set(input.paths)];
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(5000)]);
  const env:NodeJS.ProcessEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_PAGER:'cat'};
  for(const key of Object.keys(env))if(key.startsWith('GIT_') && !['GIT_TERMINAL_PROMPT','GIT_OPTIONAL_LOCKS','GIT_PAGER'].includes(key))delete env[key];
  const options={cwd:input.projectRoot,signal,maxBuffer:Math.min(input.maxBytes,16384),timeout:5000,env};
  const prefix=['--literal-pathspecs','-c','core.fsmonitor=false'];
  const capturedAt=new Date().toISOString();
  try{
   const head=(await read([...prefix,'rev-parse','--verify','HEAD'],options)).stdout.trim();
   const status=(await read([...prefix,'status','--porcelain=v1','-z','--untracked-files=normal','--',...paths],options)).stdout;
   const diff=(await read([...prefix,'diff','--no-ext-diff','--no-textconv','--no-renames','--no-color','--submodule=short','HEAD','--',...paths],options)).stdout;
   const bytes=utf8Bytes(diff);
   // Never misrepresent untracked, binary, deleted or moved files as empty changes.
   const untracked=status.split('\0').some(row=>row.startsWith('??'));
   const text=redactText(diff,16384);
   return {text:utf8Bytes(text)<=input.maxBytes?text:'[diff exceeds byte budget; content unavailable]',baseHead:head,capturedAt,status:redactText(status.replaceAll('\0','\n'),8192),truncated:bytes>input.maxBytes||utf8Bytes(text)>input.maxBytes,...(untracked?{unavailable:'Untracked file contents are not captured by git diff HEAD; task-attributed paths are listed in status.'}:{})};
  }catch{return {text:'',capturedAt,status:'unavailable',truncated:false,unavailable:signal.aborted?'scoped-diff-cancelled-or-deadline':'scoped-diff-unavailable-or-byte-limit'};}
 };
}
export const readScopedTaskDiff=createScopedTaskDiff();
