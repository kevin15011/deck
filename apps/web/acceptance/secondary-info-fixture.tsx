/** Hydrated source fixture. Scripted UI state only; no services or native calls. */
import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SecondaryInfoProvider} from '../src/secondary-info';
import {PersonalMcpAvailabilityView} from '../src/personal-mcp-availability';
import {LeadProgress} from '../src/lead-progress';
import {Subagents} from '../src/workspace';
import {projectContextWindows} from '../src/context-window';
import {snapshotView} from '../src/chat-history';
import {useDeckHistory} from '../src/navigation';
import type {SessionEvent} from '../../../packages/core/src/session/events';
import '../src/style.css';

function Fixture() {
 const navigation=useDeckHistory(),nav=navigation.controller,session=navigation.entry.route.session??'s';
 const [removed,setRemoved]=useState(false),[available,setAvailable]=useState(true),[otherOpen,setOtherOpen]=useState(false),[cancels,setCancels]=useState(0);
 const [measurement,setMeasurement]=useState<Record<string,unknown>>({basis:'codex-last-total',tokens:148000,capacity:258400,modelId:'fixture-model'});
 const other=useRef<HTMLDialogElement>(null),captures=useRef(0);
 const events:SessionEvent[]=[];
 for(const task of ['lead',...(!removed?['child']:[])]) {
  const source={taskId:task,memberId:task==='lead'?'lead':'deck-apply-deep',runnerId:measurement.basis==='claude-last-request-input'?'claude':measurement.basis==='opencode-assistant-context'?'opencode':'codex',nativeSessionId:`thread-${task}`};
  const add=(kind:SessionEvent['kind'],data:Record<string,unknown>)=>events.push({v:1,seq:events.length+1,sessionId:session,ts:'2026-10-22T00:00:00Z',kind,source,data});
  add('task.created',{taskId:task,attempt:1,state:'running',modelId:'fixture-model'});add('turn.started',{attempt:1,nativeTurnId:'turn'});
  if(available)add('usage',{attempt:1,context:{...measurement,nativeThreadId:source.nativeSessionId,nativeTurnId:'turn'}});
 }
 const view=snapshotView(events,events.length),contexts=projectContextWindows(view.events,session);
 const entries=Array.from({length:35},(_,i)=>({id:`documentation-server-${i}-${'long-name-'.repeat(5)}`,source:'user' as const,status:(['configured','active','unavailable','conflicting'] as const)[i%4],reason:i%4===3?'reserved' as const:i%4===2?'not-connected' as const:undefined}));
 useEffect(()=>{nav.capture=()=>{captures.current++;return{id:1,seq:1,offset:document.querySelector('#conversation')?.scrollTop??0};};
  Object.assign(window,{fixture:{navigate:(next:string,mode?:'push'|'replace')=>nav.navigate({project:'fixture',session:next,tab:'chat'},mode),state:()=>({session:nav.current.route.session,key:nav.current.key,generation:nav.generation,secondary:nav.secondary}),race:()=>{nav.closeSecondary(true);nav.navigate({project:'fixture',session:'other',tab:'chat'});nav.navigate({project:'fixture',session:'latest',tab:'chat'});},setMeasurement,setAvailable,setRemoved,setOtherOpen,session:()=>nav.navigate({project:'fixture',session:session==='s'?'other':'s',tab:'chat'}),cancels:()=>cancels,captures:()=>captures.current,generation:()=>nav.generation,active:()=>nav.secondary}});
 },[nav,session,cancels]);
 useEffect(()=>{if(otherOpen)other.current?.showModal();else other.current?.close();},[otherOpen]);
 return <SecondaryInfoProvider scopeKey={`${session}:${navigation.entry.key}`} navigation={nav} activeId={navigation.secondary} blocked={otherOpen}>
  <div className="workbench sidebar-collapsed fixture-workbench"><nav className="sidebar"><span>Deck</span></nav><div className="app-body"><header className="app-header"><h1>Long agent session</h1><PersonalMcpAvailabilityView entries={entries} runnerId="codex" members={{investigate:{runnerId:'opencode',servers:[{id:'team-docs',source:'native',status:'unavailable',reason:'not-connected'}]}}}/></header>
   <div className="panes fixture-panes"><main className="chat-pane"><section id="conversation" className="conversation" tabIndex={-1}>{Array.from({length:35},(_,i)=><article key={i} className="message"><p>Message {i+1} · Existing conversation remains at the same position.</p></article>)}</section><LeadProgress events={view.events} sessionId={session} contexts={contexts} progress={{phase:'tool',label:'Using tools…'}}/><form className="composer" onSubmit={e=>e.preventDefault()}><textarea aria-label="Prompt" defaultValue="Keep this draft unchanged."/><button type="button" id="lead-cancel" onClick={()=>setCancels(n=>n+1)}>Cancel Lead</button></form></main><aside className="workspace-pane fixture-cards"><Subagents view={view} sessionId={session} contexts={contexts} visible/></aside></div>
   <div className="fixture-edge"><PersonalMcpAvailabilityView entries={entries} runnerId="claude"/></div>
  </div></div><dialog ref={other} className="workspace-dialog" aria-label="Existing dialog" onCancel={e=>{e.preventDefault();setOtherOpen(false);}}><h2>Existing dialog</h2><button onClick={()=>setOtherOpen(false)}>Close existing</button></dialog>
 </SecondaryInfoProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
