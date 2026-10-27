import {test,expect,spyOn} from 'bun:test';
import * as childProcess from 'node:child_process';
import {listGitChanges} from '../git-diff';
import {existsSync} from 'node:fs';

// Replace only the child program, retaining real OS pipes, lifecycle and supervision.
for(const [name,program,code] of [
 ['unauthenticated response', 'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({version:1,token:"wrong",result:{ok:true}})))','git-unavailable'],
 ['excessive output','process.stdout.write("x".repeat(5*1024*1024));setInterval(()=>{},1000)','git-limit'],
 ['aborted process with a live descendant', 'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});setTimeout(()=>process.kill(process.pid,"SIGABRT"),50)','git-unavailable'],
 ['hung process','setInterval(()=>{},1000)','git-limit'],
] as const) {
 test(`reader supervisor rejects ${name} and cleans request resources`,async()=>{
  const original=childProcess.spawn;let temporaryRoot='';
  const spy=spyOn(childProcess,'spawn').mockImplementation(((_executable:any,_args:any,options:any)=>{
   temporaryRoot=options.env.TMPDIR;
   return original(process.execPath,['-e',program],options);
  }) as typeof childProcess.spawn);
  try {
   const start=performance.now();
   const result=await listGitChanges('/tmp');
   // Some runtimes delay exit notification until inherited descendant pipes close.
   // The hard deadline must still kill the group, clean it and release admission.
   if(name==='aborted process with a live descendant'){
    expect(result.ok).toBe(false);
    if(result.ok)throw Error('Unexpected successful crash response');
    expect(['git-unavailable','git-limit']).toContain(result.code!);
   }else expect(result).toMatchObject({ok:false,code});
   if(name==='aborted process with a live descendant')expect(performance.now()-start).toBeLessThan(35000);
   expect(temporaryRoot).not.toBe('');
   expect(existsSync(temporaryRoot)).toBe(false);
  }finally{spy.mockRestore();}
  // A subsequent call must reach the reader, rather than retaining admission.
  expect(await listGitChanges('/tmp')).toMatchObject({ok:false,code:'git-unavailable'});
 },40000);
}
