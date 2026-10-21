/** Failure-only test evidence. Never participates in native ownership/admission decisions. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {childSessionPath} from './storage';

export function captureResumeRejection(parentFile:string,job:{parent:string;childId:string;[key:string]:any},response:unknown):string {
 const file=childSessionPath(parentFile,job.parent,job.childId),root=mkdtempSync(join(tmpdir(),'deck-pi-resume-rejection-'));
 const inspect=(path:string)=>{try{const s=lstatSync(path);return{mode:s.mode&0o777,uid:s.uid,nlink:s.nlink,size:s.size,symlink:s.isSymbolicLink(),directory:s.isDirectory()};}catch(error){return{error:(error as NodeJS.ErrnoException).code};}};
 const bounded=(value:unknown,limit:number)=>{const text=JSON.stringify(value)??String(value);return{text:text.slice(0,limit),truncated:text.length>limit};};
 const leasePath=file+'.execution',metadata=inspect(leasePath);let lease:any,leaseError:string|undefined;
 try{if('size' in metadata&&typeof metadata.size==='number'&&metadata.size<=8192&&!metadata.symlink&&!metadata.directory)lease=JSON.parse(readFileSync(leasePath,'utf8'));}catch(error){leaseError=String(error).slice(0,512);}
 const probe=(command:string,args:string[],maxBuffer=4096)=>{try{return{ok:true,stdout:execFileSync(command,args,{encoding:'utf8',timeout:2000,maxBuffer,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']}).slice(0,4096)};}catch(error){const e=error as any;return{ok:false,code:e.code,status:e.status,signal:e.signal,stdout:String(e.stdout??'').slice(0,2048),stderr:String(e.stderr??'').slice(0,2048)};}};
 const existence=(pid:number)=>{try{process.kill(pid,0);return'present';}catch(error){return(error as NodeJS.ErrnoException).code;}};
 const positive=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0;
 const processEvidence:any={capturedAfterRefusal:true};
 if(process.platform==='darwin'){
  processEvidence.boot=probe('/usr/sbin/sysctl',['-n','kern.bootsessionuuid']);
  if(positive(lease?.child?.pid))processEvidence.child=probe('/bin/ps',['-p',String(lease.child.pid),'-o','pid=,pgid=,stat=']);
  // Match the release probe's global table, retaining no command lines or unrelated process rows.
  try{
   const rows=execFileSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:2000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']}).trim().split('\n').filter(Boolean);
   const pattern=/^\s*(\d+)\s+(\d+)\s+([A-Za-z+<NsEXsWLl-]+)\s*$/;
   processEvidence.groupTable={rows:rows.length,unparsed:rows.filter(line=>!pattern.test(line)).slice(0,8).map(line=>line.slice(0,128)),ownedGroup:rows.filter(line=>{const match=pattern.exec(line);return match&&Number(match[2])===lease?.group;}).slice(0,16).map(line=>line.slice(0,128))};
  }catch(error){const e=error as any;processEvidence.groupTable={error:e.code,status:e.status,signal:e.signal,stderr:String(e.stderr??'').slice(0,1024)};}

 }
 if(positive(lease?.parent?.pid))processEvidence.parentExists=existence(lease.parent.pid);
 if(positive(lease?.child?.pid))processEvidence.childExists=existence(lease.child.pid);
 if(positive(lease?.group))processEvidence.groupExists=existence(-lease.group);
 const sources=Object.fromEntries(['execution-lease.ts','runner.ts','jobs.ts','extension.ts'].map(name=>{const p=new URL(name,import.meta.url);return[name,createHash('sha256').update(readFileSync(p)).digest('hex')];}));
 const artifact={v:1,at:new Date().toISOString(),runtime:process.version,bun:Bun.version,platform:process.platform,pid:process.pid,umask:process.umask(),sources,response:bounded(response,8192),job:{id:job.id,parent:job.parent,childId:job.childId,state:job.state,attempt:job.attempt,failureKind:job.failureKind,exitCode:job.exitCode,signal:job.signal,output:bounded(job.output,4096)},history:{path:file,metadata:inspect(file)},lease:{metadata,value:lease,error:leaseError},gate:inspect(leasePath+'.gate'),processEvidence};
 const path=join(root,'rejection.json');writeFileSync(path,JSON.stringify(artifact,null,2),{mode:0o600});return path;
}
