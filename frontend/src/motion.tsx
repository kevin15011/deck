import React,{useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {gsap} from 'gsap';
import {useDisclosureMotion,useViewMotion} from './view-motion';
export const usePanelMotion=useViewMotion;
export function ReceiptDetails({children}:{children:ReactNode}){
 const [open,setOpen]=useState(false),body=useRef<HTMLDivElement>(null);
 useDisclosureMotion(body,open);
 return <div className="receipt-details"><button className="quiet" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Receipt and timing</button><div ref={body} className="receipt-body" hidden={!open} inert={!open} aria-hidden={!open}>{children}</div></div>;
}
/** Appearing rows only. Hidden rows must not enter: GSAP may reparent them to measure transforms, retriggering this observer. */
export function useEntrances(ref:React.RefObject<HTMLElement|null>){
 useLayoutEffect(()=>{const root=ref.current;if(!root)return;const media=matchMedia('(prefers-reduced-motion: reduce)'),owned=new Set<Element>();
 const selector='.exchange,.task,.alert,.empty,.session,.image-draft,.decisions-panel,.decision-row';
 const observer=new MutationObserver(records=>{
  if(media.matches)return;
  const candidates=new Set<HTMLElement>();
  for(const record of records)for(const node of record.addedNodes){
   if(!(node instanceof HTMLElement)||!root.contains(node))continue;
   if(node.matches(selector))candidates.add(node);
   for(const row of node.querySelectorAll<HTMLElement>(selector))candidates.add(row);
  }
  // GSAP writes transforms immediately. Measure the whole batch before those
  // writes and animate only rows in the visible part of the transcript.
  const viewports=new Map<HTMLElement,DOMRect>();
  const visible=[...candidates].filter(el=>{
   if(el.closest('[inert]')||!el.getClientRects().length)return false;
   const viewport=el.closest<HTMLElement>('.conversation');
   if(!viewport)return true;
   let clip=viewports.get(viewport);
   if(!clip){clip=viewport.getBoundingClientRect();viewports.set(viewport,clip);}
   const rect=el.getBoundingClientRect();
   return rect.bottom>clip.top&&rect.top<clip.bottom;
  });
  for(const el of visible){
   owned.add(el);
   gsap.fromTo(el,{opacity:.5,y:4},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform',onComplete:()=>{owned.delete(el);}});
  }
 });
 observer.observe(root,{childList:true,subtree:true});const settle=()=>{if(media.matches)for(const el of owned){gsap.killTweensOf(el);gsap.set(el,{clearProps:'opacity,transform'});} };media.addEventListener('change',settle);
 return()=>{observer.disconnect();media.removeEventListener('change',settle);for(const el of owned)gsap.killTweensOf(el);};},[]);
}
