import {ToolUpdateButton,validToolUpdate,type ToolUpdate} from './tool-update';
import React,{useEffect,useRef,useState} from 'react';
import {API,hostRequest as request,type Workspace} from './api';
import {useDisclosureMotion} from './view-motion';
import {CodebaseMemory,settingsError} from './cbm';

export function ConfigurationView({w,connected,projectId}:{w:Workspace;connected:boolean;projectId?:string}){
 return <div className="configuration-content simple-project-settings"><div className="settings-card"><CodebaseMemory w={w} connected={connected} projectId={projectId}/></div></div>;
}
type ToolId='codebase-memory'|'rtk'|'context7';
type RunnerState='installed'|'not_installed'|'incomplete'|'check_failed';
interface ToolRunner {id:'codex';state:RunnerState}
const validRunner=(v:unknown):v is ToolRunner=>typeof v==='object'&&v!==null&&(v as ToolRunner).id==='codex'&&['installed','not_installed','incomplete','check_failed'].includes((v as ToolRunner).state);
interface Tool {id:ToolId;enabled:boolean;installed:boolean;version:string|null;update:ToolUpdate;runners?:ToolRunner[]}
function tools(v:unknown):Tool[]{
 const data=v as {api:number;tools:Tool[]};
 if(data?.api!==API||!Array.isArray(data.tools)||data.tools.length!==3||new Set(data.tools.map(t=>t.id)).size!==3||data.tools.some(t=>!['codebase-memory','rtk','context7'].includes(t.id)||!validToolUpdate(t.update)||typeof t.enabled!=='boolean'||typeof t.installed!=='boolean'||(t.installed?typeof t.version!=='string':t.version!==null)))throw Error('Invalid tool status');
 if(data.tools.some(t=>t.runners!==undefined&&(!Array.isArray(t.runners)||t.runners.some(r=>!validRunner(r))||new Set(t.runners.map(r=>r.id)).size!==t.runners.length)))throw Error('Invalid runner status');
 return data.tools;
}
const names:Record<ToolId,string>={'codebase-memory':'Codebase Memory',rtk:'RTK',context7:'Context7'};
const descriptions:Record<ToolId,string>={'codebase-memory':'Indexes trusted projects so agents can search functions and their relationships.',rtk:'Compresses command output agents read, so they use fewer tokens.',context7:'Gives agents current library documentation and code examples.'};
export function RtkSettings({w,connected}:{w:Workspace;connected:boolean}){
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
 async function changeRunner(t:Tool,runner:ToolRunner,action:'install'|'remove'){
  if(busy)return;const turn=generation.current;setBusy(`rtk:runner:${action}`);setError('');setChanges([]);
  try{
   const result=await request('POST',`/api/tools/rtk/runners/${runner.id}`,{api:API,action}) as {api:number;runner:ToolRunner;changes:{path:string;change:string}[]};
   if(result.api!==API||!validRunner(result.runner)||!Array.isArray(result.changes)||result.changes.some(c=>typeof c.path!=='string'||!['created','modified','removed'].includes(c.change)))throw Error('Invalid runner result');
   if(generation.current===turn){setData(rows=>rows?.map(row=>row.id===t.id?{...row,runners:[result.runner]}:row));setChanges(result.changes);}
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
   <section className="rtk-runners" aria-label="RTK runners"><h4>Runners</h4><p>RTK changes this runner’s configuration. Restart the runner after installing or removing. Removal may leave formatting changes and RTK backups.</p>{(t.runners??[{id:'codex',state:'check_failed'} as ToolRunner]).map(r=><div className="settings-row" key={r.id}><div><h5>Codex</h5><p role="status">{busy?.startsWith('rtk:runner:')?(busy.endsWith(':remove')?'Removing integration…':'Installing integration…'):!connected?'Waiting for connection':!data?'Checking…':r.state==='installed'?'Integration installed':r.state==='not_installed'?'Not installed':r.state==='incomplete'?'Integration incomplete':"Couldn’t check integration"}</p></div><div className="settings-row-actions"><button type="button" className="quiet" aria-label="Install RTK for Codex" disabled={!connected||!data||!t.installed||!!busy||r.state==='installed'} onClick={()=>void changeRunner(t,r,'install')}>Install</button><button type="button" className="quiet" aria-label="Remove RTK from Codex" disabled={!connected||!data||!t.installed||!!busy||r.state==='not_installed'} onClick={()=>void changeRunner(t,r,'remove')}>Remove</button></div></div>)}
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
 </div><div ref={alert} hidden={!error} inert={!error}>{error&&<p className="error" role="alert">{error}</p>}</div></div>;
}
