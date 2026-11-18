import React,{useEffect,useState} from 'react';
import {request} from './api';
export function SessionBranch({session}:{session:string}){
 const [branch,setBranch]=useState<{session:string;name:string}>();
 useEffect(()=>{
  if(!session)return;
  let generation=0,controller:AbortController|undefined;
  const update=()=>{const current=++generation;controller?.abort();controller=new AbortController();
   void request('GET',`/api/sessions/${encodeURIComponent(session)}/git-identity`,undefined,controller.signal).then(value=>{
    if(current!==generation)return;
    if(value&&typeof value==='object'&&'currentBranch' in value&&typeof value.currentBranch==='string'&&value.currentBranch)setBranch({session,name:value.currentBranch});else setBranch(undefined);
   }).catch(()=>{if(current===generation)setBranch(undefined);});
  };
  update();window.addEventListener('focus',update);return()=>{++generation;controller?.abort();window.removeEventListener('focus',update);};
 },[session]);
 return branch?.session===session?<span className="session-branch" title={branch.name} aria-label={`Current branch: ${branch.name}`}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><circle cx="4" cy="3" r="1.75"/><circle cx="4" cy="13" r="1.75"/><circle cx="12" cy="3" r="1.75"/><path d="M4 4.75v6.5M12 4.75V6a4 4 0 0 1-4 4H4"/></svg><span>{branch.name}</span></span>:null;
}
