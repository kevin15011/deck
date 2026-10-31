import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectNavigation } from '../src/project-navigation';
import { createSelectionMotion } from '../src/selection-motion';
import '../src/style.css';
const project = { projectId: 'p', name: 'Project', path: '/fixture', available: true, createdAt: '' };
const sessions = ['First', 'Middle', 'Last'].map(sessionId => ({ sessionId, title: sessionId }));
const noop = () => {};
function Fixture() {
    const [selected, select] = useState('First'), [collapsed, collapse] = useState(false), [expanded, expand] = useState(true);
    Object.assign(window, { selectionFixture: { select, collapse, expand, createSelectionMotion, dispose: () => root.unmount() } });
    return <div className={`workbench${collapsed ? ' sidebar-collapsed' : ''}`}><nav className={matchMedia('(max-width: 1000px)').matches ? 'session-drawer' : 'sidebar'}><ProjectNavigation projects={[project]} projectId="p" histories={{p:{sessions}}} expanded={new Set(expanded ? ['p'] : [])} selected={selected} busy={false} collapsed={collapsed} onSession={(_, session) => select(session.sessionId!)} onToggle={() => expand(value => !value)} onAdd={noop} onNew={noop} onMore={noop} onRetry={noop} onRefresh={noop} onExpand={noop}/></nav><main/></div>;
}
const root = createRoot(document.getElementById('root')!); root.render(<Fixture/>);
