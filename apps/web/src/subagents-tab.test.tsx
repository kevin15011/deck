import React from 'react';
import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import type {SessionEvent} from '../../../packages/core/src/session/events';
import {CurrentEvents} from '../../../packages/core/src/session/chat-history';
import {snapshotView} from './chat-history';
import {emptyState,reduceEvent} from './state';
import {Tabs,hasWorkingSubagent} from './workspace';
const event=(seq:number,kind:SessionEvent['kind'],taskId:string,data:Record<string,unknown>={}):SessionEvent=>({v:1,sessionId:'s',seq,kind,source:{taskId},data,ts:'2026-10-19T00:00:00Z'});
test('tab work uses current children only, excluding Lead, historical replies and queued or blocked tasks',()=>{
 const view=emptyState();view.tasks={lead:{state:'running'},'lead-g1':{state:'running'},'assigned-lead':{memberId:'lead',state:'running'},child:{memberId:'investigate',state:'completed',attempt:2}};
 view.events=[event(1,'task.state','child',{state:'running',attempt:1}),event(2,'message.completed','child',{role:'assistant',text:'Unread old reply'})];
 for(const state of ['created','preparing','queued','blocked','failed','ownership-unsettled','cancelled','interrupted','completed']){view.tasks.child!.state=state;expect(hasWorkingSubagent(view)).toBe(false);}
 view.tasks.child!.state='running';expect(hasWorkingSubagent(view)).toBe(true);
 view.approvals.a=event(3,'approval.requested','child',{approvalId:'a'});expect(hasWorkingSubagent(view)).toBe(false);delete view.approvals.a;
 view.questions.q=event(4,'question.requested','child',{questionId:'q'});expect(hasWorkingSubagent(view)).toBe(false);delete view.questions.q;
 view.approvals.other=event(5,'approval.requested','other',{approvalId:'other'});expect(hasWorkingSubagent(view)).toBe(true);
});
test('latest-attempt work agrees in live and reconnect projections and clears after the last running child',()=>{
 let view=emptyState();const current=new CurrentEvents();
 const append=(kind:SessionEvent['kind'],taskId:string,data:Record<string,unknown>)=>{const next=event(view.seq+1,kind,taskId,data);view=reduceEvent(view,next);current.apply(next);};
 const expectWorking=(wanted:boolean)=>{expect(hasWorkingSubagent(view)).toBe(wanted);expect(hasWorkingSubagent(snapshotView(current.values(),view.seq))).toBe(wanted);};
 append('task.created','child',{memberId:'investigate',attempt:1,state:'queued'});expectWorking(false);
 append('task.state','child',{state:'running'});expectWorking(true);
 append('task.state','child',{state:'completed'});expectWorking(false);
 append('task.continued','child',{attempt:2});append('task.state','child',{state:'queued'});expectWorking(false);
 append('task.state','child',{state:'running'});append('task.created','second',{memberId:'quality',state:'running'});expectWorking(true);
 append('task.state','child',{state:'completed'});expectWorking(true);append('task.state','second',{state:'completed'});expectWorking(false);
 expect(hasWorkingSubagent(emptyState())).toBe(false);
});
test('Subagents tab reuses the working primitive beside its title while Chat is selected with a stable accessible name',()=>{
 const working=renderToStaticMarkup(<Tabs active="chat" onChange={()=>{}} subagentsWorking/>);
 expect(working).toContain('aria-label="Subagents"');expect(working).toContain('aria-describedby=');expect(working).toContain('Subagents working');expect(working).toContain('data-state="working"');expect(working).toContain('work-orbit');expect(working).not.toContain('data-unread');expect(working.match(/class="tab-working"/g)).toHaveLength(1);
 const idle=renderToStaticMarkup(<Tabs active="chat" onChange={()=>{}}/>);expect(idle).toContain('class="tab-working"');expect(idle).not.toContain('agent-indicator');expect(idle).toContain('No subagents working');
});
test('reviewing an earlier attempt cannot overwrite the current execution projection',()=>{
 const events=[event(1,'task.created','child',{memberId:'investigate',attempt:1}),event(2,'task.state','child',{state:'completed'}),event(3,'task.continued','child',{attempt:2}),event(4,'task.state','child',{state:'running'}),event(5,'task.retrieval','lead',{taskId:'child',attempt:1}),event(6,'task.integration','lead',{taskId:'child',attempt:1,state:'integrated'})];
 const view=events.reduce(reduceEvent,emptyState()),current=new CurrentEvents();for(const e of events)current.apply(e);
 for(const projection of [view,snapshotView(current.values(),view.seq)]){expect(projection.tasks.child).toMatchObject({attempt:2,state:'running'});expect(hasWorkingSubagent(projection)).toBe(true);}
});
