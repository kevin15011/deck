import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {Decision} from './api';
import {useDismissLayer} from './dismiss-layer';
import {focusSidebarOpener} from './drawer-motion';
import {Review} from './review';
import {NavigationIcon} from './navigation-icon';
import type {useSidebarAttention} from './sidebar';

type AttentionRow=ReturnType<typeof useSidebarAttention>[number];

function PermissionReview({decision,connected,storageScope}:{decision:Decision;connected:boolean;storageScope:string}){
 const [error,setError]=useState('');
 return <div>
  <Review d={decision} connected={connected} storageScope={storageScope} onError={setError}/>
  {error&&<p className="error" role="alert">{error}</p>}
 </div>;
}

export function SidebarAttention({rows,connected,onNavigate}:{rows:AttentionRow[];connected:boolean;onNavigate:(row:AttentionRow)=>void}){
 const id=useId();
 const [reviewing,setReviewing]=useState<string>();
 const review=rows.find(row=>row.id===reviewing&&row.permissions.length);
 const rail=useRef<HTMLElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const focused=useRef<HTMLElement>(null);

 function close(restore:boolean){
  setReviewing(undefined);
  if(restore)trigger.current?.focus({preventScroll:true});
  else focused.current=null;
 }

 useDismissLayer({open:!!review,roots:[rail],onDismiss:reason=>close(reason==='escape')});
 useLayoutEffect(()=>{
  if(review)closeButton.current?.focus({preventScroll:true});
 },[review?.id]);
 useLayoutEffect(()=>{
  if(reviewing&&!review)setReviewing(undefined);
  const previous=focused.current;
  // Recover focus only when the control the user was on vanished or became disabled.
  if(previous&&document.activeElement===document.body&&(!previous.isConnected||previous.matches(':disabled'))){
   focused.current=null;
   const fallback=closeButton.current??(trigger.current?.isConnected?trigger.current:rail.current?.querySelector('button'));
   if(fallback)fallback.focus({preventScroll:true});
   else focusSidebarOpener();
  }
 });

 if(!rows.length)return null;
 return <section ref={rail} className="attention-bubbles" aria-label="Sessions needing attention"
  onFocusCapture={event=>{if(event.target instanceof HTMLElement)focused.current=event.target;}}
  onBlurCapture={event=>{if(event.relatedTarget&&event.relatedTarget!==document.body&&!event.currentTarget.contains(event.relatedTarget))focused.current=null;}}>
  <ul className="attention-bubble-list">{rows.map(row=>{
   const open=review?.id===row.id;
   return <li className="attention-bubble" key={row.id}>
    <button type="button" className="quiet attention-bubble-title" title={row.title+' · '+row.projectName} onClick={()=>{close(false);onNavigate(row);}}>
     <span className="sidebar-attention-session"><strong>{row.title}</strong><small>{row.projectName}</small></span>
     <span className="sidebar-attention-count"><span className="sr-only">Actions pending: </span>{row.count}</span>
    </button>
    {row.permissions.length>0&&<button type="button" className="quiet attention-bubble-review"
     aria-label={`Review permissions for ${row.title} · ${row.projectName}`}
     aria-expanded={open} aria-controls={open?id:undefined}
     onClick={event=>{trigger.current=event.currentTarget;setReviewing(open?undefined:row.id);}}>Review</button>}
   </li>;
  })}</ul>
  {review&&<section className="attention-review" id={id} aria-labelledby={id+'-title'}>
   <header>
    <div><h2 id={id+'-title'}>{review.title}</h2><p>{review.projectName}</p></div>
    <button ref={closeButton} type="button" className="quiet" aria-label="Close permission review" onClick={()=>close(true)}><NavigationIcon kind="close"/></button>
   </header>
   {!connected&&<p role="status" className="activity-meta">Reconnect to respond to permissions.</p>}
   {review.permissions.map(d=><PermissionReview key={d.id+':'+d.revision} decision={d} storageScope={review.storageScope} connected={connected}/>)}
  </section>}
 </section>;
}
