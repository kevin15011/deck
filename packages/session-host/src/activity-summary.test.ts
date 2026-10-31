import {expect,test} from 'bun:test';
import {Ledger} from './ledger';
import {summarizeActivity} from './activity-summary';
// Protects attempt recovery and independent human attention, from the accepted contract.
test('latest attempts replace old errors while unanswered requests survive reading',()=>{
 const state=Ledger.empty('s').toState();
 state.tasks={lead:{taskId:'lead',memberId:'lead',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:1,state:'completed'}]},worker:{taskId:'worker',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:2,state:'failed'},{attempt:2,runnerId:'fake',modelId:'fake',startedSeq:3,state:'running'}]}};
 state.questions={q:{questionId:'q',taskId:'worker',questions:[],seq:4}};
 let ledger=Ledger.fromState(state);
 expect(summarizeActivity(ledger,'lead')).toMatchObject({errors:0,workers:{active:0,blocked:1},attention:{questions:1,byWorkers:1}});
 state.lastLeadReplySeq=12;ledger=Ledger.fromState(state);
 expect(summarizeActivity(ledger,'lead').attention.questions).toBe(1);
 state.questions={};ledger=Ledger.fromState(state);
 expect(summarizeActivity(ledger,'lead')).toMatchObject({workers:{active:1,blocked:0},attention:{questions:0}});
 state.tasks.worker!.attempts[1]!.state='completed';
 expect(summarizeActivity(Ledger.fromState(state),'lead')).toMatchObject({workers:{active:0},attention:{decisions:0},errors:0});
});

test('pending human decisions differ from internal worker integration and clear on resolution',()=>{
 const state=Ledger.empty('s').toState();
 state.tasks.lead={taskId:'lead',memberId:'lead',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:1,state:'running'}]};
 state.decisions={d:{decisionId:'d',revision:1,questionRevision:1,questionSeq:2,createdSeq:2,updatedSeq:2,question:'Choose scope',state:'pending',origin:{taskId:'lead',attempt:1,admissionSeq:1},source:{promptId:'p'},key:'scope',openingFingerprint:'f',relatedTaskIds:[],replies:[]}};
 expect(summarizeActivity(Ledger.fromState(state),'lead').attention.decisions).toBe(0);
 state.tasks.lead.attempts[0]!.state='completed';
 expect(summarizeActivity(Ledger.fromState(state),'lead').attention).toMatchObject({decisions:1,byLead:1});
 state.tasks.worker={taskId:'worker',memberId:'review',attempts:[{attempt:2,runnerId:'fake',modelId:'fake',startedSeq:3,state:'running'}]};
 state.decisions.d!.origin={taskId:'worker',attempt:1,admissionSeq:1};
 expect(summarizeActivity(Ledger.fromState(state),'lead')).toMatchObject({workers:{active:1,blocked:0},attention:{decisions:1,byWorkers:1}});
 state.decisions.d!.state='answered';
 expect(summarizeActivity(Ledger.fromState(state),'lead').attention.decisions).toBe(0);
});

// Exact attempt disposition resolves discarded failure; success elsewhere cannot mask a new failure.
test('any integration resolves a failed attempt, but never unsettled ownership',()=>{
 const state=Ledger.empty('s').toState();
 state.tasks.worker={taskId:'worker',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:1,state:'failed'}]};
 state.tasks.replacement={taskId:'replacement',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:2,state:'completed'}]};
 const attempt=state.tasks.worker.attempts[0]!;
 const errors=()=>summarizeActivity(Ledger.fromState(state),'lead').errors;
 expect(errors()).toBe(1);
 for(const disposition of ['integrated','blocked','discarded'] as const){
  attempt.integration={seq:3,leadTaskId:'lead',leadAttempt:1,commandId:'c',state:disposition,note:'Handled',evidenceSeqs:[1]};
  expect(errors()).toBe(0);
 }
 attempt.state='ownership-unsettled';expect(errors()).toBe(1);
 attempt.state='failed';
 state.tasks.worker.attempts.push({attempt:2,runnerId:'fake',modelId:'fake',startedSeq:4,state:'failed'});
 expect(errors()).toBe(1);
});
