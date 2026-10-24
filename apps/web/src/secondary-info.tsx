import { useDismissLayer } from './dismiss-layer';
import React, { createContext, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DeckHistory } from './navigation';

type Rect = { left:number; top:number; right:number; bottom:number };
type Viewport = { left:number; top:number; width:number; height:number };
export function placeSecondaryPanel(anchor:Rect, size:{width:number;height:number}, viewport:Viewport) {
    const width=Math.min(size.width,viewport.width-16),height=Math.min(size.height,viewport.height-16);
    const left=Math.max(viewport.left+8,Math.min(anchor.left,viewport.left+viewport.width-width-8));
    const below=anchor.bottom+8,above=anchor.top-height-8;
    const top=Math.max(viewport.top+8,Math.min(below+height<=viewport.top+viewport.height-8?below:above,viewport.top+viewport.height-height-8));
    return {left,top,width,height};
}
type Controls = { active?:string; open(id:string):void; close(replace?:boolean):void; register(id:string):()=>void; restoreAllowed():boolean };
const SecondaryContext=createContext<Controls|undefined>(undefined);

/** One presentation surface, owned by the workspace, never by a module cache. */
export function SecondaryInfoProvider({children,scopeKey='',navigation,activeId,blocked=false}:{children:React.ReactNode;scopeKey?:string;navigation?:DeckHistory;activeId?:string;blocked?:boolean}) {
    const [local,setLocal]=useState<string>(),registered=useRef(new Set<string>()),scope=useRef(scopeKey);
    const selected=navigation?activeId:local,stale=scope.current!==scopeKey;
    const active=blocked||stale?undefined:selected,latest=useRef({active,restore:!blocked&&!stale});latest.current={active,restore:!blocked&&!stale};
    const close=useCallback((replace=false)=>{if(navigation)navigation.closeSecondary(replace);else setLocal(undefined);},[navigation]);
    const register=useCallback((id:string)=>{registered.current.add(id);return()=>{registered.current.delete(id);};},[]);
    useLayoutEffect(()=>{if(stale||blocked||selected&&!registered.current.has(selected))close(true);scope.current=scopeKey;},[scopeKey,stale,blocked,selected,close]);
    const controls:Controls={active,open:id=>{if(!blocked){if(navigation)navigation.openSecondary(id);else setLocal(id);}},close,register,restoreAllowed:()=>latest.current.restore&&!latest.current.active};
    return <SecondaryContext.Provider value={controls}>{children}</SecondaryContext.Provider>;
}

type InfoProps={title:string;label:string;children:React.ReactNode;resetKey?:string;className?:string;accessibleLabel?:string};
export function SecondaryInfo(props:InfoProps) {
    const controls=useContext(SecondaryContext);
    return controls?<InfoTrigger {...props}/>:<SecondaryInfoProvider><InfoTrigger {...props}/></SecondaryInfoProvider>;
}
function InfoTrigger({title,label,children,resetKey='',className='',accessibleLabel}:InfoProps) {
    const controls=useContext(SecondaryContext)!,id=`secondary-${useId().replace(/[^A-Za-z0-9_-]/g,'')}`,trigger=useRef<HTMLButtonElement>(null),previous=useRef(resetKey);
    const active=controls.active===id,latest=useRef(controls);latest.current=controls;
    // A restored history marker can be active on the first render, before the
    // button ref exists. Publish that opener after mount so its portal appears.
    const [restoredOpener,setRestoredOpener]=useState<HTMLButtonElement|null>(null);
    useLayoutEffect(()=>{if(active&&!restoredOpener&&trigger.current)setRestoredOpener(trigger.current);},[active,restoredOpener]);
    useLayoutEffect(()=>{
        const unregister=controls.register(id),opener=trigger.current;
        return()=>{
            unregister();
            if(latest.current.active===id){
                latest.current.close(true);
                // A removed task has no opener to restore. Wait for the close
                // commit, then use the conversation without stealing new focus.
                requestAnimationFrame(()=>{if(!opener?.isConnected&&latest.current.restoreAllowed()&&document.activeElement===document.body)document.querySelector<HTMLElement>('#prompt, #conversation')?.focus({preventScroll:true});});
            }
        };
    },[controls.register,id]);
    useLayoutEffect(()=>{if(previous.current!==resetKey&&active)controls.close(true);previous.current=resetKey;},[resetKey,active,controls]);
    return <><button ref={trigger} type="button" className={`secondary-info-trigger quiet ${className}`} data-secondary-trigger={id} aria-label={accessibleLabel??title} aria-haspopup="dialog" aria-expanded={active} aria-controls={active?id:undefined} onClick={event=>{event.stopPropagation();if(active)controls.close();else controls.open(id);}}>{label}<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 7v4m0-7v1"/></svg></button>{active&&(restoredOpener??trigger.current)&&createPortal(<InfoSurface id={id} title={title} trigger={(restoredOpener??trigger.current)!} controls={controls}>{children}</InfoSurface>,document.body)}</>;
}

