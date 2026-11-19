import React,{useEffect,useLayoutEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {gsap} from 'gsap';
import {API,request,load,save,type Workspace} from './api';
import {useOriginalHistory,type HistorySelection} from './history';
import {NavigationIcon} from './navigation-icon';
import {useDismissLayer} from './dismiss-layer';
import {useDisclosureMotion} from './view-motion';
import {ConfigurationView} from './configuration';
import {useSelectionMotion} from './selection-motion';
import {SessionIndicators,ProjectIndicators} from './session-indicators';
import {sessionStatus,projectStatus} from './sidebar-state';
import './indicators.css';
import './sidebar.css';
import {orderedRows,useSidebarOrder} from './sidebar-order';
import {DirectoryInput} from './directory-input';
interface Entry {title?:string;hidden:boolean}
export interface Navigation {projects:Record<string,Entry>;sessions:Record<string,Entry>;decisions?:Record<string,number>;adopted_order_keys?:Record<string,string>;order_revision?:number;project_order?:string[];session_order?:Record<string,string[]>}
function orderPreferences({order_revision,project_order,session_order}:Navigation){
 return {order_revision,project_order,session_order};
}

function acceptNavigation(previous:Navigation,next:Navigation){
 return (next.order_revision??0)>=(previous.order_revision??0)?next:{...next,...orderPreferences(previous)};
}
type Original=ReturnType<typeof useOriginalHistory>;
type Mutation={kind:'add'|'project'|'session'|'history';action:'rename'|'remove';id:string;title:string;project?:string};
const historyKey=(source:string,project:string,id:string)=>JSON.stringify(['history',source,project,id]);
function NavigationActions({ label, menuName, busy, renameDisabled = false, renameLabel, removeLabel, removeDescription, onRename, onRemove, onSettings }: { label: string; menuName: string; busy: boolean; renameDisabled?: boolean; renameLabel: string; removeLabel: string; removeDescription: string; onRename: () => void; onRemove: () => void; onSettings?: () => void }) {
    const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), initialItem = useRef(0);
    const [position, setPosition] = useState<{top:number;left:number}>();
    useLayoutEffect(()=>{if(!position||!menu.current)return;const media=gsap.matchMedia();media.add('(prefers-reduced-motion: no-preference)',()=>{gsap.fromTo(menu.current,{opacity:.4,y:-3},{opacity:1,y:0,duration:.12,ease:'power2.out',clearProps:'opacity,transform'});});return()=>media.revert();},[position]);
    useDismissLayer({open:!!position,roots:[menu,trigger],onDismiss:reason=>close(reason==='escape')});
    function close(restore = true) { setPosition(undefined); if (restore) trigger.current?.focus({preventScroll:true}); }
    function open(last = false) {
        const bounds = trigger.current?.getBoundingClientRect(); if (!bounds) return;
        initialItem.current = last ? 1 : 0;
        const menuHeight = (onSettings ? 40 : 0) + (matchMedia('(max-width: 1000px)').matches ? 98 : 88);
        setPosition({top:Math.max(8, bounds.bottom + 4 + menuHeight < innerHeight ? bounds.bottom + 4 : bounds.top - menuHeight - 4),left:Math.max(8, Math.min(bounds.right - 164, innerWidth - 172))});
    }
    useLayoutEffect(() => { if(position) {const items=menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');items?.[initialItem.current ? items.length-1 : 0]?.focus({preventScroll:true});} }, [position]);
    useEffect(() => {
        if(!position) return;
        const resized = () => close();
        const scrolled = (event:Event) => { if(!menu.current?.contains(event.target as Node)) close(false); };
        window.addEventListener('resize',resized); document.addEventListener('scroll',scrolled,true);
        return () => {window.removeEventListener('resize',resized);document.removeEventListener('scroll',scrolled,true);};
    }, [position]);
    return <span className="project-actions"><button ref={trigger} type="button" className="project-more quiet" disabled={busy} aria-label={`More options for ${label}`} title="More options" aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? id : undefined} onClick={() => position ? close() : open()} onKeyDown={event => { if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(event.key==='ArrowUp');} }}><NavigationIcon kind="more"/></button>{position && createPortal(<div ref={menu} id={id} className="project-menu" role="menu" aria-label={menuName} style={position} onKeyDown={event => {
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
        if(event.key==='Tab'){close();return;}
        const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')], index=items.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:undefined;
        if(next!==undefined){event.preventDefault();items[next]?.focus();}
    }}>{onSettings&&<button type="button" role="menuitem" className="quiet" onClick={()=>{close();onSettings();}}>Project settings</button>}<button type="button" role="menuitem" className="quiet" disabled={renameDisabled} onClick={() => {close();onRename();}}>{renameLabel}</button><button type="button" role="menuitem" className="quiet menu-remove" title={removeDescription} aria-description={removeDescription} onClick={() => {close();onRemove();}}>{removeLabel}</button></div>,trigger.current?.closest('dialog[open]')??document.body)}</span>;
}

function MutationDialog({value,onClose,onSave}:{value:Mutation;onClose:()=>void;onSave:(title:string,trusted:boolean)=>Promise<void>}){
 const ref=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null);
 const [text,setText]=useState(value.kind==='add'?'':value.title),[pending,setPending]=useState(false),[error,setError]=useState('');
 const [trusted,setTrusted]=useState(false),trustHint=useId();
 const title=value.kind==='add'?'Add project':value.action==='rename'?`Rename ${value.kind==='project'?'project':'session'}`:`Remove ${value.kind==='project'?'project':'session'}`;
 useLayoutEffect(()=>{const node=ref.current!;returnFocus.current=document.activeElement as HTMLElement;node.showModal();const media=gsap.matchMedia();media.add('(prefers-reduced-motion: no-preference)',()=>{gsap.fromTo(node,{opacity:.4,y:6},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});});return()=>{media.revert();node.close();returnFocus.current?.focus({preventScroll:true});};},[]);
 async function submit(){if(pending)return;setPending(true);setError('');try{await onSave(text.trim(),trusted);onClose();}catch(e){setError(String(e));}finally{setPending(false);}}
 return <dialog ref={ref} className="workspace-dialog sidebar-dialog" aria-labelledby="sidebar-dialog-title" onCancel={e=>{e.preventDefault();if(!pending)onClose();}}><form onSubmit={e=>{e.preventDefault();void submit();}}><h2 id="sidebar-dialog-title">{title}</h2>{value.action==='remove'&&value.kind!=='add'?<p>{value.kind==='project'?'Remove this project from navigation? Its files and conversations are kept. Add the same path to restore it.':value.kind==='history'?'Remove this session from navigation? Original history is kept.':'Remove this settled session from local history? Project files and native history are kept.'}</p>:value.kind==='add'?<>
 <DirectoryInput value={text} onChange={setText} disabled={pending}/>
 <div>
  <label className="project-trust-control"><input type="checkbox" checked={trusted} disabled={pending} aria-describedby={trustHint} onChange={e=>setTrusted(e.target.checked)}/>Trust this project</label>
  <p id={trustHint} className="activity-meta">Allows Deck to index this folder for Code Map and enables reviewed editing when selected.</p>
 </div>
 </>:<label>Name<input required autoFocus value={text} maxLength={160} onChange={e=>setText(e.target.value)}/></label>}{error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" disabled={pending}>{pending?'Saving…':value.kind==='add'?'Add project':value.action==='remove'?'Remove':'Save'}</button></div></form></dialog>;
}
export function Sidebar({meta,setMeta,w,history:h,selected,connected,busy,collapsed=false,onSelect,onHistory,onNew,onChanged}:{meta:Navigation;setMeta:React.Dispatch<React.SetStateAction<Navigation>>;w?:Workspace;history:Original;selected:string;connected:boolean;busy:boolean;collapsed?:boolean;onSelect:(id:string)=>void;onHistory:(v:HistorySelection)=>void;onNew:(project:string)=>void;onChanged:()=>Promise<void>}){
 const ref=useRef<HTMLDivElement>(null);useSelectionMotion(ref,collapsed);
 const [mutation,setMutation]=useState<Mutation>(),[error,setError]=useState(''),[settings,setSettings]=useState<{name:string;root:string}>();
 const [open,setOpen]=useState<string[]>(()=>{try{return JSON.parse(load('sidebar-expanded')||'[]');}catch{return [];}}),[initialized,setInitialized]=useState(false),[unread,setUnread]=useState<Set<string>>(new Set()),[checked,setChecked]=useState(0);
 const visibleSelection=h.selection?.session??selected;
 const naturalProjects=[...h.projects.map(p=>({id:p.projectId,root:p.path,name:p.name,available:p.available,original:true,hidden:p.hidden})),...(w?.projects??[]).filter(p=>!h.projects.some(o=>o.projectId===p.id)).map(p=>({...p,name:p.root.split('/').pop()||p.root,available:true,original:false,hidden:false}))].filter(p=>!meta.projects[p.id]?.hidden&&(!p.hidden||p.root===w?.project||h.selection?.project===p.id));
 const projects=orderedRows(naturalProjects,meta.project_order,p=>p.id);
 const projectOrder={keys:projects.map(p=>p.id)};
 const ordering=useSidebarOrder(async ({project,keys})=>{
  try{
   const result=await request('POST','/api/sidebar/order',{api:API,project,keys}) as Navigation;
   setMeta(previous=>acceptNavigation(previous,{...previous,...orderPreferences(result)}));
   setError('');
  }catch(e){setError(String(e));throw e;}
 },!connected||busy||collapsed);
 useEffect(()=>{if(!initialized&&projects.length){const owner=projects.find(p=>w?.sessions.some(s=>s.id===visibleSelection&&s.project?.id===p.id))?.id??h.selection?.project??projects[0]!.id;setOpen(v=>v.length?v:[owner]);setInitialized(true);}},[projects.length,initialized,visibleSelection]);
 useEffect(()=>{if(!connected)return;const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const n=await request('GET','/api/sidebar',undefined,controller.signal) as Navigation;if(!controller.signal.aborted){setMeta(previous=>acceptNavigation(previous,n));setChecked(Date.now());}}catch(e){if(!controller.signal.aborted)setError(String(e));}try{let cursor:number|undefined;const ids=new Set<string>();do{const n=await request('GET','/api/replies'+(cursor?'?cursor='+cursor:''),undefined,controller.signal) as {replies:{sessionId:string}[];nextCursor?:number};n.replies.forEach(r=>ids.add(r.sessionId));cursor=n.nextCursor;}while(cursor&&!controller.signal.aborted);if(!controller.signal.aborted)setUnread(ids);}catch{/* No inferred read receipts on unavailable device context. */}if(!controller.signal.aborted)timer=setTimeout(poll,2000);};void poll();return()=>{controller.abort();clearTimeout(timer);};},[connected]);
 async function mutate(text:string,trusted:boolean){if(!mutation)return;let url:string,body:object={api:API};if(mutation.kind==='add'){url='/api/projects';body={api:API,root:text,trusted};}else if(mutation.kind==='project'){url=`/api/projects/${encodeURIComponent(mutation.id)}/${mutation.action}`;body={api:API,title:mutation.action==='rename'?text:undefined};}else if(mutation.kind==='history'){url=`/api/sidebar/projects/${encodeURIComponent(mutation.project!)}/sessions/${encodeURIComponent(mutation.id)}/${mutation.action}`;body={api:API,title:mutation.action==='rename'?text:undefined};}else{url=`/api/sessions/${encodeURIComponent(mutation.id)}/${mutation.action}`;body={api:API,title:mutation.action==='rename'?text:undefined};}await request('POST',url,body);const nextMeta=await request('GET','/api/sidebar') as Navigation;setMeta(previous=>acceptNavigation(previous,nextMeta));await onChanged();if(mutation.action==='remove'&&mutation.kind!=='add'){
 const current=w?.sessions.find(s=>s.id===visibleSelection);
 if(visibleSelection===mutation.id||mutation.kind==='project'&&(current?.project?.id===mutation.id||h.selection?.project===mutation.id)){
 const next=w?.sessions.find(s=>s.id!==mutation.id&&(mutation.kind!=='project'||s.project?.id!==mutation.id)&&!meta.projects[s.project?.id??'']?.hidden);
 if(next)onSelect(next.id);else h.select(undefined);
 }
 }}
 function toggle(id:string){const next=open.includes(id)?open.filter(v=>v!==id):[...open,id];setOpen(next);save('sidebar-expanded',JSON.stringify(next));if(!h.pages[id]&&h.projects.some(p=>p.projectId===id))void h.sessions(id);}
 useEffect(()=>{const id=open.find(id=>h.projects.some(p=>p.projectId===id)&&!h.pages[id]);if(id&&!h.busy&&connected)void h.sessions(id);},[open,h.pages,h.busy,connected]);

 useEffect(()=>{for(const [key,value] of Object.entries(meta.sessions)){try{const [kind,source,project,id]=JSON.parse(key);if(kind==='history'&&source===h.source&&value.title)h.rename(project,id,value.title);}catch{/* Ambiguous legacy keys cannot target a session safely. */}}},[meta.sessions,h.pages,h.source]);
 const fresh=connected&&Date.now()-checked<10000;
 return <div ref={ref} className="project-navigation"><div className="project-toolbar"><h2>Projects</h2><button type="button" className="quiet navigation-add" disabled={!connected||busy} onClick={()=>setMutation({kind:'add',action:'rename',id:'',title:''})}><NavigationIcon kind="plus"/>Add project</button></div><div className="navigation-scroll" ref={ordering.scroll}><ul className="project-tree">{projects.map(p=>{
 const title=meta.projects[p.id]?.title??p.name;
 const historical=h.pages[p.id]?.sessions??[];
 const naturalRows=[...historical.filter(s=>!s.removed).map(s=>({id:s.sessionId,title:s.title,history:true,orderKey:historyKey(h.source,p.id,s.sessionId)})),...(w?.sessions??[]).filter(s=>s.project?.id===p.id&&!(s.original&&historical.some(o=>o.sessionId===s.id))).map(s=>({id:s.id,title:s.title,history:!!s.original,orderKey:s.original?meta.adopted_order_keys?.[s.id]:JSON.stringify(['local',p.id,s.id])}))].filter(s=>!s.history||!meta.sessions[historyKey(h.source,p.id,s.id)]?.hidden);
 const rowKey=(s:{id:string;history:boolean;orderKey?:string})=>s.orderKey??historyKey(h.source,p.id,s.id);
 const rows=orderedRows(naturalRows,meta.session_order?.[p.id],rowKey);
 const sessionOrder={project:p.id,keys:rows.filter(s=>s.orderKey).map(rowKey)};
 const statuses=rows.filter(s=>w?.sessions.some(x=>x.id===s.id&&x.project?.id===p.id&&!!x.original===s.history)).map(s=>sessionStatus(w!,s.id,meta.decisions?.[s.id]));
 return <ProjectGroup key={p.id} id={p.id} title={title} path={p.root} orderRow={ordering.row(projectOrder,p.id)} orderHandle={ordering.handle(projectOrder,p.id,'project '+title)} available={p.available} open={open.includes(p.id)} onToggle={()=>toggle(p.id)} onNew={()=>onNew(p.id)} canCreate={connected&&!busy&&p.available&&!!w?.projects?.some(v=>v.id===p.id)} onSettings={()=>setSettings({name:title,root:p.root})} onAction={action=>setMutation({kind:'project',action,id:p.id,title})} busy={busy||!connected} indicators={statuses.length?<ProjectIndicators status={{summary:projectStatus(p.id,statuses),checkedAt:checked,stale:!fresh}}/>:undefined}>
 {rows.map(s=>{const name=(s.history?meta.sessions[historyKey(h.source,p.id,s.id)]?.title:undefined)??s.title;const live=w?.sessions.find(v=>v.id===s.id&&v.project?.id===p.id&&!!v.original===s.history),status=live?sessionStatus(w!,s.id,meta.decisions?.[s.id]):undefined;const isSelected=h.selection? s.history&&h.selection.project===p.id&&h.selection.session===s.id:!!live&&selected===s.id;return <div key={(s.history?'history:':'local:')+s.id} className="session-row" {...ordering.row(sessionOrder,rowKey(s))}>{ordering.handle(sessionOrder,rowKey(s),'session '+name)}<button type="button" className={'session quiet'+(isSelected?' selected':'')} aria-current={isSelected?'page':undefined} onClick={()=>s.history?onHistory({project:p.id,session:s.id}):onSelect(s.id)} aria-label={name} title={name}><span className="session-label"><strong>{name}</strong></span><SessionIndicators session={status??{preparationStatus:'unknown'}} unread={unread.has(s.id)} fresh={!!status&&fresh}/></button><NavigationActions label={'session '+name} menuName={'Session '+name} busy={!connected||busy} renameLabel="Rename session" removeLabel="Remove session" removeDescription="Remove after active work settles" onRename={()=>setMutation({kind:s.history?'history':'session',action:'rename',id:s.id,title:name,project:p.id})} onRemove={()=>setMutation({kind:s.history?'history':'session',action:'remove',id:s.id,title:name,project:p.id})}/></div>;})}
 {h.busy===p.id&&<p className="activity-meta" role="status">Loading history…</p>}{h.pages[p.id]?.error&&<button type="button" className="quiet" onClick={()=>void h.sessions(p.id)}>Retry conversations</button>}{h.pages[p.id]?.nextCursor&&<button type="button" className="quiet history-more" disabled={!!h.busy} onClick={()=>void h.sessions(p.id,true)}>More conversations</button>}
 </ProjectGroup>;
 })}</ul><span className="sidebar-order-announcement" role="status">{ordering.announcement}</span>{error&&<p role="alert" className="error">{error}</p>}</div>{settings&&w&&createPortal(<ProjectSettings name={settings.name} root={settings.root} w={w} connected={connected} onChanged={onChanged} onClose={()=>setSettings(undefined)}/>,document.body)}{mutation&&createPortal(<MutationDialog value={mutation} onClose={()=>setMutation(undefined)} onSave={mutate}/>,document.body)}</div>;
}
function ProjectGroup({id,title,path,available,open,onToggle,onNew,canCreate,onAction,onSettings,busy,indicators,orderRow,orderHandle,children}:{id:string;title:string;path:string;available:boolean;open:boolean;onToggle:()=>void;onNew:()=>void;canCreate:boolean;onAction:(a:'rename'|'remove')=>void;onSettings:()=>void;busy:boolean;indicators:React.ReactNode;orderRow:ReturnType<ReturnType<typeof useSidebarOrder>['row']>;orderHandle:React.ReactNode;children:React.ReactNode}){
 const ref=useRef<HTMLDivElement>(null);useDisclosureMotion(ref,open);const panel=useId();
 return <li className="project-group"><div className="project-row" {...orderRow}>{orderHandle}<button type="button" className="project-toggle quiet" aria-expanded={open} aria-controls={panel} onClick={onToggle} title={available?path:'Unavailable · '+path}><NavigationIcon kind="chevron" expanded={open}/><span className="project-name" title={title}><strong>{title}</strong></span>{indicators}</button><button type="button" className="quiet project-new" aria-label={'New session in '+title} title="New session" disabled={!canCreate} onClick={onNew}><NavigationIcon kind="plus"/></button><NavigationActions label={'project '+title} menuName={'Project '+title} busy={busy} renameLabel="Rename project" removeLabel="Remove project" removeDescription="Remove from navigation; keep project files and history" onSettings={onSettings} onRename={()=>onAction('rename')} onRemove={()=>onAction('remove')}/></div><div id={panel} ref={ref} hidden={!open} inert={!open}><div className="project-sessions">{children}</div></div></li>;
}

