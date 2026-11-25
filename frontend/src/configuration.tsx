import {CodexRestartPrompt} from './codex-server-restart';
import {ToolUpdateButton,validToolUpdate,type ToolUpdate} from './tool-update';
import React,{useEffect,useRef,useState} from 'react';
import {API,hostRequest as request,type ProjectBinding,type Workspace} from './api';
import {useDisclosureMotion} from './view-motion';
import {CodebaseMemory,settingsError} from './cbm';

export function ConfigurationView({w,connected,project,onChanged}:{w:Workspace;connected:boolean;project:ProjectBinding;onChanged:()=>Promise<void>}){
 const trusted=w.project_trust?.[project.id]??(project.root===w.project&&w.trusted);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const hint=React.useId();

 async function changeTrust(next:boolean){
  setSaving(true);
  setError('');
  try {
   await request('POST','/api/project/trust',{api:API,project:project.root,binding:project,trusted:next});
   try {
    await onChanged();
   } catch {
    setError('Trust was saved. Deck could not refresh project settings.');
   }
  } catch(e) {
   setError((e as Error).message);
  } finally {
   setSaving(false);
  }
 }

 return <div className="configuration-content simple-project-settings"><div className="settings-card">
  <div className="settings-row"><div>
   <label className="project-trust-control"><input type="checkbox" checked={trusted} disabled={!connected||saving} aria-describedby={hint} onChange={e=>void changeTrust(e.target.checked)}/>Trust this project</label>
   <p id={hint}>Allows Code Map to index this folder and enables reviewed editing when selected. File changes still require approval in reviewed editing modes.</p>
   {saving&&<p role="status">Saving project trust…</p>}
   {error&&<p role="alert" className="error">{error}</p>}
  </div></div>
  <CodebaseMemory key={String(trusted)} w={w} connected={connected} projectId={project.id} trusted={trusted} trustSaving={saving}/>
 </div></div>;
}
type ToolId='codebase-memory'|'rtk'|'context7';
type RunnerState='installed'|'not_installed'|'incomplete'|'check_failed';
type RunnerId='codex'|'claude'|'agy';
const runnerNames:Record<RunnerId,string>={codex:'Codex',claude:'Claude Code',agy:'Antigravity'};
interface ToolRunner {id:RunnerId;state:RunnerState}
const validRunner=(v:unknown):v is ToolRunner=>typeof v==='object'&&v!==null&&['codex','claude','agy'].includes((v as ToolRunner).id)&&['installed','not_installed','incomplete','check_failed'].includes((v as ToolRunner).state);
interface Tool {id:ToolId;enabled:boolean;installed:boolean;version:string|null;update:ToolUpdate;runners?:ToolRunner[]}
function tools(v:unknown):Tool[]{
 const data=v as {api:number;tools:Tool[]};
 if(data?.api!==API||!Array.isArray(data.tools)||data.tools.length!==3||new Set(data.tools.map(t=>t.id)).size!==3||data.tools.some(t=>!['codebase-memory','rtk','context7'].includes(t.id)||!validToolUpdate(t.update)||typeof t.enabled!=='boolean'||typeof t.installed!=='boolean'||(t.installed?typeof t.version!=='string':t.version!==null)))throw Error('Invalid tool status');
 if(data.tools.some(t=>t.runners!==undefined&&(!Array.isArray(t.runners)||t.runners.some(r=>!validRunner(r))||new Set(t.runners.map(r=>r.id)).size!==t.runners.length)))throw Error('Invalid runner status');
 return data.tools;
}
const names:Record<ToolId,string>={'codebase-memory':'Codebase Memory',rtk:'RTK',context7:'Context7'};
const descriptions:Record<ToolId,string>={'codebase-memory':'Indexes trusted projects so agents can search functions and their relationships.',rtk:'Compresses command output agents read, so they use fewer tokens.',context7:'Gives agents current library documentation and code examples.'};
export function RtkSettings({w,connected,projectId}:{w:Workspace;connected:boolean;projectId?:string}){
 const [data,setData]=useState<Tool[]>(),[error,setError]=useState(''),[busy,setBusy]=useState<string>();
 const [changes,setChanges]=useState<{path:string;change:string}[]>([]);
 const notice=useRef<HTMLDivElement>(null);useDisclosureMotion(notice,changes.length>0);
 const alert=useRef<HTMLDivElement>(null);useDisclosureMotion(alert,!!error);
 const generation=useRef(0);
 useEffect(()=>{const turn=++generation.current;let live=true;setData(undefined);setBusy(undefined);setError('');setChanges([]);
  async function refresh(){try{const result=tools(await request('GET','/api/tools'));if(live&&generation.current===turn){setData(result);setError('');}}catch(e){if(live)setError(settingsError(e));}}
  if(connected)void refresh();const focus=()=>{if(connected)void refresh();};window.addEventListener('focus',focus);
  return()=>{live=false;window.removeEventListener('focus',focus);};
 },[w.host_id,connected]);
 async function change(t:Tool,action:'install'|'update'|'enable'|'check_updates'){
  const turn=generation.current;setBusy(`${t.id}:${action}`);setError('');setChanges([]);
  try{const result=tools(await request('POST','/api/tools/'+t.id,{api:API,action,...(action==='enable'?{enabled:!t.enabled}:{})}));if(generation.current===turn)setData(result);}
  catch(e){if(generation.current===turn)setError(settingsError(e));}
  finally{if(generation.current===turn)setBusy(undefined);}
 }
 async function changeRunner(t:Tool,runner:ToolRunner,action:'install'|'update'|'remove'){
  if(busy)return;const turn=generation.current;setBusy(`rtk:runner:${runner.id}:${action}`);setError('');setChanges([]);
  try{
   const result=await request('POST',`/api/tools/rtk/runners/${runner.id}`,{api:API,action}) as {api:number;runner:ToolRunner;changes:{path:string;change:string}[]};
   if(result.api!==API||!validRunner(result.runner)||result.runner.id!==runner.id||!Array.isArray(result.changes)||result.changes.some(c=>typeof c.path!=='string'||!['created','modified','removed'].includes(c.change)))throw Error('Invalid runner result');
   if(generation.current===turn){setData(rows=>rows?.map(row=>row.id===t.id?{...row,runners:row.runners?.map(r=>r.id===runner.id?result.runner:r)}:row));setChanges(result.changes);}
  }catch(e){if(generation.current===turn)setError(settingsError(e));}
  finally{if(generation.current===turn)setBusy(undefined);}
 }
 const rows:Tool[]=data??(['codebase-memory','rtk','context7'] as ToolId[]).map(id=>({id,enabled:false,installed:false,version:null,update:{state:'not_installed'} as ToolUpdate}));
 return <div className="configuration-content simple-project-settings"><div className="settings-card">
 {rows.map(t=>{
  const toolRow=<div className="settings-row"><div><h3 id={t.id==='rtk'?'rtk-settings-heading':undefined}>{names[t.id]}</h3><p>{descriptions[t.id]}</p><p role="status">{busy?.startsWith(t.id+':')&&!busy.startsWith('rtk:runner:')?(busy.endsWith(':enable')?'Saving…':busy.endsWith(':install')?'Installing…':busy.endsWith(':check_updates')?'Checking for updates…':'Updating…'):!connected?'Waiting for connection':!data?'Checking…':t.installed?`Installed · ${t.version}`:'Not installed'}</p></div><div className="settings-row-actions">{t.installed?<><ToolUpdateButton update={t.update} blocked={!connected||!data||!!busy} onClick={()=>{if(!busy)void change(t,'update');}}/><button type="button" className="quiet" disabled={!connected||!data||!!busy} aria-label={`${t.update.state==='check_failed'?'Retry update check':'Check for updates'} for ${names[t.id]}`} onClick={()=>void change(t,'check_updates')}>{t.update.state==='check_failed'?'Retry':'Check for updates'}</button></>:<button type="button" className="quiet" disabled={!connected||!data||!!busy} onClick={()=>void change(t,'install')}>Install</button>}<button type="button" className="quiet settings-switch" role="switch" aria-label={names[t.id]} aria-checked={t.enabled} disabled={!connected||!data} aria-disabled={!connected||!!busy||!data} onClick={()=>{if(!busy)void change(t,'enable');}}>{t.enabled?'On':'Off'}</button></div></div>;
  if(t.id!=='rtk')return <React.Fragment key={t.id}>{toolRow}</React.Fragment>;

  return <section className="rtk-settings" aria-labelledby="rtk-settings-heading" key={t.id}>
   {toolRow}
   <section className="rtk-runners" aria-label="RTK runners">
    <h4>Runners</h4><p>RTK changes the selected runner’s configuration. Restart it after a change.</p>
    {(t.runners??[{id:'codex',state:'check_failed'},{id:'claude',state:'check_failed'},{id:'agy',state:'check_failed'}] as ToolRunner[]).map(r=>{
     const name=runnerNames[r.id];
     const action=r.state==='installed'?'update':'install';
     const changing=busy?.startsWith(`rtk:runner:${r.id}:`);
     return <div className="settings-row" key={r.id}><div><h5>{name}</h5>
      <p role="status">{changing?(busy?.endsWith(':remove')?'Removing integration…':action==='update'?'Updating integration…':'Installing integration…'):!connected?'Waiting for connection':!data?'Checking…':r.state==='installed'?'Integration installed':r.state==='not_installed'?'Not installed':r.state==='incomplete'?'Integration incomplete':"Couldn’t check integration"}</p>
     </div><div className="settings-row-actions">
      <button type="button" className="quiet" aria-label={`${action==='update'?'Update':'Install'} RTK for ${name}`} disabled={!connected||!data||!t.installed||!!busy||r.state==='check_failed'} onClick={()=>void changeRunner(t,r,action)}>{action==='update'?'Update':'Install'}</button>
      <button type="button" className="quiet" aria-label={`Remove RTK from ${name}`} disabled={!connected||!data||!t.installed||!!busy||r.state==='not_installed'||r.state==='check_failed'} onClick={()=>void changeRunner(t,r,'remove')}>Remove</button>
     </div></div>;
    })}
    <div ref={notice} hidden={!changes.length} inert={!changes.length}>
     {changes.length>0&&<div className="rtk-changes" role="status">
      <h5>RTK changed these files:</h5>
      <ul role="list">
       {changes.map(c=><li key={c.path}><span className="rtk-change-kind">{c.change}</span><span className="settings-path">{c.path}</span></li>)}
      </ul>
     </div>}
    </div>
   </section>
  </section>;
 })}
 <section className="rtk-settings" aria-labelledby="context-mode-heading">
  <div className="settings-row"><div><h3 id="context-mode-heading">Context Mode</h3><p>Keeps large tool output out of the conversation.</p></div></div>
  <section className="rtk-runners" aria-label="Context Mode runners"><h4>Runners</h4>
   {(['codex','claude','agy'] as const).map(runner=><ContextModeSettings key={w.host_id+':'+projectId+':'+runner} runner={runner} projectId={projectId} connected={connected} blocked={!!busy} onBusy={setBusy}/>)}
  </section>
 </section>
 </div><div ref={alert} hidden={!error} inert={!error}>{error&&<p className="error" role="alert">{error}</p>}</div></div>;
}

