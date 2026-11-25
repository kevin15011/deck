import {MessageCopy,MessageTime} from './message-copy';
import type {Receipt} from './api';
import {isLeadUpdateReplacement,partitionLeadSegments} from './lead-segments';
import {Markdown} from './markdown';
import {useLiveLeadText} from './chat-motion';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
type LeadReply={sessionId:string;replyId:string;messageSeq:number};
type LeadReplyDisplay=LeadReply&{displayMessageSeq:number;commandId?:string;displayStart?:number};
const validReplyId=(v:unknown):v is string=>typeof v==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(v)&&v.length<=48;
type Api=(path:string,init?:RequestInit)=>Promise<any>;
export { validReplyId };
/** Exact display receipts suppress push alerts for replies already seen on this device.
 * No global unread inbox is fetched or presented. Navigation alone is not a receipt. */
export function useDisplayedReplies(api:Api,enabled:boolean,sessionId:string,messageSeqs:(number|string)[],revision:number){
  const [visibleReplies,setVisibleReplies]=useState<LeadReplyDisplay[]>([]),[refresh,setRefresh]=useState(0);
  const seqKey=messageSeqs.join(','),owner=useRef(sessionId);owner.current=sessionId;
  useEffect(()=>{
    setVisibleReplies([]);if(!enabled||!sessionId||!messageSeqs.length)return;
    const controller=new AbortController();let busy=false;
    const load=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{
      const query=new URLSearchParams();messageSeqs.slice(0,120).forEach(seq=>query.append(typeof seq==='number'?'messageSeq':'commandId',String(seq)));
      const data=await api(`/api/sessions/${encodeURIComponent(sessionId)}/replies?${query}`,{signal:controller.signal});
      if(!controller.signal.aborted&&owner.current===sessionId)setVisibleReplies(data.replies);
    }catch{/* Never infer a receipt from errors; retry on the next poll. */}finally{busy=false;}};
    void load();const timer=setInterval(load,1500);window.addEventListener('focus',load);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',load);};
  },[api,enabled,sessionId,seqKey,refresh,revision]);
  const displayed=async(reply:LeadReply)=>{
    await api(`/api/sessions/${encodeURIComponent(reply.sessionId)}/replies/${encodeURIComponent(reply.replyId)}`,{method:'POST',body:JSON.stringify({displayed:true})});
    setRefresh(x=>x+1);
  };
  return{visibleReplies:visibleReplies.filter(reply=>reply.sessionId===sessionId),displayed};
}

/** Any meaningful visible slice of exact reply content qualifies. No whole-message
 * threshold: long answers often leave only their ending in the focused viewport. */
export function replyIntersection(content:DOMRect,viewport:DOMRect):{x:number;y:number}|undefined{
  const top=Math.max(content.top,viewport.top,0),bottom=Math.min(content.bottom,viewport.bottom,window.innerHeight),left=Math.max(content.left,viewport.left,0),right=Math.min(content.right,viewport.right,window.innerWidth);
  if(bottom-top<Math.min(24,content.height)||right-left<Math.min(24,content.width)||bottom<=top||right<=left)return;
  return{x:(left+right)/2,y:(top+bottom)/2};
}
export function DisplayedReply({reply,visible,root,onDisplayed,children}:{reply?:LeadReply;visible:boolean;root:React.RefObject<HTMLElement|null>;onDisplayed:(reply:LeadReply)=>Promise<void>;children:React.ReactNode}){
  const content=useRef<HTMLDivElement>(null),callback=useRef(onDisplayed);callback.current=onDisplayed;
  const identity=reply?`${reply.sessionId}:${reply.replyId}`:'';
  useEffect(()=>{
    const node=content.current,viewport=root.current;if(!reply||!visible||!node||!viewport)return;
    let done=false,pending=false,closed=false,timer:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined;
    const eligible=()=>{
      if(closed||document.visibilityState!=='visible'||!document.hasFocus()||!node.isConnected||!viewport.clientHeight||!viewport.clientWidth)return false;
      const point=replyIntersection(node.getBoundingClientRect(),viewport.getBoundingClientRect());
      if(!point)return false;const top=document.elementFromPoint(point.x,point.y);return !!top&&(top===node||node.contains(top));
    };
    const check=()=>{clearTimeout(timer);if(done||pending||!eligible())return;timer=setTimeout(()=>{if(!eligible())return;pending=true;void callback.current(reply).then(()=>{done=true;}).catch(()=>{if(!closed)retry=setTimeout(check,5000);}).finally(()=>{pending=false;});},300);};
    const observer=new IntersectionObserver(check,{root:viewport,threshold:0});observer.observe(node);
    const resize=new ResizeObserver(check);resize.observe(node);resize.observe(viewport);
    viewport.addEventListener('scroll',check,{passive:true});window.addEventListener('focus',check);window.addEventListener('blur',check);document.addEventListener('visibilitychange',check);
    check();return()=>{closed=true;observer.disconnect();resize.disconnect();clearTimeout(timer);clearTimeout(retry);viewport.removeEventListener('scroll',check);window.removeEventListener('focus',check);window.removeEventListener('blur',check);document.removeEventListener('visibilitychange',check);};
  },[identity,visible,root]);
  return <div ref={content} className="reply-content" data-reply-id={reply?.replyId}>{children}</div>;
}

