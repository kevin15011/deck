import {ProjectTrustSettings} from './project-trust-settings';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { Api } from './workspace';
import { SessionCreateButton, YoloFields } from './session-approvals';
import { DirectoryInput } from './directory-input';
import { sessionIdOf, sessionName, type Assignment, type Project, type RunnerOption, type WorkspaceMutation, type WorkspaceSession } from './workspace-types';

export type WorkspaceDialogKind = 'project' | 'session' | 'assignments' | 'rename-project' | 'rename-session';
export function AssignmentFields({ runners, value, onChange, role, disabled = false }: { runners: RunnerOption[]; value: Assignment; onChange: (assignment: Assignment) => void; role?: string; disabled?: boolean }) {
    const runner = runners.find(item => item.runnerId === value.runnerId), model = runner?.models.find(item => item.modelId === value.modelId);
    return <div className="assignment-fields"><label>Runner<select aria-label={role ? `Runner for ${role}` : "Runner"} disabled={disabled} required value={value.runnerId} onChange={event => {
        const next = runners.find(item => item.runnerId === event.target.value);
        onChange({ runnerId: event.target.value, modelId: next?.models[0]?.modelId ?? '' });
    }}><option value="" disabled>Choose a runner</option>{runners.map(item => <option key={item.runnerId} value={item.runnerId} disabled={!item.available || !item.models.length}>{item.label}{!item.available ? ' (unavailable)' : ''}</option>)}</select></label>
        <label>Model<select aria-label={role ? `Model for ${role}` : "Model"} required value={value.modelId} disabled={disabled || !runner?.available} onChange={event => onChange({ runnerId: value.runnerId, modelId: event.target.value })}><option value="" disabled>Choose a model</option>{value.modelId && !model && <option value={value.modelId} disabled>{value.modelId} (unavailable)</option>}{runner?.models.map(item => <option key={item.modelId} value={item.modelId}>{item.label}</option>)}</select></label>
        {!!model?.thinkingLevels.length && <label>Reasoning level<select aria-label={role ? `Reasoning level for ${role}` : "Reasoning level"} disabled={disabled} value={value.thinking ?? ''} onChange={event => onChange({ ...value, thinking: event.target.value || undefined })}><option value="">Runner default</option>{model.thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
        {runner && !runner.available && <p className="muted">{runner.reasonCode ?? 'This runner is currently unavailable.'}</p>}
    </div>;
}

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
            const result = await mutate({ type: 'session.assignMember', memberId: member, assignment, expectedRevision: revision }, sessionIdOf(session));
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
        const valid = !!runner?.available && runner.models.some(model => model.modelId === value.modelId);
        const previous = saved[member], changed = !previous || previous.runnerId !== value.runnerId || previous.modelId !== value.modelId || previous.thinking !== value.thinking;
        const role = member === 'lead' ? 'Lead' : member;
        const conflict = !sameAssignment(baseline[member], saved[member]) && !sameAssignment(value, saved[member]);
        return <section className="assignment-row" key={member} aria-label={`${role} assignment`}><h3>{role}</h3><AssignmentFields role={role} runners={runners} value={value} disabled={pending || loading} onChange={next => setDrafts(current => ({ ...current, [member]: next }))}/><button type="button" aria-label={`Save ${role} assignment`} disabled={pending || loading || !valid || !changed || conflict} onClick={() => void save(member)}>{saving === member ? 'Saving…' : 'Save'}</button>{conflict && <div role="alert"><p>Assignment changed elsewhere. Use the latest assignment or keep your draft to overwrite it.</p><button type="button" aria-label={`Use latest for ${role}`} disabled={pending} onClick={() => { setDrafts(current => ({ ...current, [member]: saved[member]! })); setBaseline(current => ({ ...current, [member]: saved[member]! })); setErrors(current => ({ ...current, [member]: '' })); }}>Use latest</button><button type="button" aria-label={`Keep my draft for ${role}`} disabled={pending} onClick={() => { setBaseline(current => ({ ...current, [member]: saved[member]! })); setErrors(current => ({ ...current, [member]: '' })); }}>Keep my draft</button></div>}{errors[member] && <p className="error" role="alert">{errors[member]}</p>}</section>;
    })}</div>;
}

