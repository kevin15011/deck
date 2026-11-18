import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'bun:test';
import {Review} from './review';
import {decisionPresentation} from './presentation';
import type {Decision} from './api';
// Protects: persistent consent requires complete validated scope, while once/session
// remain usable. Oracle: Q92-01 and proposed neutral scope contract. Fails if a
// broader command prefix can be approved unseen or malformed scope enables it.
const amendment=['git']; // Synthetic actual proposedExecpolicyAmendment for displayed git status.
const scope={kind:'command_prefix',validated:true,prefix:amendment,persistence:'across_sessions',revocation:'outside_deck'};
const projection=(grant:unknown)=>({version:1,kind:'external_action',validated:true,details:{command:'git status'},responses:['deny','allow_once','allow_session','allow_always'],...(grant===undefined?{}:{persistent_grant:grant})});
const render=(grant:unknown)=>renderToStaticMarkup(<Review d={{id:'d',revision:17,state:'pending',questions:[],detail:'',presentation:decisionPresentation(projection(grant))} as unknown as Decision} connected onError={()=>{}}/>);
test('persistent control is withheld without trustworthy scope without losing once/session',()=>{
 for(const grant of [undefined,null,{}, {...scope,validated:false},{...scope,prefix:[]},{...scope,prefix:['git\n']},{...scope,kind:'unknown'},{...scope,persistence:'session'},{...scope,revocation:'unknown'},{...scope,prefix:['x'.repeat(8193)]},{...scope,prefix:['git\u202e'] }]){
  const html=render(grant);expect(html).not.toContain('Always allow this permission');expect(html).toContain('Allow once');expect(html).toContain('Allow for this session');
 }
});
test('persistent disclosure names the exact synthetic amendment and all consequences before confirmation',()=>{
 const html=render(scope);
 expect(html).toContain('Always allow this permission');
 // Disclosure semantics are the consent oracle, not a layout/style snapshot.
 expect(html).toContain('[&quot;git&quot;]');expect(html).toContain('future sessions');expect(html).toContain('Deck cannot revoke');
 expect(amendment).toEqual(['git']);
});