function ReplySlice({text,fallback,reply,visible,root,onDisplayed}:{text:string;fallback:string;reply?:LeadReplyDisplay;visible:boolean;root:React.RefObject<HTMLElement|null>;onDisplayed:(reply:LeadReply)=>Promise<void>}){
 const start=reply?.displayStart,known=typeof start==='number'&&Number.isSafeInteger(start)&&start>=0&&start<=text.length;
 return <>{known&&start>0&&<Markdown text={text.slice(0,start)}/>}<DisplayedReply reply={known?reply:undefined} visible={visible} root={root} onDisplayed={onDisplayed}><Markdown text={(known?text.slice(start):text)||fallback}/></DisplayedReply></>;
}


export function leadMessageText(text:string,start:number,nextStart?:number){
 const slice=text.slice(start,nextStart);
 // The host inserts a blank line between native items in the combined receipt.
 return nextStart!==undefined&&slice.endsWith('\n\n')?slice.slice(0,-2):slice;
}

type Update={start:number;at_ms:number;text:string};
function LeadUpdate({update,running}:{update:Update;running:boolean}){
 const previous=useRef(update),[outgoing,setOutgoing]=useState<Update|null>(null);
 useLayoutEffect(()=>{
  const old=previous.current;previous.current=update;
  if(!isLeadUpdateReplacement(old.start,update.start,running)){if(!running)setOutgoing(null);return;}
  setOutgoing(old);
  const timer=setTimeout(()=>setOutgoing(null),220);
  return()=>clearTimeout(timer);
 },[update.start,running]);
 // Keep the snapshot current without treating streamed growth as a replacement.
 useLayoutEffect(()=>{previous.current=update;},[update]);
 return <div className="lead-update" data-live={running||undefined}>
  <div className="lead-update-header"><span className="lead-update-dot" aria-hidden="true"/><span aria-live="polite" aria-atomic="true">{running?'Working':'Last update'}</span><MessageTime timestamp={update.at_ms} label="Update"/></div>
  <div className="lead-update-body">{outgoing&&running&&<div className="lead-update-exit" aria-hidden="true"><Markdown text={outgoing.text}/></div>}<div key={update.start} className={running?'lead-update-enter':undefined}><Markdown text={update.text}/></div></div>
 </div>;
}

export function LeadReplyText({text:source,times,live,running,attempt,revealOnMount,onGrowth,...props}:React.ComponentProps<typeof ReplySlice>&{
 times?:Receipt['message_times'];live:boolean;running:boolean;attempt:Receipt['attempt'];revealOnMount:boolean;onGrowth:()=>void;
}){
 const text=useLiveLeadText(source,live,attempt,revealOnMount);
 useLayoutEffect(()=>{if(live)onGrowth();},[text,live,onGrowth]);
 const parts=partitionLeadSegments(source,times);
 if(parts){
  const latest=parts.progress.at(-1);
  return <>
   {((running||!parts.answers.length)&&latest)&&<LeadUpdate update={latest} running={running}/>}
   {parts.answers.map((part,index)=>{
    const end=times?.find(t=>t.start>part.start)?.start??source.length;
    const replyStart=props.reply?.displayStart;
    const reply=props.reply&&typeof replyStart==='number'&&replyStart>=part.start&&replyStart<end?{...props.reply,displayStart:replyStart-part.start}:undefined;
    return <div className="lead-message-part" key={part.start}>{index>0&&<div className="message-meta"><MessageTime timestamp={part.at_ms} label="Message received"/><MessageCopy text={part.text}/></div>}<ReplySlice {...props} reply={reply} text={text.slice(part.start,Math.min(end,part.start+part.text.length))}/></div>;
   })}
   {!running&&parts.progress.length>0&&<details className="lead-updates"><summary>Show {parts.progress.length} {parts.progress.length===1?'update':'updates'}</summary>{parts.progress.map(part=><div className="lead-update" key={part.start}><MessageTime timestamp={part.at_ms} label="Update"/><Markdown text={part.text}/></div>)}</details>}
  </>;
 }
 if(!times?.length)return <ReplySlice text={text} {...props}/>;
 return <>{times.map(({start,at_ms},index)=>{
  if(index>0&&start>=text.length&&text.length<source.length)return null;
  const end=times[index+1]?.start??source.length;
  const replyStart=props.reply?.displayStart;
  const reply=props.reply&&typeof replyStart==='number'&&replyStart>=start&&replyStart<end
    ?{...props.reply,displayStart:replyStart-start}:undefined;
  return <div className="lead-message-part" key={start}>
   {index>0&&<div className="message-meta"><MessageTime timestamp={at_ms} label="Message received"/><MessageCopy text={leadMessageText(source,start,times[index+1]?.start)}/></div>}
   <ReplySlice {...props} reply={reply} text={text.slice(start,end)}/>
  </div>;
 })}</>;
}
