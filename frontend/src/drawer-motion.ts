import {useLayoutEffect,useRef,type RefObject} from 'react';

export const sidebarPanelId='projects-and-sessions';
export const sidebarOpenerClass='sidebar-opener';

export function focusSidebarOpener(){
 const openers=[...document.querySelectorAll<HTMLElement>('.'+sidebarOpenerClass)];
 openers.find(button=>button.getClientRects().length)?.focus({preventScroll:true});
}

/** Keep the same navigation mounted as it switches between dock and modal overlay. */
export function useSidebarPanel(ref:RefObject<HTMLDialogElement|null>,docked:boolean,overlay:boolean){
 const scrollTop=useRef(0);
 useLayoutEffect(()=>{
  const panel=ref.current;
  if(!panel)return;
  const scroll=panel.querySelector<HTMLElement>('.navigation-scroll');
  if(!scroll)return;
  const rememberScroll=()=>{if(panel.open||panel.classList.contains('sidebar'))scrollTop.current=scroll.scrollTop;};
  scroll.addEventListener('scroll',rememberScroll,{passive:true});
  return()=>scroll.removeEventListener('scroll',rememberScroll);
 },[ref]);
 useLayoutEffect(()=>{
  const panel=ref.current;
  if(!panel)return;
  const scroll=panel.querySelector<HTMLElement>('.navigation-scroll');
  const wasOverlay=panel.open;
  const focusWasInside=panel.contains(document.activeElement);
  if(!overlay&&wasOverlay){
   scrollTop.current=scroll?.scrollTop??0;
   panel.close();
  }
  if(docked){
   if(wasOverlay)panel.querySelector<HTMLElement>('.sidebar-pin')?.focus({preventScroll:true});
  }else if(overlay){
   if(!wasOverlay){
    panel.showModal();
    panel.querySelector<HTMLElement>('.sidebar-close')?.focus({preventScroll:true});
   }
  }else if(wasOverlay||focusWasInside){
   focusSidebarOpener();
  }
  if((docked||overlay)&&scroll)scroll.scrollTop=scrollTop.current;
 },[ref,docked,overlay]);
}