function InfoSurface({id,title,trigger,controls,children}:{id:string;title:string;trigger:HTMLButtonElement;controls:Controls;children:React.ReactNode}) {
    const dialog=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null),latest=useRef(controls);latest.current=controls;
    const [modal,setModal]=useState(()=>window.matchMedia('(max-width: 1000px)').matches||!('showPopover' in HTMLElement.prototype));
    const opener=useRef<HTMLElement|null>(trigger);opener.current=trigger;
    useDismissLayer({open:!modal,roots:[dialog,opener],onDismiss:()=>latest.current.close()});
    useLayoutEffect(()=>{const media=window.matchMedia('(max-width: 1000px)'),change=()=>setModal(media.matches||!('showPopover' in HTMLElement.prototype));media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
    useLayoutEffect(()=>{
        const panel=dialog.current!;
        const viewport=()=>{const v=window.visualViewport;return{left:v?.offsetLeft??0,top:v?.offsetTop??0,width:v?.width??innerWidth,height:v?.height??innerHeight};};
        const position=()=>{
            if(!trigger.isConnected||!trigger.getClientRects().length){latest.current.close(true);return;}
            const v=viewport();panel.style.width=`${modal?v.width-16:Math.min(376,v.width-16)}px`;panel.style.maxHeight=`${modal?Math.floor(v.height*.82):v.height-16}px`;
            const rect=panel.getBoundingClientRect(),p=placeSecondaryPanel(trigger.getBoundingClientRect(),rect,v);
            panel.style.left=`${modal?v.left+8:p.left}px`;panel.style.top=`${modal?v.top+v.height-rect.height-8:p.top}px`;panel.style.visibility='visible';
        };
        if(modal)panel.showModal();else panel.showPopover();position();closeButton.current?.focus({preventScroll:true});
        const observer=new ResizeObserver(position);observer.observe(panel);observer.observe(trigger);
        window.addEventListener('resize',position);document.addEventListener('scroll',position,true);window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
        let releaseClick:undefined|(()=>void);
        const consume=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
        const outside=(event:PointerEvent)=>{
            if(!modal)return;
            const target=event.target as Element,rect=panel.getBoundingClientRect();
            const backdrop=target===panel&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
            if(!backdrop&&panel.contains(target)||target.closest('[data-secondary-trigger]'))return;
            consume(event);
            // Consume the click paired with this pointerdown, even if React has
            // already removed the surface. Never activate Cancel through it.
            releaseClick?.();const click=(e:Event)=>{consume(e);releaseClick?.();},cancel=()=>releaseClick?.();
            const timeout=setTimeout(cancel,700);releaseClick=()=>{clearTimeout(timeout);document.removeEventListener('click',click,true);document.removeEventListener('pointerdown',cancel,true);document.removeEventListener('pointercancel',cancel,true);releaseClick=undefined;};
            document.addEventListener('click',click,true);document.addEventListener('pointerdown',cancel,true);document.addEventListener('pointercancel',cancel,true);
            latest.current.close();
        };
        const key=(event:KeyboardEvent)=>{
            if(modal&&event.key==='Escape'){consume(event);latest.current.close();return;}
            if(modal&&event.key==='Tab'){
                const items=[...panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length);
                const first=items[0],last=items.at(-1);
                if(event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){consume(event);(event.shiftKey?last:first)?.focus({preventScroll:true});}
            }
        };
        const wheel=(event:WheelEvent|TouchEvent)=>{if(modal&&!panel.contains(event.target as Node))consume(event);};
        document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key,true);document.addEventListener('wheel',wheel,{capture:true,passive:false});document.addEventListener('touchmove',wheel,{capture:true,passive:false});
        return()=>{
            observer.disconnect();window.removeEventListener('resize',position);document.removeEventListener('scroll',position,true);window.visualViewport?.removeEventListener('resize',position);window.visualViewport?.removeEventListener('scroll',position);
            document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key,true);document.removeEventListener('wheel',wheel,true);document.removeEventListener('touchmove',wheel,true);
            if(modal)panel.close();else if(panel.matches(':popover-open'))panel.hidePopover();
            if(latest.current.restoreAllowed()){
                const target=trigger.isConnected&&trigger.getClientRects().length?trigger:document.querySelector<HTMLElement>('#prompt, #conversation');
                target?.focus({preventScroll:true});
            }
        };
    },[id,modal,trigger]);
    return <dialog ref={dialog} id={id} popover={modal?undefined:'manual'} className="secondary-info-panel" data-modal={modal} aria-modal={modal?true:undefined} aria-labelledby={`${id}-title`} style={{visibility:'hidden'}} onCancel={event=>{event.preventDefault();event.stopPropagation();controls.close();}} onClick={event=>event.stopPropagation()}><header><h2 id={`${id}-title`}>{title}</h2><button ref={closeButton} type="button" className="quiet secondary-info-close" aria-label={`Close ${title}`} onClick={()=>controls.close()}><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg></button></header><div className="secondary-info-body">{children}</div></dialog>;
}
