import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { StatusIndicator, indicatorLabel, type ReadMarkers } from './status-indicator';
import { sessionIdOf, sessionName, type Project, type WorkspaceSession } from './workspace-types';
import { applyOrder, PROJECT_ORDER_KEY, sessionOrderKey, useManualOrder, type OrderStore } from './ordering';
import { GripButton, SortableItem, SortableList, SortableRow } from './sortable';
import { collapse, useOpenAnimation } from './motion';

/** Disclosure whose height animates; stays mounted (hidden) when closed so panel ids remain valid. */
function Collapse({ open, id, className, label, busy, children }: { open: boolean; id: string; className: string; label: string; busy?: boolean; children: React.ReactNode }) {
    const node = useRef<HTMLDivElement>(null), first = useRef(true), [visible, setVisible] = useState(open);
    useLayoutEffect(() => {
        const element = node.current;
        if (first.current) { first.current = false; return; }
        if (open) { setVisible(true); if (element) requestAnimationFrame(() => collapse(element, true)); }
        else if (element) collapse(element, false, () => setVisible(false)); else setVisible(false);
    }, [open]);
    return <div ref={node} id={id} hidden={!open && !visible} {...(!open ? { inert: true, "aria-hidden": true } : {})} className={className} role="group" aria-label={label} aria-busy={busy}>{children}</div>;
}

export function NavigationIcon({ kind, expanded }: { kind: 'chevron' | 'panel' | 'plus' | 'refresh' | 'folder' | 'menu' | 'close' | 'more'; expanded?: boolean }) {
    const paths = { chevron: 'm6 4 4 4-4 4', panel: 'M2.5 3h11v10h-11ZM9.5 3v10', plus: 'M8 3v10M3 8h10', refresh: 'M13 6a5 5 0 1 0 .2 4M13 2v4H9', folder: 'M2 4h5l1.5 2H14v7H2Z', menu: 'M3 4h10M3 8h10M3 12h10', close: 'm4 4 8 8m0-8-8 8' };
    return <svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{kind === 'more' ? <><circle cx="3" cy="8" r=".7"/><circle cx="8" cy="8" r=".7"/><circle cx="13" cy="8" r=".7"/></> : <path d={paths[kind]} transform={kind === 'chevron' && expanded ? 'rotate(90 8 8)' : undefined}/>}</svg>;
}

