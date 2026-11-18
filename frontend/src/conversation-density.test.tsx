import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect} from 'bun:test';
import {Review} from './review';
import type {Decision} from './api';
const fixture=(state:Decision['state'])=>({id:'decision-1',state,revision:2,questions:[],detail:'Recorded native result',resolution:{command_id:'response-1',expected_revision:1,response:{type:'allow_session'}},presentation:{version:1,kind:'command',validated:true,details:{command:'git status',cwd:'/fixture'},responses:['deny','allow_once','allow_session']}} as unknown as Decision);
const render=(state:Decision['state'],conversation=false)=>renderToStaticMarkup(React.createElement(Review,{d:fixture(state),connected:true,onError:()=>{},conversation} as React.ComponentProps<typeof Review>));
// Protects the conversation/action vs Activity/audit split. Oracle: density agreement.
// Fails if routine resolved requests remain visible or pending/uncertain requests disappear.
test('conversation keeps actionable and uncertain reviews and hides routine resolution history',()=>{
 for(const state of ['responded','dispatching','delivered','settled'] as const)expect(render(state,true).split('>')[0]).toMatch(/\shidden(?:=|\s|$)/);
 for(const state of ['pending','uncertain','invalidated'] as const)expect(render(state,true).split('>')[0]).not.toMatch(/\shidden(?:=|\s|$)/);
 expect(render('settled').split('>')[0]).not.toMatch(/\shidden(?:=|\s|$)/);
});
// Protects inspectable audit identity and actual recorded resolution. Oracle: same
// immutable decision, including response scope, survives relocation to Activity.
test('inspection retains action scope and exact recorded response identity',()=>{
 const html=render('settled');
 expect(html).toContain('git status');expect(html).toContain('/fixture');
 expect(html).toContain('response-1');expect(html).toContain('allow_session');
});

// Protects visible uncertainty when native completion lacks file-effect evidence.
// Oracle: density agreement retains meaningful failure/uncertainty.
test('missing settled file comparison remains visible in conversation',()=>{
 const source=fixture('settled');
 const d={...source,presentation:{...source.presentation!,kind:'file_edit'},file:{path:'/fixture/a.txt',before:'before',after:null,diff:'proposed',native_status:'completed',snapshot_error:'Snapshot unavailable'}};
 const html=renderToStaticMarkup(React.createElement(Review,{d,connected:true,onError:()=>{},conversation:true}));
 expect(html.split('>')[0]).not.toMatch(/\shidden(?:=|\s|$)/);
 expect(html).toContain('Snapshot unavailable');
});
