import {useEffect,useRef,useState,type PointerEvent} from 'react';

type Group = {project?:string;keys:string[]};
type Insertion = {key:string;after:boolean};
type Drag = {pointer:number;key:string;group:Group;x:number;y:number;startX:number;startY:number;active:boolean;target?:Insertion};

export function orderedRows<T>(rows:T[],order:string[]|undefined,key:(row:T)=>string):T[]{
 if(!order?.length)return rows;
 const positions=new Map(order.map((id,index)=>[id,index]));
 return [...rows].sort((a,b)=>(positions.get(key(a))??Infinity)-(positions.get(key(b))??Infinity));
}

export function useSidebarOrder(save:(group:Group)=>Promise<void>,disabled:boolean){
 const scroll=useRef<HTMLDivElement>(null);
 const drag=useRef<Drag>(undefined),frame=useRef(0),pending=useRef(false);
 const [marker,setMarker]=useState<Insertion>(),[announcement,setAnnouncement]=useState('');
 useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);

 function hit(current:Drag){
  const row=document.elementFromPoint(current.x,current.y)?.closest<HTMLElement>('[data-order-row]');
  if(!row||!scroll.current?.contains(row))return undefined;
  const key=row.dataset.orderRow;
  if(!key||key===current.key||
    row.dataset.orderGroup!==(current.group.project??'')||!current.group.keys.includes(key))return undefined;
  const bounds=row.getBoundingClientRect();
  return {key,after:current.y>bounds.top+bounds.height/2};
 }

 function update(current:Drag){
  const target=hit(current);
  if(target?.key!==current.target?.key||target?.after!==current.target?.after){
   current.target=target;
   setMarker(target);
  }
 }

 function autoScroll(){
  const current=drag.current, viewport=scroll.current;
  if(!current?.active||!viewport)return;
  const bounds=viewport.getBoundingClientRect();
  if(current.x>=bounds.left&&current.x<=bounds.right&&current.y>=bounds.top&&current.y<=bounds.bottom){
   const edge=32;
   const speed=Math.max(0,edge-(bounds.bottom-current.y))-Math.max(0,edge-(current.y-bounds.top));
   if(speed){
    viewport.scrollTop+=speed/3;
    update(current);
   }
  }
  frame.current=requestAnimationFrame(autoScroll);
 }

 function finish(event:PointerEvent,commit:boolean){
  const current=drag.current;
  if(current?.pointer!==event.pointerId)return;
  drag.current=undefined;
  cancelAnimationFrame(frame.current);
  setMarker(undefined);
  if(commit&&current.active){
   current.x=event.clientX;current.y=event.clientY;
   const target=hit(current);
   if(target)void move(current.group,current.key,target);
  }
 }

 async function move(group:Group,key:string,target:Insertion,focus?:HTMLElement){
  if(disabled||pending.current)return;
  const keys=group.keys.filter(id=>id!==key);
  const anchor=keys.indexOf(target.key);
  if(anchor<0)return;
  const index=anchor+Number(target.after);
  if(index===group.keys.indexOf(key))return;
  keys.splice(index,0,key);
  pending.current=true;
  const restoreFocus=focus===document.activeElement;
  try{
   await save({...group,keys});
   setAnnouncement('Moved to position '+(index+1)+' of '+keys.length);
   if(restoreFocus)requestAnimationFrame(()=>{
    if(document.activeElement===document.body)focus?.focus({preventScroll:true});
   });
  }catch{
   setAnnouncement('Could not reorder item');
  }finally{
   pending.current=false;
  }
 }

 function handle(group:Group,key:string,label:string){
  return <button type="button" className="quiet sidebar-reorder" aria-label={'Reorder '+label}
   aria-keyshortcuts="ArrowUp ArrowDown" title="Drag or use Up and Down arrows to reorder"
   disabled={disabled||group.keys.length<2||!group.keys.includes(key)}
   onPointerDown={event=>{
    if(event.button!==0||!event.isPrimary||pending.current||drag.current)return;
    const {clientX:x,clientY:y,pointerId:pointer}=event;
    event.currentTarget.setPointerCapture(pointer);
    drag.current={key,group,pointer,x,y,startX:x,startY:y,active:false};
   }}
   onPointerMove={event=>{
    const current=drag.current;
    if(current?.pointer!==event.pointerId)return;
    current.x=event.clientX;current.y=event.clientY;
    if(!current.active&&Math.hypot(current.x-current.startX,current.y-current.startY)>=5){
     current.active=true;
     frame.current=requestAnimationFrame(autoScroll);
    }
    if(current.active)update(current);
   }}
   onPointerUp={event=>finish(event,true)}
   onPointerCancel={event=>finish(event,false)}
   onLostPointerCapture={event=>finish(event,false)}
   onKeyDown={event=>{
    if(event.key==='Escape'&&drag.current?.key===key){
     event.preventDefault();
     event.stopPropagation();
     event.currentTarget.releasePointerCapture(drag.current.pointer);
     return;
    }
    if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
    event.preventDefault();
    const after=event.key==='ArrowDown';
    const neighbor=group.keys[group.keys.indexOf(key)+(after?1:-1)];
    if(neighbor)void move(group,key,{key:neighbor,after},event.currentTarget);
   }}>
   <span aria-hidden="true" className="sidebar-reorder-grip"/>
  </button>;
 }

 function row(group:Group,key:string){
  return {'data-order-row':key,'data-order-group':group.project??'',
   'data-insertion':marker?.key===key?(marker.after?'after':'before'):undefined};
 }

 return {scroll,handle,row,announcement};
}
