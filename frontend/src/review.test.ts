import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Decision} from './api';
import {test,expect} from 'bun:test';
import {nativeActionDetails,Review} from './review';
// Protects consent display without changing exact grant identity. Oracle: Q02;
// fails if targets/payloads disappear, secrets/control text leak, or display grows unbounded.
test('native consent shows distinct MCP actions with bounded redacted display only',()=>{
 const action=(recipient:string,body:string)=>({server:'synthetic-mail',tool:'send_message',input:{recipient,body,token:'fixture-secret',url:'https://user:password@example.test/?access_token=hidden&target=visible'}});
 const first=action('alpha@example.test','First payload'),second=action('beta@example.test','Second payload');
 expect(nativeActionDetails(first)).toContain('alpha@example.test');
 expect(nativeActionDetails(second)).toContain('Second payload');
 expect(nativeActionDetails(first)).not.toContain('fixture-secret');
 expect(nativeActionDetails(first)).not.toContain('password');
 expect(nativeActionDetails(first)).not.toContain('hidden');
 expect(nativeActionDetails(first)).toContain('target=visible');
 expect(nativeActionDetails(action('alpha', '\u202e\u001b[31m'+'a'.repeat(7000))).length).toBeLessThan(4200);
 expect(nativeActionDetails(action('alpha', '\u202e\u001b[31m'))).not.toContain('\u202e');
 expect(first.input.token).toBe('fixture-secret');
});

// Protects generic top-level as well as nested action-secret redaction in the new
// consent view; oracle: existing redaction boundary, never a new exact authority.
// Fails if splitting labelled fields exposes a secret that JSON display hid.
test('labelled permission action keeps redaction before consent',()=>{
 const d={id:'d',state:'pending',questions:[],detail:'',presentation:{version:1,kind:'external_action',validated:true,details:{operation:'send_message',recipient:'alpha@example.test',token:'top-level-secret',input:{token:'nested-secret'}},responses:['deny','allow_once']}} as unknown as Decision;
 const html=renderToStaticMarkup(React.createElement(Review,{d,connected:true,onError:()=>{}}));
 expect(html).toContain('alpha@example.test');expect(html).not.toContain('top-level-secret');expect(html).not.toContain('nested-secret');
});
