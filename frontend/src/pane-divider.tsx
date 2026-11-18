import React,{useRef} from 'react';
import {resolveSplit} from './preferences';
/** Direct manipulation is immediate: no tween may lag behind a pointer or key. */
export function PaneDivider({value,onChange,hidden}:{value:number;onChange:(value:number)=>void;hidden:boolean}){
 const drag=useRef<{id:number;left:number;width:number}|undefined>(undefined);
 return <div className="pane-divider" role="separator" aria-label="Conversation width" aria-orientation="vertical" aria-controls="panel-conversation panel-activity" aria-valuemin={25} aria-valuemax={75} aria-valuenow={value} aria-valuetext={`${Math.round(value)}% conversation`} tabIndex={0} hidden={hidden}
  onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onChange(e.key==='Home'?25:e.key==='End'?75:resolveSplit(String(value+(e.key==='ArrowLeft'?-1:1)*2)));}}
  onDoubleClick={()=>onChange(50)}
  onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();const box=e.currentTarget.parentElement!.getBoundingClientRect();drag.current={id:e.pointerId,left:box.left,width:box.width};e.currentTarget.setPointerCapture(e.pointerId);}}
  onPointerMove={e=>{const d=drag.current;if(d&&d.id===e.pointerId)onChange(resolveSplit(String((e.clientX-d.left)/d.width*100)));}}
  onPointerUp={e=>{if(drag.current?.id===e.pointerId){drag.current=undefined;e.currentTarget.releasePointerCapture(e.pointerId);}}}
  onPointerCancel={()=>{drag.current=undefined;}} onLostPointerCapture={()=>{drag.current=undefined;}}/ >;
}