export function WorkspaceDialog({ kind, project, session, api, mutate, returnFocus, onClose, onProject, onCreated, onAssigned, onRenamed, onTrustChanged }: {
    kind?: WorkspaceDialogKind; project?: Project; session?: WorkspaceSession; api: Api; mutate: WorkspaceMutation;
    onTrustChanged?: () => void;
    returnFocus?: React.RefObject<HTMLElement | null>;
    onClose: () => void; onProject: (project: Project) => void; onCreated: (id: string) => void; onAssigned: () => void; onRenamed?: (id: string, title: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), projectName = useRef<HTMLInputElement>(null), id = useId();
    const [path, setPath] = useState(''), [name, setName] = useState(''), [title, setTitle] = useState('');
    const [assignment, setAssignment] = useState<Assignment>({ runnerId: '', modelId: '' }), [runners, setRunners] = useState<RunnerOption[]>([]);
    const [yolo,setYolo]=useState(false), [acknowledged,setAcknowledged]=useState(false);
    const [pending, setPending] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [trustRevision,setTrustRevision] = useState(0);
    useEffect(() => {
        if (!kind) { dialog.current?.close(); if (returnFocus?.current?.isConnected) returnFocus.current.focus(); return; }
        setError(''); setLoading(false); setYolo(false); setAcknowledged(false); setName(kind === 'rename-project' ? project?.name ?? '' : kind === 'rename-session' && session ? sessionName(session) : ''); setTitle(''); setPath(''); setRunners([]);
        setAssignment(session?.members?.lead ?? { runnerId: '', modelId: '' });
        dialog.current?.showModal();
        if (kind === 'rename-project' || kind === 'rename-session') projectName.current?.focus();
    }, [kind]);
    useEffect(() => {
        if (!kind || (kind === 'project' || kind === 'rename-project' || kind === 'rename-session') || !project) return;
        const controller = new AbortController(); setLoading(true);
        void api(`/api/models?${new URLSearchParams({ projectId: project.projectId })}`, { signal: controller.signal }).then(reply => {
            if (controller.signal.aborted) return;
            const available = reply.data.runners as RunnerOption[];
            setRunners(available);
            if (kind === 'session') setAssignment(previous => {
                if (previous.runnerId && available.some(runner => runner.runnerId === previous.runnerId && runner.available && runner.models.some(model => model.modelId === previous.modelId))) return previous;
                const runner = available.find(item => item.available && item.models.length);
                return { runnerId: runner?.runnerId ?? '', modelId: runner?.models[0]?.modelId ?? '' };
            });
        }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [kind, project?.projectId, trustRevision]);
    const selectedRunner = runners.find(item => item.runnerId === assignment.runnerId), validAssignment = !!selectedRunner?.available && !!selectedRunner.models.find(model => model.modelId === assignment.modelId);
    return <dialog ref={dialog} className={`workspace-dialog${kind === 'assignments' ? ' assignments-dialog' : ''}`} aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}><form onSubmit={async event => {
        event.preventDefault(); if (kind === 'assignments' || pending || !kind || (kind==='session'&&yolo&&!acknowledged)) return; setPending(true); setError('');
        try {
            if (kind === 'project') { const result = await mutate({ type: 'project.register', path: path.trim(), ...(name.trim() ? { name: name.trim() } : {}) }, undefined); onProject(result.project); }
            else if (kind === 'rename-project' && project) { const result = await mutate({ type: 'project.rename', projectId: project.projectId, name: name.trim() }, undefined); onProject(result.project); }
            else if (kind === 'rename-session' && session) { const result = await mutate({ type: 'session.rename', title: name.trim() }, sessionIdOf(session)); onRenamed?.(sessionIdOf(session), result.title); }
            else if (kind === 'session' && project) { const result = await mutate({ type: 'session.create', approvals: yolo?'yolo':'relay', projectId: project.projectId, title: title.trim(), members: { lead: assignment } }, undefined); onCreated(result.sessionId); }
            onClose();
        } catch (cause) { setError((cause as Error).message); }
        finally { setPending(false); }
    }}><div className="dialog-heading"><h2 id={`${id}-title`}>{kind === 'project' ? 'Add project' : kind === 'rename-project' ? 'Rename project' : kind === 'rename-session' ? 'Rename session' : kind === 'session' ? 'New session' : 'Session assignments'}</h2><button type="button" className="quiet" aria-label="Close dialog" disabled={pending} onClick={onClose}>✕</button></div>
        {(kind === 'session' || kind === 'assignments') && project && <ProjectTrustSettings key={`${kind}:${project.projectId}`} project={project} api={api} mutate={mutate} pending={pending} onPending={setPending} onChanged={()=>{setTrustRevision(value=>value+1);onTrustChanged?.();}}/>}
        {kind === 'rename-project' || kind === 'rename-session' ? <>{kind === 'rename-project' && <p className="muted">{project?.path}</p>}<label>{kind === 'rename-session' ? 'Session name' : 'Project name'}<input ref={projectName} required value={name} onChange={event => setName(event.target.value)} maxLength={160} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}/></label></> : kind === 'project' ? <><DirectoryInput value={path} onChange={setPath} api={api} disabled={pending}/><label>Project name (optional)<input value={name} onChange={event => setName(event.target.value)} maxLength={160}/></label></> : <>
            {kind === 'session' ? <><p className="muted">{project?.name}<small className="dialog-project-path">{project?.path}</small></p><label>Session name<input required value={title} onChange={event => setTitle(event.target.value)} maxLength={160} autoFocus/></label><h3>Lead</h3></> : <><p className="muted">Changes apply to future work. Existing delegated tasks keep their recorded assignments.</p><p className="muted">Changing the Lead starts a new native context with a limited handoff. Your conversation stays here.</p></>}
            {loading && <p role="status">Loading available models…</p>}{kind === 'assignments' && session ? <AssignmentRows key={sessionIdOf(session)} session={session} runners={runners} mutate={mutate} onAssigned={onAssigned} onPending={setPending} pending={pending} loading={loading}/> : !loading && <AssignmentFields runners={runners} value={assignment} onChange={setAssignment}/>}

        </>}
        {kind==='session'&&<YoloFields enabled={yolo} acknowledged={acknowledged} onEnabled={setYolo} onAcknowledged={setAcknowledged} disabled={pending}/>}
        {error && <p id={`${id}-error`} className="error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onClose}>Cancel</button>{kind === 'assignments' ? null : kind==='session'?<SessionCreateButton yolo={yolo} acknowledged={acknowledged} pending={pending} disabled={loading||!validAssignment}/>:<button disabled={pending || loading || (kind === 'rename-project' || kind === 'rename-session' ? !name.trim() : kind !== 'project' && !validAssignment)}>{pending ? 'Saving…' : kind === 'project' ? 'Add project' : kind === 'rename-project' || kind === 'rename-session' ? 'Save name' : 'Save assignment'}</button>}</div>
    </form></dialog>;
}
