import { expect, test } from 'bun:test';
import { summarize, finalSegment, approvalPushFields } from '../push-attention';
import type { SessionEvent } from '@deck/core/session/events';
const e = (seq: number, kind: string, text?: string, role = 'assistant') => ({ v: 1, sessionId: 's', ts: new Date().toISOString(), seq, kind, source: { taskId: 'lead' }, data: { text, role } } as SessionEvent);
test('approval push metadata is bounded, identifier-only and fail-closed',()=>{
 expect(approvalPushFields({approvalId:'a',tool:'mcp__deck__read',risk:'normal',input:{command:'SECRET'},summary:'SECRET'})).toEqual({approvalId:'a',tool:'mcp__deck__read',risk:'normal'});
 for(const tool of ['Bash /private/path','/private/path','token=SECRET','x'.repeat(81),'Bash\u202esecret']){
  const fields=approvalPushFields({approvalId:'a',tool,risk:'unknown'});
  expect(fields).toEqual({approvalId:'a',tool:'Tool',risk:'high'});
 }
 expect(approvalPushFields({approvalId:'a',tool:'Bash'}).risk).toBe('high');
 const f=projection();f.state.approvals={a:{approvalId:'a',seq:11}};
 f.events[1]={...e(11,'approval.requested'),data:{approvalId:'a',tool:'Bash',risk:'normal',input:{command:'SECRET'}}};
 expect(f.run().find(a=>a.kind==='approval')).toMatchObject({approvalId:'a',tool:'Bash',risk:'normal'});
});
test('final-segment heuristic excludes tools, prior commentary and steering', () => {
    expect(finalSegment([e(1, 'message.completed', 'Checking'), e(2, 'tool.completed', 'SECRET'), e(3, 'message.completed', 'Done.'), e(4, 'reasoning.delta', 'SECRET'), e(5, 'message.completed', 'Tested.')], 'lead', 0, 6)).toBe('Done.\n\nTested.');
    expect(finalSegment([e(1, 'message.completed', 'old'), e(2, 'message.completed', 'steer', 'user')], 'lead', 0, 3)).toBe('');
});
test('mandatory summary is bounded plain text, redacted and language preserving', () => {
    expect(summarize('Changes:\n- **Fixed** [delivery](https://secret.test/path).\n- Tests passed.')).toBe('Fixed delivery. · Tests passed.');
    expect(summarize('```\nsecret\n```\n# Heading\n\nArreglé la entrega.')).toBe('Arreglé la entrega.');
    expect(summarize('token=supersecret Bearer abcdefghijklmnop')).toBeUndefined();
    for (const text of ['界'.repeat(500), '👩🏽‍💻'.repeat(200), 'e\u0301 '.repeat(500)]) {
        const s = summarize(text)!;
        expect(Buffer.byteLength(s)).toBeLessThanOrEqual(480);
        expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length).toBeLessThanOrEqual(160);
        expect(s).not.toContain('\ufffd');
    }
});
import { Ledger, type LedgerState } from '../ledger';
import { deriveAttention } from '../push-attention';
function projection() {
    const events = [{ ...e(10, 'task.integration'), ts: new Date().toISOString() }, { ...e(11, 'message.completed', 'Fixed delivery. Other work continues.'), ts: new Date().toISOString() }, { ...e(12, 'turn.completed'), ts: new Date().toISOString(), data: { status: 'completed' } }] as SessionEvent[];
    const state: LedgerState = { sessionId: 's', seq: 12, session: { state: 'running' }, tasks: { lead: { taskId: 'lead', memberId: 'lead', attempts: [{ attempt: 1, runnerId: 'codex', modelId: 'm', state: 'completed', startedSeq: 1, endedSeq: 14 }] }, child: { taskId: 'child', memberId: 'apply', attempts: [{ attempt: 1, runnerId: 'x', modelId: 'm', state: 'running', startedSeq: 2, integration: { seq: 10, leadTaskId: 'lead', leadAttempt: 1, commandId: 'i', state: 'integrated', note: 'reviewed', evidenceSeqs: [5] } }] } }, approvals: {}, anomalies: [] };
    return { state, events, run() { return deriveAttention({ ledger: Ledger.fromState(state), events: () => events, leadTaskId: 'lead', running: new Set(['child:1']), idle: false, notices: 0 }); } };
}
test('reviewed result while child runs, with structural evidence and admission retirement', () => {
    const f = projection();
    expect(f.run()).toMatchObject([{ kind: 'result', summary: 'Fixed delivery.', othersActive: true, seq: 12 }]);
    f.state.tasks.child.attempts[0]!.integration!.state = 'blocked';
    expect(f.run()).toEqual([]);
    f.state.tasks.child.attempts[0]!.integration!.state = 'integrated';
    f.events[1]!.seq = 9;
    expect(f.run()).toEqual([]);
    f.events[1]!.seq = 11;
    f.state.prompts = { p: { firstAdmissionSeq: 13 } as any };
    expect(f.run()).toEqual([]);
});
test('intentional interruption never becomes a failure notification', () => {
    const f = projection();
    for (const reason of ['session-stopped', 'daemon-stopped', 'daemon-restart', 'interrupted-forced']) {
        Object.assign(f.state.tasks.lead.attempts[0]!, { state: 'interrupted', reason });
        expect(f.run()).toEqual([]);
    }
});
test('UTF-16 input cap cannot emit an unpaired surrogate', () => {
    const text = 'x '.repeat(4095) + ' 👩🏽‍💻';
    const s = summarize(text) ?? '';
    expect(Buffer.from(s).toString('utf8')).toBe(s);
    expect(s).not.toContain('\ufffd');
});

