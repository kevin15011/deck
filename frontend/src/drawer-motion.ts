import {useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {hasOpenDismissLayer,listenForDismissal} from './dismiss-layer';

export const sidebarPanelId='projects-and-sessions';
export const sidebarOpenerClass='sidebar-opener';
const sidebarEdgeWidth=12;

export function focusSidebarOpener(){
 const openers=[...document.querySelectorAll<HTMLElement>('.'+sidebarOpenerClass)];
 openers.find(button=>button.getClientRects().length)?.focus({preventScroll:true});
}

export function useSidebarHover(ref:RefObject<HTMLDialogElement|null>,enabled:boolean){
 const [hovered,setHovered]=useState(false);
 const state=useRef({enabled,hovered,atEdge:false,dismissedAtEdge:false,timer:0});
 state.current.enabled=enabled;
 state.current.hovered=enabled&&hovered;
 function close(){
  clearTimeout(state.current.timer);
  state.current.timer=0;
  state.current.dismissedAtEdge=state.current.atEdge;
  state.current.hovered=false;
  setHovered(false);
 }
 useLayoutEffect(()=>{if(!enabled)close();},[enabled]);
 useEffect(()=>{
  const mouse=matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const current=state.current;
  let lastMove:PointerEvent|undefined;
  function inDrawer(target:EventTarget|null){
   if(!(target instanceof Element)||!ref.current)return false;
   if(ref.current.contains(target))return true;
   const menu=target.closest('[role="menu"]');
   return !!menu&&Array.from(ref.current.querySelectorAll('[aria-controls]')).some(el=>el.getAttribute('aria-controls')===menu.id);
  }
  function canReveal(target:EventTarget|null){
   return !hasOpenDismissLayer()&&!document.querySelector('dialog:modal, :popover-open')&&
    !(target instanceof Element&&target.closest('.attention-bubbles, button, a, input, textarea, select, [contenteditable="true"]'));
  }
  function move(event:PointerEvent){
   if(!mouse.matches||event.pointerType!=='mouse')return;
   lastMove=event;
   current.atEdge=event.clientX>=0&&event.clientX<sidebarEdgeWidth;
   if(!current.atEdge)current.dismissedAtEdge=false;
   if(!current.enabled)return;
   if(current.hovered){
    if(inDrawer(event.target)||ref.current?.querySelector('dialog:modal')){
     clearTimeout(current.timer);
     current.timer=0;
    }else if(!current.timer)current.timer=window.setTimeout(close,220);
   }else if(!current.atEdge||event.buttons||!canReveal(event.target)){
    clearTimeout(current.timer);
    current.timer=0;
   }else if(!current.timer&&!current.dismissedAtEdge){
    current.timer=window.setTimeout(()=>{
     current.timer=0;
     if(current.enabled&&current.atEdge&&lastMove&&canReveal(document.elementFromPoint(lastMove.clientX,lastMove.clientY))){
      current.hovered=true;
      setHovered(true);
     }
    },180);
   }
  }
  function leave(event:PointerEvent){
   if(event.pointerType!=='mouse'||event.relatedTarget)return;
   clearTimeout(current.timer);
   current.timer=0;
   current.atEdge=false;
   current.dismissedAtEdge=false;
   if(current.hovered&&!ref.current?.querySelector('dialog:modal'))current.timer=window.setTimeout(close,220);
  }
  function press(event:PointerEvent){
   if(event.pointerType!=='mouse'||current.hovered||!current.atEdge)return;
   close();
  }
  function reset(){
   current.atEdge=false;
   if(!ref.current?.querySelector('dialog:modal'))close();
  }
  const dismiss=listenForDismissal(document,{isOpen:()=>current.hovered&&!document.querySelector('dialog:modal'),contains:inDrawer,dismiss:close,node:()=>ref.current});
  // Observe the edge without placing a hit target over workspace controls.
  document.addEventListener('pointermove',move,true);
  document.addEventListener('pointerout',leave,true);
  document.addEventListener('pointerdown',press,true);
  mouse.addEventListener('change',reset);
  window.addEventListener('blur',reset);
  return()=>{
   dismiss();
   clearTimeout(current.timer);
   document.removeEventListener('pointermove',move,true);
   document.removeEventListener('pointerout',leave,true);
   document.removeEventListener('pointerdown',press,true);
   mouse.removeEventListener('change',reset);
   window.removeEventListener('blur',reset);
  };
 },[ref]);
 return {open:enabled&&hovered,close};
}

/** Keep the same navigation mounted across dock, pointer hover and explicit opening. */
export function useSidebarPanel(ref:RefObject<HTMLDialogElement|null>,docked:boolean,overlay:boolean,hover:boolean){
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
  const wasHover=panel.hasAttribute('data-sidebar-hover');
  const wasOverlay=panel.open&&!wasHover;
  const focusWasInside=panel.contains(document.activeElement);
  if(wasHover&&!hover){
   scrollTop.current=scroll?.scrollTop??0;
   panel.removeAttribute('open');
   panel.removeAttribute('data-sidebar-hover');
  }
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
  }else if(hover){
   // Setting open reveals the modeless dialog without running dialog focusing steps.
   if(!wasHover){
    panel.setAttribute('data-sidebar-hover','');
    panel.setAttribute('open','');
   }
  }else if(wasOverlay||focusWasInside){
   focusSidebarOpener();
  }
  if((docked||overlay||hover)&&scroll)scroll.scrollTop=scrollTop.current;
 },[ref,docked,overlay,hover]);
}
