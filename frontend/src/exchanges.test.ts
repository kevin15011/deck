import {test,expect} from 'bun:test';
import {exchangePage,appendConversation} from './exchanges';
const identity={session:'s',task:'t',attempt:'a'};
const message={sequence:8,id:'m',role:'lead',source:'lead-delegation',at_ms:100,text:'Actual prompt',provenance:{runner:'codex',integration:'v1',content:'hash'}};
const page={...identity,messages:[message],nextCursor:8,more:false,settled:true,recording:'recorded'};
// Protects recorded authorship and scoped monotonic page admission.
// Oracle: runtime114 exchange identity/cursor contract; fails on foreign/replayed pages.
test('exchange pages preserve recorded authorship and reject foreign or replayed cursors',()=>{
 expect(exchangePage(page,identity,0).messages).toEqual([message]);
 for(const bad of [{...page,attempt:'foreign'},{...page,nextCursor:7},{...page,messages:[message,message]},{...page,messages:[{...message,at_ms:null}]},{...page,recording:'unavailable'}])expect(()=>exchangePage(bad,identity,0)).toThrow();
 expect(()=>exchangePage(page,identity,8)).toThrow();
 expect(exchangePage({...page,messages:[],nextCursor:8},identity,8).messages).toEqual([]);
});
// Protects a late delivery receipt reaching a conversation that is already open.
// Oracle: one guidance row per input, updated at its original position; fails if it duplicates or moves.
test('a re-issued guidance row updates in place and other rows keep their order',()=>{
 const row=(sequence:number,id:string,source:string,extra:object={})=>({...message,sequence,id,source,...extra});
 const open=appendConversation([],[row(1,'p','lead-delegation',{offset:0}),row(2,'guidance:g','lead-guidance',{delivery:'unknown'}),row(3,'o','member-output',{role:'member',offset:0})]);
 const updated=appendConversation(open,[row(9,'guidance:g','lead-guidance',{delivery:'accepted'})]);
 expect(updated.map(m=>[m.id,m.delivery])).toEqual([['p',undefined],['guidance:g','accepted'],['o',undefined]]);
});
