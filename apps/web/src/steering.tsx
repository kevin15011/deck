import React,{useEffect,useRef} from 'react';
export type SteeringDelivery={promptId:string;text:string;state:'sending'|'accepted'|'unknown'|'not-accepted';runnerId?:string;historical?:boolean};
export const steeringRunnerLabel=(runnerId?:unknown)=>runnerId==='claude'?'Claude Code':runnerId===undefined||runnerId==='codex'?'Codex':'Runner';
export function CurrentTurnAction({available,disabled,runnerId}:{available:boolean;disabled:boolean;runnerId?:string}){
 const focused=useRef(false);
 useEffect(()=>{if(!available&&focused.current&&document.activeElement===document.body){document.getElementById('prompt')?.focus({preventScroll:true});focused.current=false;}},[available]);
 return available ? <div className="steering-action"><button type="submit" form="prompt-composer" className="quiet" name="delivery" value="current-turn" disabled={disabled} title={`Send text to the running ${steeringRunnerLabel(runnerId)} execution`} onFocus={()=>{focused.current=true;}} onBlur={event=>{if(event.relatedTarget)focused.current=false;}}>Send to current turn</button><small>Enter keeps ordinary queued delivery.</small></div> : null;
}
function deliveryStatus(d:SteeringDelivery):string {
 const runner=steeringRunnerLabel(d.runnerId);
 if(d.state==='sending')return `Sending to ${runner}…`;
 if(d.state==='accepted')return d.runnerId==='claude'&&d.historical?'Confirmed for the original Claude Code execution.':`Accepted by ${runner}`;
 if(d.state==='not-accepted')return `Not accepted by ${runner} · This message was not queued or sent again.`;
 return d.runnerId==='claude'?'Uncertain · Claude Code has not confirmed delivery to the selected execution. The text may remain in later context. It will not be sent again automatically.':`Uncertain · ${runner} may already have received this message. It will not be sent again automatically.`;
}
export function SteeringStatus({deliveries,omitted=0}:{deliveries:SteeringDelivery[];omitted?:number}){
 if(!deliveries.length)return null;
 return <section className="steering-status" aria-label="Current-turn delivery"><ul aria-live="polite" aria-relevant="additions text">{deliveries.map(d=><li key={d.promptId}><span className="steering-preview" title={d.text}>{d.text||'Earlier message'}</span><span>{deliveryStatus(d)}</span></li>)}</ul><p>Acceptance does not confirm reading or completion.</p>{omitted>0&&<p>Earlier delivery records remain in session history.</p>}</section>;
}