test('decision revisions remain distinct and deferred/terminal states are quiet', () => {
    const f=projection();f.state.tasks.lead.attempts[0]!.state='running';
    f.state.decisions={a:{decisionId:'a',question:'Approve storage?',questionSeq:11,questionRevision:1,state:'pending',origin:{taskId:'lead',attempt:1}} as any};
    const run=(running=new Set<string>())=>deriveAttention({ledger:Ledger.fromState(f.state),events:()=>f.events,leadTaskId:'lead',running,idle:false,notices:0});
    expect(run(new Set(['lead:1']))).toEqual([]);expect(run()).toMatchObject([{kind:'decision',key:'decision:a',revision:1,summary:'Approve storage?'}]);
    f.state.decisions.a!.questionRevision=2;expect(run()[0]!.revision).toBe(2);
    for(const state of ['deferred','answered','cancelled','superseded']){f.state.decisions.a!.state=state as any;expect(run()).toEqual([]);}
});
test('result requires matching integrated claim, completed Lead and bounded final text',()=>{
 const f=projection();const integration=f.state.tasks.child.attempts[0]!.integration!;
 for(const state of ['blocked','discarded']){integration.state=state as any;expect(f.run()).toEqual([]);}
 integration.state='integrated';integration.leadAttempt=2;expect(f.run()).toEqual([]);integration.leadAttempt=1;
 f.state.tasks.lead.attempts[0]!.state='failed';expect(f.run().some(x=>x.kind==='result')).toBe(false);
 f.state.tasks.lead.attempts[0]!.state='completed';f.state.tasks.lead.attempts[0]!.endedSeq=10000;
 f.events.splice(0,0,...Array.from({length:4097},(_,n)=>e(n+2,'hook.started')));expect(f.run()).toEqual([]);
});

test('nested or mismatched code fences cannot expose code as a summary',()=>{
 expect(summarize('```text\n~~~\nPRIVATE CODE\n```\nDelivery repaired.')).toBe('Delivery repaired.');
 expect(summarize('````text\n```\nPRIVATE CODE\n````\nDelivery repaired.')).toBe('Delivery repaired.');
});
test('multi-byte grapheme caps exercise real truncation without splitting clusters',()=>{
 for(const text of ['界界界 '.repeat(150),'👩🏽‍💻 '.repeat(150),'e\u0301 '.repeat(200)]){
  const summary=summarize(text)!;expect(summary.length).toBeGreaterThan(50);
  expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(480);
  expect([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(summary)].length).toBeLessThanOrEqual(160);
  expect(Buffer.from(summary).toString('utf8')).toBe(summary);
 }
});

test('normalize formatted credentials and quoted fences before redaction',()=>{
 for(const text of ['**password**: DEMOPASSWORD42','**token:** DEMO_SECRET_42','> ```text\n> PRIVATE_CODE_42\n> ```\nDelivery fixed.']){
  const summary=summarize(text)??'';expect(summary).not.toMatch(/DEMOPASSWORD42|DEMO_?SECRET_?42|PRIVATE_?CODE_?42/);
 }
});

import {redactText} from '@deck/core/session/redaction';
test('previous ingestion redaction cannot leave a formatted credential remainder in a summary',()=>{
 for(const text of ['**password**: DEMOPASSWORD42','**token:** DEMO_SECRET_42']){
  expect(summarize(redactText(text)+'\n\nDelivery fixed.')).toBe('Delivery fixed.');
 }
});

test('quoted indentation remains code after container normalization',()=>{
 expect(summarize('>     PRIVATE_CODE_42\n\nDelivery fixed.')).toBe('Delivery fixed.');
});

test('complete table grammar with optional outer pipes, alignment and containers excludes data',()=>{
 for(const table of [
 'Credential | Value\n--- | ---\npassword | DEMOPASSWORD42',
 '| Credential | Value |\n| :--- | ---: |\n| password | DEMOPASSWORD42 |',
 '> Credential | Value\n> :---: | ---\n> password | DEMOPASSWORD42',
 '- Credential | Value\n  --- | ---\n  password | DEMOPASSWORD42',
 '> - Credential | Value\n>   --- | ---\n>   password | DEMOPASSWORD42',
 'Credential \\| Type | Value\n--- | ---\npassword | DEMOPASSWORD42',
 ])expect(summarize(table+'\n\nDelivery fixed.')).toBe('Delivery fixed.');
});

