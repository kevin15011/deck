import React, {useEffect,useRef,useState} from 'react';
import type {Api} from './workspace';
import type {Project,WorkspaceMutation} from './workspace-types';
export type ProjectTrust = {projectId:string;projectRoot:string;trusted:boolean;revision:number};

export function ProjectTrustFields({trust,pending,disabled,onChange}:{trust:ProjectTrust;pending:boolean;disabled?:boolean;onChange?:(trusted:boolean)=>void}) {
 return <section aria-label="OpenCode project trust"><h3>OpenCode project trust</h3><p className="muted">User and global skills, MCP servers and plugins load automatically. Trust allows this project’s native configuration, skills and plugins to execute for Lead and every member. Existing role permissions still apply.</p><small className="dialog-project-path">{trust.projectRoot}</small><p role="status">{trust.trusted?'Project trusted':'Project execution is not trusted'}</p><p className="muted">Saved for this canonical project. Changes apply to future preparation and launches; running work keeps its current configuration.</p>{onChange&&<button type="button" className="quiet" disabled={pending||disabled} onClick={()=>onChange(!trust.trusted)}>{pending?'Saving trust…':trust.trusted?'Revoke project trust':'Trust project'}</button>}</section>;
}

/** Mount only inside user settings dialogs; loading a folder never grants trust. */
export function ProjectTrustSettings({project,api,mutate,pending,onPending,onChanged}:{project:Project;api:Api;mutate:WorkspaceMutation;pending:boolean;onPending:(pending:boolean)=>void;onChanged:()=>void}) {
 const [trust,setTrust]=useState<ProjectTrust>(),[error,setError]=useState('');const epoch=useRef(0);
 useEffect(()=>{const version=++epoch.current,controller=new AbortController();setTrust(undefined);setError('');void api(`/api/projects/${encodeURIComponent(project.projectId)}/trust`,{signal:controller.signal}).then(reply=>{if(version===epoch.current)setTrust(reply.data);}).catch(cause=>{if(!controller.signal.aborted&&version===epoch.current)setError((cause as Error).message);});return()=>{++epoch.current;controller.abort();};},[api,project.projectId]);
 async function change(trusted:boolean){if(!trust||pending)return;const version=epoch.current;onPending(true);setError('');try{const result=await mutate({type:'project.trust',projectId:trust.projectId,runnerId:'opencode',trusted,expectedRevision:trust.revision});if(version===epoch.current){setTrust(result.trust);onChanged();}}catch(cause){if(version===epoch.current){
  if((cause as Error).message==='project-trust-conflict'){
   // Refresh the state the user must review. Never retry authorization automatically.
   setTrust(undefined);
   try{const reply=await api(`/api/projects/${encodeURIComponent(project.projectId)}/trust`);if(version===epoch.current){setTrust(reply.data);onChanged();setError('Project trust changed. Review the current state and choose again.');}}
   catch(refreshError){if(version===epoch.current)setError((refreshError as Error).message);}
  }else setError((cause as Error).message);
 }}finally{onPending(false);}}
 return <>{trust?<ProjectTrustFields trust={trust} pending={pending} disabled={!project.available&&!trust.trusted} onChange={value=>void change(value)}/>:!error&&<p role="status">Loading project trust…</p>}{error&&<p role="alert" className="error">{error}</p>}</>;
}
