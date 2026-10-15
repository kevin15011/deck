import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectNavigation } from './project-navigation';
import type { WorkspaceSession } from './workspace-types';
const project = { projectId: 'p', name: 'Same name', path: '/home/developer/project', createdAt: '2026-10-15T12:00:00Z', available: true };
const noop = () => {};
function render(sessions: WorkspaceSession[], available = true) {
    return renderToStaticMarkup(<ProjectNavigation projects={[{ ...project, available }]} projectId="p" histories={{ p: { sessions, loaded: true, nextCursor: "next" } }} expanded={new Set(["p"])} selected="first" busy={false} onToggle={noop} onSession={noop} onAdd={noop} onNew={noop} onMore={noop} onRetry={noop} onRefresh={noop} onExpand={noop}/>);
}
test('one-line session preserves full title/status/creation metadata accessibly', () => {
    const html = render([{ sessionId: 'first', title: 'Architecture review', state: 'ended', createdAt: '2026-10-15T12:03:00.123Z' }]);
    expect(html).toContain('Architecture review'); expect(html).toContain('Closed'); expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Architecture review"'); expect(html).toContain('aria-description="Closed · Created'); expect(html).toContain('2026');
    expect(html).not.toContain('<time'); expect(html).not.toContain('<small>Closed');
    expect(html).not.toContain('session-monogram'); expect(html).not.toContain('last activity');
});
test('session readiness uses authoritative preparation independently of work and exposes separate menu', () => {
    const html = render([{sessionId:'first',title:'Prepared idle',state:'idle',preparationStatus:'ready',leadActivity:{state:'completed',pendingApprovals:0,lastReplySeq:5}},{sessionId:'second',title:'Unprepared idle',state:'idle',preparationStatus:'unprepared'},{sessionId:'third',title:'Closing',state:'idle',preparationStatus:'ready',releasing:true}]);
    expect(html.match(/class="session-readiness ready"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Disconnected"/g)).toHaveLength(2);
    expect(html).toContain('More options for Prepared idle');expect(html).toContain('Lead Completed · Unread reply');expect(html).toContain('· Connected');
});
test('legacy canonical IDs supply only valid creation dates; arbitrary IDs and impossible dates stay unlabeled', () => {
    const html = render([{ sessionId: '20261015T120300-abcdef', title: 'Legacy' }, { sessionId: '20260231T120300-abcdef', title: 'Invalid calendar' }, { sessionId: 'arbitrary-id', title: 'No date' }]);
    expect(html.match(/aria-description="[^"]*Created /g)).toHaveLength(1);
    expect(render([{ sessionId: 'other', title: 'Untrusted', createdAt: 'not-a-date' }])).not.toContain('Created ');
});
test('unavailable active project retains readable path/history while new session is disabled', () => {
    const html = render([{ sessionId: 'first', title: 'Retained history' }], false);
    expect(html).toContain('Directory unavailable'); expect(html).toContain('/home/developer/project'); expect(html).toContain('Retained history');
    expect(html).toMatch(/aria-label="New session in [^"]+"[^>]*disabled/);
});

test('project disclosure and creation use separate compact buttons, with stable controlled panels', () => {
    const html = renderToStaticMarkup(<ProjectNavigation projects={[project, { ...project, projectId: 'q', path: '/home/other/project' }]} projectId="p" histories={{}} expanded={new Set(['p'])} selected="" busy={false} onToggle={noop} onSession={noop} onAdd={noop} onNew={noop} onMore={noop} onRetry={noop} onRefresh={noop} onExpand={noop}/>);
    expect(html.match(/class="project-toggle quiet" aria-expanded=/g)).toHaveLength(2);
    expect(html.match(/aria-label="More options for [^"]+" title="More options" aria-haspopup="menu" aria-expanded="false"/g)).toHaveLength(2); expect(html).toContain('aria-expanded="true"'); expect(html).toContain('aria-expanded="false"');
    expect(html.match(/aria-label="New session in /g)).toHaveLength(2);
    expect(html).toContain('…/developer/project'); expect(html).toContain('…/other/project');
    for (const match of html.matchAll(/aria-controls="([^"]+)"/g)) expect(html).toContain(`id="${match[1]}"`);
    expect(html).toContain('hidden=""');
    expect(html).not.toContain('Find a project'); expect(html).not.toContain('Switch project');
});
