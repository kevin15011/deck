import {useLayoutEffect,type RefObject} from 'react';
export {gsap} from 'gsap';
import {gsap} from 'gsap';
export const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
export function useContentMotion(ref:RefObject<HTMLElement|null>,key:unknown){
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');
 const settle=()=>{if(media.matches){gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});}};
 gsap.killTweensOf(node);if(!media.matches){if(!node.style.opacity)gsap.set(node,{opacity:.65});gsap.to(node,{opacity:1,duration:.18,ease:'power3.out',overwrite:true,clearProps:'opacity'});}
 media.addEventListener('change',settle);return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};
 },[key]);
}