test('mixed nested list/quote containers exclude fenced content recursively',()=>{
 for(const prefix of ['- > ','> - > ','1. > - > ','> 1. > - > ','- > - > - > ']){
  const continuation=prefix.replace(/(?:[-*+]|\d+[.)]) /g,marker=>' '.repeat(marker.length));
  const content=prefix+'```text\n'+continuation+'PRIVATE_CODE_42\n'+continuation+'```\n\nDelivery fixed.';
  expect(summarize(redactText(content))).toBe('Delivery fixed.');
 }
 expect(summarize(redactText('- > ```text\n  > PRIVATE_CODE_42\n  > ```\n\nDelivery fixed.'))).toBe('Delivery fixed.');
});
test('budget-saturated input never emits a prefix with incomplete block classification',()=>{
 const header='password | DEMOPASSWORD42 ';
 for(const offset of [-1,0,1]){
  const text=header+' '.repeat(8192-header.length+offset)+'\n--- | ---\nname | value\n\nDelivery fixed.';
  expect(summarize(redactText(text))).toBeUndefined();
 }
 for(const length of [8192,8193,32768])expect(summarize(('Safe.\n\n'+header).padEnd(length,' '))).toBeUndefined();
 // The extraction path may already have capped a larger message to exactly 8192.
 expect(summarize(header.padEnd(8192,' '))).toBeUndefined();
 expect(summarize('Delivery fixed.'.padEnd(8191,' '))).toBe('Delivery fixed.');
 expect(summarize('Arreglé la entrega.')).toBe('Arreglé la entrega.');
});

test('nested-container classification stays bounded and preserves safe normal prose',()=>{
 for(const depth of [1,2,8,32]){
  const prefix='- > '.repeat(depth);
  const continuation=prefix.replace(/- /g,'  ');
  expect(summarize(prefix+'```text\n'+continuation+'PRIVATE_CODE_42\n'+continuation+'```\n\nDelivery fixed.')).toBe('Delivery fixed.');
 }
 const tooDeep='- > '.repeat(33); // 66 composable containers, beyond the bounded classifier.
 expect(summarize('Safe introduction.\n\n'+tooDeep+'```text\n'+tooDeep+'PRIVATE_CODE_42')).toBeUndefined();
 expect(summarize('- > **Delivery fixed.**')).toBe('Delivery fixed.');
 expect(summarize('-     PRIVATE_CODE_42\n\nDelivery fixed.')).toBe('Delivery fixed.');
 expect(summarize('Delivery fixed.\n\n'+ ' '.repeat(1000000))).toBeUndefined();
});
test('final-segment aggregation cannot turn a budget-cut table into publishable prose',()=>{
 const text=finalSegment([e(1,'message.completed','password | DEMOPASSWORD42'.padEnd(8191,' ')),e(2,'message.completed','--- | ---\nname | value\n\nDelivery fixed.')],'lead',0,3);
 expect(text.length).toBe(8192);expect(summarize(text)).toBeUndefined();
});

test('complete fenced blocks at the exact parsing boundary fail closed only at saturation',()=>{
 const start='- > ```text\n  > PRIVATE_CODE_42 ',end='\n  > ```\n\nDelivery fixed.';
 for(const length of [8191,8192,8193]){
  const text=start+' '.repeat(length-start.length-end.length)+end;expect(text.length).toBe(length);
  if(length<8192)expect(summarize(redactText(text))).toBe('Delivery fixed.');else expect(summarize(redactText(text))).toBeUndefined();
 }
});

test('literal container-looking code lines cannot become closing fences',()=>{
 for(const literal of ['- ```','> ```','- > ```']){
  expect(summarize('```text\n'+literal+'\nPRIVATE_CODE_42\n```\n\nDelivery fixed.')).toBe('Delivery fixed.');
 }
 expect(summarize('- > ```text\n  > - ```\n  > PRIVATE_CODE_42\n  > ```\n\nDelivery fixed.')).toBe('Delivery fixed.');
});

test('dedented quote content follows renderer prose ownership',()=>{
 const quote='> '.repeat(32),nearMiss='> '.repeat(31);
 expect(summarize(quote+'```text\n'+nearMiss+'PRIVATE_CODE_42\n'+quote+'```\n\nDelivery fixed.')).toBe('PRIVATE_CODE_42 · Delivery fixed.');
});

test('list padding and dedented fences follow CommonMark block ownership',()=>{
 for(const marker of ['-','+','*','1.','12)'])for(const padding of [2,3,4]){
  const text=marker+' '.repeat(padding)+'```text\n  ```\nPRIVATE_CODE_42\n```\n\nDelivery fixed.';
  expect(summarize(redactText(text))).not.toMatch(/PRIVATE_?CODE_?42/);
 }
});
