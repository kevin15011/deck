import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'bun:test';
import {sessionQueue,cancelQueuedInput} from './input-queue';
import {InputQueue} from './input-queue-view';
import {type Receipt,API} from './api';
const row=(id:string,session='a',accepted_ms=1)=>({id,session,accepted_ms,attempt:'attempt-'+id,phase:'queued',dispatch_ms:null,prompt:'Message '+id,attachments:[]} as unknown as Receipt);
// Protects queue provenance and session ownership. Oracle: only accepted queued
// receipts in the selected session may be shown; ordinal means session wait order.
test('queue view isolates accepted session input and preserves acceptance order',()=>{
 const outcome={...row('outcome'),continuation:{task:'task',attempt:'member-attempt',source_seq:1,origin:'previous-root'}};
 const rows=[row('second','a',2),row('foreign','b'),{...row('running'),phase:'running'} as Receipt,outcome,row('first')];
 expect(sessionQueue(rows,'a').map(r=>r.id)).toEqual(['second','first']);
 const html=renderToStaticMarkup(<InputQueue receipts={rows} session="a" connected paused={false} onPause={()=>{}} onError={()=>{}}/>);
 expect(html).toContain('Message first');expect(html).toContain('Message second');expect(html).not.toContain('Message foreign');expect(html).not.toContain('Message running');
});
// Protects the queue/start race: queue cancellation must never interrupt a turn
// already dispatched. Oracle: existing exact undispatched recall contract.
test('queued cancellation binds attempt and refuses mismatched acknowledgment',async()=>{
 const input=row('command/a');let requestBody:unknown;
 await cancelQueuedInput(input,async(method,path,body)=>{
  expect(method).toBe('POST');expect(path).toBe('/api/commands/command%2Fa/recall');
  requestBody=body;return {id:input.id,session:'a',attempt:input.attempt,state:'cancelled'};
 });expect(requestBody).toEqual({api:API,session:'a',attempt:input.attempt});
 for(const delta of [{id:'other'},{session:'other'},{attempt:'other'},{state:'running'}])await expect(cancelQueuedInput(input,async()=>({id:input.id,session:'a',attempt:input.attempt,state:'cancelled',...delta}))).rejects.toThrow();
 let called=false;await expect(cancelQueuedInput({...input,phase:'running',dispatch_ms:2},async()=>{called=true;})).rejects.toThrow();expect(called).toBe(false);
 await expect(cancelQueuedInput(input,async()=>{throw Error('already dispatched');})).rejects.toThrow('already dispatched');
});

// Protects Q99-02. Oracle: host receipt arrival order survives clock rollback
// and equal timestamps; frontend must not invent ordering from wall time or IDs.
test('queue preserves authoritative arrival order through rollback and timestamp ties',()=>{
 const rows=[row('first','a',200),row('second','a',100),row('z-tie','a',100),row('a-tie','a',100)];
 expect(sessionQueue(rows,'a').map(r=>r.id)).toEqual(['first','second','z-tie','a-tie']);
 expect(rows.map(r=>r.id)).toEqual(['first','second','z-tie','a-tie']);
});
