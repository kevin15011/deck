import React,{useLayoutEffect,useRef} from 'react';
import {gsap} from 'gsap';

/** Submit and Stop are separate actions. Enter always goes through form admission. */
export function ComposerAction({stop,stopping,disabled,stopDisabled,queued,pending,title,onStop}:{stop:boolean;stopping:boolean;disabled:boolean;stopDisabled:boolean;queued:boolean;pending:boolean;title:string;onStop:()=>void}) {
 const node=useRef<HTMLButtonElement>(null),focused=useRef(false);
 useLayoutEffect(()=>{
  const button=node.current;if(!button)return;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const paint=()=>{gsap.killTweensOf(button);button.hidden=!stop;if(!stop){gsap.set(button,{clearProps:'opacity'});const prompt=document.getElementById('prompt');if(focused.current&&document.activeElement===document.body&&prompt?.getClientRects().length&&!prompt.closest('[hidden],[inert]'))prompt.focus({preventScroll:true});focused.current=false;return;}if(media.matches)gsap.set(button,{clearProps:'opacity'});else {if(!button.style.opacity)gsap.set(button,{opacity:.65});gsap.to(button,{opacity:1,duration:.14,ease:'power2.out',overwrite:true,clearProps:'opacity'});}};
  paint();media.addEventListener('change',paint);return()=>{media.removeEventListener('change',paint);gsap.killTweensOf(button);};
 },[stop]);
 return <><button ref={node} onFocus={()=>{focused.current=true;}} onBlur={e=>{if(e.relatedTarget&&e.relatedTarget!==document.body)focused.current=false;}} type="button" className="quiet composer-stop" hidden={!stop} aria-label={stopping?'Stopping Lead':'Stop Lead'} title="Stop the current Lead turn; your draft and queued messages are kept." aria-busy={stopping} disabled={stopDisabled} onClick={onStop}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button><button type="submit" className="send" aria-label={pending?'Retry retained message':queued?'Queue message':'Send message'} title={title} disabled={disabled}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></>;
}
