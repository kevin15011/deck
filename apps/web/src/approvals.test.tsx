import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { ApprovalCard, ApprovalConfirmation, SessionPermissions, AutoApprovalMessage, approvalView } from './approvals';
import type { SessionEvent } from '../../../packages/core/src/session/events';
const event=(data:Record<string,unknown>):SessionEvent=>({v:1,sessionId:'s',seq:1,kind:'approval.requested',ts:'2026-01-01T00:00:00Z',source:{taskId:'lead'},data:{approvalId:'a',tool:'Bash',summary:'Run a command',...data}});
const base={toolKey:'claude:Bash',exactKey:'cat "a file.txt" && echo <safe>',risk:'normal',allowedScopes:['once','session']};
const noop=()=>{};
test('legacy and once-only approvals expose only allow once and deny',()=>{
 for(const data of [{},{allowedScopes:['once']}]){const html=render(<ApprovalCard event={event(data)} onRespond={async()=>{}}/>);expect(html).toContain('Allow once');expect(html).toContain('Deny');expect(html).not.toContain('Allow for this session');expect(html).not.toContain('Always allow');}
});
test('session menu names exact action and tool verbatim and omits missing exact choices',()=>{
 const html=render(<ApprovalCard event={event(base)} onRespond={async()=>{}}/>);
 expect(html).toContain('Allow for this session');expect(html).toContain('This exact action');expect(html).toContain('Any use of Bash');expect(html).toContain('cat &quot;a file.txt&quot; &amp;&amp; echo &lt;safe&gt;');expect(html).not.toContain('Always allow');
 expect(render(<ApprovalCard event={event({...base,exactKey:undefined})} onRespond={async()=>{}}/>)).not.toContain('This exact action');
});
test('high risk session tool grants visibly warn before confirmation',()=>{
 const html=render(<ApprovalCard event={event({...base,risk:'high'})} onRespond={async()=>{}}/>);
 expect(html).toContain('High risk');expect(html).toContain('every action');
});
test('always appears only when advertised',()=>{
 const html=render(<ApprovalCard event={event({...base,allowedScopes:['once','session','always'],alwaysNote:'Stored by the runner on this machine.'})} onRespond={async()=>{}}/>);
 expect(html).toContain('Always allow…');
});
test('confirmation quotes persistence note and gates the acknowledgement',()=>{
 const request=approvalView(event({...base,allowedScopes:['once','always'],alwaysNote:'Stored by OpenCode on this machine; Deck cannot revoke it.'}));
 const props={request,choice:{scope:'always' as const},acknowledged:false,onAcknowledged:noop,onCancel:noop,onConfirm:noop};
 const html=render(<ApprovalConfirmation {...props}/>);
 expect(html).toContain('Stored by OpenCode on this machine; Deck cannot revoke it.');expect(html).toContain('I understand');expect(html).toContain('required=""');expect(html).toMatch(/disabled="">Always allow/);
 expect(render(<ApprovalConfirmation {...props} acknowledged/>)).not.toMatch(/disabled="">Always allow/);
 expect(render(<ApprovalConfirmation {...props} acknowledged pending/>)).toContain('Saving…');
});
test('high-risk tool confirmation shows breadth and requires acknowledgement',()=>{
 const html=render(<ApprovalConfirmation request={approvalView(event({...base,risk:'high'}))} choice={{scope:'session',grant:'tool'}} acknowledged={false} onAcknowledged={noop} onCancel={noop} onConfirm={noop}/>);
 expect(html).toContain('every action');expect(html).toMatch(/disabled="">Allow for this session/);expect(html).toContain('Bash');
});
test('session permissions hide empty state and list revocable exact and tool grants',()=>{
 expect(render(<SessionPermissions grants={[]} onRevoke={async()=>{}}/>)).toBe('');
 const html=render(<SessionPermissions grants={[{grantId:'g',kind:'exact',toolKey:'claude:Bash',exactKey:'cat README.md',risk:'high',createdAt:'now'},{grantId:'h',kind:'tool',toolKey:'codex:fileChange',risk:'high',createdAt:'now'}]} onRevoke={async()=>{}}/>);
 expect(html).toContain('Session permissions (2)');expect(html).toContain('exact:');expect(html).toContain('cat README.md');expect(html).toContain('any use');expect(html.match(/>Revoke</g)).toHaveLength(2);
});
test('auto-approved line preserves tool and action without a reply acknowledgement',()=>{
 const html=render(<AutoApprovalMessage detail={{tool:'Bash',exactKey:'cat README.md'}}/>);
 expect(html).toContain('Auto-approved by a session permission');expect(html).toContain('cat README.md');expect(html).toContain('muted');expect(html).not.toContain('data-reply-seq');
});
test('confirmation errors stay inline and missing persistence details cannot be acknowledged away',()=>{
 const html=render(<ApprovalConfirmation request={approvalView(event({...base,allowedScopes:['once','always']}))} choice={{scope:'always'}} acknowledged onAcknowledged={noop} onCancel={noop} onConfirm={noop} error="approval-scope-unsupported"/>);
 expect(html).toContain('role="alert"');expect(html).toContain('approval-scope-unsupported');expect(html).toMatch(/disabled="">Always allow/);
});
