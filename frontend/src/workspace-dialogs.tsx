import {YoloFields} from './session-approvals';
// AssignmentFields is reused from Deck1 workspace-dialogs.tsx; transport below
// adapts the original creation/revision contract to the Rust host.
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
import {API,request,load,save as persist,HttpError,sessionContract,workspace,type Session,type SessionContract,type MemberAssignment as Assignment} from './api';
import {transitionPreview,transitionCommand,transitionedSession,type TransitionCommand} from './session-transition';
import {lastAssignmentsKey,mergeAssignments,restoreAssignments} from './last-assignments';
interface RunnerOption {runnerId:string;label:string;available:boolean;reasonCode?:string;models:{modelId:string;label:string;thinkingLevels:string[]}[]}
export function AssignmentFields({ runners, value, onChange, role, disabled = false }: { runners: RunnerOption[]; value: Assignment; onChange: (assignment: Assignment) => void; role?: string; disabled?: boolean }) {
    const runner = runners.find(item => item.runnerId === value.runnerId), model = runner?.models.find(item => item.modelId === value.modelId);
    return <div className="assignment-fields"><label>Runner<select aria-label={role ? `Runner for ${role}` : "Runner"} disabled={disabled} required value={value.runnerId} onChange={event => {
        const next = runners.find(item => item.runnerId === event.target.value);
        onChange({ runnerId: event.target.value, modelId: next?.models[0]?.modelId ?? '' });
    }}><option value="" disabled>Choose a runner</option>{runners.map(item => <option key={item.runnerId} value={item.runnerId} disabled={!item.available || !item.models.length}>
        {item.label}{!item.available ? (item.reasonCode ? ` · ${item.reasonCode}` : ' (unavailable)') : ''}
    </option>)}</select></label>
        <label>Model<select aria-label={role ? `Model for ${role}` : "Model"} required value={value.modelId} disabled={disabled || !runner?.available} onChange={event => onChange({ runnerId: value.runnerId, modelId: event.target.value })}><option value="" disabled>Choose a model</option>{value.modelId && !model && <option value={value.modelId} disabled>{value.modelId} (unavailable)</option>}{runner?.models.map(item => <option key={item.modelId} value={item.modelId}>{item.label}</option>)}</select></label>
        {model && (!!model.thinkingLevels.length || !!value.thinking) && <label className="assignment-reasoning">Reasoning level<select aria-label={role ? `Reasoning level for ${role}` : "Reasoning level"} disabled={disabled} value={value.thinking ?? ''} onChange={event => onChange({ ...value, thinking: event.target.value || undefined })}><option value="">Runner default</option>{value.thinking && !model.thinkingLevels.includes(value.thinking) && <option value={value.thinking} disabled>{value.thinking} (unavailable)</option>}{model.thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
        {runner && !runner.available && <p className="muted">{runner.reasonCode ?? 'This runner is currently unavailable.'}</p>}
    </div>;
}

const memberIds = ['lead', 'investigate', 'architect', 'apply-fast', 'apply-deep', 'quality', 'setup'];
const unassigned: Assignment = {runnerId: '', modelId: ''};
const sameAssignment = (a: Assignment, b: Assignment) => a.runnerId === b.runnerId && a.modelId === b.modelId && (a.thinking || '') === (b.thinking || '');

type AssignmentEdit = {baseline: Assignment; value: Assignment};

function AssignmentRows({ session, runners, onAssigned, onPending, onClose, pending, loading }: {
    session: Session; runners: RunnerOption[]; onAssigned: () => void; onPending: (pending: boolean) => void;
    onClose: () => void; pending: boolean; loading: boolean;
}) {
    const [saved, setSaved] = useState(session.contract);
    const [edits, setEdits] = useState<Record<string, AssignmentEdit>>({});
    const [failure, setFailure] = useState<{member: string; message: string}>();
    const saving = useRef(false);

    const revision = saved?.revision ?? 0;
    if (!pending && session.contract && session.contract.revision > revision) {
        reconcile(session.contract);
    }
    const current = (member: string) => saved?.members[member] ?? unassigned;
    const dirty = memberIds.filter(member => edits[member] && !sameAssignment(edits[member].value, current(member)));
    const conflicting = (member: string) => !sameAssignment(edits[member].baseline, current(member));
    const valid = ({runnerId, modelId, thinking}: Assignment) => runners.some(runner =>
        runner.available && runner.runnerId === runnerId &&
        runner.models.some(model => model.modelId === modelId && (!thinking || model.thinkingLevels.includes(thinking))));
    const canSave = !pending && !loading && dirty.length > 0 &&
        dirty.every(member => !conflicting(member) && valid(edits[member].value));

    function reconcile(latest: SessionContract) {
        setSaved(latest);
        setEdits(previous => Object.fromEntries(Object.entries(previous).filter(([member, edit]) =>
            !sameAssignment(edit.value, latest.members[member] ?? unassigned))));
    }

    function edit(member: string, value: Assignment, baseline: Assignment) {
        setEdits(previous => {
            const next = {...previous};
            if (sameAssignment(value, current(member))) delete next[member];
            else next[member] = {baseline, value};
            return next;
        });
        if (failure?.member === member) setFailure(undefined);
    }

    function rememberAssignment(contract: SessionContract, member: string) {
        const assignment = contract.members[member];
        if (!assignment) return;
        try { persist(lastAssignmentsKey, mergeAssignments(load(lastAssignmentsKey), member, assignment)); } catch { /* best effort */ }
    }

    async function save() {
        if (saving.current || !canSave) return;
        saving.current = true;
        onPending(true);
        setFailure(undefined);
        let expectedRevision = revision;
        let committed = false;
        try {
            for (const member of dirty) {
                try {
                    const result = await request('POST', `/api/sessions/${encodeURIComponent(session.id)}/assignments`, {
                        api: API, memberId: member, assignment: edits[member].value, expectedRevision,
                    }) as Session;
                    const confirmed = sessionContract(result.contract);
                    if (result.id !== session.id || !confirmed || confirmed.revision !== expectedRevision + 1) {
                        throw Error('Assignment save could not be confirmed.');
                    }
                    reconcile(confirmed);
                    expectedRevision = confirmed.revision;
                    committed = true;
                    rememberAssignment(confirmed, member);
                } catch (cause) {
                    const message = String(cause instanceof Error ? cause.message : cause);
                    const stale = message.includes('assignment-revision-stale');
                    // An interrupted response can hide a committed write. Inspect the
                    // current revision before deciding which drafts still need saving.
                    if (stale || !(cause instanceof HttpError) || cause.status >= 500) {
                        try {
                            const latest = workspace(await request('GET', '/api/workspace')).sessions.find(item => item.id === session.id)?.contract;
                            if (!latest || latest.revision < expectedRevision) throw Error('Assignment revision unavailable.');
                            reconcile(latest);
                            committed ||= latest.revision > expectedRevision;
                            if (sameAssignment(edits[member].value, latest.members[member] ?? unassigned)) {
                                if (latest.revision > expectedRevision) rememberAssignment(latest, member);
                            } else {
                                setFailure({member, message: stale ? 'Assignments changed elsewhere. Review the latest assignments before saving again.' : message});
                            }
                        } catch {
                            setFailure({member, message: 'Could not refresh assignments. Your draft is still available.'});
                        }
                    } else {
                        setFailure({member, message: member === 'lead' && cause.status === 409 && message.endsWith(': session-busy')
                            ? 'Lead assignment changes require queued, running, and unresolved work to settle. Your draft is still available.'
                            : message});
                    }
                    break;
                }
            }
        } finally {
            if (committed) onAssigned();
            saving.current = false;
            onPending(false);
        }
    }

    return <>
        {loading ? <p role="status">Loading available models…</p> : <div className="assignment-rows">{memberIds.map(member => {
            const latest = current(member);
            const draft = edits[member];
            const changed = !!draft && !sameAssignment(draft.value, latest);
            const role = member === 'lead' ? 'Lead' : member;
            const conflict = changed && conflicting(member);
            return <section className="assignment-row" key={member} aria-label={`${role} assignment`}>
                <h3>{role}</h3>
                <AssignmentFields role={role} runners={runners} value={changed ? draft.value : latest} disabled={pending}
                    onChange={next => edit(member, next, changed ? draft.baseline : latest)}/>
                {conflict && <div className="assignment-feedback">
                    <p role="alert">Assignment changed elsewhere. Use the latest assignment or keep your draft to overwrite it.</p>
                    <button type="button" aria-label={`Use latest for ${role}`} disabled={pending} onClick={() => edit(member, latest, latest)}>Use latest</button>
                    <button type="button" aria-label={`Keep my draft for ${role}`} disabled={pending} onClick={() => edit(member, draft.value, latest)}>Keep my draft</button>
                </div>}
                {failure?.member === member && changed && <p className="assignment-feedback error" role="alert">{failure.message}</p>}
            </section>;
        })}</div>}
        <div className="dialog-actions">
            <button type="button" className="quiet" disabled={pending} onClick={onClose}>Done</button>
            <button type="button" disabled={!canSave} onClick={() => void save()}>{pending ? 'Saving…' : 'Save'}</button>
        </div>
    </>;
}

export function WorkspaceDialog({open,session,transitionSource,projectId,onClose,onSaved}:{transitionSource?:Session;projectId?:string;open:boolean;session?:Session;onClose:()=>void;onSaved:(id:string)=>void}) {
 const ref=useRef<HTMLDialogElement>(null),returnFocus=useRef<HTMLElement|null>(null),creationId=useRef('');
 const [runners,setRunners]=useState<RunnerOption[]>([]),[title,setTitle]=useState(''),[drafts,setDrafts]=useState<Record<string,Assignment>>({});
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
 useEffect(()=>{if(!open)return;const controller=new AbortController();setLoading(true);setError('');setDigest('');command.current=undefined;setRetained(false);setRunners([]);setTitle(transitionSource?transitionSource.title+' · new session':'');setYolo(false);setAck(false);setDrafts(session?.contract?.members??{});
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
   // New sessions start from the most recent assignments still offered.
   if(!session){const last=restoreAssignments(load(lastAssignmentsKey),data.runners);const r=data.runners.find(r=>r.available&&r.models.length);if(last)setDrafts(last);else if(r)setDrafts({lead:{runnerId:r.runnerId,modelId:r.models[0].modelId}});}
   if(command.current){const c=command.current;setTitle(c.session.title);setDrafts(c.session.members);setRetained(true);}
  }
  void discover().catch(e=>{if(!controller.signal.aborted)setError(String(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[open,session?.id,transitionSource?.id,projectId,refresh]);

 async function save(){if(sending.current||pending||(!session&&yolo&&!ack))return;sending.current=true;setPending(true);setError('');try{
  if(transitionSource){
   if(!digest||!transitionSource.project)throw Error('Refresh the historical preview before creating a session.');
   const retrying=!!command.current;
   const c=command.current??transitionCommand({api:API,expected_source_digest:digest,session:{api:API,id:creationId.current,title:title.trim(),project_id:transitionSource.project.id,members:drafts,approvals:'relay'}},transitionSource);
   // Persist before the effect. An uncertain reply retries only this exact identity.
   localStorage.setItem('deck2.'+transitionKey,JSON.stringify(c));command.current=c;setRetained(true);
   try {const created=transitionedSession(await request('POST',`/api/sessions/${encodeURIComponent(transitionSource.id)}/transition`,c),c);persist(transitionKey,'');command.current=undefined;setRetained(false);onSaved(created.id);onClose();}
   catch(e){if(!retrying&&e instanceof HttpError&&e.status>=400&&e.status<500){persist(transitionKey,'');command.current=undefined;setRetained(false);setDigest('');}throw e;}
  }
  else {const id=creationId.current;await request('POST','/api/sessions',{api:API,id,project_id:projectId,title:title.trim(),members:drafts,approvals:yolo?'yolo':'relay'});try{persist(lastAssignmentsKey,JSON.stringify(drafts));}catch{/* best effort */}onSaved(id);onClose();}
 }catch(e){setError(String(e));}finally{sending.current=false;setPending(false);}}
 return <dialog ref={ref} className="workspace-dialog assignments-dialog" aria-labelledby="session-dialog-title" onCancel={e=>{e.preventDefault();if(!pending)onClose();}}><form onSubmit={e=>{e.preventDefault();if(!session)void save();}}><div className="dialog-heading"><h2 id="session-dialog-title">{session?'Session assignments':transitionSource?'Start canonical session':'New session'}</h2><button type="button" className="quiet" aria-label="Close dialog" disabled={pending} onClick={onClose}>✕</button></div>
 {session?<><p className="muted">Changes apply to future work. Existing delegated tasks keep their recorded assignments.</p><p className="muted">Changing the Lead starts a new native context. Your conversation stays here.</p></>:<label>Session name<input required autoFocus disabled={pending||retained} value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label>}
 {session ? <AssignmentRows key={session.id} session={session} runners={runners} pending={pending}
    loading={loading} onPending={setPending} onAssigned={()=>onSaved(session.id)} onClose={onClose}/>
 : loading?<p role="status">Loading available models…</p>:<section><h3>Lead</h3><AssignmentFields runners={runners} value={drafts.lead??{runnerId:'',modelId:''}} onChange={a=>setDrafts({lead:a})} disabled={pending||retained}/></section>}

 {transitionSource&&<p className="muted">Creates a separate session with Ask first permissions and the canonical team assignments. This history stays available. Native context, previous permissions and pending inputs stay here. No message is sent.</p>}
 {!session&&!transitionSource&&<YoloFields enabled={yolo} acknowledged={ack} onEnabled={setYolo} onAcknowledged={setAck} disabled={pending}/>}
 {error&&<p role="alert" className="error">{error}{transitionSource&&!retained&&<button type="button" className="quiet" disabled={pending||loading} onClick={()=>setRefresh(v=>v+1)}>Reload transition preview</button>}</p>}{retained&&<p role="status">A transition identity is retained. Retry to inspect the same new session; edits stay locked until its outcome is known.</p>}{!session&&<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onClose}>Cancel</button><button disabled={pending||loading||!title.trim()||!drafts.lead?.modelId||(!retained&&!runners.some(r=>r.available&&r.runnerId===drafts.lead?.runnerId&&r.models.some(m=>m.modelId===drafts.lead?.modelId&&(!drafts.lead.thinking||m.thinkingLevels.includes(drafts.lead.thinking)))))||!!transitionSource&&!digest||(yolo&&!ack)}>{pending?'Creating session…':retained?'Retry transition':transitionSource?'Create canonical session':'Create session'}</button></div>}</form></dialog>;
}