function ProjectSettings({name,root,w,connected,onChanged,onClose}:{name:string;root:string;w:Workspace;connected:boolean;onChanged:()=>Promise<void>;onClose:()=>void}){
 const project=w.projects?.find(p=>p.root===root);
 const ref=useRef<HTMLDialogElement>(null),title=useId();
 useLayoutEffect(()=>{const node=ref.current!,previous=document.activeElement as HTMLElement;node.showModal();const media=gsap.matchMedia();media.add('(prefers-reduced-motion: no-preference)',()=>{gsap.fromTo(node,{opacity:.7,y:8,scale:.99},{opacity:1,y:0,scale:1,duration:.2,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});});return()=>{media.revert();node.close();previous?.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className="settings-modal" aria-labelledby={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==e.currentTarget)return;const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)onClose();}}><div className="settings-shell project-settings-shell"><div className="settings-main"><header className="settings-modal-header"><span id={title}>{name} / <strong>Project settings</strong></span><button type="button" className="quiet settings-close" aria-label="Close project settings" onClick={onClose}>×</button></header><div className="settings-panel"><h2>Project settings</h2>{project?<ConfigurationView key={JSON.stringify([w.host_id,project])} project={project} w={w} connected={connected} onChanged={onChanged}/>:<p role="status">This project is no longer registered.</p>}</div></div></div></dialog>;
}
