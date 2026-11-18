import {YoloFields} from './session-approvals';
// AssignmentFields is reused from Deck1 workspace-dialogs.tsx; transport below
// adapts the original creation/revision contract to the Rust host.
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
import {API,request,load,save as persist,HttpError,type Session,type MemberAssignment as Assignment} from './api';
import {transitionPreview,transitionCommand,transitionedSession,type TransitionCommand} from './session-transition';
interface RunnerOption {runnerId:string;label:string;available:boolean;reasonCode?:string;models:{modelId:string;label:string;thinkingLevels:string[]}[]}
export function AssignmentFields({ runners, value, onChange, role, disabled = false }: { runners: RunnerOption[]; value: Assignment; onChange: (assignment: Assignment) => void; role?: string; disabled?: boolean }) {
    const runner = runners.find(item => item.runnerId === value.runnerId), model = runner?.models.find(item => item.modelId === value.modelId);
    return <div className="assignment-fields"><label>Runner<select aria-label={role ? `Runner for ${role}` : "Runner"} disabled={disabled} required value={value.runnerId} onChange={event => {
        const next = runners.find(item => item.runnerId === event.target.value);
        onChange({ runnerId: event.target.value, modelId: next?.models[0]?.modelId ?? '' });
    }}><option value="" disabled>Choose a runner</option>{runners.map(item => <option key={item.runnerId} value={item.runnerId} disabled={!item.available || !item.models.length}>{item.label}{!item.available ? ' (unavailable)' : ''}</option>)}</select></label>
        <label>Model<select aria-label={role ? `Model for ${role}` : "Model"} required value={value.modelId} disabled={disabled || !runner?.available} onChange={event => onChange({ runnerId: value.runnerId, modelId: event.target.value })}><option value="" disabled>Choose a model</option>{value.modelId && !model && <option value={value.modelId} disabled>{value.modelId} (unavailable)</option>}{runner?.models.map(item => <option key={item.modelId} value={item.modelId}>{item.label}</option>)}</select></label>
        {model && (!!model.thinkingLevels.length || !!value.thinking) && <label>Reasoning level<select aria-label={role ? `Reasoning level for ${role}` : "Reasoning level"} disabled={disabled} value={value.thinking ?? ''} onChange={event => onChange({ ...value, thinking: event.target.value || undefined })}><option value="">Runner default</option>{value.thinking && !model.thinkingLevels.includes(value.thinking) && <option value={value.thinking} disabled>{value.thinking} (unavailable)</option>}{model.thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
        {runner && !runner.available && <p className="muted">{runner.reasonCode ?? 'This runner is currently unavailable.'}</p>}
    </div>;
}

type WorkspaceSession={members:Record<string,Assignment>;assignmentRevision:number};
type WorkspaceMutation=(input:{type:string;memberId:string;assignment:Assignment;expectedRevision:number})=>Promise<{revision:number}>;
const sameAssignment = (a?: Assignment, b?: Assignment) => !!a && !!b && a.runnerId === b.runnerId && a.modelId === b.modelId && a.thinking === b.thinking;

function AssignmentRows({ session, runners, mutate, onAssigned, onPending, pending, loading }: { session: WorkspaceSession; runners: RunnerOption[]; mutate: WorkspaceMutation; onAssigned: () => void; onPending: (pending: boolean) => void; pending: boolean; loading: boolean }) {
    const [drafts, setDrafts] = useState<Record<string, Assignment>>(() => ({ ...session.members }));
    const [saved, setSaved] = useState<Record<string, Assignment>>(() => ({ ...session.members }));
    const [baseline, setBaseline] = useState<Record<string, Assignment>>(() => ({ ...session.members }));
    const [revision, setRevision] = useState(session.assignmentRevision ?? 0);
    const [saving, setSaving] = useState(''), [errors, setErrors] = useState<Record<string, string>>({});
    useEffect(() => {
        const incomingRevision = session.assignmentRevision ?? 0;
        if (incomingRevision <= revision) return;
        const incoming = session.members ?? {};
        setDrafts(current => {
            const next = { ...current };
            for (const [member, assignment] of Object.entries(incoming)) {
                const draft = current[member], previous = saved[member];
                if (!draft || (previous && draft.runnerId === previous.runnerId && draft.modelId === previous.modelId && draft.thinking === previous.thinking)) next[member] = assignment;
            }
            return next;
        });
        setBaseline(current => {
            const next = { ...current };
            for (const [member, assignment] of Object.entries(incoming)) {
                if (!drafts[member] || sameAssignment(drafts[member], current[member])) next[member] = assignment;
            }
            return next;
        });
        setSaved({ ...incoming });
        setRevision(incomingRevision);
    }, [session.assignmentRevision, revision]);
    async function save(member: string) {
        const assignment = drafts[member]; if (!assignment || saving || !sameAssignment(baseline[member], saved[member])) return;
        setSaving(member); onPending(true); setErrors(current => ({ ...current, [member]: '' }));
        try {
            const result = await mutate({ type: 'session.assignMember', memberId: member, assignment, expectedRevision: revision });
            setRevision(result.revision); setSaved(current => ({ ...current, [member]: assignment })); setBaseline(current => ({ ...current, [member]: assignment })); onAssigned();
        } catch (cause) {
            const message = (cause as Error).message;
            if (message.includes('assignment-revision-stale')) onAssigned();
            setErrors(current => ({ ...current, [member]: message.includes('assignment-revision-stale') ? 'Assignments changed elsewhere. Review the latest values and save again.' : message }));
        }
        finally { setSaving(''); onPending(false); }
    }
    return <div className="assignment-rows">{Object.keys(session.members ?? {}).map(member => {
        const value = drafts[member]; if (!value) return null;
        const runner = runners.find(item => item.runnerId === value.runnerId);
        const valid = !!runner?.available && runner.models.some(model => model.modelId === value.modelId && (!value.thinking || model.thinkingLevels.includes(value.thinking)));
        const previous = saved[member], changed = !previous || previous.runnerId !== value.runnerId || previous.modelId !== value.modelId || previous.thinking !== value.thinking;
        const role = member === 'lead' ? 'Lead' : member;
        const conflict = !sameAssignment(baseline[member], saved[member]) && !sameAssignment(value, saved[member]);
        return <section className="assignment-row" key={member} aria-label={`${role} assignment`}><h3>{role}</h3><AssignmentFields role={role} runners={runners} value={value} disabled={pending || loading} onChange={next => setDrafts(current => ({ ...current, [member]: next }))}/><button type="button" aria-label={`Save ${role} assignment`} disabled={pending || loading || !valid || !changed || conflict} onClick={() => void save(member)}>{saving === member ? 'Saving…' : 'Save'}</button>{conflict && <div role="alert"><p>Assignment changed elsewhere. Use the latest assignment or keep your draft to overwrite it.</p><button type="button" aria-label={`Use latest for ${role}`} disabled={pending} onClick={() => { setDrafts(current => ({ ...current, [member]: saved[member]! })); setBaseline(current => ({ ...current, [member]: saved[member]! })); setErrors(current => ({ ...current, [member]: '' })); }}>Use latest</button><button type="button" aria-label={`Keep my draft for ${role}`} disabled={pending} onClick={() => { setBaseline(current => ({ ...current, [member]: saved[member]! })); setErrors(current => ({ ...current, [member]: '' })); }}>Keep my draft</button></div>}{errors[member] && <p className="error" role="alert">{errors[member]}</p>}</section>;
    })}</div>;
}

export function WorkspaceDialog({open,session,transitionSource,projectId,onClose,onSaved}:{transitionSource?:Session;projectId?:string;open:boolean;session?:Session;onClose:()=>void;onSaved:(id:string)=>void}) {
 const ref=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null),creationId=useRef('');
 const [runners,setRunners]=useState<RunnerOption[]>([]),[title,setTitle]=useState(''),[drafts,setDrafts]=useState<Record<string,Assignment>>({}),[revision,setRevision]=useState(0);
 const [yolo,setYolo]=useState(false),[ack,setAck]=useState(false);
 const command=useRef<TransitionCommand|undefined>(undefined),sending=useRef(false);
 const [digest,setDigest]=useState(''),[refresh,setRefresh]=useState(0),[retained,setRetained]=useState(false);
 const transitionKey=transitionSource?`transition.${location.host}.${transitionSource.id}`:'';
 const [pending,setPending]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const settle=()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity,transform'});};
  gsap.killTweensOf(node);
  if(open){creationId.current=crypto.randomUUID();returnFocus.current=document.activeElement as HTMLElement;if(!node.open)node.showModal();
   if(media.matches)settle();else{if(!node.style.opacity)gsap.set(node,{opacity:.5,y:6});gsap.to(node,{opacity:1,y:0,duration:.18,ease:'power2.out',overwrite:true,clearProps:'opacity,transform'});}
  }else if(node.open){node.close();returnFocus.current?.focus();settle();}
  const changed=()=>{if(media.matches)settle();};media.addEventListener('change',changed);return()=>{media.removeEventListener('change',changed);gsap.killTweensOf(node);};
 },[open]);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('');setDigest('');command.current=undefined;setRetained(false);setRunners([]);setTitle(transitionSource?transitionSource.title+' · new session':'');setYolo(false);setAck(false);setRevision(session?.contract?.revision??0);setDrafts(session?.contract?.members??{});
  async function discover(){
   const value=await request('GET','/api/models'+(projectId?'?projectId='+encodeURIComponent(projectId):''),undefined,controller.signal);
   const data=value as {runners:RunnerOption[]};
   if(!Array.isArray(data.runners)||data.runners.some(r=>typeof r.runnerId!=='string'||typeof r.label!=='string'||typeof r.available!=='boolean'||!Array.isArray(r.models)||r.models.some(m=>typeof m.modelId!=='string'||typeof m.label!=='string'||!Array.isArray(m.thinkingLevels)||m.thinkingLevels.some(t=>typeof t!=='string'))))throw Error('Invalid model inventory');
   let preview='';
   const saved=transitionSource?load(transitionKey):'';
   if(saved&&transitionSource){const c=transitionCommand(JSON.parse(saved),transitionSource);command.current=c;creationId.current=c.session.id;preview=c.expected_source_digest;}
   else if(transitionSource)preview=transitionPreview(await request('GET',`/api/sessions/${encodeURIComponent(transitionSource.id)}/transition`,undefined,controller.signal),transitionSource.id);
   if(controller.signal.aborted)return;
   setRunners(data.runners);setDigest(preview);
   if(!session){const r=data.runners.find(r=>r.available&&r.models.length);if(r)setDrafts({lead:{runnerId:r.runnerId,modelId:r.models[0].modelId}});}
   if(command.current){const c=command.current;setTitle(c.session.title);setDrafts(c.session.members);setRetained(true);}
  }
  void discover().catch(e=>{if(!controller.signal.aborted)setError(String(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[open,session?.id,transitionSource?.id,projectId,refresh]);

 async function save(member?:string){if(sending.current||pending||(!session&&yolo&&!ack))return;sending.current=true;setPending(true);setError('');try{
  if(session&&member){const result=await request('POST',`/api/sessions/${encodeURIComponent(session.id)}/assignments`,{api:API,memberId:member,assignment:drafts[member],expectedRevision:revision}) as Session;setRevision(result.contract?.revision??revision);onSaved(session.id);}
  else if(transitionSource){
   if(!digest||!transitionSource.project)throw Error('Refresh the historical preview before creating a session.');
   const retrying=!!command.current;
   const c=command.current??transitionCommand({api:API,expected_source_digest:digest,session:{api:API,id:creationId.current,title:title.trim(),project_id:transitionSource.project.id,members:drafts,approvals:'relay'}},transitionSource);
   // Persist before the effect. An uncertain reply retries only this exact identity.
   localStorage.setItem('deck2.'+transitionKey,JSON.stringify(c));command.current=c;setRetained(true);
   try {const created=transitionedSession(await request('POST',`/api/sessions/${encodeURIComponent(transitionSource.id)}/transition`,c),c);persist(transitionKey,'');command.current=undefined;setRetained(false);onSaved(created.id);onClose();}
   catch(e){if(!retrying&&e instanceof HttpError&&e.status>=400&&e.status<500){persist(transitionKey,'');command.current=undefined;setRetained(false);setDigest('');}throw e;}
  }
  else {const id=creationId.current;await request('POST','/api/sessions',{api:API,id,project_id:projectId,title:title.trim(),members:drafts,approvals:yolo?'yolo':'relay'});onSaved(id);onClose();}
 }catch(e){setError(String(e));}finally{sending.current=false;setPending(false);}}
 return <dialog ref={ref} className="workspace-dialog assignments-dialog" aria-labelledby="session-dialog-title" onCancel={e=>{e.preventDefault();if(!pending)onClose();}}><form onSubmit={e=>{e.preventDefault();if(!session)void save();}}><div className="dialog-heading"><h2 id="session-dialog-title">{session?'Session assignments':transitionSource?'Start canonical session':'New session'}</h2><button type="button" className="quiet" aria-label="Close dialog" disabled={pending} onClick={onClose}>✕</button></div>
 {session?<><p className="muted">Changes apply to future work. Existing delegated tasks keep their recorded assignments.</p><p className="muted">Changing the Lead starts a new native context. Your conversation stays here.</p></>:<label>Session name<input required autoFocus disabled={pending||retained} value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label>}
 {loading?<p role="status">Loading available models…</p>:session?<AssignmentRows session={{assignmentRevision:session.contract?.revision??0,members:Object.fromEntries(['lead','investigate','architect','apply-fast','apply-deep','quality','setup'].map(id=>[id,session.contract?.members[id]??{runnerId:'',modelId:''}]))}} runners={runners} pending={pending} loading={loading} onPending={setPending} onAssigned={()=>onSaved(session.id)} mutate={async input=>{const result=await request('POST',`/api/sessions/${encodeURIComponent(session.id)}/assignments`,{api:API,memberId:input.memberId,assignment:input.assignment,expectedRevision:input.expectedRevision}) as Session;return{revision:result.contract!.revision};}}/>:<section><h3>Lead</h3><AssignmentFields runners={runners} value={drafts.lead??{runnerId:'',modelId:''}} onChange={a=>setDrafts({lead:a})} disabled={pending||retained}/></section>}

 {transitionSource&&<p className="muted">Creates a separate session with Ask first permissions and the canonical team assignments. This history stays available. Native context, previous permissions and pending inputs stay here. No message is sent.</p>}
 {!session&&!transitionSource&&<YoloFields enabled={yolo} acknowledged={ack} onEnabled={setYolo} onAcknowledged={setAck} disabled={pending}/>}
 {error&&<p role="alert" className="error">{error}{transitionSource&&!retained&&<button type="button" className="quiet" disabled={pending||loading} onClick={()=>setRefresh(v=>v+1)}>Reload transition preview</button>}</p>}{retained&&<p role="status">A transition identity is retained. Retry to inspect the same new session; edits stay locked until its outcome is known.</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onClose}>{session?'Done':'Cancel'}</button>{!session&&<button disabled={pending||loading||!title.trim()||!drafts.lead?.modelId||(!retained&&!runners.some(r=>r.available&&r.runnerId===drafts.lead?.runnerId&&r.models.some(m=>m.modelId===drafts.lead?.modelId&&(!drafts.lead.thinking||m.thinkingLevels.includes(drafts.lead.thinking)))))||!!transitionSource&&!digest||(yolo&&!ack)}>{pending?'Creating session…':retained?'Retry transition':transitionSource?'Create canonical session':'Create session'}</button>}</div></form></dialog>;
}
