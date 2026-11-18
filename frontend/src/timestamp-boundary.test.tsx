import {test,expect} from 'bun:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {task} from './api';
import {exchangePage} from './exchanges';
import {Subagents} from './subagents';
const maximum=8640000000000000;
const identity={session:'s',task:'t',attempt:'a'};
const page=(at_ms:unknown)=>({...identity,messages:[{sequence:1,id:'m',role:'lead',source:'lead-delegation',at_ms,text:'Recorded message',provenance:{runner:'codex',integration:'v1',content:'hash'}}],nextCursor:1,more:false,settled:true,recording:'recorded'});
const projection=(at_ms:unknown)=>({id:'t',session:'s',root:'r',parent_attempt:'lead',owner:'quality',scope:[],acceptance:'check',revision:2,attempts:[{id:'a',prompt:'check',source_report:null,phase:'failed',detail:'Failed',requested_model:'p/m',observed_model:null,provenance:{runner:'codex',integration:'v1',executable:'hash',storage:'owned',content:'hash'},native_session:null,native_message:null,generation:'g',accepted_ms:1,preparation_ms:null,tool_connection_ms:null,dispatch_ms:null,acknowledgment_ms:null,first_output_ms:null,settled_ms:2,cancel_requested:false,report:null,treatments:[],failure_dismissal:{command_id:'dismiss',at_ms,revision:2}}]});
// Protects recorded exchanges from committing timestamps that crash the panel.
// Oracle: Q89-01 and ECMAScript TimeClip range; fails if first invalid ms is accepted.
test('exchange dates accept the inclusive Date boundary and reject non-renderable times',()=>{
 for(const ms of [0,maximum-1,maximum]){
  const decoded=exchangePage(page(ms),identity,0);
  expect(Number.isFinite(new Date(decoded.messages[0].at_ms).getTime())).toBe(true);
 }
 for(const ms of [maximum+1,Number.MAX_SAFE_INTEGER,-1,NaN,Infinity,null,'100',1.5])expect(()=>exchangePage(page(ms),identity,0)).toThrow('Invalid recorded conversation message');
});
// Protects handled failures from bypassing validation before actual Subagents render.
// Oracle: Q89-01, existing nonnegative timestamp contract and Date range. Fails if
// invalid dismissal enters task state, or a valid maximum crashes the real renderer.
test('dismissal dates validate before projection and maximum renders in Subagents',()=>{
 for(const ms of [0,maximum-1,maximum]){
  const decoded=task(projection(ms));
  const html=renderToStaticMarkup(<Subagents tasks={[decoded]} session="s" visible connected onError={()=>{}} decisions={[]}/>);
  expect(html).toContain(new Date(ms).toISOString());
 }
 for(const ms of [maximum+1,Number.MAX_SAFE_INTEGER,-1,NaN,Infinity,null,'100',1.5])expect(()=>task(projection(ms))).toThrow('Invalid failure dismissal');
});
