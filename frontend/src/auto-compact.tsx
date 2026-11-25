import {useEffect,useId,useRef,useState} from 'react';
import {API,hostRequest} from './api';

export type AutoCompactRunner='claude'|'codex';
export interface AutoCompact {window:number;claude:boolean;codex:boolean}

export function parseAutoCompact(v:unknown):AutoCompact{
 const d=v as Record<string,unknown>|null;
 if(typeof d!=='object'||d===null||d.api!==API||!Number.isSafeInteger(d.window)||(d.window as number)<=0||typeof d.claude!=='boolean'||typeof d.codex!=='boolean')throw Error('Invalid automatic compaction settings');
 return {window:d.window as number,claude:d.claude,codex:d.codex};
}

const tokens=(n:number)=>n%1000===0?`${n/1000}K`:n.toLocaleString();

/** Host-wide automatic compaction intent, shared by every runner row. */
export function useAutoCompact(connected:boolean,host:string){
 const [data,setData]=useState<AutoCompact>(),[busy,setBusy]=useState<AutoCompactRunner>(),[error,setError]=useState<{runner?:AutoCompactRunner;message:string}>();
 const generation=useRef(0);
 useEffect(()=>{
  const turn=++generation.current;setData(undefined);setError(undefined);setBusy(undefined);
  if(!connected)return;
  const controller=new AbortController();
  void hostRequest('GET','/api/runners/auto-compact',undefined,controller.signal)
   .then(v=>{if(generation.current===turn)setData(parseAutoCompact(v));})
   .catch(e=>{if(!controller.signal.aborted&&generation.current===turn)setError({message:(e as Error).message});});
  return()=>controller.abort();
 },[connected,host]);
 async function change(runner:AutoCompactRunner,enabled:boolean){
  if(busy)return;
  const turn=generation.current;setBusy(runner);setError(undefined);
  try{const next=parseAutoCompact(await hostRequest('POST',`/api/runners/auto-compact/${runner}`,{api:API,enabled}));if(generation.current===turn)setData(next);}
  catch(e){if(generation.current===turn)setError({runner,message:(e as Error).message});}
  finally{if(generation.current===turn)setBusy(undefined);}
 }
 return {data,busy,error,change};
}

export function AutoCompactToggle({runner,name,state,connected}:{runner:AutoCompactRunner;name:string;state:ReturnType<typeof useAutoCompact>;connected:boolean}){
 const hint=useId();
 const {data,busy,error,change}=state;
 const window=data?tokens(data.window):'500K';
 return <div className="runner-auto-compact">
  <label className="project-trust-control"><input type="checkbox" checked={data?.[runner]??true} disabled={!connected||!data||!!busy} aria-describedby={hint} onChange={e=>void change(runner,e.target.checked)}/>Auto-compact at {window} tokens</label>
  <p id={hint}>{name} summarizes the conversation when its context reaches {window} tokens, so later turns send fewer tokens. Applies to new {name} processes. When off, {name} uses its own default.</p>
  {busy===runner&&<p role="status">Saving…</p>}
  {error&&(!error.runner||error.runner===runner)&&<p role="alert" className="error">{error.message}</p>}
 </div>;
}
