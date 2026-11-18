import type {Receipt} from './api';

// Local DevTools Performance entries. No storage, telemetry, or message data.
const limit = 32;
const stages = ['submit','request','headers','receipt','first-output'] as const;
type Stage = typeof stages[number];
interface Attempt {id:string;prefix:string;seen:Set<Stage>}
const attempts:Attempt[]=[];
const current=new Map<string,Attempt>();
let next=0;

export function beginCommandTiming(id:string,submittedAt:number){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))return;
 const attempt={id,prefix:'deck.command.'+id+'.'+(++next)+'.',seen:new Set<Stage>()};
 attempts.push(attempt);
 current.set(id,attempt);
 if(attempts.length>limit){
  const expired=attempts.shift()!;
  for(const stage of expired.seen)performance.clearMarks(expired.prefix+stage);
  if(current.get(expired.id)===expired)current.delete(expired.id);
 }
 mark(id,'submit',undefined,submittedAt);
}

function mark(id:string,stage:Stage,detail?:Record<string,number|string|null>,startTime?:number){
 const attempt=current.get(id);
 if(!attempt||attempt.seen.has(stage))return;
 attempt.seen.add(stage);
 performance.mark(attempt.prefix+stage,{detail,startTime});
}

export function markCommandRequest(id:string){mark(id,'request');}

export function markCommandHeaders(id:string,response:Response){
 const timing = response.headers.get('server-timing') ?? '';
 const duration = (name:string) => {
  const match=timing.match(new RegExp('(?:^|,\\s*)'+name+';dur=(\\d+(?:\\.\\d+)?)(?:,|$)'));
  return match?Number(match[1]):null;
 };
 mark(id,'headers',{status:response.status,hostCommitMs:duration('deck_commit'),hostReceiptMs:duration('deck_receipt')});
}

export function observeCommandReceipt(receipt:Receipt,source:'http'|'workspace'){
 mark(receipt.id,'receipt',{source,hostAcceptedMs:receipt.accepted_ms});
 if(receipt.first_output_ms!==null)mark(receipt.id,'first-output',{
  source,hostAcceptedMs:receipt.accepted_ms,hostDispatchMs:receipt.dispatch_ms,hostFirstOutputMs:receipt.first_output_ms
 });
}
