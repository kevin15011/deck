import {active,type Workspace} from './api';
import {type WorkspaceSession,type ProjectActivity} from './session-indicators';
export function sessionStatus(w:Workspace,id:string,decisions=0):WorkspaceSession {
 const rows=w.receipts.filter(r=>r.session===id),current=rows.find(r=>active(r)||r.phase==='queued'||r.phase==='uncertain')??rows.at(-1);
 const pending=rows.flatMap(r=>r.decisions).filter(d=>['pending','responded','dispatching','uncertain'].includes(d.state));
 const leadPending=pending.filter(d=>!d.task||d.task==='lead');
 const approvals=leadPending.filter(d=>!d.questions.length).length,questions=leadPending.filter(d=>d.questions.length>0).length;
 const tasks=w.tasks.filter(t=>t.session===id),attempts=tasks.flatMap(t=>t.attempts.slice(-1));
 const workers=workerCounts(w,id);
 // Counts come from persisted receipts and decisions, never inferred from a rendered view.
 const errors=Number(current?.phase==='failed'||current?.phase==='uncertain')+attempts.filter(a=>a.phase==='failed'&&!a.failure_dismissal||a.phase==='uncertain').length;
 const preparing=!!current&&['queued','accepted','preparing','dispatching'].includes(current.phase);
 return {preparationStatus:preparing?'preparing':current&&['running','cancelling'].includes(current.phase)?'ready':current?.phase==='failed'?'failed':'disconnected',leadActivity:{state:current?.phase==='uncertain'?'ownership-unsettled':current?.phase==='cancelling'?'running':current?.phase??'unknown',pendingApprovals:approvals,pendingQuestions:questions},activity:{workers,attention:{approvals:pending.filter(d=>!d.questions.length).length,questions:pending.filter(d=>d.questions.length>0).length,decisions,byLead:pending.filter(d=>!d.task||d.task==='lead').length+decisions,byWorkers:pending.filter(d=>!!d.task&&d.task!=='lead').length,unowned:0},errors}};
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
