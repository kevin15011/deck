import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {NavigationIcon} from './project-navigation';
import {ThemeDialog} from './theme-select';
import type {Theme} from './theme';
import {FONTS,type Font} from './preferences';
import {SETTINGS_SECTIONS,type SettingsSection} from './navigation';
import {gsap,reducedMotion} from './motion';
import {useActiveIndicator} from './view-motion';
import {dictationRequest,dictationMessage} from './dictation/composer';
import type {DictationSummary,DictationModelId} from '../../../packages/core/src/session/dictation';
const labels:Record<SettingsSection,string>={appearance:'Appearance',notifications:'Notifications',dictation:'Dictation',app:'App'};
export function SettingsButton({onClick,attention=false}:{onClick:()=>void;attention?:boolean}){return <div className="deck-menu"><button type="button" className="quiet deck-menu-toggle" aria-label="Settings" onClick={onClick}><NavigationIcon kind="settings"/><span>Settings</span>{attention&&<span className="menu-attention" aria-label="Notifications need attention"/>}</button></div>;}
export function SettingsView({section,narrow,onSection,onBack,theme,onTheme,font,onFont,onNotifications,notificationsEnabled,onInstall,onRestart,installHidden}:{section?:SettingsSection;narrow:boolean;onSection:(s:SettingsSection)=>void;onBack:()=>void;theme:Theme;onTheme:(v:Theme)=>void;font:Font;onFont:(v:Font)=>void;onNotifications:()=>void;notificationsEnabled:boolean;onInstall:()=>void;onRestart:()=>void;installHidden:boolean}){
 const active=section??(narrow?undefined:'appearance'),[themeOpen,setThemeOpen]=useState(false),root=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),list=useRef<HTMLElement>(null),panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented&&!document.querySelector('dialog[open]')){event.preventDefault();onBack();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[onBack]);
 useActiveIndicator(list,active,'[aria-pressed="true"]');
 useLayoutEffect(()=>{heading.current?.focus({preventScroll:true});const el=panel.current??root.current;if(!el)return;gsap.killTweensOf(el);if(!reducedMotion())gsap.fromTo(el,{opacity:.6,x:5},{opacity:1,x:0,duration:.18,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});return()=>{gsap.killTweensOf(el);};},[active]);
 return <main className="settings-view" ref={root} onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!(event.target as HTMLElement).closest('dialog')){event.preventDefault();event.stopPropagation();onBack();}}}>
  <header className="settings-header"><button type="button" className="quiet" onClick={onBack} aria-label={narrow&&section?'Back to settings':'Back to session'}>← Back</button><h1 ref={heading} tabIndex={-1}>{narrow&&active?labels[active]:'Settings'}</h1><span>Preferences and host resources</span></header>
  <div className="settings-layout"><nav ref={list} className="settings-nav" aria-label="Settings sections" hidden={narrow&&!!active}>{SETTINGS_SECTIONS.map(s=><button type="button" className="quiet" key={s} aria-current={s===active?'page':undefined} aria-pressed={s===active} onClick={()=>onSection(s)}>{labels[s]}</button>)}</nav>
  {active&&<div className="settings-panel" ref={panel} key={active}><h2>{labels[active]}</h2>
   {active==='appearance'&&<><div className="settings-row"><div><h3>Theme</h3><p>Colors for this browser.</p></div><button type="button" onClick={()=>setThemeOpen(true)}>Choose theme</button></div><fieldset className="settings-fonts"><legend>Interface font</legend>{FONTS.map(item=><label key={item.id}><input type="radio" name="settings-font" checked={font===item.id} onChange={()=>onFont(item.id)}/>{item.label}</label>)}</fieldset></>}
   {active==='notifications'&&<div className="settings-row"><div><h3>Browser notifications</h3><p>{notificationsEnabled?'On':'Off'} · Manage permission and delivery for this browser.</p></div><button type="button" onClick={onNotifications}>Manage notifications</button></div>}
   {active==='dictation'&&<DictationSettings/>}
   {active==='app'&&<><div className="settings-row"><div><h3>Install Deck</h3><p>Open Deck as an app on this device.</p></div><button type="button" disabled={installHidden} onClick={onInstall}>{installHidden?'Installed or unavailable':'Install'}</button></div><div className="settings-row"><div><h3>Restart Deck</h3><p>Review active work before restarting the host.</p></div><button type="button" onClick={onRestart}>Review restart</button></div></>}
  </div>}</div>{themeOpen&&<ThemeDialog value={theme} onChange={onTheme} onClose={()=>setThemeOpen(false)}/>}
 </main>;
}
function Progress({received,total}:{received:number;total:number}){
 const bar=useRef<HTMLSpanElement>(null);useLayoutEffect(()=>{const el=bar.current;if(!el)return;gsap.to(el,{scaleX:Math.min(1,received/total),duration:reducedMotion()?0:.15,overwrite:true});return()=>{gsap.killTweensOf(el);};},[received,total]);
 return <div className="dictation-progress" role="progressbar" aria-label="Model download" aria-valuemin={0} aria-valuemax={total} aria-valuenow={received}><span ref={bar}/></div>;
}
function DictationSettings(){
 const [summary,setSummary]=useState<DictationSummary>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[deleting,setDeleting]=useState<DictationModelId>();
 const live=useRef(true),request=useRef(0);const refresh=async(signal?:AbortSignal)=>{const token=++request.current;try{const result=await dictationRequest<DictationSummary>('',{signal});if(live.current&&token===request.current)setSummary(result);}catch(e){if(live.current&&!signal?.aborted)setError(dictationMessage(e));}};
 useEffect(()=>{live.current=true;const controller=new AbortController();void refresh(controller.signal);return()=>{live.current=false;controller.abort();};},[]);
 const downloading=summary?.models.some(m=>m.state==='downloading'||m.state==='verifying');
 useEffect(()=>{if(!downloading)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{await refresh(controller.signal);if(!controller.signal.aborted)timer=setTimeout(poll,500);};timer=setTimeout(poll,500);return()=>{controller.abort();clearTimeout(timer);};},[downloading]);
 async function action(path:string,method:string,body?:unknown){if(pending)return;setPending(true);setError('');try{await dictationRequest(path,{method,...(body?{body:JSON.stringify(body)}:{})});await refresh();}catch(e){if(live.current)setError(dictationMessage(e));}finally{if(live.current)setPending(false);}}
 const confirm=useRef<HTMLDialogElement>(null);useEffect(()=>{if(deleting)confirm.current?.showModal();else confirm.current?.close();},[deleting]);
 if(!summary)return <div role="status">{error||'Checking host dictation…'}{error&&<button type="button" onClick={()=>void refresh()}>Try again</button>}</div>;
 return <><p className="decision-note">Record in this browser. Transcribe on the computer running Deck. Text enters your draft and is never sent automatically.</p>
  <div className="settings-row"><div><h3>Local engine</h3><p>{summary.runtime.state==='ready'?'Ready · external whisper-cli':'whisper-cli was not found or is incompatible.'}</p>{summary.runtime.path&&<code className="settings-path">{summary.runtime.path}</code>}</div><button type="button" disabled={pending} onClick={()=>void refresh()}>Check again</button></div>
  {summary.runtime.state==='missing'&&<p className="decision-note">Install a compatible whisper.cpp CLI on the Deck host and make <code>whisper-cli</code> available on its PATH. On macOS you can use <code>brew install whisper-cpp</code>. Deck does not run this command. The engine must support JSON output and the dictation flags.</p>}
  <h3>Models on this host</h3><p className="decision-note">Downloads are explicit and shared by paired devices. Turbo Q5 is the supported multilingual model. Accuracy, memory use and speed have not been benchmarked in Deck. Models load only for a transcription.</p>
  {summary.models.map(model=><div className="settings-model" key={model.id}><div className="settings-row"><div><h4>{model.label}{summary.selected===model.id?' · Selected':''}</h4><p>{(model.bytes/1_000_000).toFixed(1)} MB · {model.state}{model.received!==undefined&&model.state==='downloading'?` · ${Math.floor(model.received/model.bytes*100)}%`:''}</p></div><div className="settings-actions">
   {['absent','failed'].includes(model.state)&&<button type="button" disabled={pending||downloading} onClick={()=>void action(`/models/${model.id}/download`,'POST')}>Download</button>}
   {model.state==='installed'&&<button type="button" disabled={pending||summary.selected===model.id} onClick={()=>void action('/settings','PUT',{selected:model.id})}>Use</button>}
   {['installed','corrupt'].includes(model.state)&&<button type="button" className="quiet" disabled={pending} onClick={()=>setDeleting(model.id)}>Delete</button>}
   {model.state==='downloading'&&<button type="button" className="quiet" disabled={pending} onClick={()=>void action(`/models/${model.id}/download`,'DELETE')}>Cancel</button>}
  </div></div>{model.state==='downloading'&&<Progress received={model.received??0} total={model.bytes}/>}{model.error&&<p role="status">{model.error==='dictation-download-integrity'?'Download failed verification. Retry the download.':model.error==='dictation-disk-full'?'Not enough disk space on the host.':'Download failed. Check the host connection and try again.'}</p>}</div>)}
  <div className="settings-row"><label htmlFor="dictation-language">Recognition language</label><select id="dictation-language" disabled={pending} value={summary.language} onChange={e=>void action('/settings','PUT',{language:e.target.value})}><option value="es">Spanish</option><option value="en">English</option><option value="auto">Detect automatically</option></select></div>
  {summary.lastRun&&<p className="decision-note">Last transcription on this host: {(summary.lastRun.audioMs/1000).toFixed(1)} s audio · {(summary.lastRun.elapsedMs/1000).toFixed(1)} s processing.</p>}
  {error&&<p role="alert">{error}</p>}
  <dialog ref={confirm} className="workspace-dialog" aria-labelledby="delete-model-title" onCancel={e=>{e.preventDefault();setDeleting(undefined);}}><h2 id="delete-model-title">Delete model?</h2><p>This removes the downloaded model from the Deck host. Download it again to use it later.</p><div className="dialog-actions"><button type="button" className="quiet" onClick={()=>setDeleting(undefined)}>Keep model</button><button type="button" onClick={()=>{const id=deleting;setDeleting(undefined);if(id)void action(`/models/${id}`,'DELETE');}}>Delete model</button></div></dialog>
 </>;
}
