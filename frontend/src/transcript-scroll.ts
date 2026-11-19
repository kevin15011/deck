import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';

export type TranscriptDirection = 'older' | 'newer';
const edge = 24;
const restored = new WeakMap<HTMLElement,number>();
const handled = new WeakSet<Event>();

export function restoreTranscriptPosition(node:HTMLElement,top:number){
 if(Math.abs(node.scrollTop-top)<.5)return;
 node.scrollTop=top;
 restored.set(node,node.scrollTop);
}

export function captureTranscriptAnchor(node:HTMLElement,content:HTMLElement,retained:Set<string>){
 const viewport=node.getBoundingClientRect();
 for(const row of content.children){
  if(!(row instanceof HTMLElement)||!retained.has(row.dataset.timelineKey??''))continue;
  const bounds=row.getBoundingClientRect();
  if(bounds.bottom>viewport.top&&bounds.top<viewport.bottom)return {key:row.dataset.timelineKey!,offset:bounds.top-viewport.top};
 }
 return undefined;
}

export function restoreTranscriptAnchor(node:HTMLElement,content:HTMLElement,anchor:ReturnType<typeof captureTranscriptAnchor>){
 const row=anchor&&Array.from(content.children).find((el):el is HTMLElement=>
  el instanceof HTMLElement&&el.dataset.timelineKey===anchor.key);
 if(row&&anchor)restoreTranscriptPosition(node,node.scrollTop+row.getBoundingClientRect().top-node.getBoundingClientRect().top-anchor.offset);
}

export function useTranscriptScroll(viewport:RefObject<HTMLElement|null>,navigate:(direction:TranscriptDirection,node:HTMLElement,threshold:number)=>boolean,onPosition?:(node:HTMLElement,direction:TranscriptDirection)=>void,onIntent?:(node:HTMLElement,direction:TranscriptDirection)=>void){
 const current=useRef({navigate,onPosition,onIntent});
 useLayoutEffect(()=>{current.current={navigate,onPosition,onIntent};});
 useEffect(()=>{
  const node=viewport.current;
  if(!node)return;
  let top=node.scrollTop,touch:Touch|undefined;
  const move=(event:Event,direction:TranscriptDirection,threshold:number)=>{
   if(handled.has(event)||!node.clientHeight)return false;
   if(!current.current.navigate(direction,node,threshold))return false;
   handled.add(event);
   return true;
  };
  // The native scroll event handles wheel, momentum, keys and scrollbar drags.
  // At a hard edge (including an underfilled viewport), the gesture may produce no scroll event.
  const scroll=(event:Event)=>{
   const next=node.scrollTop,delta=next-top;
   top=next;
   if(next===restored.get(node)||Math.abs(delta)<.5)return;
   restored.delete(node);
   const direction=delta<0?'older':'newer';
   if(!move(event,direction,edge)&&!handled.has(event))current.current.onPosition?.(node,direction);
  };
  const gesture=(event:Event,direction:TranscriptDirection)=>{
   if(handled.has(event)||!node.clientHeight)return false;
   current.current.onIntent?.(node,direction);
   return move(event,direction,1);
  };
  const wheel=(event:WheelEvent)=>{
   if(!event.ctrlKey&&event.deltaY)gesture(event,event.deltaY<0?'older':'newer');
  };
  const key=(event:KeyboardEvent)=>{
   if(event.target!==node||event.defaultPrevented||event.altKey||event.metaKey)return;
   const direction=['ArrowUp','PageUp','Home'].includes(event.key)||(event.key===' '&&event.shiftKey)?'older'
    :['ArrowDown','PageDown','End',' '].includes(event.key)?'newer':undefined;
   if(direction&&gesture(event,direction))event.preventDefault();
  };
  const touchStart=(event:TouchEvent)=>{touch=event.touches.length===1?event.touches[0]:undefined;};
  const touchMove=(event:TouchEvent)=>{
   const point=event.touches.length===1?event.touches[0]:undefined;
   if(point&&touch){
    const delta=point.clientY-touch.clientY;
    if(Math.abs(delta)<4)return;
    if(Math.abs(delta)>=Math.abs(point.clientX-touch.clientX))gesture(event,delta>0?'older':'newer');
   }
   touch=point;
  };
  node.addEventListener('scroll',scroll,{passive:true});
  node.addEventListener('wheel',wheel,{passive:true});
  node.addEventListener('keydown',key);
  node.addEventListener('touchstart',touchStart,{passive:true});
  node.addEventListener('touchmove',touchMove,{passive:true});
  return()=>{
   node.removeEventListener('scroll',scroll);
   node.removeEventListener('wheel',wheel);
   node.removeEventListener('keydown',key);
   node.removeEventListener('touchstart',touchStart);
   node.removeEventListener('touchmove',touchMove);
  };
 },[viewport]);
}
