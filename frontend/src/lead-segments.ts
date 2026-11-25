import type {Receipt} from './api';
type Time=NonNullable<Receipt['message_times']>[number];
export function isLeadUpdateReplacement(previous:number,next:number,running:boolean){return running&&previous!==next;}
export function partitionLeadSegments(text:string,times?:Receipt['message_times']) {
 if(!times?.length||times.some(t=>!t.kind))return null;
 const progress:(Time&{text:string})[]=[],answers:(Time&{text:string})[]=[];
 times.forEach((t,i)=>{let part=text.slice(t.start,times[i+1]?.start);if(i+1<times.length&&part.endsWith('\n\n'))part=part.slice(0,-2);(t.kind==='progress'?progress:answers).push({...t,text:part});});
 return {progress,answers};
}
