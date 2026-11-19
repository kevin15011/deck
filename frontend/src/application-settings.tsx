import React,{useEffect,useState} from 'react';
import {API,hostRequest} from './api';

interface RestartStatus { generation:string; available:boolean; busy:boolean }
const endpoint='/api/application/restart';

export function ApplicationSettings(){
 const [status,setStatus]=useState<RestartStatus>();
 const [pending,setPending]=useState<string>();
 const [error,setError]=useState(''),[connectionError,setConnectionError]=useState('');
 useEffect(()=>{
  let live=true;
  let timer:ReturnType<typeof setTimeout>;
  const controller=new AbortController();
  const started=Date.now();
  async function refresh(){
   try{
    const next=await hostRequest('GET',endpoint,undefined,controller.signal) as RestartStatus;
    if(!live)return;
    if(typeof next.generation!=='string'||typeof next.busy!=='boolean'||typeof next.available!=='boolean')throw Error('Invalid application status.');
    if(pending&&pending!==next.generation){window.location.reload();return;}
    setConnectionError('');setStatus(next);
   }catch(e){if(live){setStatus(undefined);if(!pending)setConnectionError((e as Error).message);else if(Date.now()-started>30000)setConnectionError('Still waiting for Deck. Check the host with deck2 status.');}}
   if(live)timer=setTimeout(refresh,pending?500:3000);
  }
  void refresh();
  return ()=>{live=false;controller.abort();clearTimeout(timer);};
 },[pending]);
 async function restart(){
  if(!status||pending)return;
  setError('');setPending(status.generation);
  try{await hostRequest('POST',endpoint,{api:API,generation:status.generation});}
  catch(e){setPending(undefined);setError((e as Error).message);}
 }
 return <div className="settings-card"><div className="settings-row"><div><h3>Restart Deck</h3>
  <p>Restart the daemon to load the installed version of Deck.</p>
  <p role="status">{pending?'Restarting Deck. Waiting to reconnect…':status?.busy?'Deck has running or queued work. Restart when it finishes.':status&&!status.available?'Restart is unavailable for this host.':!status?'Checking application status…':''}</p>
  {(error||connectionError)&&<p role="alert" className="error">{error||connectionError}</p>}
 </div><button type="button" className="quiet" disabled={!status?.available||status.busy||!!pending} onClick={()=>void restart()}>Restart Deck</button></div></div>;
}
