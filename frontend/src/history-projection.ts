export interface HistoryEvent {v:number;seq:number;sessionId:string;ts:string;kind:string;source:Record<string,unknown>;data:Record<string,unknown>;historyId?:number;request?:HistoryEvent}
/** Original ChatHistory's per-task delta/completion folding. Raw transport keeps
 * every sequence; this disposable view never supplies execution state. */
export function historyRows(events:HistoryEvent[]):HistoryEvent[]{
 const rows:HistoryEvent[]=[],pending=new Map<string,number>();
 for(const event of events){
  const task=String(event.source.taskId??'lead');
  if(event.kind==='session.ended')pending.clear();
  if(['turn.started','turn.completed','task.continued','question.resolved'].includes(event.kind))pending.delete(task);
  if(event.data.internal===true||event.data.role==='system')continue;
  const at=pending.get(task);
  if(event.kind==='message.delta'){
   if(at!==undefined){const prior=rows[at];rows[at]={...prior,data:{...prior.data,text:String(prior.data.text??prior.data.delta??'')+String(event.data.text??event.data.delta??'')}};}
   else {pending.set(task,rows.length);rows.push({...event,data:{...event.data,text:String(event.data.text??event.data.delta??'')}});}
  }else if(event.kind==='message.completed'&&event.data.role!=='user'&&at!==undefined){rows[at]={...event,seq:rows[at].seq};pending.delete(task);}
  else if(event.kind==='message.completed'||event.kind==='question.resolved'||event.kind==='approval.resolved'&&event.data.auto===true&&String(event.data.by).startsWith('session-grant:')||event.kind==='turn.completed'&&event.data.status==='failed')rows.push(event);
 }
 return rows;
}
