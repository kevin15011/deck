import React,{useEffect,useRef,useState} from 'react';
import {request} from './api';

export const restartImpact = 'Restarting disconnects all sessions using this Codex server and can interrupt active turns. Saved conversation history is preserved.';

async function restartServer(projectId?:string){
 const query=projectId?'?projectId='+encodeURIComponent(projectId):'';
 await request('POST','/api/runners/codex/daemon/restart'+query);
}

export function CodexRestartPrompt({connected,projectId,onLater,onRestart}:{
 connected:boolean;projectId?:string;onLater:()=>void;onRestart:()=>void;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 async function confirm(){
  setPending(true);
  setError('');
  try{await restartServer(projectId);onRestart();}
  catch(e){setError(e instanceof Error?e.message:String(e));setPending(false);}
 }
 return <dialog className="workspace-dialog install-dialog" ref={dialog} aria-labelledby="codex-restart-heading" onCancel={e=>{e.preventDefault();e.stopPropagation();if(!pending)onLater();}}>
  <h3 id="codex-restart-heading">Restart Codex to load the Context Mode changes?</h3>
  <p>{restartImpact}</p>
  <p>You can restart it anytime from Settings → Agents &amp; tools → Codex.</p>
  {error&&<p role="alert">{error}</p>}
  <div className="dialog-actions">
   <button type="button" disabled={pending} onClick={onLater}>Later</button>
   <button type="button" disabled={pending||!connected} onClick={()=>void confirm()}>{pending?'Restarting…':'OK'}</button>
  </div>
 </dialog>;
}

export function CodexServerRestart({connected,onRestart,projectId}:{connected:boolean;onRestart:()=>void;projectId?:string}){
 const [pending,setPending]=useState(false);
 const [message,setMessage]=useState('');
 async function restart(){
  if(!window.confirm(`Restart the Codex server? ${restartImpact}`))return;
  setPending(true);
  setMessage('');
  try{
   await restartServer(projectId);
   setMessage('Codex server restarted.');
   onRestart();
  }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  finally{setPending(false);}
 }
 return <div><button type="button" className="quiet" disabled={!connected||pending} onClick={()=>void restart()}>{pending?'Restarting Codex server…':'Restart Codex server'}</button>
 {message&&<p role="status">{message}</p>}</div>;
}
