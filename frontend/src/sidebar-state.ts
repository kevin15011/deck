import {active,type Workspace} from './api';
import {type WorkspaceSession,type ProjectActivity} from './session-indicators';
export function sessionStatus(w:Workspace,id:string,decisions=0):WorkspaceSession {
 const rows=w.receipts.filter(r=>r.session===id),current=rows.find(r=>active(r)||r.phase==='queued'||r.phase==='uncertain')??rows.at(-1);
 const pending=rows.flatMap(r=>r.decisions).filter(d=>['pending','responded','dispatching','uncertain'].includes(d.state));
 const leadPending=pending.filter(d=>!d.task||d.task==='lead');
 const approvals=leadPending.filter(d=>!d.questions.length).length,questions=leadPending.filter(d=>d.questions.length>0).length;
 const workers=workerCounts(w,id);
 // Counts come from persisted receipts and decisions, never inferred from a rendered view.
 const errors=Number(current?.phase==='failed'||current?.phase==='uncertain')+subagentErrorCount(w,id);
 const preparing=!!current&&['queued','accepted','preparing','dispatching'].includes(current.phase);
 return {preparationStatus:preparing?'preparing':current&&['running','cancelling'].includes(current.phase)?'ready':current?.phase==='failed'?'failed':'disconnected',leadActivity:{state:current?.phase==='uncertain'?'ownership-unsettled':current?.phase==='cancelling'?'running':current?.phase??'unknown',pendingApprovals:approvals,pendingQuestions:questions},activity:{workers,attention:{approvals:pending.filter(d=>!d.questions.length).length,questions:pending.filter(d=>d.questions.length>0).length,decisions,byLead:pending.filter(d=>!d.task||d.task==='lead').length+decisions,byWorkers:pending.filter(d=>!!d.task&&d.task!=='lead').length,unowned:0},errors}};
}
export function subagentErrorCount(w:Workspace,session:string):number {
 return w.tasks.filter(task=>{
  if(task.session!==session||task.owner==='lead')return false;
  const attempt=task.attempts.at(-1);
  if(attempt?.phase==='uncertain')return true;
  if(attempt?.phase!=='failed'||attempt.failure_dismissal)return false;
  const disposition=attempt.treatments.at(-1)?.disposition;
  return disposition!=='adopted'&&disposition!=='rejected';
 }).length;
}

export function projectStatus(projectId:string,rows:WorkspaceSession[]):ProjectActivity {
 return rows.reduce<ProjectActivity>((v,s)=>{const a=s.activity!;v.connected+=Number(s.preparationStatus==='ready');v.leadsRunning+=Number(s.leadActivity?.state==='running');v.leadsStarting+=Number(s.preparationStatus==='preparing');for(const k of ['active','queued','blocked','unsettled'] as const)v.workers[k]+=a.workers[k];for(const k of ['approvals','questions','decisions','byLead','byWorkers','unowned'] as const)v.attention[k]+=a.attention[k];v.attentionSessions+=Number(a.attention.approvals+a.attention.questions+a.attention.decisions>0);v.errors+=a.errors;return v;},{projectId,connected:0,leadsRunning:0,leadsStarting:0,workers:{active:0,queued:0,blocked:0,unsettled:0},attentionSessions:0,attention:{approvals:0,questions:0,decisions:0,byLead:0,byWorkers:0,unowned:0},errors:0});
}

// One logical task contributes only its latest attempt. Preparation is queued work;
// pending human requests exclude execution, matching the original workerActivity.
export function workerCounts(w:Workspace,session:string){
 const pending=w.receipts.filter(r=>r.session===session).flatMap(r=>r.decisions).filter(d=>['pending','responded','dispatching','uncertain'].includes(d.state));
 const workers={active:0,queued:0,blocked:0,unsettled:0};
 for(const t of w.tasks.filter(t=>t.session===session&&t.owner!=='lead')){
  const a=t.attempts.at(-1);if(!a)continue;
  if(a.phase==='uncertain')workers.unsettled++;
  else if(['queued','accepted','preparing','dispatching','running','cancelling'].includes(a.phase)){
   if(pending.some(d=>d.task===t.id&&d.attempt===a.id))workers.blocked++;
   else if(['running','cancelling'].includes(a.phase))workers.active++;
   else workers.queued++;
  }
 }
 // Retain attention for a task whose projection has not arrived yet.
 workers.blocked+=new Set(pending.filter(d=>d.task&&d.task!=='lead'&&!w.tasks.some(t=>t.session===session&&t.id===d.task)).map(d=>d.task)).size;
 return workers;
}

/** The sidebar count includes pending native requests and actionable session decisions.
 * Worker blocks from the same native requests already appear in the receipt. */
export function sidebarAttention(w:Workspace|undefined,decisions:Record<string,number>|undefined){
 const requests=new Map<string,Set<string>>();
 for(const receipt of w?.receipts??[]){
  for(const decision of receipt.decisions){
   if(decision.state!=='pending')continue;
   const ids=requests.get(receipt.session)??new Set<string>();
   ids.add(decision.id);
   requests.set(receipt.session,ids);
  }
 }
 return new Map((w?.sessions??[]).flatMap(session=>{
  const count=(requests.get(session.id)?.size??0)+(decisions?.[session.id]??0);
  return count>0?[[session.id,count] as const]:[];
 }));
}