const contextModePath='/api/tools/context-mode';
type ContextModeAction='install'|'update'|'migrate';
type ContextModeOutcome='installed'|'updated'|'current';
const contextModeStates=['not_installed','installed','incomplete','stale','standalone','migration_available','conflict','disabled','check_failed'] as const;
type ContextModeStatus={
 state:typeof contextModeStates[number];
 version:string|null;
 detail:string;
 outcome:ContextModeOutcome|null;
};

function contextModeStatus(value:unknown):ContextModeStatus {
 const status=value as ContextModeStatus & {api:number};
 if(status?.api!==API||!contextModeStates.includes(status.state)
   ||(status.version!==null&&typeof status.version!=='string')
   ||typeof status.detail!=='string'
   ||(status.outcome!==null&&(!['installed','updated','current'].includes(status.outcome)||status.state!=='installed'))) {
  throw Error('Invalid Context Mode status');
 }
 return status;
}

function ContextModeSettings({runner,projectId,connected,blocked,onBusy}:{
 runner:RunnerId;projectId?:string;connected:boolean;blocked:boolean;onBusy:(busy:string|undefined)=>void;
}) {
 const [status,setStatus]=useState<ContextModeStatus>();
 const [action,setAction]=useState<ContextModeAction>();
 const [restart,setRestart]=useState<'recommended'|'later'|'complete'>();
 const [error,setError]=useState('');
 const [checking,setChecking]=useState(false);
 const lifetime=useRef(0);
 const requestId=useRef(0);
 const projectQuery=projectId?`?projectId=${encodeURIComponent(projectId)}`:'';

 const name=runnerNames[runner];
 const runnerPath=`${contextModePath}/runners/${runner}`;
 const heading=React.useId();

 async function refresh(signal?:AbortSignal) {
  const requestTurn=++requestId.current;
  setChecking(true);
  try {
   const result=contextModeStatus(await request('GET',(runner==='codex'?contextModePath:runnerPath)+projectQuery,undefined,signal));
   if(requestTurn===requestId.current)setStatus(result);
  } catch(e) {
   if(requestTurn===requestId.current)setError(settingsError(e));
  } finally {
   if(requestTurn===requestId.current)setChecking(false);
  }
 }

 useEffect(()=>{
  lifetime.current++;
  setStatus(undefined);
  setError('');
  setChecking(false);
  setAction(undefined);
  const controller=new AbortController();
  if(connected)void refresh(controller.signal);
  return ()=>{
   lifetime.current++;
   requestId.current++;
   controller.abort();
  };
 },[connected]);

 async function change(next:ContextModeAction) {
  if(blocked||checking||!connected)return;
  const turn=lifetime.current;
  setAction(next);
  onBusy('context-mode:'+next);
  setError('');
  try {
   const result=contextModeStatus(await request('POST',runnerPath+projectQuery,{api:API,action:next}));
   if(turn===lifetime.current){
    setStatus(result);
    if(result.outcome==='installed'||result.outcome==='updated')setRestart('recommended');
   }
  } catch(e) {
   if(turn===lifetime.current){
    setError(settingsError(e));
    setStatus(undefined);
    await refresh();
   }
  } finally {
   if(turn===lifetime.current)setAction(undefined);
   onBusy(undefined);
  }
 }

 const installing=status?.state==='not_installed'||status?.state==='incomplete';
 const installed=status?.state==='installed';
 const canMigrate=status?.state==='migration_available';
 const disabled=!connected||blocked||checking;
 return <section className="settings-row" aria-labelledby={heading}>
  <div>
   <h5 id={heading}>{name}</h5>
   <p role="status">{action==='install'?`Setting up for ${name}…`:action==='update'?`Updating for ${name}…`:action==='migrate'?'Migrating Context Mode for Codex…':
    !connected?'Waiting for connection':checking?`Checking ${name}…`:
    installed?(status.version?`Installed · ${status.version}`:'MCP registered'):
    (canMigrate||status?.state==='standalone')?'Standalone MCP configured':
    status?.state==='conflict'?'Conflicting configuration':
    status?.state==='stale'?'Integration needs an update':
    status?.state==='incomplete'?'Plugin setup incomplete':status?.state==='disabled'?`Disabled in ${name}`:
    status?.state==='not_installed'?'Not installed':`Couldn’t check ${name}`}</p>
   {status&&!installed&&<p>{status.detail}</p>}
   {restart==='recommended'&&runner==='claude'&&<p role="status">Restart Claude Code to load the plugin changes.</p>}
   {restart==='recommended'&&runner==='agy'&&<p role="status">Start a new Antigravity turn to load the MCP changes.</p>}
   {restart==='recommended'&&runner==='codex'&&<CodexRestartPrompt connected={connected} projectId={projectId}
    onLater={()=>setRestart('later')} onRestart={()=>setRestart('complete')}/>}
   {restart==='later'&&<p role="status">Restart Codex when you’re ready from Settings → Agents &amp; tools → Codex.</p>}
   {restart==='complete'&&<p role="status">Codex server restarted.</p>}
   {status?.outcome==='current'&&<p role="status">{name} already has the current plugin version.</p>}
   {error&&<p className="error" role="alert">{error}</p>}
  </div>
  <div className="settings-row-actions">
   {installing&&<button type="button" className="quiet" disabled={disabled}
    aria-label={status.state==='incomplete'?`Finish Context Mode setup for ${name}`:`Install Context Mode for ${name}`}
    onClick={()=>void change('install')}>{status.state==='incomplete'?'Finish setup':'Install'}</button>}
   {canMigrate&&<button type="button" className="quiet" disabled={disabled}
    aria-label="Install Context Mode for Codex"
    onClick={()=>{
     if(window.confirm('Install the official Context Mode plugin for Codex and replace the existing standalone MCP registration?')){
      void change('migrate');
     }
    }}>Install</button>}
   {(installed||status?.state==='stale')&&<button type="button" className="quiet" disabled={disabled}
    aria-label={`Update Context Mode for ${name}`} onClick={()=>void change('update')}>Update</button>}
   <button type="button" className="quiet" disabled={disabled} aria-label={`Refresh Context Mode status for ${name}`}
    onClick={()=>{setError('');void refresh();}}>Refresh</button>
  </div>
 </section>;
}
