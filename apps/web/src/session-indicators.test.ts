import {expect,test} from 'bun:test';
import {sessionIndicatorDescription,statusFresh} from './session-indicators';
import type {WorkspaceSession} from './workspace-types';
const session:WorkspaceSession={preparationStatus:'ready',leadActivity:{state:'completed',pendingApprovals:0,lastReplySeq:1},activity:{workers:{active:2,queued:1,blocked:1,unsettled:0},attention:{approvals:1,questions:0,decisions:0,byLead:0,byWorkers:1,unowned:0},errors:0}};
// Protects simultaneous worker activity, Lead availability and unresolved attention.
test('availability does not consume activity or human attention',()=>{
 const text=sessionIndicatorDescription(session,true);
 expect(text).toContain('Lead available');expect(text).toContain('2 active subagents');expect(text).toContain('1 approvals');
 for(const update of [{releasing:true},{removing:true},{state:'ended'},{preparationStatus:'unprepared' as const}]) expect(sessionIndicatorDescription({...session,...update},true)).not.toContain('Lead available');
 expect(sessionIndicatorDescription(session,false)).not.toContain('Lead available');
});
test('missing, failed and expired fetches cannot claim freshness',()=>{
 expect(statusFresh(undefined,10000)).toBe(false);
 expect(statusFresh({checkedAt:1000},2000)).toBe(true);
 expect(statusFresh({checkedAt:1000,stale:true},2000)).toBe(false);
 expect(statusFresh({checkedAt:1000},11000)).toBe(false);
});

test('human-blocked Lead is waiting while workers remain active',()=>{
 for(const pending of [{pendingQuestions:1},{pendingApprovals:1}]){
  const text=sessionIndicatorDescription({...session,leadActivity:{...session.leadActivity!,state:'running',...pending}},true);
  expect(text).toContain('Lead waiting');expect(text).not.toContain('Lead working');expect(text).toContain('2 active subagents');
 }
});
