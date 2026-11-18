import React,{useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {windowRange} from './conversation-timeline';
/** Keeps a sliding 120-row DOM window. Stable keys preserve a visible anchor when
 * rows are prepended and the far end is removed (height deltas alone cannot). */
export function TranscriptWindow<T extends {key:string}>({rows,viewport,children,onBrowse,limit=120,onOlder,olderLabel="Load older messages"}:{limit?:number;onOlder?:()=>void;olderLabel?:string;rows:T[];viewport:RefObject<HTMLElement|null>;children:(row:T)=>ReactNode;onBrowse:()=>void}){
 const [endKey,setEndKey]=useState<string|null>(null),root=useRef<HTMLDivElement>(null);
 const anchor=useRef<{key:string;offset:number}|null>(null),loading=useRef(false);
 const found=endKey===null?-1:rows.findIndex(r=>r.key===endKey);
 const {start,end}=windowRange(rows.length,found<0?rows.length:found+1,limit);
 function move(older:boolean){
  if(loading.current||older&&start===0||!older&&end===rows.length)return;
  const node=viewport.current;if(!node)return;
  const first=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-timeline-key]')??[]).find(el=>el.getBoundingClientRect().bottom>node.getBoundingClientRect().top+32);
  if(first)anchor.current={key:first.dataset.timelineKey!,offset:first.getBoundingClientRect().top-node.getBoundingClientRect().top};
  loading.current=true;onBrowse();const next=older?Math.max(limit,end-Math.min(40,Math.floor(limit/3))):Math.min(rows.length,end+Math.min(40,Math.floor(limit/3)));setEndKey(next===rows.length?null:rows[next-1]!.key);
 }
 useLayoutEffect(()=>{
  const node=viewport.current,a=anchor.current;
  if(node&&a){const el=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-timeline-key]')??[]).find(el=>el.dataset.timelineKey===a.key);if(el)node.scrollTop+=el.getBoundingClientRect().top-node.getBoundingClientRect().top-a.offset;}
  anchor.current=null;loading.current=false;
 },[start,end]);
 useLayoutEffect(()=>{const node=viewport.current;if(!node)return;const scroll=()=>{if(node.scrollTop<24){if(start===0)onOlder?.();else move(true);}};node.addEventListener('scroll',scroll);return()=>node.removeEventListener('scroll',scroll);},[start,end,rows]);
 return <div ref={root} className="transcript-window" data-window-start={start} data-window-end={end} data-window-total={rows.length}>
 {start>0&&<button type="button" className="quiet history-window-control" onClick={()=>move(true)}>{olderLabel}</button>}
 {rows.slice(start,end).map(row=><div key={row.key} data-timeline-key={row.key}>{children(row)}</div>)}
 {end<rows.length&&<button type="button" className="quiet history-window-control" onClick={()=>move(false)}>Load newer messages</button>}
 </div>;
}
