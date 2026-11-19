import {CodexServerRestart} from './codex-server-restart';
import {useActiveIndicator,useDisclosureMotion} from './view-motion';
import {request} from './api';
import {ApplicationSettings} from './application-settings';
import {RtkSettings} from './configuration';
import {usePushNotifications} from './push-notifications';
import type {Workspace} from './api';
import {DictationSettings} from './dictation/settings';
import React,{useLayoutEffect,useRef,useState,useId,useEffect} from 'react';
import {gsap} from 'gsap';
import {FONTS,THEMES,type Font,type Theme,type ChatWidth} from './preferences';
const normalizeSearch=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim();
const themeMatches=(theme:{id:string;label:string},query:string)=>normalizeSearch(theme.label).includes(normalizeSearch(query))||normalizeSearch(theme.id).includes(normalizeSearch(query));
function ThemeSwatch({swatch}:{swatch:readonly[string,string]}){return <svg className="theme-swatch" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill={swatch[0]} stroke="currentColor" strokeOpacity=".35"/><path d="M8 1a7 7 0 0 1 0 14z" fill={swatch[1]}/></svg>;}


/** Native modal owns keyboard containment and restores focus to Choose theme. */
function ThemePicker({value,onChange,onClose}:{value:Theme;onChange:(value:Theme,bounds:DOMRect)=>void;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const [closing,setClosing]=useState(false),close=()=>setClosing(true);
 useLayoutEffect(()=>{if(!closing)return;const node=dialog.current!,media=matchMedia('(prefers-reduced-motion: reduce)');
  gsap.killTweensOf(node);const finish=()=>onClose();if(media.matches){finish();return;}
  gsap.to(node,{opacity:0,y:4,duration:.12,ease:'power2.out',overwrite:true,onComplete:finish});
  const settle=()=>{if(media.matches){gsap.killTweensOf(node);finish();}};media.addEventListener('change',settle);
  return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);};
 },[closing]);
 useLayoutEffect(()=>{const node=dialog.current!;node.showModal();search.current?.focus({preventScroll:true});const media=matchMedia('(prefers-reduced-motion: reduce)');
  if(!media.matches)gsap.fromTo(node,{opacity:.6,y:6},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});
  const settle=()=>{if(media.matches){gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity,transform'});}};media.addEventListener('change',settle);
  return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);node.close();};
 },[]);
    const id = useId(), [query, setQuery] = useState(''), [highlighted, setHighlighted] = useState<Theme>(value);
    const themes = THEMES.filter(theme => themeMatches(theme, query));
    const active = themes.find(theme => theme.id === highlighted)?.id ?? themes[0]?.id;
    useEffect(() => { list.current?.querySelector(`[data-theme-id="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
    const navigate = (event: React.KeyboardEvent) => {
        if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.currentTarget === search.current && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key) || !themes.length) return;
        event.preventDefault();
        if (event.key === 'Enter') {
            const option = list.current?.querySelector<HTMLElement>(`[data-theme-id="${active}"]`);
            if (active && option) onChange(active, option.getBoundingClientRect());
            return;
        }
        const index = themes.findIndex(theme => theme.id === active);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? themes.length - 1 :
            (index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1) + themes.length) % themes.length;
        setHighlighted(themes[next]!.id);
    };
    return <dialog ref={dialog} inert={closing} aria-hidden={closing||undefined} className="workspace-dialog theme-dialog" aria-labelledby={`${id}-title`}
        onKeyDownCapture={event => {
            // Search inputs otherwise consume the first Escape just to clear their value.
            if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
            event.preventDefault(); event.stopPropagation(); close();
        }}
        onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
        onClick={event => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
        }}>
        <div className="dialog-heading"><h2 id={`${id}-title`}>Theme</h2><button type="button" className="quiet" aria-label="Close theme picker" onClick={close}>✕</button></div>
        <input ref={search} autoFocus type="search" role="combobox" aria-label="Search themes" placeholder="Search themes"
            aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={active ? `${id}-${active}` : undefined}
            value={query} onChange={event => setQuery(event.currentTarget.value)} onKeyDown={navigate}/>
        <div ref={list} id={`${id}-list`} className="theme-picker-list" role="listbox" aria-label="Themes" tabIndex={0}
            aria-activedescendant={active ? `${id}-${active}` : undefined} onKeyDown={navigate}>
            {themes.map(theme => <button key={theme.id} id={`${id}-${theme.id}`} data-theme-id={theme.id} type="button" role="option"
                tabIndex={-1} aria-selected={theme.id === value} className={`quiet theme-picker-option${theme.id === active ? ' highlighted' : ''}`}
                onFocus={() => setHighlighted(theme.id)} onClick={event => {
                    setHighlighted(theme.id);
                    // Keep keyboard focus on the composite so active-descendant changes are announced.
                    list.current?.focus({ preventScroll: true });
                    onChange(theme.id, event.currentTarget.getBoundingClientRect());
                }}>
                <ThemeSwatch swatch={theme.swatch}/><span>{theme.label}</span>
                {theme.id === value && <svg className="theme-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>}
            </button>)}
        </div>
        {!themes.length && <p role="status" className="muted">No themes match</p>}
        <div className="dialog-actions"><button type="button" onClick={close}>Done</button></div>
    </dialog>;
}

export function AgentSettings({w,connected,projectId}:{w:Workspace;connected:boolean;projectId?:string}){
 const [agents,setAgents]=useState<{name:string;ready:boolean|null}[]>([{name:'Claude',ready:null},{name:'Codex',ready:null}]),[loading,setLoading]=useState(false),[check,setCheck]=useState(0);
 useEffect(()=>{let live=true;if(!connected)return;setLoading(true);void(async()=>{
  let failed=false;try{await request('POST','/api/runners/refresh');}catch{failed=true;}
  try{const d=await request('GET','/api/runners') as {historical:boolean;refresh_error:string|null;observation:{ready:boolean}|null;open_code:{assignment:{runner:string}|null;ready:boolean}};
   if(!live)return;const rows=new Map<string,boolean|null>([['Claude',null],['Codex',failed||d.refresh_error?false:d.historical?null:d.observation?d.observation.ready===true:null]]);
   const runner=d.open_code?.assignment?.runner;if(runner&&runner!=='codex')rows.set(runner.charAt(0).toUpperCase()+runner.slice(1),d.open_code.ready===true);setAgents(Array.from(rows,([name,ready])=>({name,ready})));
  }catch{if(live)setAgents([{name:'Claude',ready:null},{name:'Codex',ready:failed?false:null}]);}
 })().finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[w.host_id,connected,check]);
 return <><RtkSettings w={w} connected={connected} projectId={projectId}/><div className="settings-card">{agents.map(a=><div className="settings-row" key={a.name}><h3>{a.name}</h3><span role="status">{!connected?'Not checked yet':loading?'Checking…':a.ready===null?'Not checked yet':a.ready?'Ready':'Unavailable'}</span>{a.name==='Codex'&&<CodexServerRestart connected={connected} onRestart={()=>setCheck(v=>v+1)}/>}</div>)}</div><button type="button" className="quiet" disabled={!connected||loading} onClick={()=>setCheck(v=>v+1)}>Check again</button></>;
}

const notificationApi=(path:string,init?:RequestInit)=>request(init?.method??'GET',path,init?.body?JSON.parse(String(init.body)):undefined,init?.signal??undefined);
function notificationDelivery(status:ReturnType<typeof usePushNotifications>['delivery']){
 if(!status)return '';
 switch(status.lastOutcome){
  case 'accepted':return 'The last alert was sent to your browser.';
  case 'viewed':return 'The last alert was received in your open conversation.';
  case 'waiting-for-storage':return 'Alerts are waiting because notification storage is unavailable.';
  case 'waiting-for-view':return 'Waiting for your open conversation to receive the alert.';
  case 'stale':return 'The last alert no longer needed your attention.';
  case 'rejected':return 'The last alert couldn’t be delivered — your browser’s push service rejected it.';
  case 'transport-error':return 'The last alert couldn’t be delivered — the push service couldn’t be reached.';
  case 'expired':return 'The last alert or this browser’s authorization expired.';
  default:return status.eligible?'The last alert couldn’t be delivered.':'No alerts have been sent to this browser yet.';
 }
}
function NotificationSettings({n}:{n:ReturnType<typeof usePushNotifications>}){
 async function change(){await (n.enabled?n.disable():n.enable());window.dispatchEvent(new Event('focus'));}
 return <section className="notification-settings" aria-label="Browser notifications"><p>Get a private alert when the Lead is ready or work needs your attention.</p><p>Alerts use your browser’s push service, even when this tab is closed. Enabling keeps this browser signed in for 180 days. Commands, paths and tool input stay in Deck.</p>{n.hint?<p role="status">{n.hint}</p>:<><div className="settings-card"><div className="settings-row"><div><h3>Browser notifications</h3><p role="status">{n.loading?'Checking…':n.denied?'Blocked in browser settings':n.enabled?'On for this browser':'Off for this browser'}</p></div><button type="button" disabled={n.busy||n.loading} onClick={()=>void change()}>{n.busy?'Saving…':n.enabled?'Disable notifications':'Enable notifications'}</button></div><div className="settings-row"><div><h3>Answer approvals</h3><p>Allow once or deny normal-risk requests from supported browsers. Other approvals open Deck.</p></div><button type="button" className="quiet settings-switch" role="switch" aria-label="Answer approvals from notifications" aria-checked={n.approvalActions} disabled={n.busy||n.loading} onClick={()=>void n.changeApprovalActions(!n.approvalActions)}>{n.approvalActions?'On':'Off'}</button></div></div>{n.registered&&!n.enabled&&<button type="button" disabled={n.busy} onClick={()=>void n.disable()}>Disable notifications</button>}{n.denied&&<p>Allow notifications in this site’s browser settings, then retry.</p>}</>}{n.delivery&&<p role="status">{notificationDelivery(n.delivery)}</p>}{n.message&&<p role="status">{n.message}</p>}<button type="button" className="quiet" disabled={n.busy} onClick={()=>void n.refresh()}>Refresh status</button></section>;
}

type SettingsSection = 'Appearance'|'Chat'|'Dictation'|'Agents & tools'|'Notifications'|'Application';
const sections:SettingsSection[]=['Appearance','Chat','Dictation','Agents & tools','Notifications','Application'];
function SettingsIcon({section}:{section:SettingsSection}){return <svg className="settings-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{section==='Application'?<><rect x="2" y="3" width="12" height="9" rx="1.5"/><path d="M6 14h4m-2-2v2"/></>:section==='Appearance'?<><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11M8 2.5a5.5 5.5 0 0 1 0 11"/></>:section==='Chat'?<><path d="M3 3h10v8H7l-4 3z"/><path d="M5.5 6h5M5.5 8h3"/></>:section==='Dictation'?<><rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2M6 14h4"/></>:section==='Agents & tools'?<><path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1" fill="var(--surface, currentColor)"/><circle cx="10" cy="8" r="1" fill="var(--surface, currentColor)"/><circle cx="6" cy="12" r="1" fill="var(--surface, currentColor)"/></>:<><path d="M4 11h8l-1-1.5V7a3 3 0 0 0-6 0v2.5zM6.5 13a1.5 1.5 0 0 0 3 0"/></>}</svg>}
export function Appearance({resources,onNotifications,dictation,onDictation,open,narrow,theme,font,chatWidth,onChatWidth,onTheme,onFont,onBack}:{resources?:React.ReactNode;onNotifications:()=>void;dictation:boolean;onDictation:(value:boolean)=>void;open:boolean;narrow:boolean;theme:Theme;font:Font;chatWidth:ChatWidth;onChatWidth:(value:ChatWidth)=>void;onTheme:(v:Theme,bounds:DOMRect)=>void;onFont:(v:Font)=>void;onBack:()=>void}){
 const notifications=usePushNotifications(notificationApi);
 const dialog=useRef<HTMLDialogElement>(null), panel=useRef<HTMLDivElement>(null), settingsNav=useRef<HTMLElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const [picker,setPicker]=useState(false),[section,setSection]=useState<SettingsSection>('Appearance'),[drilled,setDrilled]=useState(false),[query,setQuery]=useState('');
 const active=narrow?drilled:true;
 useActiveIndicator(settingsNav,section,'[aria-pressed="true"]',open&&(!narrow||!drilled));
 useLayoutEffect(()=>{const node=dialog.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');
  gsap.killTweensOf(node);
  if(open){const firstOpen=!node.open;if(firstOpen){returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;node.showModal();setSection(dictation?'Dictation':'Appearance');setDrilled(narrow&&dictation);setQuery('');}node.inert=false;node.removeAttribute('aria-hidden');if(!media.matches){if(firstOpen)gsap.set(node,{opacity:.7,y:8,scale:.99});gsap.to(node,{opacity:1,y:0,scale:1,duration:.2,ease:'power2.out',overwrite:true});}else gsap.set(node,{clearProps:'opacity,transform'});}
  else if(node.open){node.inert=true;node.setAttribute('aria-hidden','true');const finish=()=>{node.close();const target=returnFocus.current;if(target?.isConnected&&target.getClientRects().length)target.focus({preventScroll:true});else document.querySelector<HTMLElement>('[aria-label="Toggle project navigation"]')?.focus({preventScroll:true});};if(media.matches)finish();else gsap.to(node,{opacity:0,y:6,scale:.99,duration:.14,ease:'power2.out',overwrite:true,onComplete:finish});setPicker(false);}
  const settle=()=>{if(media.matches){gsap.killTweensOf(node);if(!open&&node.open){node.close();returnFocus.current?.focus({preventScroll:true});}else gsap.set(node,{clearProps:'opacity,transform'});}};media.addEventListener('change',settle);
  return()=>{media.removeEventListener('change',settle);gsap.killTweensOf(node);};
 },[open]);
 useLayoutEffect(()=>{const node=panel.current;if(!node||!open||!active)return;const media=matchMedia('(prefers-reduced-motion: reduce)');if(!media.matches)gsap.fromTo(node,{opacity:.7,x:5},{opacity:1,x:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});return()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity,transform'});};},[open,section,active]);
 const choose=(value:SettingsSection)=>{setSection(value);onDictation(value==='Dictation');setDrilled(true);};
 const visible=sections.filter(value=>normalizeSearch(value==='Agents & tools'?'Agents & tools advanced agents runners codex server daemon restart code map capabilities':value==='Application'?'Application system restart daemon update':value).includes(normalizeSearch(query)));
 return <dialog ref={dialog} className="settings-modal" aria-labelledby="settings-title" onKeyDown={e=>{if(e.key!=='Tab'||(e.target as HTMLElement).closest('dialog')!==dialog.current)return;const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length>0&&!el.closest('[inert]'));if(!controls.length){e.preventDefault();return;}const first=controls[0]!,last=controls[controls.length-1]!;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}} onCancel={e=>{e.preventDefault();onBack();}} onClick={e=>{if(e.target!==e.currentTarget)return;const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onBack();}}>
  <span id="settings-title" className="sr-only">Settings</span><div className="settings-shell"><nav ref={settingsNav} className="settings-nav" aria-label="Settings sections" hidden={narrow&&drilled}><h1>Settings</h1><input type="search" aria-label="Search settings" placeholder="Search settings" value={query} onChange={e=>setQuery(e.currentTarget.value)}/>{visible.map(value=><button key={value} type="button" className="quiet" aria-pressed={active&&section===value} onClick={()=>choose(value)}><SettingsIcon section={value}/>{value}</button>)}{!visible.length&&<p role="status">No sections match</p>}</nav>
  <div className="settings-main" hidden={narrow&&!drilled}><header className="settings-modal-header">{narrow&&<button type="button" className="quiet" aria-label="Back to settings" onClick={()=>setDrilled(false)}>←</button>}<span>Settings <span aria-hidden="true">/</span> <strong>{section}</strong></span><button type="button" className="quiet settings-close" aria-label="Close settings" onClick={onBack}>×</button></header>
   <div ref={panel} className="settings-panel"><h2>{section}</h2>{section==='Application'?(open&&active?<ApplicationSettings/>:null):section==='Chat'?<div className="settings-card"><div className="settings-row"><div><h3 id="chat-width-label">Conversation width</h3><p>Choose how much space your conversation and message box use.</p></div><fieldset className="settings-fonts" aria-labelledby="chat-width-label"><label><input type="radio" name="chat-width" checked={chatWidth==='full'} onChange={()=>onChatWidth('full')}/>Full width</label><label><input type="radio" name="chat-width" checked={chatWidth==='compact'} onChange={()=>onChatWidth('compact')}/>Compact</label></fieldset></div></div>:section==='Notifications'?(open&&active?<NotificationSettings n={notifications}/>:null):section==='Agents & tools'?(open&&active?resources:null):section==='Dictation'?(open&&active?<DictationSettings/>:null):<div className="settings-card"><div className="settings-row"><div><h3>Theme</h3><p>Colors for this browser.</p></div><button type="button" className="quiet" onClick={()=>setPicker(true)}>Choose theme</button></div><div className="settings-row"><div><h3 id="interface-font-label">Interface font</h3><p>Choose the typeface for the interface.</p></div><fieldset className="settings-fonts" aria-labelledby="interface-font-label">{FONTS.map(f=><label key={f.id}><input type="radio" name="interface-font" checked={font===f.id} onChange={()=>onFont(f.id)}/>{f.label}</label>)}</fieldset></div></div>}</div>
  </div>{narrow&&!drilled&&<button type="button" className="quiet settings-mobile-close" aria-label="Close settings" onClick={onBack}>×</button>}</div>{picker&&<ThemePicker value={theme} onChange={onTheme} onClose={()=>setPicker(false)}/>}
 </dialog>;
}
