import {gsap} from 'gsap';
import {CustomEase} from 'gsap/CustomEase';
import type {Theme} from './preferences';

gsap.registerPlugin(CustomEase);
const ease=CustomEase.create('deck-theme-reveal','.22,.61,.36,1');
type Bounds=Pick<DOMRect,'left'|'top'|'width'|'height'>;
function waveClip(x:number,y:number,r:number){
 const circle=(radius:number,reverse=false)=>Array.from({length:97},(_,i)=>{
  const a=(reverse?-i:i)*Math.PI/48;return `${x+Math.cos(a)*radius}px ${y+Math.sin(a)*radius}px`;
 });
 return `polygon(evenodd,${[...circle(r+8),...circle(Math.max(0,r-8),true)].join(',')})`;
}
/** Browser snapshots isolate paint from the live, mounted editor. GSAP owns all motion.
 * No WAAPI/default View Transition animations run. Capture has a short timeout so
 * unsupported, hidden or slow browsers always retain immediate access to the editor. */
export function createThemeReveal(){
 const root=document.documentElement,media=matchMedia('(prefers-reduced-motion: reduce)');
 let requested=root.dataset.theme,disposeRun:(()=>void)|undefined,disposed=false;
 const cancel=()=>{disposeRun?.();};
 document.addEventListener('visibilitychange',cancel);media.addEventListener('change',cancel);
 const events=['pointerdown','keydown','beforeinput','wheel','resize'] as const;
 for(const event of events)window.addEventListener(event,cancel,{capture:true,passive:true});
 return {
  select(theme:Theme,bounds:Bounds){
   if(disposed||theme===requested)return;
   const width=innerWidth,height=innerHeight,x=Math.max(0,Math.min(width,bounds.left+bounds.width/2)),y=Math.max(0,Math.min(height,bounds.top+bounds.height/2));
   const radius=Math.hypot(Math.max(x,width-x),Math.max(y,height-y)),source=requested;
   cancel();requested=theme;
   if(!document.startViewTransition||!('adoptedStyleSheets' in document)||!('replaceSync' in CSSStyleSheet.prototype)||document.hidden||media.matches){root.dataset.theme=theme;return;}
   const color=source==='dark'&&theme==='green'?'#93c9b1':source==='green'&&theme==='dark'?'#ff7040':undefined;
   // CSSOM owns dynamic rules without an inline style element blocked by CSP.
   const sheet=new CSSStyleSheet();
   sheet.replaceSync(`::view-transition,::view-transition-group(*),::view-transition-image-pair(*),::view-transition-old(*),::view-transition-new(*){animation:none!important;pointer-events:none!important}@keyframes deck-theme-hold{from,to{opacity:1}}::view-transition-group(root){animation:deck-theme-hold 1.6s linear!important}::view-transition-old(root){z-index:1}::view-transition-new(root){z-index:2;mix-blend-mode:normal;clip-path:circle(0px at ${x}px ${y}px)}::view-transition-new(deck-theme-wave){clip-path:${waveClip(x,y,0)}}`);
   document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
   const rules=sheet.cssRules,newRule=(rules[4] as CSSStyleRule).style,waveRule=(rules[5] as CSSStyleRule).style;
   let wave:HTMLDivElement|undefined,transition:ViewTransition|undefined,tween:gsap.core.Timeline|undefined,finished=false;
   const end=()=>{if(finished)return;finished=true;clearTimeout(timer);tween?.kill();try{transition?.skipTransition();}catch{}wave?.remove();document.adoptedStyleSheets=document.adoptedStyleSheets.filter(owned=>owned!==sheet);if(disposeRun===end){disposeRun=undefined;root.dataset.theme=requested;}};
   disposeRun=end;
   let timer=setTimeout(end,180);
   try{
    transition=document.startViewTransition(()=>{
     if(finished)return;root.dataset.theme=theme;
     if(color){wave=document.createElement('div');wave.setAttribute('aria-hidden','true');wave.className='theme-reveal-wave';wave.style.background=color;document.body.append(wave);}
    });
    void transition.finished.then(end,end);
    void transition.ready.then(()=>{
     if(finished)return;if(document.hidden||media.matches){end();return;}
     clearTimeout(timer);timer=setTimeout(end,1600);
     const progress={radius:0};
     tween=gsap.timeline({onComplete:end}).to(progress,{radius,duration:1,ease,onUpdate:()=>{
      newRule.clipPath=`circle(${progress.radius}px at ${x}px ${y}px)`;
      if(color)waveRule.clipPath=waveClip(x,y,progress.radius);
     }},0);
     if(color)tween.to(waveRule,{opacity:.65,duration:.12,ease:'none'},0).to(waveRule,{opacity:.5,duration:.63,ease:'none'},.12).to(waveRule,{opacity:0,duration:.25,ease:'none'},.75);
    },end);
   }catch{end();}
  },
  cancel,
  dispose(){cancel();disposed=true;document.removeEventListener('visibilitychange',cancel);media.removeEventListener('change',cancel);for(const event of events)window.removeEventListener(event,cancel,true);},
 };
}
