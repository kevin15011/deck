import React,{useEffect,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {transcriptRenderBudget,windowRange} from './conversation-timeline';
import {captureTranscriptAnchor,restoreTranscriptAnchor,restoreTranscriptPosition,useTranscriptScroll,type TranscriptDirection} from './transcript-scroll';
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
type Row = {key:string};
type Bounds = {start:number;end:number};
type KeyedBounds = {first:string;last:string};

export function LiveTranscriptWindow<T extends Row>({rows,viewport,children,following,limit,rowCost,focusKey,preferStart}:{
 rows:T[];viewport:RefObject<HTMLElement|null>;children:(row:T)=>ReactNode;
 following:RefObject<boolean>;limit:number;rowCost:(row:T)=>number;focusKey?:string;preferStart:boolean;
}){
 const root=useRef<HTMLDivElement>(null);
 const [page,setPage]=useState<KeyedBounds>();
 const [fill,setFill]=useState<{first:string;tail:string}>();
 const filledTail=useRef<string|undefined>(undefined);
 const rendered=useRef<{bounds:KeyedBounds;tail:string;page?:KeyedBounds;preferStart:boolean}>(undefined);
 const change=useRef<{anchor:ReturnType<typeof captureTranscriptAnchor>;direction:TranscriptDirection}>(undefined);
 const tail=rows.at(-1)?.key;
 const lastRender=rendered.current;
 const saved=page!==lastRender?.page?page:lastRender?.bounds;
 const first=saved?rows.findIndex(row=>row.key===saved.first):-1;
 const last=saved?rows.findIndex(row=>row.key===saved.last):-1;
 const append=lastRender&&lastRender.tail!==tail&&following.current&&lastRender.bounds.last===lastRender.tail;
 const seekHistory=preferStart&&!lastRender?.preferStart;
 // Keep the render window stable while Markdown streams into a mounted row.
 const range=first>=0&&last>=first&&!append&&!seekHistory?{start:first,end:last+1}
  :preferStart&&!append?budgetedRange(rows,0,'newer',limit,rowCost)
  :budgetedRange(rows,rows.length,'older',limit,rowCost);
 const focus=!page&&!preferStart&&focusKey?rows.findIndex(row=>row.key===focusKey):-1;
 const visibleRange:Bounds=focus>=0&&(focus<range.start||focus>=range.end)
  ?budgetedRange(rows,focus+1,'older',limit,rowCost):range;
 const {end}=visibleRange;
 const preceding=rows[visibleRange.start-1]?.key;
 const start=fill&&fill.tail===tail&&fill.first===preceding&&end===rows.length
  ?visibleRange.start-1:visibleRange.start;
 const olderKey=start>0&&end-start<limit?rows[start-1]?.key:undefined;

 useTranscriptScroll(viewport,(direction,node,threshold)=>{
  const content=root.current;
  const older=direction==='older';
  if(!content||change.current||(older?start===0:end===rows.length))return false;
  const view=node.getBoundingClientRect();
  const distance=older?node.scrollTop:node.scrollHeight-node.clientHeight-node.scrollTop;
  if(distance>threshold||!content.getClientRects().length)return false;
  // Admit one batch at the edge. Keep the visible rows and one adjacent row
  // from the old range, even when a single visible exchange exceeds the budget.
  const batch=budgetedRange(rows,older?start:end,direction,limit,rowCost);
  const visible=Array.from(content.children).map((el,index)=>({index:start+index,rect:el.getBoundingClientRect()}))
   .filter(({rect})=>rect.bottom>view.top&&rect.top<view.bottom);
  const next=older
   ?{start:batch.start,end:Math.min(end,Math.max(start+1,(visible.at(-1)?.index??start)+2))}
   :{start:Math.max(start,(visible[0]?.index??end-1)-1),end:batch.end};
  const firstVisible=visible[0];
  const anchor=firstVisible&&{key:rows[firstVisible.index]!.key,offset:firstVisible.rect.top-view.top};
  change.current={anchor,direction};
  following.current=false;
  setPage({first:rows[next.start]!.key,last:rows[next.end-1]!.key});
  return true;
 },node=>{
  following.current=!!root.current?.getClientRects().length&&end===rows.length&&node.scrollHeight-node.scrollTop-node.clientHeight<24;
 },(node,direction)=>{
  if(direction==='older'&&node.scrollTop>1)following.current=false;
  if(direction==='newer'&&end===rows.length&&root.current?.getClientRects().length&&node.scrollHeight-node.scrollTop-node.clientHeight<1)following.current=true;
 });

 useLayoutEffect(()=>{
  const moved=change.current,node=viewport.current;
  if(moved&&node&&root.current){
   restoreTranscriptAnchor(node,root.current,moved.anchor);
   if(moved.direction==='newer'&&end===rows.length&&node.scrollHeight-node.scrollTop-node.clientHeight<1)following.current=true;
   change.current=undefined;
  }
  rendered.current=tail?{bounds:{first:rows[start]!.key,last:rows[end-1]!.key},tail,page,preferStart}:undefined;
 });
 useEffect(()=>{
  const node=viewport.current,content=root.current;
  if(!node||!content||end!==rows.length)return;
  const layout=()=>{
   if(!following.current||!content.getClientRects().length||!node.clientHeight)return;
   const padding=parseFloat(getComputedStyle(node).paddingBottom);
   const bottom=content.getBoundingClientRect().bottom+padding;
   // Admit one complete predecessor beyond the budget if the mounted tail leaves a gap.
   if(!preferStart&&tail&&olderKey&&filledTail.current!==tail&&bottom<node.getBoundingClientRect().bottom-1){
    filledTail.current=tail;
    setFill({first:olderKey,tail});
    return;
   }
   restoreTranscriptPosition(node,node.scrollHeight-node.clientHeight);
  };
  layout();
  const observer=new ResizeObserver(layout);
  observer.observe(content);
  observer.observe(node);
  return()=>observer.disconnect();
 },[viewport,following,tail,olderKey,end,rows.length,preferStart]);
 return <div ref={root} className="transcript-window" data-window-start={start} data-window-end={end} data-window-total={rows.length}>
  {rows.slice(start,end).map(row=><div key={row.key} data-timeline-key={row.key}>{children(row)}</div>)}
 </div>;
}

/** The file list keeps explicit pagination controls. */
export function TranscriptWindow<T extends Row>({rows,viewport,children,onBrowse,limit=120,olderLabel,newerLabel}:{
 rows:T[];viewport:RefObject<HTMLElement|null>;children:(row:T)=>ReactNode;
 onBrowse:()=>void;limit?:number;olderLabel:string;newerLabel:string;
}){
 const [page,setPage]=useState<string>();
 const root=useRef<HTMLDivElement>(null);
 const anchor=useRef<ReturnType<typeof captureTranscriptAnchor>>(undefined);
 const index=page?rows.findIndex(row=>row.key===page):-1;
 const {start,end}=windowRange(rows.length,index<0?rows.length:index+1,limit);
 function move(older:boolean){
  const content=root.current,node=viewport.current;
  if(!content||!node||(older?start===0:end===rows.length))return;
  const step=Math.max(1,Math.min(40,Math.floor(limit/3)));
  const next=windowRange(rows.length,end+(older?-step:step),limit);
  anchor.current=captureTranscriptAnchor(node,content,new Set(rows.slice(next.start,next.end).map(row=>row.key)));
  onBrowse();
  setPage(next.end===rows.length?undefined:rows[next.end-1]!.key);
 }
 useTranscriptScroll(viewport,(direction,node,threshold)=>{
  if(direction!=='older'||start===0||node.scrollTop>=threshold)return false;
  move(true);
  return true;
 });
 useLayoutEffect(()=>{
  if(viewport.current&&root.current)restoreTranscriptAnchor(viewport.current,root.current,anchor.current);
  anchor.current=undefined;
 },[start,end,page]);
 return <div ref={root} className="transcript-window" data-window-start={start} data-window-end={end} data-window-total={rows.length}>
  {start>0&&<button type="button" className="quiet history-window-control" onClick={()=>move(true)}>{olderLabel}</button>}
  {rows.slice(start,end).map(row=><div key={row.key} data-timeline-key={row.key}>{children(row)}</div>)}
  {end<rows.length&&<button type="button" className="quiet history-window-control" onClick={()=>move(false)}>{newerLabel}</button>}
 </div>;
}

/** Newest-first task lists follow arrivals at the top and retain a keyed page during browsing. */
export function RecentTaskWindow<T extends Row>({rows,viewport,children,visible,detail,limit=20}:{
 rows:T[];viewport:RefObject<HTMLElement|null>;children:(row:T)=>ReactNode;
 visible:boolean;detail:boolean;limit?:number;
}){
 const [page,setPage]=useState<{head?:string}>();
 const root=useRef<HTMLDivElement>(null);
 const head=useRef<string|undefined>(undefined);
 const following=useRef(true);
 const move=useRef<{anchor:ReturnType<typeof captureTranscriptAnchor>;latest:boolean}|undefined>(undefined);
 const retained=page?.head??(following.current?undefined:head.current);
 const start=retained?Math.max(0,rows.findIndex(row=>row.key===retained)):0;
 const end=Math.min(start+limit,rows.length);
 function browse(older:boolean){
  const content=root.current,node=viewport.current;
  if(!content||!node||(older?end===rows.length:start===0))return;
  const step=Math.max(1,Math.floor(limit/3));
  const next=Math.min(Math.max(0,start+(older?step:-step)),Math.max(0,rows.length-limit));
  const latest=next===0;
  move.current={anchor:captureTranscriptAnchor(node,content,new Set(rows.slice(next,next+limit).map(row=>row.key))),latest};
  following.current=latest;
  setPage({head:latest?undefined:rows[next]!.key});
 }
 useTranscriptScroll(viewport,()=>false,node=>{
  if(visible&&!detail)following.current=start===0&&node.scrollTop<1;
 });
 useLayoutEffect(()=>{
  head.current=rows[start]?.key;
  const node=viewport.current,content=root.current,position=move.current;
  if(detail){following.current=false;return;}
  if(!visible||!node||!content)return;
  if(position?.latest)restoreTranscriptPosition(node,0);
  else if(position)restoreTranscriptAnchor(node,content,position.anchor);
  move.current=undefined;
  following.current=start===0&&node.scrollTop<1;
 });
 return <div ref={root} className="transcript-window">
  {start>0&&<button type="button" className="quiet history-window-control" onClick={()=>browse(false)}>Load newer subagents</button>}
  {rows.slice(start,end).map(row=><div key={row.key} data-timeline-key={row.key}>{children(row)}</div>)}
  {end<rows.length&&<button type="button" className="quiet history-window-control" onClick={()=>browse(true)}>Load older subagents</button>}
 </div>;
}
