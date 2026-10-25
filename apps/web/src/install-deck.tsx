import {useDismissLayer} from './dismiss-layer';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {NavigationIcon} from './project-navigation';
import {createPortal} from 'react-dom';
import {ThemeDialog,ThemeSwatch} from './theme-select';
import {THEMES,type Theme} from './theme';
type Choice={outcome?:'accepted'|'dismissed'};
type InstallEvent=Event & {prompt:()=>Promise<Choice|void>;userChoice?:Promise<Choice>};
export function installHelp(ios:boolean,secure=true){return !secure?'Open Deck over HTTPS (or loopback on this computer), then use your browser’s install menu if available.':ios?'In Safari, open Share, choose Add to Home Screen, then Add. If you are using another browser, open this page in Safari.':'Open your browser’s menu and choose Install app or Add to Home Screen, if available. Some browsers do not offer installation.';}
export function useInstallDeck(){
 const event=useRef<InstallEvent|undefined>(undefined),attempt=useRef(0);
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
 const [hidden,setHidden]=useState(standalone),[status,setStatus]=useState(''),[pending,setPending]=useState(false);
 useEffect(()=>{
  const media=matchMedia('(display-mode: standalone)'),update=()=>setHidden(standalone());
  const capture=(incoming:Event)=>{if(typeof(incoming as InstallEvent).prompt!=='function')return;incoming.preventDefault();event.current=incoming as InstallEvent;};
  const installed=()=>{event.current=undefined;setHidden(true);setStatus('Deck installation was reported by this browser.');};
  window.addEventListener('beforeinstallprompt',capture);window.addEventListener('appinstalled',installed);media.addEventListener('change',update);
  return()=>{++attempt.current;window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',installed);media.removeEventListener('change',update);};
 },[]);
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const activate=()=>{
  if(hidden||pending)return;const captured=event.current;event.current=undefined;
  const version=++attempt.current;setStatus('');if(!captured)return;
  setPending(true);
  // Invoke synchronously inside the explicit menu click. Never from an effect.
  try{const result=captured.prompt();void Promise.resolve(captured.userChoice??result).then(choice=>{
    if(attempt.current!==version)return;setStatus(choice?.outcome==='accepted'?'Installation request accepted. Open Deck from your apps when it appears.':choice?.outcome==='dismissed'?'Installation dismissed. You can use your browser’s menu to try again.':'Follow the installation options offered by your browser.');
  }).catch(()=>{if(attempt.current===version)setStatus('The install prompt is unavailable. Use your browser’s menu if installation is offered.');}).finally(()=>{if(attempt.current===version)setPending(false);});}
  catch{setPending(false);setStatus('The install prompt is unavailable. Use your browser’s menu if installation is offered.');}
 };
 return{hidden,pending,status,help:installHelp(ios,window.isSecureContext),activate};
}
/** Navigation menu only: no banner, header/composer button, setting or permission request. */
export function DeckMenu({hidden,onInstall,onRestart,theme,onTheme,inline=false,onOpenTheme,onCloseTheme,onNotifications,onQuota,notificationsEnabled=false,notificationsAttention=false}:{hidden:boolean;onInstall:()=>void;onRestart?:()=>void;theme?:Theme;onTheme?:(theme:Theme)=>void;inline?:boolean;onOpenTheme?:()=>void;onCloseTheme?:()=>void;onNotifications?:()=>void;onQuota?:()=>void;notificationsEnabled?:boolean;notificationsAttention?:boolean}){
 const [open,setOpen]=useState(false),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
 const [themeOpen,setThemeOpen]=useState(false);
 useLayoutEffect(()=>{if(open)menu.current?.querySelector<HTMLButtonElement>('button')?.focus();},[open]);
 useDismissLayer({open,roots:[menu,trigger],onDismiss:reason=>{setOpen(false);if(reason==='escape')trigger.current?.focus({preventScroll:true});}});
 const current=THEMES.find(entry=>entry.id===theme);
 const closeTheme=()=>{setThemeOpen(false);if(onCloseTheme)onCloseTheme();else trigger.current?.focus({preventScroll:true});};
 const themes=current&&onTheme?<button ref={inline?trigger:undefined} type="button" role={inline?undefined:'menuitem'} className={`quiet theme-menu-item${inline?' drawer-install':''}`} aria-haspopup="dialog" onClick={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});onOpenTheme?.();setThemeOpen(true);}}><span>Theme</span><span className="theme-menu-current"><ThemeSwatch swatch={current.swatch}/><span>{current.label}</span></span></button>:null;
 const picker=themeOpen&&theme&&onTheme?createPortal(<ThemeDialog value={theme} onChange={onTheme} onClose={closeTheme}/>,document.body):null;
 const notifications=onNotifications?<button type="button" role={inline?undefined:'menuitem'} className={`quiet theme-menu-item${inline?' drawer-install':''}`} aria-haspopup="dialog" onClick={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});onNotifications();}}><span>Notifications</span><span className="theme-menu-current">{notificationsEnabled?'On':'Off'}{notificationsAttention&&<span className="menu-attention" role="img" aria-label="Notifications need attention"/>}</span></button>:null;
 const quota=onQuota?<button type="button" role={inline?undefined:'menuitem'} className={`quiet${inline?' drawer-install':''}`} aria-haspopup="dialog" onClick={()=>{setOpen(false);trigger.current?.focus({preventScroll:true});onQuota();}}>Quota usage</button>:null;
 if(hidden&&!onRestart&&!themes&&!notifications&&!quota)return null;
 const actions=[...(!hidden?[{label:'Install Deck',run:onInstall,path:'M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3'}]:[]),...(onRestart?[{label:'Restart Deck',run:onRestart,path:'M13 7a5 5 0 1 0-1 4M13 2v5H8'}]:[])];
 const activate=(run:()=>void)=>{setOpen(false);trigger.current?.focus({preventScroll:true});run();};
 if(inline)return <><div className="deck-menu drawer-secondary">{actions.map(action=><button key={action.label} type="button" className="quiet drawer-install" onClick={action.run}><svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={action.path}/></svg><span>{action.label}</span></button>)}{themes}{notifications}{quota}</div>{picker}</>;
 return <><div className="deck-menu"><button ref={trigger} type="button" className="quiet deck-menu-toggle" aria-label="Deck menu" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(x=>!x)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);}}}><NavigationIcon kind="more"/><span>Menu</span>{notificationsAttention&&<span className="menu-attention" role="img" aria-label="Notifications need attention"/>}</button>{open&&<div ref={menu} role="menu" aria-label="Deck" className="deck-menu-items" onKeyDown={e=>{if(e.key==='Escape'||e.key==='Tab'){if(e.key==='Escape')e.preventDefault();setOpen(false);trigger.current?.focus();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=[...menu.current!.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}}}>{actions.map(action=><button key={action.label} role="menuitem" type="button" className="quiet" onClick={()=>activate(action.run)}>{action.label}</button>)}{themes&&actions.length>0&&<hr className="deck-menu-separator"/>}{themes}{notifications}{quota}</div>}</div>{picker}</>;
}
export function InstallDeckDialog({open,onClose,help,status,pending}:{open:boolean;onClose:()=>void;help:string;status:string;pending:boolean}){
 const dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 return <dialog ref={dialog} className="workspace-dialog install-dialog" aria-labelledby="install-deck-title" onCancel={event=>{event.preventDefault();onClose();}} onClose={()=>{if(open)onClose();}} onClick={event=>{if(event.target!==event.currentTarget)return;const b=event.currentTarget.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)onClose();}}><div className="dialog-heading"><h2 id="install-deck-title">Install Deck</h2><button type="button" className="quiet" aria-label="Close installation help" onClick={onClose}>✕</button></div><p>{help}</p><p className="decision-note">Installation does not enable notifications or change your sessions.</p><p role="status" aria-live="polite">{pending?'Waiting for your browser’s install prompt…':status}</p><div className="dialog-actions"><button type="button" onClick={onClose}>Done</button></div></dialog>;
}
