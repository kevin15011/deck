import React,{useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {gsap} from 'gsap';
import {readPreference,savePreference} from './preferences';
import {clampInspectorWidth,readInspectorWidth,clampInspectorRect,readInspectorRect,type InspectorRect} from './inspector-size';

/** Nonmodal on desktop; a focus-contained card on narrow screens. */
export function Inspector({session,open,narrow,returnFocus,children}:{session:string;open:boolean;narrow:boolean;returnFocus:RefObject<HTMLElement|null>;children:ReactNode}){
 const panel=useRef<HTMLElement>(null),wasOpen=useRef(false);
 const [width,setWidth]=useState(()=>readInspectorWidth(readPreference('inspector-width'))),[expanded,setExpanded]=useState(false);
 const [docked,setDocked]=useState(()=>readPreference('inspector-mode:'+session)==='docked');
 const [position,setPosition]=useState(()=>readInspectorRect(readPreference('inspector-position')));
 const [area,setArea]=useState({width:440,height:700});
 const drag=useRef<{id:number;x:number;y:number;kind:'width'|'move'|'size';box:InspectorRect;target:HTMLElement}|null>(null);
 const isDocked=docked&&!narrow,available=area.width;
 const floating=clampInspectorRect({...position,width},area);
 const actual=expanded?Math.max(0,available-(isDocked?0:24)):clampInspectorWidth(width,available);
 const rect=narrow?{x:available-actual-12,y:12,width:actual,height:Math.max(0,area.height-24)}:isDocked?{x:available-actual,y:0,width:actual,height:area.height}:expanded?{x:12,y:12,width:actual,height:Math.max(0,area.height-24)}:floating;
 useLayoutEffect(()=>{const node=panel.current;if(!node)return;const parent=node.parentElement!;const update=()=>setArea({width:parent.clientWidth,height:parent.clientHeight});update();const observer=new ResizeObserver(update);observer.observe(parent);return()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{savePreference('inspector-width',String(width));},[width]);
 useLayoutEffect(()=>{savePreference('inspector-position',JSON.stringify(position));},[position]);
 useLayoutEffect(()=>{savePreference('inspector-mode:'+session,docked?'docked':'floating');},[session,docked]);
 useLayoutEffect(()=>{
  const node=panel.current;if(!node)return;const parent=node.parentElement!,chat=parent.querySelector<HTMLElement>(':scope > .chat-pane');
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const geometry={left:rect.x,top:rect.y,width:rect.width,height:rect.height};
  const reservation={paddingRight:open&&isDocked?actual:0};
  parent.classList.toggle('inspector-docked',open&&isDocked);
  if(chat){chat.inert=open&&isDocked&&expanded;chat.style.visibility=chat.inert?'hidden':'';}
  const settle=()=>{gsap.killTweensOf(node,'left,top,width,height');gsap.killTweensOf(parent,'paddingRight');gsap.set(node,geometry);gsap.set(parent,reservation);};
  if(media.matches||!open||drag.current)settle();else{gsap.to(node,{...geometry,duration:.22,ease:'power2.out',overwrite:'auto'});gsap.to(parent,{...reservation,duration:.22,ease:'power2.out',overwrite:'auto'});}
  const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);
  return()=>{media.removeEventListener('change',change);gsap.killTweensOf(node,'left,top,width,height');gsap.killTweensOf(parent,'paddingRight');};
 },[rect.x,rect.y,rect.width,rect.height,actual,open,isDocked,expanded]);
 useLayoutEffect(()=>()=>{const node=panel.current,parent=node?.parentElement;if(parent){gsap.killTweensOf(parent,'paddingRight');parent.style.paddingRight='';parent.classList.remove('inspector-docked');const chat=parent.querySelector<HTMLElement>(':scope > .chat-pane');if(chat){chat.inert=false;chat.style.visibility='';}}},[]);
 function begin(e:React.PointerEvent<HTMLElement>,kind:'width'|'move'|'size'){
  if(e.button!==0||narrow&&kind!=='width'||isDocked&&kind!=='width'||expanded&&kind!=='width')return;
  e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
  const node=panel.current!;const box=node.getBoundingClientRect(),parent=node.parentElement!.getBoundingClientRect();
  drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,kind,target:e.currentTarget,box:{x:box.x-parent.x,y:box.y-parent.y,width:box.width,height:box.height}};setExpanded(false);
 }
 function move(e:React.PointerEvent<HTMLElement>){
  const d=drag.current;if(!d||d.id!==e.pointerId)return;
  const dx=e.clientX-d.x,dy=e.clientY-d.y;
  if(isDocked){setWidth(clampInspectorWidth(d.box.width-dx,available));return;}
  const next=d.kind==='move'?{...d.box,x:d.box.x+dx,y:d.box.y+dy}:d.kind==='size'?{...d.box,width:d.box.width+dx,height:d.box.height+dy}:{...d.box,x:d.box.x+dx,width:d.box.width-dx};
  const box=clampInspectorRect(next,area);setWidth(box.width);setPosition({x:box.x,y:box.y,height:box.height});
 }
 function end(){drag.current=null;}
 function moveKey(e:React.KeyboardEvent){
  const delta=e.shiftKey?48:16;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();
  setPosition({...floating,x:floating.x+(e.key==='ArrowLeft'?-delta:e.key==='ArrowRight'?delta:0),y:floating.y+(e.key==='ArrowUp'?-delta:e.key==='ArrowDown'?delta:0)});
 }
 useLayoutEffect(()=>{
  const node=panel.current;if(!node)return;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  gsap.killTweensOf(node,'x,opacity');node.inert=!open;node.setAttribute('aria-hidden',String(!open));
  if(open||wasOpen.current)node.hidden=false;
  if(open){if(!wasOpen.current){if(!returnFocus.current||!returnFocus.current.isConnected)returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;node.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({preventScroll:true});}}
  else if(wasOpen.current&&returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});
  const settle=()=>{gsap.killTweensOf(node,'x,opacity');node.hidden=!open;gsap.set(node,{x:open?0:24,opacity:open?1:0});};
  if(media.matches||!open&&!wasOpen.current)settle();else gsap.to(node,{x:open?0:24,opacity:open?1:0,duration:.2,ease:'power2.out',overwrite:'auto',onComplete:()=>{node.hidden=!open;}});
  wasOpen.current=open;
  const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);
  return()=>{media.removeEventListener('change',change);gsap.killTweensOf(node,'x,opacity');};
 },[open,returnFocus]);
 useLayoutEffect(()=>{
  if(!open)return;
  const node=panel.current;if(!node)return;
  const key=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||document.querySelector('dialog[open]'))return;
   if(event.key==='Escape'&&drag.current){
    event.preventDefault();event.stopPropagation();const active=drag.current;drag.current=null;
    if(active.target.hasPointerCapture(active.id))active.target.releasePointerCapture(active.id);
    return;
   }
   if(narrow&&event.key==='Tab'){
    const controls=Array.from(node.closest('.app-body')!.querySelectorAll<HTMLElement>('.inspector-actions button,#session-inspector button,#session-inspector a[href],#session-inspector input,#session-inspector select,#session-inspector textarea,#session-inspector [tabindex="0"]')).filter(el=>!el.closest('[hidden],[inert]')&&!el.matches(':disabled')&&el.getClientRects().length>0);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
  };
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);};
 },[open,narrow]);
 return <aside ref={panel} id="session-inspector" data-mode={isDocked?'docked':'floating'} data-expanded={expanded} className="workspace-pane shell-workspace inspector" onPointerDown={e=>{const target=e.target as Element;if(target.closest('.workspace-tabs')&&!target.closest('button,[role="tab"]'))begin(e,'move');}} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} role="dialog" aria-label="Session inspector"  hidden={!open}>
  <div className="inspector-resize" role="separator" aria-label="Inspector width" aria-orientation="vertical" aria-valuemin={Math.min(320,available-24)} aria-valuemax={expanded?actual:Math.min(960,available-24)} aria-valuenow={Math.round(actual)} tabIndex={0}
   onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setExpanded(false);setWidth(clampInspectorWidth(actual+(e.key==='ArrowLeft'?32:-32),available));}}}
   onPointerDown={e=>begin(e,'width')}/>
  {!narrow&&<button className="quiet inspector-dock" type="button" aria-label={docked?'Float inspector':'Dock inspector'} aria-pressed={docked} title={docked?'Float inspector':'Dock inspector'} onClick={()=>setDocked(v=>!v)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">{docked ? <g strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 4H3a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 3 14h7a1.5 1.5 0 0 0 1.5-1.5V11"/>
    <rect x="6" y="1.5" width="8.5" height="8" rx="1.5"/>
    <path d="M6.5 4h7.5"/>
   </g> : <><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M10 2v12"/></>}</svg></button>}
  {!narrow&&!isDocked&&!expanded&&<><button className="quiet inspector-move" type="button" aria-label="Move inspector" title="Drag to move, or use arrow keys" onKeyDown={moveKey} onPointerDown={e=>begin(e,'move')}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 1v14M1 8h14M5 4l3-3 3 3M5 12l3 3 3-3M4 5 1 8l3 3M12 5l3 3-3 3"/></svg></button><div className="inspector-size" role="separator" aria-label="Inspector size" aria-valuetext={`${Math.round(rect.width)} by ${Math.round(rect.height)} pixels`} tabIndex={0} onPointerDown={e=>begin(e,'size')} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();setWidth(clampInspectorWidth(floating.width+(e.key==='ArrowLeft'?-32:e.key==='ArrowRight'?32:0),available));setPosition({...floating,height:floating.height+(e.key==='ArrowUp'?-32:e.key==='ArrowDown'?32:0)});}}/></>}
  <button className="quiet inspector-expand" type="button" aria-label={expanded?'Restore inspector width':'Expand inspector'} aria-pressed={expanded} onClick={()=>setExpanded(v=>!v)}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">{expanded?<path d="M2 6h4V2M14 10h-4v4M6 6 2 2M10 10l4 4"/>:<path d="M6 2H2v4M10 14h4v-4M2 2l4 4M14 14l-4-4"/>}</svg></button>{children}
 </aside>;
}
