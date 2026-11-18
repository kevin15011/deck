import {test,expect} from 'bun:test';
import {historyRows,type HistoryEvent} from './history-projection';
const e=(seq:number,kind:string,text:string,taskId='lead',role='assistant'):HistoryEvent=>({v:1,sessionId:'original',seq,ts:'2026-01-01Z',kind,source:{taskId},data:{text,role}});
// Protects original ChatHistory folding: each task's completed answer replaces
// its streamed prefix, user input and other tasks remain separate and ordered.
test('original task streams fold across page boundaries without duplicate answers',()=>{
 const first=[e(1,'message.completed','question','lead','user'),e(2,'message.delta','hel'),e(3,'message.delta','other','member')];
 expect(historyRows(first).map(v=>v.data.text)).toEqual(['question','hel','other']);
 expect(historyRows([...first,e(4,'message.delta','lo'),e(5,'message.completed','hello'),e(6,'message.completed','other done','member')]).map(v=>v.data.text)).toEqual(['question','hello','other done']);
});
// Protects turn fences and original suppression of system/internal conversation.
test('turn fences keep interrupted text separate from a later answer',()=>{
 const rows=historyRows([e(1,'message.delta','partial'),e(2,'turn.completed',''),e(3,'message.completed','later'),e(4,'message.completed','secret system','lead','system'),{...e(5,'message.completed','internal'),data:{text:'internal',internal:true}}]);
 expect(rows.map(v=>v.data.text)).toEqual(['partial','later']);
});
