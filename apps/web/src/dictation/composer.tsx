import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {gsap,reducedMotion} from '../motion';
import type {DraftStore} from '../draft-boundary';
import type {DictationSummary,DictationResult} from '../../../../packages/core/src/session/dictation';
import {captureAvailable,startCapture,type Capture} from './capture';
import {insertDictation} from './audio-pcm';
export async function dictationRequest<T>(path='',init:RequestInit={}):Promise<T>{
 const response=await fetch(`/api/dictation${path}`,{...init,headers:{...(init.body&&!(init.body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...init.headers}});
 const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.code??'dictation-failed');return data as T;
}
const messages:Record<string,string>={
 'dictation-download-busy':'A model download is active on this host. Wait or cancel it first.',
 'dictation-model-in-use':'A transcription is using the host models. Wait or cancel it before changing models.',
 'dictation-disk-full':'The Deck host does not have enough free disk space.',
 'dictation-unavailable':'Dictation is unavailable on this host. Check its Deck version.',
 'dictation-audio-too-large':'This recording exceeds the upload limit. Try a shorter clip.',
 'dictation-audio-too-long':'This recording is too long. Try a shorter clip.',
 'dictation-engine-output-limit':'The local engine exceeded its output limit. Try a shorter clip.',
 'daemon-stopping':'Host maintenance is in progress. Try again after it finishes.',
 'dictation-model-not-installed':'Choose an installed model in Settings.', 'dictation-engine-missing':'Install whisper-cli on the Deck host, then check Settings.',
 'dictation-busy':'Another dictation is running on this host. Try again shortly.', 'dictation-engine-timeout':'Transcription took too long. Try a shorter recording.',
 'dictation-engine-failed':'The local engine could not transcribe this audio.', 'dictation-cancelled':'Dictation cancelled.', 'device-required':'Reconnect this device before dictating.',
};
export function dictationMessage(error:unknown){const code=error instanceof Error?error.message:String(error);return messages[code]??(code.startsWith('dictation-')?'Dictation failed. Check Settings and try again.':code);}
export function DictationControl({sessionId,drafts,navigationKey,disabled,onSettings}:{sessionId:string;drafts:DraftStore;navigationKey:number;disabled:boolean;onSettings:()=>void}){
 const [phase,setPhase]=useState<'idle'|'permission'|'recording'|'retained'|'transcribing'>('idle'),[notice,setNotice]=useState(''),[announcement,setAnnouncement]=useState(''),[seconds,setSeconds]=useState(0),[limitSeconds,setLimitSeconds]=useState(300);
 const work=useRef<{controller:AbortController;transcribing:boolean;capture?:Capture;initial:string;selection?:[number,number]}|undefined>(undefined),surface=useRef<HTMLDivElement>(null),meter=useRef<HTMLSpanElement>(null);
 const cancel=(message='Dictation cancelled.')=>{const job=work.current;work.current=undefined;job?.controller.abort();job?.capture?.cancel();setPhase('idle');setNotice(message);setAnnouncement('');};
 useLayoutEffect(()=>{cancel('');return()=>{const job=work.current;work.current=undefined;job?.controller.abort();job?.capture?.cancel();};},[sessionId,navigationKey,disabled]);
 useEffect(()=>{const interrupt=()=>{if(work.current)cancel('Recording interrupted. Your draft is kept.');};const visibility=()=>{if(document.hidden)interrupt();};document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',interrupt);return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',interrupt);};},[]);
 useEffect(()=>{if(phase!=='recording')return;setSeconds(0);const timer=setInterval(()=>setSeconds(n=>n+1),1000);return()=>clearInterval(timer);},[phase]);
 useEffect(()=>{const el=surface.current,bar=meter.current;if(!el)return;gsap.killTweensOf(el);if(!reducedMotion())gsap.fromTo(el,{opacity:.65},{opacity:1,duration:.15,overwrite:true});return()=>{gsap.killTweensOf(el);if(bar)gsap.killTweensOf(bar);};},[phase]);
 async function start(){
  if(work.current)return;setNotice('');setAnnouncement('');setPhase('permission');
  const input=document.getElementById('prompt') as HTMLTextAreaElement|null,job={controller:new AbortController(),initial:drafts.get(sessionId)??'',selection:input?[input.selectionStart,input.selectionEnd] as [number,number]:undefined,limited:false,transcribing:false,capture:undefined as Capture|undefined};work.current=job;
  try{const summary=await dictationRequest<DictationSummary>('',{signal:job.controller.signal});if(work.current!==job)return;if(!summary.available){cancel('Set up the local engine and choose a model in Settings.');onSettings();return;}
   job.capture=await startCapture(job.controller.signal,()=>{job.limited=true;if(work.current===job&&!job.transcribing){setPhase('retained');setNotice('Recording limit reached.');}},level=>{if(meter.current)gsap.to(meter.current,{scaleX:Math.min(1,level*5),duration:reducedMotion()?0:.1,overwrite:true});},()=>{if(work.current===job)cancel('Microphone interrupted. Your draft is kept.');});if(work.current!==job){job.capture.cancel();return;}setLimitSeconds(job.capture.limitSeconds);setPhase(job.limited?'retained':'recording');
  }catch(error){if(work.current===job)cancel((error as DOMException).name==='NotAllowedError'?'Microphone permission was denied. Allow it in your browser and try again.':dictationMessage(error));}
 }
 async function stop(){const job=work.current;if(!job?.capture||job.transcribing)return;job.transcribing=true;setPhase('transcribing');
  try{const bytes=await job.capture.stop();if(work.current!==job)return;const result=await dictationRequest<DictationResult>('/transcriptions',{method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes as BodyInit,signal:job.controller.signal});if(work.current!==job)return;
   const current=drafts.get(sessionId)??'',next=insertDictation(current,job.initial,job.selection,result.text);drafts.set(sessionId,next);work.current=undefined;setPhase('idle');setNotice(result.text?'':'No speech detected.');setAnnouncement(result.text?'Dictation added to your draft.':'');
   const input=document.getElementById('prompt') as HTMLTextAreaElement|null;if(input){input.focus({preventScroll:true});input.setSelectionRange(next.length,next.length);}
  }catch(error){if(work.current===job)cancel(dictationMessage(error));}
 }
 if(!captureAvailable())return null;
 return <div className="dictation-control" ref={surface} onKeyDown={e=>{if(e.key==='Escape'&&work.current){e.preventDefault();e.stopPropagation();cancel();}}}>
  {phase!=='retained'&&<button type="button" className="quiet" aria-label={phase==='recording'?'Stop dictation':'Start dictation'} aria-pressed={phase==='recording'} disabled={disabled||phase==='permission'||phase==='transcribing'} onClick={()=>void(phase==='recording'?stop():start())}>{phase==='recording'?'Stop':<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>}</button>}
  <span className="sr-only" role="status">{announcement}</span>
  {(phase!=='idle'||notice)&&<div className="dictation-status" role="status">
   {phase==='recording'&&<span className="dictation-meter" aria-hidden="true"><span ref={meter}/></span>}
   <span>{phase==='idle'||phase==='retained'?notice:phase==='recording'?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}${seconds>=limitSeconds*.9?' · Stop soon':''}`:phase==='permission'?'Opening microphone…':'Transcribing on host…'}</span>
   {phase==='retained'&&<button type="button" className="quiet" aria-label="Transcribe recording" onClick={()=>void stop()}>Transcribe</button>}
   {phase!=='idle'?<button type="button" className="quiet" onClick={()=>cancel()}>Cancel</button>:<button type="button" className="quiet" onClick={onSettings}>Dictation settings</button>}
  </div>}

 </div>;
}
