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
 const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(!(node instanceof HTMLElement))continue;const nodes=[...(node.matches('.exchange,.task,.alert,.empty,.session,.image-draft,.decisions-panel,.decision-row')?[node]:[]),...node.querySelectorAll<HTMLElement>('.exchange,.task,.alert,.empty,.session,.image-draft,.decisions-panel,.decision-row')];for(const el of nodes){if(media.matches||!el.getClientRects().length)continue;owned.add(el);gsap.fromTo(el,{opacity:.5,y:4},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform',onComplete:()=>{owned.delete(el);}});}}});
 observer.observe(root,{childList:true,subtree:true});const settle=()=>{if(media.matches)for(const el of owned){gsap.killTweensOf(el);gsap.set(el,{clearProps:'opacity,transform'});} };media.addEventListener('change',settle);
 return()=>{observer.disconnect();media.removeEventListener('change',settle);for(const el of owned)gsap.killTweensOf(el);};},[]);
}
