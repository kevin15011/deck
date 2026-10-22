import {expect,test} from 'bun:test';
import {mergeStructuredTask, utf8Bytes} from './task-handoff';
const f={id:'F1',state:'open' as const,text:'Fix race'};
test('structured omission/empty/merge/replace and explicit closure/reopen preserve unresolved state',()=>{
 const p=mergeStructuredTask({}, {acceptance:{items:[{id:'AC1',text:'Safe'}]},findings:{items:[f]},sourceTasks:[]});
 expect(mergeStructuredTask(p,{})).toEqual(p);
 expect(mergeStructuredTask(p,{acceptance:{items:[]}}).acceptance?.items).toEqual([]);
 expect(mergeStructuredTask(p,{findings:{items:[]}}).findings).toEqual([f]);
 expect(()=>mergeStructuredTask(p,{findings:{mode:'replace',items:[]}})).toThrow('drop-open');
 expect(()=>mergeStructuredTask(p,{findings:{items:[{...f,state:'resolved'}]}})).toThrow('evidence');
 const closed=mergeStructuredTask(p,{findings:{items:[{...f,state:'resolved',resolution:'Verified',evidenceSeqs:[1]}]}});
 expect(closed.findings).toEqual([]);
 expect(()=>mergeStructuredTask(closed,{findings:{items:[f]}})).toThrow('evidence');
 expect(mergeStructuredTask(closed,{findings:{items:[{...f,resolution:'Regression',evidenceSeqs:[2]}]}}).findings?.length).toBe(1);
 for(const field of ['acceptance','findings','sourceTasks']) expect(()=>mergeStructuredTask(p,{[field]:null})).toThrow();
});
test('validates actual UTF8 merged budgets and exact same-session references',()=>{
 expect(utf8Bytes('😀')).toBe(4);
 expect(()=>mergeStructuredTask({}, {sourceTasks:[{taskId:'foreign',attempt:1}]},()=>false)).toThrow();
 const items=Array.from({length:10},(_,i)=>({id:'a'+i,text:'漢'.repeat(1000)}));
 expect(()=>mergeStructuredTask({}, {acceptance:{items}})).toThrow('overflow');
 expect(()=>mergeStructuredTask({}, {findings:{items:[f,f]}})).toThrow();
 expect(()=>mergeStructuredTask({}, {acceptance:{items:[],refs:[{path:'../escape'}]}})).toThrow();
});
