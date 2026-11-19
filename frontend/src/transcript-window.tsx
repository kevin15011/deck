import React,{useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {transcriptRenderBudget,windowRange} from './conversation-timeline';
// Dense Markdown costs much more to mount than short messages. Keep one
// complete row even if it exceeds the budget so every turn stays reachable.
function budgetedRange<T>(rows:T[],edge:number,direction:'older'|'newer',limit:number,cost:(row:T)=>number){
 const backwards=direction==='older';
 let index=edge,spent=0;
 while(Math.abs(index-edge)<limit){
  const row=rows[backwards?index-1:index];
  if(!row)break;
  const next=spent+cost(row);
  if(index!==edge&&next>transcriptRenderBudget)break;
  spent=next;index+=backwards?-1:1;
 }
 return backwards?{start:index,end:edge}:{start:edge,end:index};
}
/** Stable keys preserve the visible anchor across window changes. */
export function TranscriptWindow<T extends {key:string}>({rows,viewport,children,onBrowse,limit=120,onOlder,olderLabel="Load older messages",rowCost,focusKey}:{limit?:number;onOlder?:()=>void;olderLabel?:string;rowCost?:(row:T)=>number;focusKey?:string;rows:T[];viewport:RefObject<HTMLElement|null>;children:(row:T)=>ReactNode;onBrowse:()=>void}){
 const [page,setPage]=useState<{key:string;direction:'older'|'newer'}|null>(),root=useRef<HTMLDivElement>(null);
 const anchor=useRef<{key:string;offset:number}|undefined>(undefined);
 const latestStart=useRef<string|undefined>(undefined);
 const browsing=useRef<'older'|'newer'|undefined>(undefined),restoredScroll=useRef<number|undefined>(undefined);
 const found=page?rows.findIndex(r=>r.key===page.key):-1;
 const focus=focusKey&&page===undefined?rows.findIndex(r=>r.key===focusKey):-1;
 const direction=found<0?'older':page!.direction;
 const edge=found<0?rows.length:found+(direction==='older'?1:0);
 const existingStart=rowCost&&!page&&latestStart.current!==undefined?rows.findIndex(r=>r.key===latestStart.current):-1;
 const range=existingStart>=0?{start:Math.max(existingStart,edge-limit),end:edge}
  :rowCost?budgetedRange(rows,edge,direction,limit,rowCost):windowRange(rows.length,edge,limit);
 const {start,end}=rowCost&&focus>=0&&(focus<range.start||focus>=range.end)
  ?budgetedRange(rows,focus+1,'older',limit,rowCost):range;
 function move(older:boolean){
  if(browsing.current||(older?start===0:end===rows.length))return;
  const node=viewport.current;if(!node)return;
  const bounds=node.getBoundingClientRect();
  const first=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-timeline-key]')??[]).find(el=>el.getBoundingClientRect().bottom>bounds.top+32);
  if(first)anchor.current={key:first.dataset.timelineKey!,offset:first.getBoundingClientRect().top-bounds.top};
  const dir=older?'older':'newer';
  browsing.current=dir;onBrowse();
  if(!rowCost){
   const step=Math.min(40,Math.floor(limit/3));
   const next=older?Math.max(limit,end-step):Math.min(rows.length,end+step);
   setPage(next===rows.length?null:{key:rows[next-1]!.key,direction:'older'});
   return;
  }
  // Share the boundary row where it fits. A turn over budget is a page
  // on its own, so navigation must still advance when overlap will not fit.
  let next=budgetedRange(rows,older?start+1:end-1,dir,limit,rowCost);
  if(older?next.start===start:next.end===end)next=budgetedRange(rows,older?start:end,dir,limit,rowCost);
  const latest=!older&&next.end===rows.length;
  if(latest)latestStart.current=undefined;
  setPage(latest?null:{key:rows[older?next.end-1:next.start]!.key,direction:dir});
 }
 useLayoutEffect(()=>{
  // Keep the admitted rows stable as a live reply grows. Reapplying the
  // Markdown budget on every poll would evict content above the reader.
  if(rowCost&&!page)latestStart.current=rows[range.start]?.key;
 });
 useLayoutEffect(()=>{
  const node=viewport.current,a=anchor.current,dir=browsing.current;
  if(node&&dir){
   const el=a&&Array.from(root.current?.querySelectorAll<HTMLElement>('[data-timeline-key]')??[]).find(el=>el.dataset.timelineKey===a.key);
   const previous=node.scrollTop;
   if(el)node.scrollTop+=el.getBoundingClientRect().top-node.getBoundingClientRect().top-a.offset;
   else if(rowCost)node.scrollTop=dir==='older'?node.scrollHeight:0;
   if(previous!==node.scrollTop)restoredScroll.current=node.scrollTop;
  }
  anchor.current=undefined;browsing.current=undefined;
 },[start,end,page]);
 useLayoutEffect(()=>{
  const node=viewport.current;if(!node)return;
  const scroll=()=>{
   const restored=restoredScroll.current;restoredScroll.current=undefined;
   if(node.scrollTop===restored||node.scrollTop>=24)return;
   if(start===0)onOlder?.();
   // A single dense turn can fill a page. Let readers reach its beginning
   // before leaving it via the explicit older control.
   else if(!rowCost||end-start>1)move(true);
  };
  node.addEventListener('scroll',scroll);
  return()=>node.removeEventListener('scroll',scroll);
 },[start,end,rows]);
 return <div ref={root} className="transcript-window" data-window-start={start} data-window-end={end} data-window-total={rows.length}>
 {start>0&&<button type="button" className="quiet history-window-control" onClick={()=>move(true)}>{olderLabel}</button>}
 {rows.slice(start,end).map(row=><div key={row.key} data-timeline-key={row.key}>{children(row)}</div>)}
 {end<rows.length&&<button type="button" className="quiet history-window-control" onClick={()=>move(false)}>Load newer messages</button>}
 </div>;
}
