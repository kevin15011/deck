import React,{useEffect,useRef,useState} from 'react';
import {hostRequest} from './api';

const endpoint='/api/browser-device';
const duration='Keep access in this browser profile for up to 180 days, including after Deck restarts. Use only on a device you trust.';
type DeviceStatus={available:boolean;remembered:boolean;expiresAt:string|null};

function useBrowserDevice(){
 const [status,setStatus]=useState<DeviceStatus>();
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const writing=useRef(false);

 async function refresh(signal?:AbortSignal){
  const next=await hostRequest('GET',endpoint,undefined,signal) as DeviceStatus;
  if(typeof next.available!=='boolean'||typeof next.remembered!=='boolean')throw Error('Browser access status is unavailable.');
  if(!signal?.aborted)setStatus(next);
 }
 useEffect(()=>{
  const controller=new AbortController();
  void refresh(controller.signal).catch(()=>{if(!controller.signal.aborted)setError('Browser access status is unavailable.');});
  return ()=>controller.abort();
 },[]);

 async function change(remember:boolean){
  if(writing.current)return;
  writing.current=true;
  setPending(true);
  setError('');
  try{
   await hostRequest('POST',endpoint,{remember});
   if(!remember){location.reload();return;}
   await refresh();
  }catch(e){setError((e as Error).message);}
  finally{writing.current=false;setPending(false);}
 }

 return {status,pending,error,change};
}

export function BrowserDeviceOffer(){
 const {status,pending,error,change}=useBrowserDevice();
 const [dismissed,setDismissed]=useState(false);
 if(dismissed||!status?.available||status.remembered)return null;
 return <aside className="browser-device-offer" aria-label="Browser access">
  <div><strong>Keep Deck signed in?</strong><p>{duration} You can forget this device in Application settings.</p>
   {error&&<p role="alert" className="error">{error}</p>}
  </div>
  <div className="browser-device-actions">
   <button type="button" className="quiet" disabled={pending} onClick={()=>setDismissed(true)}>Use this session only</button>
   <button type="button" disabled={pending} onClick={()=>void change(true)}>Remember this device</button>
  </div>
 </aside>;
}

export function BrowserDeviceSettings(){
 const {status,pending,error,change}=useBrowserDevice();
 const date=status?.expiresAt?new Date(status.expiresAt):undefined;
 const expiration=date&&Number.isFinite(date.getTime())?date.toLocaleDateString():undefined;
 return <div className="settings-card"><div className="settings-row">
  <div><h3>Browser access</h3>
   <p>{status?.remembered?'This browser is remembered.' : duration} {expiration&&`Access expires ${expiration}.`}</p>
   {status?.remembered&&<p>Forgetting this device revokes its access and signs you out.</p>}
   {status&&!status.available&&<p>Changes are unavailable at this address or while the device store is read-only.</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </div>
  {status?.available&&<button type="button" className="quiet" disabled={pending} onClick={()=>void change(!status.remembered)}>{status.remembered?'Forget this device':'Remember this device'}</button>}
 </div></div>;
}
