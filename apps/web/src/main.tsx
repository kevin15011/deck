import { DraftBoundary, DraftStore } from './draft-boundary';
import { useChatHistory } from './chat-history';
import { Approvals, AutoApprovalMessage } from './approvals';
import { QuestionAnswerMessage } from './question-answer';
import { QuestionDock, type Question, type QuestionDrafts } from './questions';
import { Avatar, agentProfile } from './subagent-parts';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { sessionGrants, conversationEvents, emptyState, pairingToken, type ViewState } from './state';
import { Markdown } from './markdown';
import { MessageInput } from './message-input';
import { installMobileViewport } from './mobile-viewport';
import { leadProgress, LeadProgress, type PendingPrompt } from './lead-progress';
import { Activity, OpenSpec, Subagents, Tabs, type WorkspaceTab } from './workspace';
import { NavigationIcon, ProjectNavigation, type ProjectHistory } from './project-navigation';
import { WorkspaceDialog, type WorkspaceDialogKind } from './workspace-dialogs';
import { SessionControls, useSessionPreparation } from './session-controls';
import { sessionIdOf, sessionName, type Project, type WorkspaceSession } from './workspace-types';
import { attachmentURL, clipboardImages, imageDisplayName, imageMimeType, insertPastedText, ImageDraftStrip, ImagePicker, ImagePreview, ImageReferences, publicImages, useImageDrafts, type ImageAttachment, type PreviewImage } from './image-attachments';
import { PromptQueue, usePromptInbox } from './prompt-queue';
import { leadActivityFromEvents, useReadMarkers, VisibleReply } from './status-indicator';
import { installMotion } from './motion-dom';
import { DeckBrand } from './deck-logo';
import { readTheme, persistTheme, type Theme } from './theme';
import { ThemeSelect } from './theme-select';
import './style.css';
installMotion();
const initialToken = pairingToken(window.location, window.history);
const initialTheme = readTheme();
document.documentElement.dataset.theme = initialTheme;
export function App() {
    useLayoutEffect(() => installMobileViewport(document.documentElement), []);
    const { markers: readMarkers, acknowledge } = useReadMarkers();
    const [hydratedSession, setHydratedSession] = useState('');
    const historiesRef = useRef<Record<string, ProjectHistory>>({});
    const [theme, setTheme] = useState<Theme>(initialTheme);
    useLayoutEffect(() => {
        persistTheme(theme);
    }, [theme]);
    const [paired, setPaired] = useState(false), [selected, setSelected] = useState(''), [view, setView] = useState<ViewState>(emptyState), [error, setError] = useState(''), [connection, setConnection] = useState('Connecting'), [busy, setBusy] = useState(false), [code, setCode] = useState(''), [connecting, setConnecting] = useState(true);
    const [closingSession, setClosingSession] = useState('');
    const [actionSession, setActionSession] = useState<WorkspaceSession>();
    const removedSessions = useRef(new Set<string>()), removingSessions = useRef(new Set<string>()), sessionMutation = useRef(0);
    const [projects, setProjects] = useState<Project[]>([]), [projectId, setProjectId] = useState(''), [dialogKind, setDialogKind] = useState<WorkspaceDialogKind>(), [reconnectRevision, setReconnectRevision] = useState(0);
    const activeProjectId = useRef(projectId), projectsRef = useRef(projects); activeProjectId.current = projectId; projectsRef.current = projects;
    const [histories, setHistories] = useState<Record<string, ProjectHistory>>({}), [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set()), [creationProject, setCreationProject] = useState<Project>();
    const expandedProjectIds = useRef(new Set<string>()), historyRequests = useRef(new Map<string, number>()), loadingProjects = useRef(new Set<string>());
    historiesRef.current = histories;
    const sessions = histories[projectId]?.sessions ?? [];
    const catalogRequest = useRef(0), sessionMetadata = useRef(new Map<string, WorkspaceSession>());
    const commandInFlight = useRef(false);
    const selectedSession = useRef(selected);
    selectedSession.current = selected;
    const [previewImage,setPreviewImage]=useState<PreviewImage>();
    const [submittedImages,setSubmittedImages]=useState<Record<string,string[]>>({});
    const [openQuestion,setOpenQuestion]=useState('');
    const [questionDrafts,setQuestionDrafts]=useState<Record<string,QuestionDrafts>>(Object.create(null));
    const [queueErrors,setQueueErrors]=useState<Record<string,string>>({});
    const [pendingPrompts, setPendingPrompts] = useState<Record<string, PendingPrompt>>({});
    const conversation = useRef<HTMLElement>(null), drawer = useRef<HTMLDialogElement>(null), dialogReturnFocus = useRef<HTMLElement | null>(null);
    const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('deck.sidebar-collapsed') === 'true'; } catch { return false; } });
    const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1000px)').matches), [drawerOpen, setDrawerOpen] = useState(false);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('activity'), [mobileTab, setMobileTab] = useState<WorkspaceTab>('chat'), [unseen, setUnseen] = useState(false);
    const following = useRef(true), restored = useRef('');
    const drafts = useRef(new DraftStore());
    useEffect(() => { const media = window.matchMedia('(max-width: 1000px)'); const update = () => setNarrow(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
    useEffect(() => { if (narrow && drawerOpen) drawer.current?.showModal(); else drawer.current?.close(); }, [narrow, drawerOpen]);
    const [workspaceCollapsed, setWorkspaceCollapsed] = useState(() => { try { return localStorage.getItem('deck.workspace-collapsed') === 'true'; } catch { return false; } });
    useEffect(() => { try { localStorage.setItem('deck.workspace-collapsed', String(workspaceCollapsed)); } catch { /* Preferences are optional. */ } }, [workspaceCollapsed]);
    useEffect(() => { try { localStorage.setItem('deck.sidebar-collapsed', String(collapsed)); } catch { /* Preferences are optional. */ } }, [collapsed]);
    const api = useCallback(async (path: string, init?: RequestInit) => { const r = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init?.headers } }); if (r.status === 401) {
        setPaired(false);
        throw new Error('Pair this browser to continue.');
    } const data = await r.json(); if (!r.ok || data.ok === false)
        throw new Error(data.message ?? data.error?.message ?? data.error ?? data.code ?? 'Request failed. Try again.'); return data; }, []);
    const imageDrafts=useImageDrafts(useCallback(async(sessionId:string,file:File,signal:AbortSignal)=>{
        const query=new URLSearchParams({name:imageDisplayName(file.name)});
        const reply=await api(`/api/sessions/${encodeURIComponent(sessionId)}/attachments?${query}`,{method:'POST',body:file,signal,headers:{'Content-Type':imageMimeType(file)??'application/octet-stream'}});
        return reply.data.attachment as ImageAttachment;
    },[api]));
    useEffect(()=>{setPreviewImage(undefined);},[selected]);
    const previewAttachment=(attachment:ImageAttachment)=>setPreviewImage({sessionId:selected,name:attachment.name,src:attachmentURL(selected,attachment.attachmentId)});
    async function loadHistory(id: string, cursor?: string, force = false) {
        if (loadingProjects.current.has(id) && !force) return;
        loadingProjects.current.add(id);
        const version = (historyRequests.current.get(id) ?? 0) + 1;
        historyRequests.current.set(id, version);
        setHistories(previous => ({ ...previous, [id]: { ...previous[id], sessions: previous[id]?.sessions ?? [], loading: true, error: undefined } }));
        try {
            const query = new URLSearchParams({ projectId: id, limit: '30', ...(cursor ? { cursor } : {}) });
            const reply = await api(`/api/sessions?${query}`);
            if (historyRequests.current.get(id) !== version) return;
            const incoming = (reply.data.sessions as WorkspaceSession[]).filter(session => !removedSessions.current.has(sessionIdOf(session))).map(session => { const old = sessionMetadata.current.get(sessionIdOf(session)); return old && (old.lastSeq ?? 0) > (session.lastSeq ?? 0) ? { ...session, ...old } : session; });
            for (const session of incoming) sessionMetadata.current.set(sessionIdOf(session), session);
            setHistories(previous => {
                const old = previous[id], combined = cursor ? [...(old?.sessions ?? []), ...incoming] : [...incoming, ...(old?.sessions ?? [])];
                return { ...previous, [id]: { sessions: combined.filter((session, index) => !removedSessions.current.has(sessionIdOf(session)) && combined.findIndex(item => sessionIdOf(item) === sessionIdOf(session)) === index), loaded: true, loading: false, paged: !!cursor || old?.paged, nextCursor: cursor || !old?.paged ? reply.data.nextCursor : old.nextCursor } };
            });
        } catch (cause) {
            if (historyRequests.current.get(id) === version) setHistories(previous => ({ ...previous, [id]: { ...previous[id], sessions: previous[id]?.sessions ?? [], loading: false, error: (cause as Error).message } }));
        } finally { if (historyRequests.current.get(id) === version) loadingProjects.current.delete(id); }
    }
    useEffect(() => {
        if (!paired) return;
        let closed = false, pending = false;
        const controller = new AbortController();
        async function refreshStatuses() {
            if (pending || document.visibilityState !== 'visible') return;
            pending = true;
            try {
                for (const id of expandedProjectIds.current) {
                    const ids = (historiesRef.current[id]?.sessions ?? []).map(sessionIdOf);
                    for (let offset = 0; offset < ids.length; offset += 100) {
                        const query = new URLSearchParams({ projectId: id }); ids.slice(offset, offset + 100).forEach(value => query.append('sessionId', value));
                        const mutation = sessionMutation.current;
                        const response = await api(`/api/sessions/status?${query}`, { signal: controller.signal });
                        if (closed) return;
                        if (mutation !== sessionMutation.current) continue;
                        const returned = new Set((response.data.sessions as WorkspaceSession[]).map(sessionIdOf));
                        for (const missing of ids.slice(offset, offset + 100)) if (!returned.has(missing)) hideSession(missing);
                        const summary=(response.data.sessions as WorkspaceSession[]).find(row=>sessionIdOf(row)===selectedSession.current);
                        if(summary)setView(previous=>{if(selectedSession.current!==sessionIdOf(summary))return previous;const grants=sessionGrants(previous,summary);return grants===previous.grants?previous:{...previous,grants};});
                        setHistories(previous => {
                            const old = previous[id]; if (!old) return previous;
                            const updates = new Map<string, WorkspaceSession>((response.data.sessions as WorkspaceSession[]).map(item => [sessionIdOf(item), item]));
                            return { ...previous, [id]: { ...old, sessions: old.sessions.map(session => {
                                const update = updates.get(sessionIdOf(session));
                                if (!update || (update.lastSeq ?? 0) < (session.lastSeq ?? 0)) return session;
                                const merged = { ...session, ...update, leadActivity: update.leadActivity ? { ...update.leadActivity, lastReplySeq: Math.max(update.leadActivity.lastReplySeq, session.leadActivity?.lastReplySeq ?? 0) } : session.leadActivity };
                                sessionMetadata.current.set(sessionIdOf(session), merged); return merged;
                            }).filter(session => !removedSessions.current.has(sessionIdOf(session))) } };
                        });
                    }
                }
            } catch { /* Existing history stays usable; the next status poll retries. */ }
            finally { pending = false; }
        }
        void refreshStatuses(); const timer = setInterval(() => void refreshStatuses(), 3000);
        document.addEventListener('visibilitychange', refreshStatuses); window.addEventListener('focus', refreshStatuses);
        return () => { closed = true; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', refreshStatuses); window.removeEventListener('focus', refreshStatuses); };
    }, [paired]);
    function expandProject(id: string, open = true) {
        const next = new Set(expandedProjectIds.current);
        if (open) next.add(id); else next.delete(id);
        expandedProjectIds.current = next; setExpandedProjects(next);
        if (open) void loadHistory(id);
    }
    async function load(projectOverride?: string) {
        const version = ++catalogRequest.current;
        try {
            const reply = await api('/api/projects');
            if (version !== catalogRequest.current) return;
            const available = reply.data.projects as Project[];
            let saved = ''; try { saved = localStorage.getItem('deck.project') ?? ''; } catch { }
            const requested = projectOverride ?? activeProjectId.current;
            const chosen = available.some(item => item.projectId === requested) ? requested : available.some(item => item.projectId === saved) ? saved : available[0]?.projectId ?? '';
            setProjects(available);
            if (activeProjectId.current !== chosen) { const previous = activeProjectId.current; activeProjectId.current = chosen; setProjectId(chosen); if (previous) selectSession(''); if (chosen) expandProject(chosen); }
            setPaired(true);
            const ids = new Set(expandedProjectIds.current); if (chosen) ids.add(chosen);
            await Promise.all([...ids].map(id => loadHistory(id)));
        } catch (cause) { if (version === catalogRequest.current) setError((cause as Error).message); }
    }
    useEffect(() => { if (projectId) try { localStorage.setItem('deck.project', projectId); } catch { } }, [projectId]);
    useEffect(() => { void (async () => {
        try {
            if (initialToken) await api('/pair', { method: 'POST', body: JSON.stringify({ token: initialToken, name: 'Desktop browser' }) });
            else {
                // The server decides whether loopback or opt-in Serve access is trusted.
                // Paired remote browsers must still load when automatic access is denied.
                try { await api('/api/local-access', { method: 'POST', body: JSON.stringify({ name: 'Browser' }) }); } catch { }
            }
            await load();
        } catch (e) { setError((e as Error).message); }
        finally { setConnecting(false); }
    })(); }, []);
    useEffect(() => { if (!paired)
        return; void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [paired, projectId]);
    const anchor = useRef<{id:string;offset:number}|undefined>(undefined);
    const captureAnchor = () => {
        const element=conversation.current;if(!element||!element.clientHeight||following.current)return;
        const top=element.getBoundingClientRect().top;
        const row=[...element.querySelectorAll<HTMLElement>('[data-history-id]')].find(row=>row.getBoundingClientRect().bottom>top);
        if(row)anchor.current={id:row.dataset.historyId!,offset:row.getBoundingClientRect().top-top};
    };
    const history = useChatHistory({api,sessionId:selected,enabled:paired,revision:reconnectRevision,
        beforeChange:captureAnchor,isFollowing:()=>following.current,onHydrated:setHydratedSession,onView:setView,onConnection:setConnection,onError:setError,
        onEvent:event=>{
            if(selectedSession.current!==selected)return;
            if(event.kind==='question.resolved')setQuestionDrafts(old=>{const next=Object.assign(Object.create(null),old);delete next[`${event.sessionId}:${event.data.questionId}`];return next;});
            if(event.kind==='session.removed'&&event.data.phase==='removed')hideSession(selected);
            if(event.kind==='session.renamed'&&typeof event.data.title==='string')renameSessionView(selected,event.data.title);
        }});
    const messages=useMemo(()=>history.messages.flatMap(event=>conversationEvents([...(event.request?[event.request]:[]),event]).map(row=>({...row,historyId:event.historyId}))),[history.messages]);
    const restoreAnchor=()=>{
        const element=conversation.current,saved=anchor.current;if(!element||!element.clientHeight||!saved||following.current)return;
        const row=element.querySelector<HTMLElement>(`[data-history-id="${saved.id}"]`);
        if(row)element.scrollTop+=row.getBoundingClientRect().top-element.getBoundingClientRect().top-saved.offset;
    };
    useLayoutEffect(restoreAnchor,[messages]);
    const historyGesture=useRef(false),touchY=useRef<number|undefined>(undefined);
    function navigateHistory(direction:'older'|'newer') {
        const element=conversation.current;if(!element)return;
        if(direction==='newer'&&!history.after&&element.scrollHeight-element.scrollTop-element.clientHeight<80){following.current=true;anchor.current=undefined;historyGesture.current=false;setUnseen(false);return;}
        historyGesture.current=true;following.current=false;
        if(direction==='older'&&element.scrollTop<200){historyGesture.current=false;void history.older();}
        if(direction==='newer'&&history.after&&element.scrollHeight-element.scrollTop-element.clientHeight<200){historyGesture.current=false;void history.newer();}
    }
    async function jumpLatest(){const owner=selected;anchor.current=undefined;following.current=true;await history.latest();if(selectedSession.current!==owner)return;if(conversation.current)conversation.current.scrollTop=conversation.current.scrollHeight;setUnseen(false);}
    const promptInbox=usePromptInbox(api,selected,paired&&connection==='Connected',view.events);
    const progress = useMemo(() => leadProgress(view.events, { sessionId: selected, pending: pendingPrompts[selected] ? {...pendingPrompts[selected],background:pendingPrompts[selected]?.background||promptInbox.inbox.paused} : undefined, connection }), [view.events, selected, pendingPrompts, connection, promptInbox.inbox.paused]);
    useLayoutEffect(() => {
        const element = conversation.current;
        if (!element || !selected || (narrow && mobileTab !== 'chat')) return;
        if (restored.current !== selected) {
            if (hydratedSession !== selected) return;
            element.scrollTop = element.scrollHeight;
            following.current = true; setUnseen(false);
            restored.current = selected;
        } else if (following.current) element.scrollTop = element.scrollHeight;
        else if(!history.loading) setUnseen(true);
    }, [messages, selected, narrow, mobileTab, hydratedSession, connection, progress?.label]);
    useLayoutEffect(() => {
        const element = conversation.current;
        if (!element || hydratedSession !== selected || (narrow && mobileTab !== 'chat')) return;
        const observer = new ResizeObserver(() => { if (following.current && restored.current === selected) element.scrollTop = element.scrollHeight; else restoreAnchor(); });
        observer.observe(element); if(element.firstElementChild)observer.observe(element.firstElementChild); return () => observer.disconnect();
    }, [selected, hydratedSession, narrow, mobileTab]);
    function selectSession(id: string, closeDrawer = true) {
        if (id !== selectedSession.current) { anchor.current=undefined;historyGesture.current=false;touchY.current=undefined;setOpenQuestion(''); selectedSession.current = id; setHydratedSession(''); setView(emptyState()); setConnection('Reconnecting'); setError(''); restored.current = ''; following.current = true; setUnseen(false); }
        setSelected(id); if (closeDrawer) setDrawerOpen(false);
    }
    function hideSession(id: string) {
        removedSessions.current.add(id); removingSessions.current.delete(id); sessionMetadata.current.delete(id); ++sessionMutation.current;
        setHistories(previous => Object.fromEntries(Object.entries(previous).map(([project, history]) => [project, {...history, sessions: history.sessions.filter(session => sessionIdOf(session) !== id)}])));
        if(selectedSession.current === id) selectSession('');
    }
    function renameSessionView(id: string, title: string) {
        if(removedSessions.current.has(id)) return;
        const previous = sessionMetadata.current.get(id); if(previous) sessionMetadata.current.set(id,{...previous,title});
        setHistories(previous => Object.fromEntries(Object.entries(previous).map(([project, history]) => [project,{...history,sessions:history.sessions.map(session => sessionIdOf(session) === id ? {...session,title} : session)}])));
    }
    async function removeSession(target: WorkspaceSession) {
        const id = sessionIdOf(target); ++sessionMutation.current;
        try {
            const result = await mutate({type:'session.remove'},id); ++sessionMutation.current;
            if(removedSessions.current.has(id)) return;
            removingSessions.current.add(id);
            const next = {...target,removing:true,releasing:true,preparationStatus:'releasing' as const}; sessionMetadata.current.set(id,next);
            setHistories(previous => Object.fromEntries(Object.entries(previous).map(([project,history]) => [project,{...history,sessions:history.sessions.map(session => sessionIdOf(session) === id ? {...session,...next} : session)}])));
            if(selectedSession.current === id && result?.preparation) readiness.update(result.preparation);
            if(target.projectId) void loadHistory(target.projectId,undefined,true);
        } catch(cause) { setError((cause as Error).message); }
        finally { ++sessionMutation.current; }
    }
    // A delegation that happens while the reader is elsewhere brings the workspace to Subagents; history loaded with the session never does.
    const delegationSeq = useMemo(() => view.events.reduce((latest, event) => (event.kind === 'task.created' || event.kind === 'task.continued') && (event.source.memberId ?? view.tasks[String(event.data.taskId ?? event.source.taskId ?? '')]?.memberId) !== 'lead' && (event.data.taskId ?? event.source.taskId) !== 'lead' ? Math.max(latest, event.seq) : latest, 0), [view.events, view.tasks]);
    const delegationSeen = useRef<{ session: string; seq: number }>({ session: '', seq: 0 });
    useEffect(() => {
        if (!selected || hydratedSession !== selected) return;
        if (delegationSeen.current.session !== selected) { delegationSeen.current = { session: selected, seq: delegationSeq }; return; }
        if (delegationSeq <= delegationSeen.current.seq) return;
        delegationSeen.current.seq = delegationSeq;
        if (!narrow && workspaceTab !== 'subagents') setWorkspaceTab('subagents');
    }, [delegationSeq, selected, hydratedSession, narrow, workspaceTab]);
    function changeTab(tab: WorkspaceTab) { setMobileTab(tab); if (tab !== 'chat') setWorkspaceTab(tab); }
    const activeTab = narrow ? mobileTab : workspaceTab;
    const currentSession = sessions.find(session => sessionIdOf(session) === selected) ?? sessionMetadata.current.get(selected);
    const project = projects.find(item => item.projectId === projectId);
    const recordedAssignment = view.events.filter(event => event.kind === 'session.assignment').at(-1)?.data;
    const generation = typeof recordedAssignment?.generation === 'number' ? recordedAssignment.generation : currentSession?.generation ?? 0;
    const effectiveSession = currentSession ? { ...currentSession, generation, assignmentRevision: typeof recordedAssignment?.revision === 'number' ? recordedAssignment.revision : currentSession.assignmentRevision, members: { ...currentSession.members, ...(recordedAssignment?.memberOverrides as WorkspaceSession['members'] ?? {}) } } : undefined;
    const leadTaskId = generation === 0 ? 'lead' : `lead-g${generation}`;
    const lead = effectiveSession?.members?.lead ?? view.tasks[leadTaskId];
    useEffect(() => {
        if (!selected || hydratedSession !== selected || !view.events.length) return;
        const activity = leadActivityFromEvents(view.events, leadTaskId);
        setHistories(previous => Object.fromEntries(Object.entries(previous).map(([id, history]) => [id, { ...history, sessions: history.sessions.map(session => {
            if (sessionIdOf(session) !== selected || (session.lastSeq ?? 0) > view.seq) return session;
            const next = { ...session, lastSeq: view.seq, grants:sessionGrants(view,session), leadActivity: { ...activity, lastReplySeq: Math.max(activity.lastReplySeq, session.leadActivity?.lastReplySeq ?? 0) } };
            sessionMetadata.current.set(selected, next); return next;
        }) }])));
    }, [selected, hydratedSession, view.seq, leadTaskId]);
    const latestReplySeq = messages.filter(event => event.kind === 'message.completed' && (event.data.role === undefined || event.data.role === 'assistant') && typeof event.data.text === 'string' && event.data.text.trim()).at(-1)?.seq ?? 0;
    const chatVisible = hydratedSession === selected && (!narrow || mobileTab === 'chat') && !dialogKind && !drawerOpen;

    const approvals = Object.values(view.approvals);
    const ended = (view.events.length ? view.state : currentSession?.state) === 'ended';
    const working = (view.events.length ? view.state === 'running' : currentSession?.state === 'running') || Object.values(view.tasks).some(task => ['queued', 'running'].includes(String(task.state))) || approvals.length > 0 || promptInbox.inbox.queued.length > 0 || !!promptInbox.inbox.active;
    const preparationSignal = view.events.filter(event => event.kind === 'session.assignment' || event.kind === 'session.reopened' || (event.kind === 'diagnostic' && event.data.code === 'session.preparation')).at(-1)?.seq ?? 0;
    const readiness = useSessionPreparation(api, selected, paired && connection === 'Connected', generation, preparationSignal);
    const removing = currentSession?.removing === true || removingSessions.current.has(selected);
    const releaseEvent = view.events.filter(event => event.kind === 'session.released').at(-1);
    const releasePending = releaseEvent ? releaseEvent.data.phase === 'releasing' : currentSession?.releasing === true;
    const releaseFailed = (removing || releasePending) && readiness.preparation?.status === 'failed';
    const closing = removing || releasePending || closingSession === selected || readiness.preparation?.status === 'releasing' || (!readiness.preparation && currentSession?.releasing === true);
    const canCompose = !!selected && !closing && !ended && connection === 'Connected' && readiness.preparation?.status === 'ready' && readiness.preparation.generation === generation;
    const draftImages=imageDrafts.drafts[selected]??[];
    const canSend = canCompose && !busy && draftImages.every(item=>item.status==='ready');
    useEffect(() => {
        if(!selected || !readiness.preparation) return;
        const preparationStatus = closing ? 'releasing' : readiness.preparation.status;
        const old = sessionMetadata.current.get(selected); if(old) sessionMetadata.current.set(selected,{...old,preparationStatus});
        setHistories(previous => Object.fromEntries(Object.entries(previous).map(([project,history]) => [project,{...history,sessions:history.sessions.map(session => sessionIdOf(session) === selected ? {...session,preparationStatus} : session)}])));
    },[selected,readiness.preparation,closing]);
    function selectProjectSession(id: string, session: WorkspaceSession) {
        sessionMetadata.current.set(sessionIdOf(session), session);
        activeProjectId.current = id; setProjectId(id); expandProject(id); selectSession(sessionIdOf(session));
    }
    function showDialog(kind: WorkspaceDialogKind, target?: Project) {
        dialogReturnFocus.current = narrow && drawerOpen ? document.querySelector<HTMLElement>('[aria-label="Open sessions"]') : document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setCreationProject(target); setDrawerOpen(false); setDialogKind(kind);
    }
    async function removeProject(target: Project) {
        const navigation = document.activeElement?.closest('nav');
        try {
            await mutate({ type: 'project.remove', projectId: target.projectId });
            ++catalogRequest.current;
            historyRequests.current.set(target.projectId, (historyRequests.current.get(target.projectId) ?? 0) + 1); loadingProjects.current.delete(target.projectId);
            const remaining = projectsRef.current.filter(item => item.projectId !== target.projectId);
            setProjects(remaining);
            const expanded = new Set(expandedProjectIds.current); expanded.delete(target.projectId); expandedProjectIds.current = expanded; setExpandedProjects(expanded);
            if (activeProjectId.current === target.projectId) { selectSession(''); const next = remaining[0]?.projectId ?? ''; activeProjectId.current = next; setProjectId(next); if (next) expandProject(next); try { if (next) localStorage.setItem('deck.project', next); else localStorage.removeItem('deck.project'); } catch { } }
            requestAnimationFrame(() => navigation?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }));
        } catch (cause) { setError((cause as Error).message); }
    }
    const navigationHistories = {...histories, ...(histories[projectId] ? {[projectId]: {...histories[projectId], sessions: sessions.map(session => sessionIdOf(session) === selected ? {...session, preparationStatus: connection !== 'Connected' ? 'unprepared' as const : releaseFailed ? 'failed' as const : closing ? 'releasing' as const : readiness.preparation?.status ?? session.preparationStatus} : session)}} : {})};
    const sessionButtons = <ProjectNavigation projects={projects} projectId={projectId} histories={navigationHistories} expanded={expandedProjects} selected={selected} busy={busy} readMarkers={readMarkers} collapsed={collapsed && !narrow} onToggle={id => expandProject(id, !expandedProjectIds.current.has(id))} onSession={selectProjectSession} onAdd={() => showDialog('project')} onNew={target => showDialog('session', target)} onMore={id => void loadHistory(id, histories[id]?.nextCursor)} onRetry={id => void loadHistory(id)} onRefresh={() => void load()} onExpand={() => setCollapsed(false)} onRename={target => showDialog('rename-project', target)} onRemove={target => void removeProject(target)} onRenameSession={target => {setActionSession(target);showDialog('rename-session');}} onRemoveSession={target => void removeSession(target)}/>;
    async function mutate(body: Record<string, unknown>, sessionId?: string) {
        if (commandInFlight.current) throw new Error('Another request is still pending.');
        commandInFlight.current = true; setBusy(true); setError('');
        const commandId = crypto.randomUUID(), prompt = body.type === 'prompt.send';
        if(['session.rename','session.remove','session.release','session.setApprovals','session.revokeGrant'].includes(String(body.type))) ++sessionMutation.current;
        if (prompt && sessionId) setPendingPrompts(previous => ({ ...previous, [sessionId]: { commandId, afterSeq: view.seq, phase: 'sending', background: promptInbox.inbox.paused || !!promptInbox.inbox.active || promptInbox.inbox.queued.length>0 || (!!progress && progress.phase!=='connection') } }));
        try {
            const reply = await api('/api/commands', { method: 'POST', body: JSON.stringify({ ...(sessionId ? { sessionId } : {}), command: { v: 1, commandId, ...body } }) });
            if (prompt && sessionId) setPendingPrompts(previous => previous[sessionId]?.commandId === commandId ? { ...previous, [sessionId]: { ...previous[sessionId]!, phase: 'accepted', background: true } } : previous);
            if(prompt&&sessionId){setQueueErrors(previous=>({...previous,[sessionId]:''}));if(selectedSession.current===sessionId)promptInbox.refresh();}
            return reply.data;
        } catch (e) {
            if (prompt && sessionId) setPendingPrompts(previous => { if (previous[sessionId]?.commandId !== commandId) return previous; const next = { ...previous }; delete next[sessionId]; return next; });
            throw e;
        } finally { commandInFlight.current = false; setBusy(false); }
    }
    async function revokeGrant(owner:string, grantId:string) {
        try{await mutate({type:'session.revokeGrant',grantId},owner);}
        catch(cause){
            if(!(cause instanceof Error)||!cause.message.includes('unknown-grant'))throw cause;
            // The server has already removed it; recover without presenting a permanently failing action.
            const old=sessionMetadata.current.get(owner);
            if(old)sessionMetadata.current.set(owner,{...old,grants:(old.grants??[]).filter(grant=>grant.grantId!==grantId)});
            setHistories(previous=>Object.fromEntries(Object.entries(previous).map(([id,history])=>[id,{...history,sessions:history.sessions.map(session=>sessionIdOf(session)===owner?{...session,grants:(session.grants??[]).filter(grant=>grant.grantId!==grantId)}:session)}])));
            setView(previous=>selectedSession.current===owner?{...previous,grants:(previous.grants??old?.grants??[]).filter(grant=>grant.grantId!==grantId)}:previous);
        }finally{++sessionMutation.current;}
    }
    async function changeApprovals(owner:string, mode:'relay'|'yolo') {
        await mutate({type:'session.setApprovals',mode},owner); ++sessionMutation.current;
        const patch={approvalMode:mode,approvalModeSource:'session' as const}, old=sessionMetadata.current.get(owner);
        if(old)sessionMetadata.current.set(owner,{...old,...patch});
        setHistories(previous=>Object.fromEntries(Object.entries(previous).map(([id,history])=>[id,{...history,sessions:history.sessions.map(session=>sessionIdOf(session)===owner?{...session,...patch}:session)}])));
    }
    async function command(body: Record<string, unknown>) {
        const sessionId = selected;
        try { await mutate(body, sessionId); return true; }
        catch (cause) { if (selectedSession.current === sessionId) setError((cause as Error).message); return false; }
    }
    async function queueCommand(type:'prompt.cancel'|'prompt.resume',promptId?:string) {
        const sessionId=selected;setQueueErrors(previous=>({...previous,[sessionId]:''}));
        try{await mutate({type,...(promptId?{promptId}:{})},sessionId);}
        catch(cause){const message=(cause as Error).message;setQueueErrors(previous=>({...previous,[sessionId]:message==='prompt-already-started'?'This message has already started. It was not interrupted.':message}));}
        finally{if(selectedSession.current===sessionId)promptInbox.refresh();}
    }
    async function lifecycle(type: 'session.prepare' | 'session.prepare.cancel' | 'session.release') {
        const sessionId = selected;
        if (type === 'session.release') setClosingSession(sessionId);
        try {
            const result = await mutate({ type, ...(type === 'session.prepare.cancel' ? { preparationId: readiness.preparation?.preparationId } : {}) }, sessionId);
            if (selectedSession.current !== sessionId) return;
            if (result?.preparation) readiness.update(result.preparation);
            if (projectId) void loadHistory(projectId, undefined, true);
            void load();
        } catch (cause) { if (selectedSession.current === sessionId) setError((cause as Error).message); }
        finally { if (type === 'session.release') setClosingSession(current => current === sessionId ? '' : current); }
    }
    async function pair(e: React.FormEvent) { e.preventDefault(); setBusy(true); try {
        await api('/pair', { method: 'POST', body: JSON.stringify(code.trim() ? { code, name: 'Desktop browser' } : { token: initialToken, name: 'Desktop browser' }) });
        await load();
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    if (connecting) return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1 role="status">Opening your workspace…</h1></main>;
    if (!paired && ['127.0.0.1', 'localhost'].includes(window.location.hostname))
        return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1>Could not open your workspace</h1><p role="alert">{error || 'Local access is unavailable.'}</p><button onClick={() => window.location.reload()}>Retry</button></main>;
    if (!paired)
        return <main className="pair"><p className="eyebrow">DECK / LOCAL WORKSPACE</p><h1>Pair this browser</h1><p>Use the pairing code from your Deck terminal to open your sessions.</p><form onSubmit={pair}><label htmlFor="code">Pairing code</label><input id="code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} required={!initialToken} aria-describedby={error ? 'pair-error' : undefined}/><button disabled={busy}>{busy ? 'Pairing…' : 'Pair browser'}</button></form>{error && <p id="pair-error" role="alert">{error}</p>}</main>;
    return <div className={`workbench ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <a className="skip" href="#conversation">Skip to conversation</a>
        <nav className="sidebar" aria-label="Sessions"><DeckBrand/>{sessionButtons}</nav>
        <dialog ref={drawer} className="session-drawer" aria-labelledby="drawer-title" onClose={() => setDrawerOpen(false)} onClick={event => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setDrawerOpen(false);
        }}><div className="drawer-heading"><h2 id="drawer-title">Workspace</h2><button className="quiet drawer-close" type="button" onClick={() => setDrawerOpen(false)} aria-label="Close sessions"><NavigationIcon kind="close"/></button></div><nav aria-label="Mobile sessions">{sessionButtons}</nav></dialog>
        <div className={`app-body${!narrow && workspaceCollapsed ? ' workspace-collapsed' : ''}`}><header className="app-header"><button className="sidebar-toggle quiet" type="button" aria-label={narrow ? 'Open sessions' : collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={narrow ? drawerOpen : !collapsed} onClick={() => narrow ? setDrawerOpen(true) : setCollapsed(value => !value)}><NavigationIcon kind="menu"/></button><div className="session-identity"><h1>{selected ? currentSession ? sessionName(currentSession) : 'Session conversation' : project?.name ?? 'Choose a project'}</h1>{lead && <p className="lead-identity">Lead <strong>{String(lead.runnerId ?? 'Runner pending')}</strong><span title={String(lead.modelId ?? 'Model pending')}>{String(lead.modelId ?? 'Model pending')}</span></p>}</div><div className="connection"><span className={`connection-dot${canCompose ? ' ready' : ''}`} aria-hidden="true"/><span>{selected ? connection !== 'Connected' ? connection : canCompose ? 'Connected' : 'Disconnected' : 'Ready'}</span><small>{selected ? closing ? 'Closing' : ended ? 'Not prepared' : readiness.preparation?.status === 'ready' ? view.state : 'Not prepared' : 'Local'}</small></div>{!narrow && <button type="button" className="workspace-toggle quiet" aria-label={workspaceCollapsed ? 'Show workspace panel' : 'Hide workspace panel'} title={workspaceCollapsed ? 'Show workspace panel' : 'Hide workspace panel'} aria-expanded={!workspaceCollapsed} aria-controls="session-workspace" onClick={() => setWorkspaceCollapsed(value => !value)}><NavigationIcon kind="panel"/></button>}<ThemeSelect value={theme} onChange={setTheme}/></header>
        {error && <p className="error app-error" role="alert">{error}</p>}
        {selected && <SessionControls key={selected} approvalMode={view.approvalMode??currentSession?.approvalMode} approvalModeSource={view.approvalModeSource??currentSession?.approvalModeSource} onApprovals={mode=>changeApprovals(selected,mode)} grants={sessionGrants(view,currentSession)} onRevokeGrant={grantId=>revokeGrant(selected,grantId)} showPrimary={narrow && mobileTab !== 'chat'} connected={connection === 'Connected'} ended={ended} closing={closing} releaseFailed={releaseFailed} removing={removing} working={working} busy={busy} preparation={readiness.preparation} error={readiness.error} sharedActive={Math.max(0, (currentSession?.sharedActiveSessions ?? 0) - (currentSession?.running ? 1 : 0))} predecessor={currentSession?.predecessorSessionId} onReconnect={() => setReconnectRevision(value => value + 1)} onPrepare={() => void lifecycle('session.prepare')} onCancel={() => void lifecycle('session.prepare.cancel')} onClose={() => removing && currentSession ? void removeSession(currentSession) : void lifecycle('session.release')} onAssignments={() => showDialog('assignments')} onPredecessor={() => { if (currentSession?.predecessorSessionId) selectSession(currentSession.predecessorSessionId); }}/>}
        <Approvals key={`approvals:${selected}`} events={approvals} busy={busy||connection!=='Connected'} onRespond={body=>mutate(body,selected)}/>
        <div className="view-nav"><span className="chat-label"><Avatar memberId="lead" size={32}/>Conversation <small>You and the Lead</small></span><Tabs active={activeTab} onChange={changeTab}/></div>
        {narrow && mobileTab !== 'chat' && <LeadProgress progress={progress} mobile/>}
        <div className="panes"><main id="panel-chat" className="chat-pane" hidden={narrow && mobileTab !== 'chat'} aria-labelledby="tab-chat"><section id="conversation" ref={conversation} tabIndex={-1} className="conversation" aria-label="Conversation" onWheelCapture={event=>navigateHistory(event.deltaY<0?'older':'newer')} onKeyDownCapture={event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))navigateHistory('older');if(['ArrowDown','PageDown','End'].includes(event.key))navigateHistory('newer');}} onTouchStartCapture={event=>{touchY.current=event.touches[0]?.clientY;}} onTouchMoveCapture={event=>{const next=event.touches[0]?.clientY;if(next!==undefined&&touchY.current!==undefined)navigateHistory(next>touchY.current?'older':'newer');touchY.current=next;}} onPointerDownCapture={()=>{historyGesture.current=true;}} onScroll={event => {
            const element=event.currentTarget;
            if(history.loading)return;
            following.current=!history.after&&element.scrollHeight-element.scrollTop-element.clientHeight<80;
            if(following.current){anchor.current=undefined;setUnseen(false);}else captureAnchor();
            if(historyGesture.current){if(element.scrollTop<200){historyGesture.current=false;void history.older();}else if(history.after&&element.scrollHeight-element.scrollTop-element.clientHeight<200){historyGesture.current=false;void history.newer();}}
        }}>
        <div className="history-content"><div className="history-navigation" role="status">{history.before?<button type="button" className="quiet" disabled={history.loading} onClick={()=>{following.current=false;void history.older();}}>{history.loading?'Loading history…':'Older messages'}</button>:messages.length>0?<span>Beginning of conversation</span>:null}{history.error&&<span role="alert">{history.error}</span>}</div>
        {!messages.length && <div className="empty"><DeckBrand large/><h2>{selected ? 'What are we working on?' : 'Your work, across runners'}</h2><p>{selected ? 'Send a message to the Lead. Follow the tools, delegated work and documents in the workspace alongside it.' : 'Choose a session to continue the conversation and see its work.'}</p></div>}
        {messages.map(event => <div className="history-row" key={event.historyId} data-history-id={event.historyId}>{event.autoApproval ? <AutoApprovalMessage key={event.seq} detail={event.autoApproval}/>:event.questionResolution ? <QuestionAnswerMessage key={event.seq} resolution={event.questionResolution} ts={event.ts}/>:event.kind === 'turn.completed' ? <article key={event.seq} className="message failed-message" role="alert"><p className="message-meta">Turn failed</p><p>{typeof event.data.error === 'string' && event.data.error ? event.data.error : 'The runner could not complete this turn. Try again.'}</p></article> : <article key={event.seq} className={`message ${event.data.role === 'user' ? 'user' : 'lead'}`}><div className="message-meta"><strong>{event.data.role === 'user' ? 'You' : 'Lead'}</strong>{event.data.role !== 'user' && <span>{event.source.runnerId ?? view.tasks[event.source.taskId ?? 'lead']?.runnerId as string ?? ''}{(event.data.modelId ?? view.tasks[event.source.taskId ?? 'lead']?.modelId) ? ` · ${String(event.data.modelId ?? view.tasks[event.source.taskId ?? 'lead']?.modelId)}` : ''}</span>}<time dateTime={event.ts}>{new Date(event.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><VisibleReply visible={chatVisible} replyKey={selected} seq={event.seq === latestReplySeq ? event.seq : 0} acknowledge={acknowledge}><Markdown text={String(event.data.text ?? event.data.delta ?? '')}/><ImageReferences attachments={publicImages(event.data.attachments)} onPreview={previewAttachment}/></VisibleReply></article>}</div>)}
        {history.after&&<button type="button" className="quiet" disabled={history.loading} onClick={()=>{following.current=false;void history.newer();}}>Newer messages</button>}</div>
        </section>
        <div className="conversation-feedback">{(unseen||history.after) && <button type="button" className="jump-latest" onClick={()=>void jumpLatest()}>Jump to latest ↓</button>}</div>
        <LeadProgress progress={progress}/>
        {/* Connection changes remount docks so secret DOM values and refs are wiped; ordinary drafts live above them. */}
        <div className="question-docks">{Object.values(view.questions).sort((a,b)=>a.seq-b.seq).map(event=>{const id=String(event.data.questionId), draftKey=`${selected}:${id}`, member=String(event.source.memberId??view.tasks[String(event.data.taskId)]?.memberId??'lead');return <QuestionDock key={`${draftKey}:${connection}:${reconnectRevision}`} open={openQuestion===draftKey} onToggle={()=>setOpenQuestion(old=>old===draftKey?'':draftKey)} questionId={id} questions={event.data.questions as Question[]} label={member==='lead'?'The Lead':agentProfile(member).label} drafts={questionDrafts[draftKey]??Object.create(null)} onDrafts={draft=>setQuestionDrafts(old=>Object.assign(Object.create(null),old,{[draftKey]:draft}))} onCommand={body=>mutate(body,selected)} busy={busy||connection!=='Connected'}/>;})}</div>
        <PromptQueue key={selected} items={promptInbox.inbox.queued} paused={promptInbox.inbox.paused&&!ended} pauseReason={promptInbox.inbox.pauseReason} failed={promptInbox.failed} connected={connection==='Connected'&&canCompose} busy={busy} sending={pendingPrompts[selected]?.phase==='sending'&&!!pendingPrompts[selected]?.background} error={queueErrors[selected]||promptInbox.error} onCancel={id=>void queueCommand('prompt.cancel',id)} onResume={()=>void queueCommand('prompt.resume')} onImage={previewAttachment}/>
        <ImageDraftStrip items={draftImages} error={imageDrafts.errors[selected]} submitted={new Set(submittedImages[selected]??[])} onRemove={id=>imageDrafts.remove(selected,[id])} onRetry={id=>imageDrafts.retry(selected,id)} onPreview={item=>setPreviewImage({sessionId:selected,name:imageDisplayName(item.file.name),file:item.file})}/>
        <DraftBoundary key={selected} sessionId={selected} drafts={drafts.current}>{(text,setText)=>canCompose ? <form className="composer" onSubmit={async event => {
            event.preventDefault();const session=selected,prompt=text,images=[...draftImages],ids=images.map(item=>item.draftId);
            if(!canSend||(!prompt.trim()&&!images.length))return;
            setSubmittedImages(previous=>({...previous,[session]:ids}));
            try{if(await command({type:'prompt.send',text:prompt,...(images.length?{attachmentIds:images.map(item=>item.attachment!.attachmentId)}:{})})){
                if(drafts.current.get(session)===prompt){drafts.current.set(session,'');}imageDrafts.consume(session,ids);
            }}finally{setSubmittedImages(previous=>({...previous,[session]:[]}));}
        }}><label htmlFor="prompt">Message the lead</label><MessageInput id="prompt" value={text} onChange={event => setText(event.target.value)} disabled={!selected || ended} placeholder="Describe the next step…" aria-describedby="composer-help" onPaste={event=>{
            const files=clipboardImages(event.clipboardData);if(!files.length)return;event.preventDefault();const session=selected,input=event.currentTarget,pasted=event.clipboardData.getData('text/plain');
            if(pasted){const inserted=insertPastedText(input.value,input.selectionStart,input.selectionEnd,pasted);setText(inserted.text);requestAnimationFrame(()=>{if(selectedSession.current===session&&document.activeElement===input)input.setSelectionRange(inserted.caret,inserted.caret);});}
            imageDrafts.add(session,files);
        }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/><div className="composer-actions"><ImagePicker sessionId={selected} disabled={!canCompose} onFiles={(files,owner)=>imageDrafts.add(owner,files)}/><span id="composer-help">{selected ? ended ? 'This session has ended.' : busy ? 'Saving message… Your draft is kept.' : draftImages.some(item=>item.status==='uploading') ? 'Uploading images…' : draftImages.some(item=>item.status==='error') ? 'Retry or remove failed images before sending.' : promptInbox.inbox.paused ? 'New messages wait until you resume the queue.' : promptInbox.inbox.active || promptInbox.inbox.queued.length ? 'Messages queue after current work · Enter to send' : 'Enter to send · Shift + Enter for a new line' : 'Choose a session to send a message.'}</span><button type="button" className="quiet" aria-label="Interrupt" title="Interrupt" disabled={!selected || busy || ended || !working} onClick={() => void command({ type: 'turn.interrupt', taskId: leadTaskId })}><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg></button><button aria-label="Send prompt" title="Send prompt" disabled={!canSend || (!text.trim()&&!draftImages.length)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button></div></form> : <div className="composer-gate" aria-label="Session connection"><p>{!selected ? 'Choose a session or create one to start.' : releaseFailed ? 'Session resources could not be fully released. You can retry.' : removing ? 'Removing session… Waiting for its resources to stop.' : closing ? 'Closing session… History and drafts are kept.' : connection !== 'Connected' ? 'Connect to this session to continue.' : readiness.preparation?.status === 'preparing' ? 'Checking session setup…' : readiness.preparation?.status === 'failed' ? 'Session preparation failed. You can retry.' : 'Prepare the session before sending a message.'}</p>{selected && <button type="button" disabled={busy || (closing && !releaseFailed)} onClick={() => {
            if (releaseFailed) { if(removing && currentSession) void removeSession(currentSession); else void lifecycle('session.release'); }
            else if (connection !== 'Connected') setReconnectRevision(value => value + 1);
            else if (readiness.preparation?.status === 'preparing') void lifecycle('session.prepare.cancel');
            else void lifecycle('session.prepare');
        }}>{releaseFailed ? removing ? 'Retry removal' : 'Retry close' : closing ? removing ? 'Removing session…' : 'Closing session…' : connection !== 'Connected' ? 'Reconnect' : readiness.preparation?.status === 'preparing' ? 'Cancel preparation' : readiness.preparation?.status === 'failed' ? 'Retry preparation' : 'Prepare session'}</button>}{!!text && <small>Your draft is kept for this session.</small>}</div>}</DraftBoundary></main>
        <aside className="workspace-pane" id="session-workspace" aria-label="Session workspace" hidden={narrow && mobileTab === 'chat'}><div className="workspace-panel" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" hidden={workspaceTab !== 'activity'} tabIndex={0}><Activity events={view.events} sessionId={selected} visible={paired && connection === 'Connected' && (narrow ? mobileTab === 'activity' : !workspaceCollapsed && workspaceTab === 'activity')}/></div><div className="workspace-panel" id="panel-subagents" role="tabpanel" aria-labelledby="tab-subagents" hidden={workspaceTab !== 'subagents'} tabIndex={0}><Subagents api={api} view={view} sessionId={selected} visible={hydratedSession === selected && !dialogKind && !drawerOpen && (narrow ? mobileTab === 'subagents' : !workspaceCollapsed && workspaceTab === 'subagents')} readMarkers={readMarkers} acknowledge={acknowledge}/></div><div className="workspace-panel" id="panel-openspec" role="tabpanel" aria-labelledby="tab-openspec" hidden={workspaceTab !== 'openspec'} tabIndex={0}><OpenSpec key={selected} sessionId={selected} visible={paired && (narrow ? mobileTab === 'openspec' : !workspaceCollapsed && workspaceTab === 'openspec')} api={api}/></div></aside></div>
        </div><ImagePreview image={previewImage} onClose={()=>setPreviewImage(undefined)}/><WorkspaceDialog kind={dialogKind} project={dialogKind === 'session' || dialogKind === 'rename-project' ? creationProject : project} session={dialogKind === 'rename-session' ? actionSession : effectiveSession} api={api} mutate={mutate} returnFocus={dialogReturnFocus} onClose={() => setDialogKind(undefined)} onProject={next => { ++catalogRequest.current; setProjects(previous => previous.some(item => item.projectId === next.projectId) ? previous.map(item => item.projectId === next.projectId ? next : item) : [...previous, next]); if (dialogKind !== 'rename-project') expandProject(next.projectId); void load(); }} onCreated={id => { if (creationProject) { setProjectId(creationProject.projectId); expandProject(creationProject.projectId); void loadHistory(creationProject.projectId, undefined, true); } selectSession(id); void load(creationProject?.projectId); }} onRenamed={(id,title) => { ++sessionMutation.current; renameSessionView(id,title); if(actionSession?.projectId) void loadHistory(actionSession.projectId,undefined,true); }} onAssigned={() => { if (projectId) void loadHistory(projectId, undefined, true); void load(); void readiness.refresh(); }}/></div>;
}
if (typeof document !== 'undefined')
    createRoot(document.getElementById('root')!).render(<App />);
