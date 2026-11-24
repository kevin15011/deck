import {useLayoutEffect,useRef,useState,type Ref,type RefObject} from 'react';
import type {Decision,Receipt,Task} from './api';
import {Review} from './review';

export function isPendingPermission(d:Decision){
 return d.state==='pending'&&!d.questions.length&&d.presentation?.kind!=='question';
}

export function pendingPermissionRows(session:string,receipts:Receipt[],tasks:Task[]){
 const owners=new Map(tasks.filter(task=>task.session===session).map(task=>[task.id,task.owner]));
 const rows=new Map<string,{decision:Decision;origin:string}>();
 for(const receipt of receipts){
  if(receipt.session!==session)continue;
  for(const d of receipt.decisions){
   if(d.session!==session||d.command!==receipt.id||!isPendingPermission(d))continue;
   rows.set(d.id,{decision:d,origin:d.task?owners.get(d.task)??'Member':'Lead'});
  }
 }
 return [...rows.values()];
}

export function PermissionDock({rows,connected,storageScope,composer,onError,dockRef}:{dockRef?:Ref<HTMLDivElement>;rows:ReturnType<typeof pendingPermissionRows>;connected:boolean;storageScope:string;composer:RefObject<HTMLTextAreaElement|null>;onError:(error:string)=>void}){
 // A request leaves the dock as soon as its response is sent; the host settles
 // it in the background. A failed submission returns it for another decision.
 const [sent,setSent]=useState<ReadonlySet<string>>(new Set());
 const binding=(d:{id:string;revision:number})=>d.id+':'+d.revision;
 const visible=rows.filter(row=>!sent.has(binding(row.decision)));
 const controls=useRef(new Map<string,HTMLButtonElement>());
 const focus=useRef<string|undefined>(undefined);
 const previous=useRef<string[]>([]);
 useLayoutEffect(()=>{
  const ids=visible.map(row=>row.decision.id);
  const id=focus.current;
  const removed=id===undefined?-1:previous.current.indexOf(id);
  previous.current=ids;
  if(id===undefined||removed<0||ids.includes(id))return;
  focus.current=undefined;
  if(document.activeElement!==document.body)return;
  const next=controls.current.get(ids[Math.min(removed,ids.length-1)]);
  if(next){
   next.focus({preventScroll:true});
   next.scrollIntoView({block:'nearest'});
  }else composer.current?.focus({preventScroll:true});
 },[visible,composer]);

 return <div ref={dockRef} className="permission-dock">
  <span className="sr-only" role="status">{visible.length?visible.length===1?'One permission request':visible.length+' permission requests':''}</span>
  {visible.length>0&&<section aria-label="Pending permissions"><ul>{visible.map(({decision:d,origin})=><li key={d.id}
   onFocusCapture={()=>{focus.current=d.id;}}
   onBlurCapture={event=>{if(event.relatedTarget&&event.relatedTarget!==document.body&&!event.currentTarget.contains(event.relatedTarget as Node))focus.current=undefined;}}>
   <Review d={d} connected={connected} storageScope={storageScope} onError={onError} dockOrigin={origin}
    dockDisclosure={node=>{if(node)controls.current.set(d.id,node);else controls.current.delete(d.id);}}
    onDockSubmission={state=>setSent(current=>{const next=new Set(current);if(state==='sent')next.add(binding(d));else next.delete(binding(d));return next;})}/>
  </li>)}</ul></section>}
 </div>;
}
