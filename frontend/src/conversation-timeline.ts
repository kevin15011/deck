import type {Receipt,Task} from './api';
export type TimelineRow={key:string;receipt:Receipt;task?:never}|{key:string;task:Task;receipt?:never};
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
  +(receipt.steering?.reduce((size,input)=>input.state==='accepted'?size+markdownCost(input.text):size,0)??0):64;
}
/** Parent identity is authoritative across delayed polling; acceptance orders siblings.
 * The live projection has no delegation sequence: stable projection order breaks ties. */
export function conversationTimeline(receipts:Receipt[],tasks:Task[],session:string):TimelineRow[]{
 const turns=receipts.filter(r=>r.recalled_ms===undefined&&r.phase!=='queued').sort((a,b)=>a.accepted_ms-b.accepted_ms);
 const agents=tasks.filter(t=>t.session===session&&t.owner!=='lead'&&t.attempts.length).sort((a,b)=>a.attempts[0]!.accepted_ms-b.attempts[0]!.accepted_ms);
 const parents=new Set(turns.map(r=>r.attempt).filter(Boolean));
 const rows:TimelineRow[]=turns.map(receipt=>({key:'receipt:'+receipt.id,receipt}));
 for(const task of agents.filter(t=>!parents.has(t.parent_attempt))){const at=task.attempts[0]!.accepted_ms;const index=rows.findIndex(r=>(r.receipt?.accepted_ms??r.task!.attempts[0]!.accepted_ms)>at);rows.splice(index<0?rows.length:index,0,{key:'task:'+task.id,task});}
 return rows.flatMap(row=>row.receipt?[row,...agents.filter(t=>t.parent_attempt===row.receipt.attempt).map(task=>({key:'task:'+task.id,task}))]:[row]);
}
export function windowRange(total:number,end=total,limit=120){end=Math.min(total,Math.max(Math.min(total,limit),end));return {start:Math.max(0,end-limit),end};}
