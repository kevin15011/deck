import {test,expect} from 'bun:test';
import {mergeTasks,type DisplayTask} from './original-tasks';
import type {Task} from './api';
// Protects selection identity when original paging and current workspace delivery
// arrive in either order. Oracle: ORIGINAL-TASK-06, not component markup.
test('one lineage survives late historical delivery with continuous attempts and routes',()=>{
 const old:DisplayTask={id:'recorded-display',session:'s',owner:'quality',original:{taskId:'old',snapshot:'snapshot'},attempts:[1,2].map(number=>({id:`original:${number}`,original:{taskId:'old',snapshot:'snapshot',displayId:'recorded-display'},recordedNumber:number,phase:'completed',report:null,treatments:[],provenance:{runner:'codex'},requested_model:'recorded',observed_model:null,native_session:null,native_message:null,accepted_ms:1,cancel_requested:false,detail:''}))};
 const current={id:'internal',session:'s',owner:'quality',original:{task_id:'old',display_id:'recorded-display',fingerprint:'snapshot',maximum:2},attempts:[{...old.attempts[0],id:'new-attempt',original:undefined,recordedNumber:undefined,number:3}]} as unknown as Task;
 const first=mergeTasks([], [current],'s'),later=mergeTasks([old],[current],'s');
 expect(first[0]!.id).toBe(later[0]!.id);expect(later).toHaveLength(1);expect(later[0]!.executionId).toBe('internal');
 expect(later[0]!.attempts.map(a=>a.recordedNumber??a.number)).toEqual([1,2,3]);expect(later[0]!.attempts[0]!.original?.taskId).toBe('old');expect(later[0]!.attempts[2]!.original).toBeUndefined();
 expect(mergeTasks([old],[current],'foreign')).toEqual([old]);
 const mismatch=mergeTasks([old],[{...current,original:{...current.original!,fingerprint:'different'}}],'s');expect(mismatch).toHaveLength(1);expect(mismatch[0]!.attempts).toHaveLength(1);expect(mismatch[0]!.historyError).toBeDefined();
});
