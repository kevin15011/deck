import React from 'react';
import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {CurrentTurnAction,SteeringStatus} from './steering';
test('explicit current-turn control is capability gated and normal submit remains separate',()=>{
 expect(renderToStaticMarkup(<CurrentTurnAction available={false} disabled={false}/>)).toBe('');
 const html=renderToStaticMarkup(<CurrentTurnAction available disabled={false}/>);expect(html).toContain('Send to current turn');expect(html).toContain('name="delivery"');expect(html).toContain('value="current-turn"');expect(html).toContain('form="prompt-composer"');
});
test('delivery status distinguishes sending, native acceptance and uncertainty without resend or consumption claims',()=>{
 const html=renderToStaticMarkup(<SteeringStatus deliveries={[{promptId:'a',text:'<unsafe>',state:'sending'},{promptId:'b',text:'Accepted input',state:'accepted'},{promptId:'c',text:'Unknown input',state:'unknown'}]}/>);
 expect(html).toContain('Sending to Codex');expect(html).toContain('Accepted by Codex');expect(html).toContain('may already have received');expect(html).toContain('&lt;unsafe&gt;');expect(html).not.toContain('<button');expect(html).not.toContain('read by');
});
test('historical refusal is explicit non-delivery without a resend action',()=>{
 const html=renderToStaticMarkup(<SteeringStatus deliveries={[{promptId:'a',text:'Earlier refused text',state:'not-accepted'}]}/>);
 expect(html).toContain('Not accepted by Codex');expect(html).toContain('not queued or sent again');expect(html).not.toContain('Uncertain');expect(html).not.toContain('<button');expect(html).toContain('aria-live="polite"');
});
test('Claude uncertainty names selected-execution uncertainty, possible retained context and no automatic retry',()=>{
 const html=renderToStaticMarkup(<SteeringStatus deliveries={[{promptId:'c',text:'Potentially retained',state:'unknown',runnerId:'claude',historical:true}]}/>);
 expect(html).toContain('Claude Code');expect(html).toContain('not confirmed delivery to the selected execution');expect(html).toContain('may remain in later context');expect(html).toContain('not be sent again automatically');expect(html).not.toContain('Accepted by');expect(html).not.toContain('<button');
});
test('Claude folded acceptance distinguishes current and historical proof while preserving Codex attribution',()=>{
 const html=renderToStaticMarkup(<SteeringStatus deliveries={[{promptId:'a',text:'Current input',state:'accepted',runnerId:'claude'},{promptId:'b',text:'Original input',state:'accepted',runnerId:'claude',historical:true},{promptId:'d',text:'Codex input',state:'accepted',runnerId:'codex'}]}/>);
 expect(html).toContain('Accepted by Claude Code');expect(html).toContain('Confirmed for the original Claude Code execution');expect(html).toContain('Accepted by Codex');
});
