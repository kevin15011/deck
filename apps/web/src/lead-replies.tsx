import { useEffect, useRef, useState } from 'react';
import type { LeadReply, LeadReplyPage, LeadReplyDisplay } from '../../../packages/core/src/session/lead-replies';
import { validReplyId } from '../../../packages/core/src/session/lead-replies';
import type { Api } from './workspace';
export { validReplyId };
export function replyFromURL(url:string):string {const value=new URL(url).searchParams.get('reply');return validReplyId(value)?value:'';}

/** Queries are device-authenticated; neither query nor navigation acknowledges a reply. */
export function useLeadReplies(api:Api,enabled:boolean,sessionId:string,messageSeqs:number[],revision:number){
  const [page,setPage]=useState<LeadReplyPage>({replies:[],total:0}),[visibleReplies,setVisibleReplies]=useState<LeadReplyDisplay[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false),[refresh,setRefresh]=useState(0),[cursor,setCursor]=useState(0);
  const seqKey=messageSeqs.join(','),owner=useRef(sessionId);owner.current=sessionId;
  useEffect(()=>{
    if(!enabled){setPage({replies:[],total:0});setVisibleReplies([]);setReady(false);return;}
    const controller=new AbortController();let busy=false;
    const load=async()=>{
      if(busy||document.visibilityState!=='visible')return;busy=true;
      try {
        const data=await api(`/api/replies${cursor?`?cursor=${cursor}`:''}`,{signal:controller.signal});
        if(controller.signal.aborted)return;setPage(data);setError('');setReady(true);
      }catch(cause){if(!controller.signal.aborted){setError((cause as Error).message);setReady(true);}}finally{busy=false;}
    };
    void load();const timer=setInterval(load,3000);window.addEventListener('focus',load);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',load);};
  },[api,enabled,refresh,cursor,revision]);
  useEffect(()=>{
    setVisibleReplies([]);if(!enabled||!sessionId||!messageSeqs.length)return;
    const controller=new AbortController();let busy=false;
    const load=async()=>{if(busy||document.visibilityState!=='visible')return;busy=true;try{
      const query=new URLSearchParams();messageSeqs.slice(0,120).forEach(seq=>query.append('messageSeq',String(seq)));
      const data=await api(`/api/sessions/${encodeURIComponent(sessionId)}/replies?${query}`,{signal:controller.signal});
      if(!controller.signal.aborted&&owner.current===sessionId)setVisibleReplies(data.replies);
    }catch{/* Inbox query reports availability; never infer a receipt from errors. */}finally{busy=false;}};
    void load();const timer=setInterval(load,1500);window.addEventListener('focus',load);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',load);};
  },[api,enabled,sessionId,seqKey,refresh,revision]);
  const displayed=async(reply:LeadReply)=>{
    await api(`/api/sessions/${encodeURIComponent(reply.sessionId)}/replies/${encodeURIComponent(reply.replyId)}`,{method:'POST',body:JSON.stringify({displayed:true})});
    setRefresh(x=>x+1);
  };
  return{page,error,loading:!ready,visibleReplies:visibleReplies.filter(reply=>reply.sessionId===sessionId),displayed,refresh:()=>setRefresh(x=>x+1),more:()=>{if(page.nextCursor)setCursor(page.nextCursor);},first:()=>setCursor(0),cursor};
}

export function UnreadReplies({page,error,onOpen,onMore,onFirst,cursor,onRefresh,sessionLabel,open=false,loading=false,onToggle=()=>{}}:{page:LeadReplyPage;error:string;onOpen:(reply:LeadReply)=>void;onMore:()=>void;onFirst:()=>void;cursor:number;onRefresh:()=>void;sessionLabel?:(id:string)=>string;open?:boolean;loading?:boolean;onToggle?:(open:boolean)=>void}){
  const button=useRef<HTMLButtonElement>(null),details=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(open&&!loading&&!page.total&&!error){if((details.current?.contains(document.activeElement)||button.current===document.activeElement))document.getElementById('conversation')?.focus({preventScroll:true});onToggle(false);}},[page.total,error,open,loading]);
  useEffect(()=>{if(!open)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onToggle(false);button.current?.focus();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[open]);
  if(!page.total&&!error)return null;
  return <div className="unread-replies"><button ref={button} type="button" className="quiet unread-replies-toggle" aria-expanded={open} aria-controls="unread-replies-list" onClick={()=>onToggle(!open)}>{error?'Replies unavailable':`${page.total} unread ${page.total===1?'reply':'replies'}`}</button>{open&&<div ref={details} id="unread-replies-list" className="unread-replies-list" aria-label="Unread Lead replies"><p className="decision-note">Displayed on this browser device. Reading never answers a question or approves work.</p>{error&&<p role="alert">{error} <button type="button" onClick={onRefresh}>Retry</button></p>}{page.syncing&&<p role="status">Updating reply history…</p>}<ul>{page.replies.map(reply=><li key={`${reply.sessionId}:${reply.replyId}`}><button type="button" onClick={()=>onOpen(reply)}><span>{reply.summary}</span><small>{sessionLabel?.(reply.sessionId)??reply.sessionId} · {new Date(reply.ts).toLocaleString()}</small></button></li>)}</ul>{cursor>0&&<button type="button" className="quiet" onClick={onFirst}>First replies</button>}{page.nextCursor&&<button type="button" className="quiet" onClick={onMore}>More replies</button>}</div>}</div>;
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
