import {expect,test} from 'bun:test';
import {createScopedTaskDiff} from './session-task-diff';
test('scopes every workspace read to attributed literal paths and bounded no-effects Git options',async()=>{
 const calls:{args:string[];options:any}[]=[];
 const provider=createScopedTaskDiff(async(args,options)=>{calls.push({args,options});return {stdout:args.includes('rev-parse')?'abc\n':args.includes('status')?'?? new.ts\0':'diff evidence',stderr:''};});
 await expect(provider({projectRoot:'/project',paths:[':(glob)*.ts','new.ts'],maxBytes:16384,signal:new AbortController().signal})).rejects.toThrow('task-diff-path-invalid');
 // invalid colon/pathspec is rejected, not executed
 expect(calls).toHaveLength(0);
});
test('supports only validated paths, disables external diff/textconv and discloses untracked content',async()=>{
 const calls:string[][]=[];
 const provider=createScopedTaskDiff(async(args,options)=>{calls.push(args);expect(options.timeout).toBe(5000);expect(options.maxBuffer).toBeLessThanOrEqual(16384);return {stdout:args.includes('rev-parse')?'abc\n':args.includes('status')?'?? new.ts\0':'diff evidence',stderr:''};});
 expect(await provider({projectRoot:'/project',paths:['new.ts'],maxBytes:16384,signal:new AbortController().signal})).toMatchObject({baseHead:'abc',text:'diff evidence',unavailable:expect.stringContaining('Untracked')});
 expect(calls[2]).toContain('--no-ext-diff');expect(calls[2]).toContain('--no-textconv');expect(calls[2]?.slice(-2)).toEqual(['--','new.ts']);
 const count=calls.length;
 await expect(provider({projectRoot:'/project',paths:['../outside'],maxBytes:16384,signal:new AbortController().signal})).rejects.toThrow();expect(calls).toHaveLength(count);
});
