/** Failure-only probe for the synthetic packed-history test, never production.
 * Observe the real private-reader protocol and Git spawn without changing fds.
 */
import { spyOn } from 'bun:test';
import * as childProcess from 'node:child_process';
import { fstatSync } from 'node:fs';
import { dlopen, FFIType } from 'bun:ffi';
import { runGitReaderProcess } from '../../git-diff-process';

const native=dlopen(process.platform==='darwin'?'/usr/lib/libSystem.B.dylib':'libc.so.6',{
 lseek:{args:[FFIType.i32,FFIType.i64,FFIType.i32],returns:FFIType.i64},
});
const events:unknown[]=[];
const original=childProcess.spawn;
const hook=spyOn(childProcess,'spawn').mockImplementation(((...args:Parameters<typeof childProcess.spawn>)=>{
 const options=args[2];
 const stdio=options?.stdio;
 const handles=Array.isArray(stdio)?stdio.flatMap((fd,index)=>typeof fd==='number'&&index>=3?[{fd,target:index}]:[]):[];
 const snapshot=()=>handles.map(({fd,target})=>{
  try{const stat=fstatSync(fd);return {fd,target,dev:stat.dev,ino:stat.ino,size:stat.size,offset:String(native.symbols.lseek(fd,0,1))};}
  catch{return {fd,target,closed:true};}
 });
 // Fixture arguments and stderr contain no user repository data. Bound both.
 const event={args:(args[1] as string[]).slice(-8),before:snapshot(),after:[] as unknown[],code:null as number|null,signal:null as string|null,stderr:''};
 events.push(event);
 console.log(JSON.stringify({phase:'spawn',sequence:events.length,args:event.args,handles:event.before}));
 const child=original(...args);
 child.stderr?.on('data',(chunk:Buffer)=>{event.stderr=(event.stderr+chunk.toString()).slice(0,2048);});
 child.once('close',(code,signal)=>{event.code=code;event.signal=signal;event.after=snapshot();});
 return child;
}) as typeof childProcess.spawn);
try{await runGitReaderProcess();}
finally{
 hook.mockRestore();native.close();
 // stdout is captured by the test, independent of the production response.
 console.log('\n'+JSON.stringify({platform:process.platform,arch:process.arch,bun:Bun.version,events}));
}
