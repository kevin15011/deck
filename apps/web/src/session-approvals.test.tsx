import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { ApprovalChip, ApprovalConfirmation, SessionCreateButton, YoloFields } from './session-approvals';
const noop=()=>{};
test('YOLO creation defaults unchecked with no acknowledgement required',()=>{
 const html=render(<YoloFields enabled={false} acknowledged={false} onEnabled={noop} onAcknowledged={noop}/>);
 expect(html).not.toContain('checked=""');expect(html).toContain('YOLO mode — agents run without asking for permission');
 expect(html).toContain('YOLO is off by default and applies only to this session.');
 expect(html).toContain('You can enable it later from the session controls.');
 expect(render(<SessionCreateButton yolo={false} acknowledged={false}/>)).not.toContain('disabled');
});
test('creation requires acknowledgement only while YOLO is enabled',()=>{
 expect(render(<SessionCreateButton yolo acknowledged={false}/>)).toContain('disabled');
 expect(render(<SessionCreateButton yolo acknowledged/>)).not.toContain('disabled');
 expect(render(<SessionCreateButton yolo acknowledged disabled/>)).toContain('disabled');
});
test('YOLO warnings truthfully cover each runner and the next message',()=>{
 const html=render(<YoloFields enabled acknowledged={false} onEnabled={noop} onAcknowledged={noop}/>);
 for(const text of ['shell commands','edit or delete files','network','Claude cannot ask you structured questions','full-access sandbox','every tool permission is auto-allowed','Deck does not sandbox','next message','I understand the risks'])expect(html).toContain(text);
 expect(html).toContain('required=""');
});
test('approval chips describe behavior without showing an origin',()=>{
 expect(render(<ApprovalChip mode="yolo" source="session"/>)).toContain('>YOLO<');
 expect(render(<ApprovalChip mode="yolo" source="session"/>)).toContain('title="Agents act without asking. Enabled for this session."');
 expect(render(<ApprovalChip mode="relay" source="default"/>)).toContain('>Ask first<');
 expect(render(<ApprovalChip mode="relay" source="default"/>)).toContain('title="Agents ask for your approval before acting"');
 for(const source of ['session','default'] as const)expect(render(<ApprovalChip mode="relay" source={source}/>)).not.toContain('Source:');
});
test('enable confirmation gates submission, displays errors and allows cancellation',()=>{
 const props={acknowledged:false,onAcknowledged:noop,onCancel:noop,onSubmit:noop};
 const html=render(<ApprovalConfirmation {...props} error="Request failed"/>);
 expect(html).toMatch(/disabled="">Enable YOLO/);expect(html).toContain('role="alert"');expect(html).toContain('Cancel');
 expect(render(<ApprovalConfirmation {...props} acknowledged/>)).not.toMatch(/disabled="">Enable YOLO/);
});
test('confirmation cannot submit while saving and reflects acknowledged state',()=>{
 const html=render(<ApprovalConfirmation acknowledged onAcknowledged={noop} onCancel={noop} onSubmit={noop} pending/>);
 expect(html).toContain('checked=""');expect(html).toMatch(/disabled="">Saving…/);
});
