import React, { useEffect, useId, useRef, useState } from 'react';
import type { Api } from './workspace';
import { SessionCreateButton, YoloFields } from './session-approvals';
import { DirectoryInput } from './directory-input';
import { sessionIdOf, sessionName, type Assignment, type Project, type RunnerOption, type WorkspaceMutation, type WorkspaceSession } from './workspace-types';

export type WorkspaceDialogKind = 'project' | 'session' | 'assignments' | 'rename-project' | 'rename-session';
export function AssignmentFields({ runners, value, onChange }: { runners: RunnerOption[]; value: Assignment; onChange: (assignment: Assignment) => void }) {
    const runner = runners.find(item => item.runnerId === value.runnerId), model = runner?.models.find(item => item.modelId === value.modelId);
    return <div className="assignment-fields"><label>Runner<select aria-label="Runner" required value={value.runnerId} onChange={event => {
        const next = runners.find(item => item.runnerId === event.target.value);
        onChange({ runnerId: event.target.value, modelId: next?.models[0]?.modelId ?? '' });
    }}><option value="" disabled>Choose a runner</option>{runners.map(item => <option key={item.runnerId} value={item.runnerId} disabled={!item.available || !item.models.length}>{item.label}{!item.available ? ' (unavailable)' : ''}</option>)}</select></label>
        <label>Model<select aria-label="Model" required value={value.modelId} disabled={!runner?.available} onChange={event => onChange({ runnerId: value.runnerId, modelId: event.target.value })}><option value="" disabled>Choose a model</option>{value.modelId && !model && <option value={value.modelId} disabled>{value.modelId} (unavailable)</option>}{runner?.models.map(item => <option key={item.modelId} value={item.modelId}>{item.label}</option>)}</select></label>
        {!!model?.thinkingLevels.length && <label>Reasoning level<select aria-label="Reasoning level" value={value.thinking ?? ''} onChange={event => onChange({ ...value, thinking: event.target.value || undefined })}><option value="">Runner default</option>{model.thinkingLevels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
        {runner && !runner.available && <p className="muted">{runner.reasonCode ?? 'This runner is currently unavailable.'}</p>}
    </div>;
}

export function WorkspaceDialog({ kind, project, session, api, mutate, returnFocus, onClose, onProject, onCreated, onAssigned, onRenamed }: {
    kind?: WorkspaceDialogKind; project?: Project; session?: WorkspaceSession; api: Api; mutate: WorkspaceMutation;
    returnFocus?: React.RefObject<HTMLElement | null>;
    onClose: () => void; onProject: (project: Project) => void; onCreated: (id: string) => void; onAssigned: () => void; onRenamed?: (id: string, title: string) => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null), projectName = useRef<HTMLInputElement>(null), id = useId();
    const [path, setPath] = useState(''), [name, setName] = useState(''), [title, setTitle] = useState(''), [member, setMember] = useState('lead');
    const [assignment, setAssignment] = useState<Assignment>({ runnerId: '', modelId: '' }), [runners, setRunners] = useState<RunnerOption[]>([]);
    const [yolo,setYolo]=useState(false), [acknowledged,setAcknowledged]=useState(false);
    const [pending, setPending] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
    useEffect(() => {
        if (!kind) { dialog.current?.close(); if (returnFocus?.current?.isConnected) returnFocus.current.focus(); return; }
        setError(''); setLoading(false); setYolo(false); setAcknowledged(false); setName(kind === 'rename-project' ? project?.name ?? '' : kind === 'rename-session' && session ? sessionName(session) : ''); setTitle(''); setMember('lead'); setPath(''); setRunners([]);
        setAssignment(session?.members?.lead ?? { runnerId: '', modelId: '' });
        setRevision(session?.assignmentRevision ?? 0);
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
    }, [kind, project?.projectId]);
    useEffect(() => { if (kind === 'assignments') setAssignment(session?.members?.[member] ?? { runnerId: '', modelId: '' }); }, [kind, member]);
    const selectedRunner = runners.find(item => item.runnerId === assignment.runnerId), validAssignment = !!selectedRunner?.available && !!selectedRunner.models.find(model => model.modelId === assignment.modelId);
    return <dialog ref={dialog} className="workspace-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}><form onSubmit={async event => {
        event.preventDefault(); if (pending || !kind || (kind==='session'&&yolo&&!acknowledged)) return; setPending(true); setError('');
        try {
            if (kind === 'project') { const result = await mutate({ type: 'project.register', path: path.trim(), ...(name.trim() ? { name: name.trim() } : {}) }, undefined); onProject(result.project); }
            else if (kind === 'rename-project' && project) { const result = await mutate({ type: 'project.rename', projectId: project.projectId, name: name.trim() }, undefined); onProject(result.project); }
            else if (kind === 'rename-session' && session) { const result = await mutate({ type: 'session.rename', title: name.trim() }, sessionIdOf(session)); onRenamed?.(sessionIdOf(session), result.title); }
            else if (kind === 'session' && project) { const result = await mutate({ type: 'session.create', approvals: yolo?'yolo':'relay', projectId: project.projectId, title: title.trim(), members: { lead: assignment } }, undefined); onCreated(result.sessionId); }
            else if (kind === 'assignments' && session) { await mutate({ type: 'session.assignMember', memberId: member, assignment, expectedRevision: revision }, session.sessionId ?? session.id); onAssigned(); }
            onClose();
        } catch (cause) { setError((cause as Error).message); }
        finally { setPending(false); }
    }}><div className="dialog-heading"><h2 id={`${id}-title`}>{kind === 'project' ? 'Add project' : kind === 'rename-project' ? 'Rename project' : kind === 'rename-session' ? 'Rename session' : kind === 'session' ? 'New session' : 'Session assignments'}</h2><button type="button" className="quiet" aria-label="Close dialog" disabled={pending} onClick={onClose}>✕</button></div>
        {kind === 'rename-project' || kind === 'rename-session' ? <>{kind === 'rename-project' && <p className="muted">{project?.path}</p>}<label>{kind === 'rename-session' ? 'Session name' : 'Project name'}<input ref={projectName} required value={name} onChange={event => setName(event.target.value)} maxLength={160} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}/></label></> : kind === 'project' ? <><DirectoryInput value={path} onChange={setPath} api={api} disabled={pending}/><label>Project name (optional)<input value={name} onChange={event => setName(event.target.value)} maxLength={160}/></label></> : <>
            {kind === 'session' ? <><p className="muted">{project?.name}<small className="dialog-project-path">{project?.path}</small></p><label>Session name<input required value={title} onChange={event => setTitle(event.target.value)} maxLength={160} autoFocus/></label><h3>Lead</h3></> : <><label>Member<select aria-label="Member" value={member} onChange={event => setMember(event.target.value)}>{Object.keys(session?.members ?? { lead: assignment }).map(item => <option key={item} value={item}>{item === 'lead' ? 'Lead' : item}</option>)}</select></label><p className="muted">Changes apply to future work. Existing delegated tasks keep their recorded assignments.</p>{member === 'lead' && <p className="muted">Changing the Lead starts a new native context with a limited handoff. Your conversation stays here.</p>}</>}
            {loading ? <p role="status">Loading available models…</p> : <AssignmentFields runners={runners} value={assignment} onChange={setAssignment}/>}
        </>}
        {kind==='session'&&<YoloFields enabled={yolo} acknowledged={acknowledged} onEnabled={setYolo} onAcknowledged={setAcknowledged} disabled={pending}/>}
        {error && <p id={`${id}-error`} className="error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onClose}>Cancel</button>{kind==='session'?<SessionCreateButton yolo={yolo} acknowledged={acknowledged} pending={pending} disabled={loading||!validAssignment}/>:<button disabled={pending || loading || (kind === 'rename-project' || kind === 'rename-session' ? !name.trim() : kind !== 'project' && !validAssignment)}>{pending ? 'Saving…' : kind === 'project' ? 'Add project' : kind === 'rename-project' || kind === 'rename-session' ? 'Save name' : 'Save assignment'}</button>}</div>
    </form></dialog>;
}
