import {validProjectActivities} from "./activity-summary";
import { expect, test } from 'bun:test';
import { workerActivity } from './activity-summary';
// Protects the accepted shared running-worker definition; queued and blocked are not running.
test('counts independent latest worker states, excluding Lead and terminal attempts', () => {
 expect(workerActivity([{taskId:'lead',memberId:'lead',state:'running'},{taskId:'a',state:'running'},{taskId:'b',state:'running'},{taskId:'c',state:'queued'},{taskId:'d',state:'failed'},{taskId:'e',state:'completed'}],new Set(['b']))).toEqual({active:1,queued:1,blocked:1,unsettled:0});
});

test('project summary transport accepts only complete counts for the exact requested identities',()=>{
 const row={projectId:'p',connected:1,leadsRunning:0,leadsStarting:0,attentionSessions:0,workers:{active:2,queued:0,blocked:0,unsettled:0},attention:{approvals:0,questions:0,decisions:0,byLead:0,byWorkers:0,unowned:0},errors:0};
 expect(validProjectActivities([row],['p'])).toBe(true);
 for(const rows of [null,[null],[{projectId:'p'}],[row,row],[{...row,projectId:'other'}],[],[{...row,workers:null}],[{...row,errors:-1}],[{...row,connected:NaN}],[{...row,workers:{...row.workers,active:1.5}}],[{...row,attention:{...row.attention,questions:'1'}}]]) expect(validProjectActivities(rows,['p'])).toBe(false);
});
