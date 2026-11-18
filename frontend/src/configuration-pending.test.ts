import {test,expect} from 'bun:test';
import {API,HttpError} from './api';
import {retainOperation,pendingOperations,forgetOperation,pendingKey,managementNotApplied,type PendingOperation} from './configuration-pending';
// S5A-Q01: oracle is independent operation recovery, never last-writer-wins.
const host='fixture-host',project='/owned/project';
const pending=(id:string):PendingOperation=>({id,allow:true,plan:{id:'plan-'+id,before:{host_id:host,project,revision:1,team_enabled:true,investigator:null,codex_executable:null,definitions:[]},team_enabled:false,trusted:false,qualification:null}});
class MemoryStorage implements Storage {
 data=new Map<string,string>();get length(){return this.data.size;}key(i:number){return [...this.data.keys()][i]??null;}getItem(k:string){return this.data.get(k)??null;}setItem(k:string,v:string){this.data.set(k,v);}removeItem(k:string){this.data.delete(k);}clear(){this.data.clear();}
}
test('separate tab responses survive stale rejection, reload and same-operation cleanup',()=>{
 const s=new MemoryStorage(),a=pending('operation-a'),b=pending('operation-b');
 retainOperation(s,host,project,a);retainOperation(s,host,project,b);
 forgetOperation(s,host,project,b);
 expect(pendingOperations(s,host,project).entries).toEqual([a]);
 forgetOperation(s,host,project,a);forgetOperation(s,host,project,a);
 expect(pendingOperations(s,host,project).entries).toEqual([]);
});
test('legacy migration copies before removing and does not erase other operations',()=>{
 const s=new MemoryStorage(),a=pending('operation-a'),b=pending('operation-b');
 s.setItem(pendingKey(host),JSON.stringify(a));retainOperation(s,host,project,b);
 expect(pendingOperations(s,host,project).entries).toEqual([a,b]);expect(s.getItem(pendingKey(host))).toBeNull();
 const failed=new MemoryStorage();failed.setItem(pendingKey(host),JSON.stringify(a));failed.setItem=()=>{throw Error('quota');};
 expect(pendingOperations(failed,host,project).issues.length).toBe(1);expect(failed.getItem(pendingKey(host))).toBe(JSON.stringify(a));
});
test('malformed, conflicting, foreign-host and unreadable identities preserve bytes and expose recovery issues',()=>{
 const s=new MemoryStorage(),a=pending('operation-a'),key=pendingKey(host)+'.'+a.id;
 for(const raw of ['{bad',JSON.stringify({...a,id:'wrong-key'}),JSON.stringify({...a,plan:{...a.plan,before:{...a.plan.before,host_id:'foreign-host'}}})]){
  s.setItem(key,raw);expect(pendingOperations(s,host,project).issues.length).toBe(1);forgetOperation(s,host,project,a);expect(s.getItem(key)).toBe(raw);
 }
 s.setItem(key,JSON.stringify({...a,allow:false}));expect(()=>retainOperation(s,host,project,a)).toThrow('conflicts');forgetOperation(s,host,project,a);expect(s.getItem(key)).not.toBeNull();
 s.getItem=()=>{throw Error('blocked');};expect(pendingOperations(s,host,project).issues.length).toBe(1);expect(()=>retainOperation(s,host,project,a)).toThrow('storage');
});
test('write and cleanup faults leave recovery available and cannot authorize dispatch',()=>{
 const s=new MemoryStorage(),a=pending('operation-a');s.setItem=()=>{throw Error('quota');};expect(()=>retainOperation(s,host,project,a)).toThrow();
 const t=new MemoryStorage();retainOperation(t,host,project,a);t.removeItem=()=>{throw Error('blocked');};expect(()=>forgetOperation(t,host,project,a)).toThrow();expect(pendingOperations(t,host,project).entries).toEqual([a]);
});
test('only exact authoritative non-application proof allows clearing a response',()=>{
 const a=pending('operation-a'),proof={api:API,code:'management_not_applied',plan:a.plan.id,operation_id:a.id};
 expect(managementNotApplied(new HttpError(409,'',proof),a)).toBe(true);
 for(const change of [{api:1},{code:'generic'},{plan:'other'},{operation_id:'operation-b'}])expect(managementNotApplied(new HttpError(409,'',{...proof,...change}),a)).toBe(false);
 expect(managementNotApplied(new HttpError(500,'',proof),a)).toBe(false);expect(managementNotApplied(new HttpError(409,'generic'),a)).toBe(false);
});
test('pending changes in another project do not block or appear in this project',()=>{
 const s=new MemoryStorage(),a=pending('operation-a'),b={...pending('operation-b'),plan:{...pending('operation-b').plan,before:{...a.plan.before,project:'/other'}}};
 retainOperation(s,host,project,a);retainOperation(s,host,'/other',b);
 expect(pendingOperations(s,host,project)).toEqual({entries:[a],issues:[]});
 expect(pendingOperations(s,host,'/other')).toEqual({entries:[b],issues:[]});
});
