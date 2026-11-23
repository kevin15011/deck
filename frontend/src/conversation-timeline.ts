import type {Receipt,Task,TaskAttempt} from './api';
export type TimelineRow={key:string;receipt:Receipt;task?:never;attempt?:never}|{key:string;task:Task;attempt:TaskAttempt;receipt?:never};
export const transcriptRenderBudget=4096;
// Line boundaries are a proxy for the markup nodes produced by lists,
// tables and headings, especially when each source line is short.
function markdownCost(text:string){
 let cost=text.length;
 for(let i=text.indexOf('\n');i>=0&&cost<transcriptRenderBudget;i=text.indexOf('\n',i+1))cost+=48;
 return cost;
}
export function timelineRowCost(row:TimelineRow){
 const receipt=row.receipt;
 return receipt?markdownCost(receipt.prompt)+markdownCost(receipt.text)
  +(receipt.steering?.reduce((size,input)=>(input.state==='accepted'||input.state==='uncertain'&&input.queuedSource)?size+markdownCost(input.text):size,0)??0):64;
}
/** Recorded Lead authority takes precedence over acceptance time for placement. */
export function conversationTimeline(receipts:Receipt[],tasks:Task[],session:string):TimelineRow[]{
 const turns=receipts.filter(r=>r.session===session&&r.recalled_ms===undefined&&!r.steered_to&&r.phase!=='queued'
  &&!(r.continuation&&r.phase==='completed'&&r.dispatch_ms===null));
 const byRoot=new Map(turns.map(receipt=>[receipt.id,receipt]));
 const anchored=new Map<string,TimelineRow[]>();
 const rows:TimelineRow[]=turns.map(receipt=>({key:'receipt:'+receipt.id,receipt}));
 const agents=tasks.filter(task=>task.session===session&&task.owner!=='lead')
  .flatMap(task=>task.attempts.map((attempt,index)=>{
   const original=byRoot.get(task.root);
   // Legacy team follow-ups were admitted under the same Lead authority.
   const legacy=original?.mode==='team'||original?.mode==='developer';
   const authority=attempt.authority??(index===0||legacy?{root:task.root,attempt:task.parent_attempt}:undefined);
   const parent=authority&&byRoot.get(authority.root);
   const row={key:'task:'+task.id+':'+attempt.id,task,attempt};
   return {row,parent:parent?.attempt===authority?.attempt?parent:undefined};
  }))
  .sort((a,b)=>a.row.attempt.accepted_ms-b.row.attempt.accepted_ms);
 for(const {row,parent} of agents){
  if(!parent){rows.push(row);continue;}
  const group=anchored.get(parent.id);
  if(group)group.push(row);
  else anchored.set(parent.id,[row]);
 }
 const accepted=(row:TimelineRow)=>row.receipt?.accepted_ms??row.attempt!.accepted_ms;
 return rows.sort((a,b)=>accepted(a)-accepted(b))
  .flatMap(row=>row.receipt?[row,...anchored.get(row.receipt.id)??[]]:[row]);
}
export function windowRange(total:number,end=total,limit=120){end=Math.min(total,Math.max(Math.min(total,limit),end));return {start:Math.max(0,end-limit),end};}
