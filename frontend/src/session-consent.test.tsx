import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'bun:test';
import {Review} from './review';
import {decisionPresentation} from './presentation';
import type {Decision} from './api';
// Protects: broader role/session consent must be disclosed and validated before
// offering it. Oracle: runtime125 BACKEND-CONTRACT.md; fails if malformed metadata
// falls back to exact-action consent or scope/lifetime is absent from the consent UI.
const scope={kind:'delegation_role',role:'apply-deep',assignment_revision:7,lifetime:'session_generation',survives_host_restart:true,revocation:'deck_session',description:'Delegate new tasks to apply-deep in this session with the current assignments.'} as const;
const projection=(extra:object={})=>({version:1,kind:'tool',validated:true,details:{server:'deck-session',tool:'deck_delegate',input:{agent:'apply-deep',task:'A synthetic task'}},responses:['allow_once','allow_session','deny'],...extra});
const render=(p:unknown)=>renderToStaticMarkup(<Review d={{id:'d',revision:17,state:'pending',questions:[],detail:'',presentation:decisionPresentation(p)} as unknown as Decision} connected onError={()=>{}}/>);
test('validated role grant discloses its scope and lifetime before session consent',()=>{
 const p=projection({session_grant:scope});
 expect(decisionPresentation(p)?.session_grant).toEqual(scope);
 const html=render(p),button=html.indexOf('Allow this role for this session');
 expect(button).toBeGreaterThan(0);
 const primary=html.slice(0,button).replace(/<[^>]+>/g,' ');
 // Material meaning stays before consent; wording and technical identifiers are not the oracle.
 for(const meaning of [/new tasks/i,/apply-deep/,/this session/i,/survives restarting/i,/ends if.*team or session permissions change/i,/revoke.*session permissions/i,/other roles and tools.*separate permission/i])expect(primary).toMatch(meaning);
 // Technical producer evidence remains inspectable in the existing disclosure.
 const recorded=html.slice(html.indexOf('class="receipt-details"'));
 for(const key of Object.keys(scope))expect(recorded).toContain(key);
 expect(recorded).toContain(scope.description);
 expect(html).toContain('Allow once');expect(html).toContain('Deny');
});
test('invalid or unsupported additive scope blocks session consent without losing once/deny',()=>{
 const incomplete=[null,{},undefined,[],...Object.keys(scope).map(key=>{const copy:Record<string,unknown>={...scope};delete copy[key];return copy;})];
 const unsupported=[{kind:'unknown'},{role:'lead'},{role:''},{role:'quality\u202e'},{assignment_revision:'7'},{assignment_revision:0},{assignment_revision:1.5},{assignment_revision:Number.MAX_SAFE_INTEGER+1},
  {lifetime:'forever'},{survives_host_restart:false},{revocation:'outside_deck'},{description:' '},{description:'x'.repeat(4097)},{description:'Bearer private-fixture'},{description:'hidden\nline'},{description:'hidden\u202e'}].map(v=>({...scope,...v}));
 for(const grant of [...incomplete,...unsupported]){
  const decoded=decisionPresentation(projection({session_grant:grant}));
  expect(decoded?.session_grant).toBeNull();
  const html=render(projection({session_grant:grant}));
  expect(html).not.toContain('>Allow this role for this session<');expect(html).not.toContain('>Allow for this session<');
  expect(html).toContain('Allow once');expect(html).toContain('Deny');
 }
});
test('absent metadata preserves exact historical and other-tool session consent',()=>{
 for(const details of [{server:'deck-session',tool:'deck_delegate'},{server:'integration',tool:'inspect'}]){
  const p={...projection(),details};expect(decisionPresentation(p)?.session_grant).toBeUndefined();
  const html=render(p);expect(html).toContain('>Allow for this session<');expect(html).toContain('exact action');expect(html).not.toContain('Allow this role for this session');
 }
});

// Settled permissions live in Activity; the same scope must remain inspectable.
test('settled role grant retains its scope without offering new consent',()=>{
 const d={id:'d',revision:17,state:'settled',questions:[],detail:'',resolution:{response:{type:'allow_session'}},presentation:decisionPresentation(projection({session_grant:scope}))} as unknown as Decision;
 const html=renderToStaticMarkup(<Review d={d} connected onError={()=>{}}/>);
 const recorded=html.slice(html.indexOf('class="receipt-details"'));
 expect(recorded).toContain(scope.description);expect(recorded).toContain('assignment_revision');expect(recorded).toContain('session_generation');
 const buttons=html.match(/<button\b[^>]*>Allow this role for this session<\/button>/g)??[];
 expect(buttons.length).toBe(1);expect(buttons.every(button=>button.includes('disabled=') )).toBe(true);
});