function NavigationActions({ label, menuName, busy, renameDisabled = false, renameLabel, removeLabel, removeDescription, onRename, onRemove }: { label: string; menuName: string; busy: boolean; renameDisabled?: boolean; renameLabel: string; removeLabel: string; removeDescription: string; onRename: () => void; onRemove: () => void }) {
    const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), initialItem = useRef(0);
    const [position, setPosition] = useState<{top:number;left:number}>();
    useOpenAnimation(menu, !!position, 'pop');
    function close(restore = true) { setPosition(undefined); if (restore) trigger.current?.focus({preventScroll:true}); }
    function open(last = false) {
        const bounds = trigger.current?.getBoundingClientRect(); if (!bounds) return;
        initialItem.current = last ? 1 : 0;
        setPosition({top:Math.max(8, bounds.bottom + 4 + 88 < innerHeight ? bounds.bottom + 4 : bounds.top - 92),left:Math.max(8, Math.min(bounds.right - 164, innerWidth - 172))});
    }
    useLayoutEffect(() => { if(position) {const items=menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');items?.[initialItem.current ? items.length-1 : 0]?.focus({preventScroll:true});} }, [position]);
    useEffect(() => {
        if(!position) return;
        const outside = (event:PointerEvent) => { if(!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
        const resized = () => close();
        const scrolled = (event:Event) => { if(!menu.current?.contains(event.target as Node)) close(false); };
        document.addEventListener('pointerdown',outside); window.addEventListener('resize',resized); document.addEventListener('scroll',scrolled,true);
        return () => {document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resized);document.removeEventListener('scroll',scrolled,true);};
    }, [position]);
    return <span className="project-actions"><button ref={trigger} type="button" className="project-more quiet" disabled={busy} aria-label={`More options for ${label}`} title="More options" aria-haspopup="menu" aria-expanded={!!position} aria-controls={position ? id : undefined} onClick={() => position ? close() : open()} onKeyDown={event => { if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();open(event.key==='ArrowUp');} }}><NavigationIcon kind="more"/></button>{position && <div ref={menu} id={id} className="project-menu" role="menu" aria-label={menuName} style={position} onKeyDown={event => {
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
        if(event.key==='Tab'){close();return;}
        const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')], index=items.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:undefined;
        if(next!==undefined){event.preventDefault();items[next]?.focus();}
    }}><button type="button" role="menuitem" className="quiet" disabled={renameDisabled} onClick={() => {close();onRename();}}>{renameLabel}</button><button type="button" role="menuitem" className="quiet menu-remove" title={removeDescription} aria-description={removeDescription} onClick={() => {close();onRemove();}}>{removeLabel}</button></div>}</span>;
}

function creationDate(session: WorkspaceSession): Date | undefined {
    let value = session.createdAt;
    if (!value) {
        const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-[a-f0-9]{6}$/.exec(sessionIdOf(session));
        if (match) value = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`;
    }
    if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return;
    const date = new Date(value);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19)) return date;
}

export type ProjectHistory = { sessions: WorkspaceSession[]; loaded?: boolean; loading?: boolean; error?: string; nextCursor?: string; paged?: boolean };
function distinguishingPath(project: Project, projects: Project[]): string | undefined {
    const peers = projects.filter(item => item.projectId !== project.projectId && item.name === project.name);
    if (!peers.length) return;
    const parts = project.path.split('/').filter(Boolean);
    for (let length = 1; length <= parts.length; length++) {
        const suffix = parts.slice(-length).join('/');
        if (!peers.some(item => item.path.endsWith(`/${suffix}`))) return length < parts.length ? `…/${suffix}` : project.path;
    }
    return project.path;
}
export function ProjectNavigation({ orderStore, projects, projectId, histories, expanded, selected, busy, readMarkers = {}, collapsed = false, onToggle, onSession, onAdd, onNew, onMore, onRetry, onRefresh, onExpand, onRename, onRemove, onRenameSession, onRemoveSession }: {
    orderStore?: OrderStore; projects: Project[]; projectId: string; histories: Record<string, ProjectHistory>; expanded: Set<string>; selected: string; busy: boolean; readMarkers?: ReadMarkers; collapsed?: boolean;
    onToggle: (id: string) => void; onSession: (projectId: string, session: WorkspaceSession) => void; onAdd: () => void; onNew: (project: Project) => void; onMore: (id: string) => void; onRetry: (id: string) => void; onRefresh: () => void; onExpand: () => void; onRename?: (project: Project) => void; onRemove?: (project: Project) => void; onRenameSession?: (session: WorkspaceSession) => void; onRemoveSession?: (session: WorkspaceSession) => void;
}) {
    const id = useId(), { saved, reorder } = useManualOrder(orderStore);
    if (collapsed) return <div className="project-navigation navigation-rail"><button type="button" className="quiet" aria-label="Show projects" title="Show projects" onClick={onExpand}><NavigationIcon kind="folder"/></button><button type="button" className="quiet" aria-label="Add project" title="Add project" onClick={onAdd}><NavigationIcon kind="plus"/></button></div>;
    const orderedProjects = applyOrder(projects, saved(PROJECT_ORDER_KEY), item => item.projectId);
    return <div className="project-navigation">
        <div className="project-toolbar"><h2>Projects</h2><button type="button" className="quiet navigation-add" onClick={onAdd}><NavigationIcon kind="plus"/>Add project</button><button type="button" className="quiet navigation-refresh" aria-label="Refresh sessions" title="Refresh projects and sessions" onClick={onRefresh}><NavigationIcon kind="refresh"/></button></div>
        <div className="navigation-scroll"><SortableList className="project-tree" label="Projects" ids={orderedProjects.map(item => item.projectId)} onReorder={(from, to) => reorder(PROJECT_ORDER_KEY, orderedProjects.map(item => item.projectId), from, to)}>{orderedProjects.map(project => {
            const history = histories[project.projectId], open = expanded.has(project.projectId), suffix = distinguishingPath(project, projects), panelId = `${id}-${project.projectId}`;
            const sessionKey = sessionOrderKey(project.projectId), sessions = applyOrder(history?.sessions ?? [], saved(sessionKey), item => sessionIdOf(item));
            return <SortableItem key={project.projectId} id={project.projectId} className={`project-group${project.projectId === projectId ? ' active-project' : ''}`} data-project-id={project.projectId}>
                <SortableRow className="project-row"><GripButton label={`Reorder project ${project.name}`}/><button type="button" className="project-toggle quiet" aria-expanded={open} aria-controls={panelId} aria-label={`Sessions in ${project.name} (${project.path})`} title={project.path} onClick={() => onToggle(project.projectId)}><NavigationIcon kind="chevron" expanded={open}/><span className="project-name"><strong>{project.name}</strong>{suffix && <small>{suffix}</small>}{!project.available && <small>Directory unavailable</small>}</span></button><button type="button" className="project-new quiet" aria-label={`New session in ${project.name} (${project.path})`} title={project.available ? `New session in ${project.name}` : 'Project directory is unavailable'} disabled={busy || !project.available} onClick={() => onNew(project)}><NavigationIcon kind="plus"/></button><NavigationActions label={`${project.name} (${project.path})`} menuName={`Options for ${project.name}`} busy={busy} renameLabel="Rename project" removeLabel="Remove project" removeDescription="Hides the project from this interface. Files, history and running work are kept. Add the same directory to restore it." onRename={() => onRename?.(project)} onRemove={() => onRemove?.(project)}/></SortableRow>
                <Collapse id={panelId} open={open} className="project-sessions" label={`Sessions for ${project.name}`} busy={history?.loading}>
                    <SortableList className="session-list" label={`Sessions in ${project.name}`} ids={sessions.map(item => sessionIdOf(item))} onReorder={(from, to) => reorder(sessionKey, sessions.map(item => sessionIdOf(item)), from, to)}>{sessions.map(session => {
                        const sessionId = sessionIdOf(session), name = sessionName(session), created = creationDate(session), creationText = created?.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                        const status = session.removing ? 'Removing' : session.releasing ? 'Closing' : session.state === 'ended' ? 'Closed' : session.state === 'created' ? 'New' : session.state ?? 'Session', connection = session.preparationStatus === 'ready' && !session.releasing && !session.removing && session.state !== 'ended' ? 'Connected' : session.preparationStatus === 'preparing' ? 'Preparing' : 'Disconnected', description = `${status}${session.leadActivity ? ` · Lead ${indicatorLabel(session.leadActivity.state, session.leadActivity.pendingApprovals, session.leadActivity.lastReplySeq > (readMarkers[sessionId] ?? 0), session.leadActivity.pendingQuestions)}` : ''}${created ? ` · Created ${creationText}` : ''} · ${connection}`;
                        return <SortableItem key={sessionId} id={sessionId} className="session-row" data-session-id={sessionId} dragFromItem><GripButton label={`Reorder session ${name}`}/><button type="button" title={`${name}\n${description}`} aria-label={name} aria-description={description} className={`session${selected === sessionId ? ' selected' : ''}`} aria-current={selected === sessionId ? 'page' : undefined} onClick={() => onSession(project.projectId, session)}><span className={`session-readiness${connection === 'Connected' ? ' ready' : ''}`} role="img" aria-label={connection} title={connection}/><span className="session-label"><strong>{name}</strong></span>{session.leadActivity && <StatusIndicator state={session.leadActivity.state} approvals={session.leadActivity.pendingApprovals} questions={session.leadActivity.pendingQuestions} unread={session.leadActivity.lastReplySeq > (readMarkers[sessionId] ?? 0)}/>}</button><NavigationActions label={name} menuName={`Options for session ${name}`} busy={busy || (session.removing === true && session.preparationStatus !== 'failed')} renameDisabled={session.removing === true} renameLabel="Rename session" removeLabel={session.removing ? 'Retry removal' : 'Remove session'} removeDescription="Closes this session and hides it from the interface. Files and stored history are kept." onRename={() => onRenameSession?.(session)} onRemove={() => onRemoveSession?.(session)}/></SortableItem>;
                    })}</SortableList>
                    {history?.error ? <div className="history-error"><p role="alert">{history.error}</p><button type="button" className="quiet" onClick={() => onRetry(project.projectId)}>Retry history</button></div> : history?.loading && !history.sessions.length ? <p className="empty-note" role="status">Loading sessions…</p> : history?.loaded && !history.sessions.length && <p className="empty-note">No sessions yet.</p>}
                    {history?.nextCursor && <button type="button" className="quiet history-more" disabled={history.loading} onClick={() => onMore(project.projectId)}>{history.loading ? 'Loading…' : 'Older sessions'}</button>}
                </Collapse>
            </SortableItem>;
        })}</SortableList>{!projects.length && <p className="empty-note">Add a project to start a session.</p>}</div>
    </div>;
}
