import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { activityEvents } from './state';
import { Activity } from './workspace';

const event = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown> = {}, source: SessionEvent['source'] = { taskId: 'lead', runnerId: 'claude' }): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data, source, ts: '2026-10-14T10:00:00Z' });
test('Activity keeps only explicit Lead tools and runner reasoning, without lifecycle or child notices', () => {
    const rows = activityEvents([
        event(1, 'session.created'), event(2, 'turn.started'), event(3, 'diagnostic', { message: 'Noise' }),
        event(4, 'tool.started', { toolUseId: 'a', name: 'Read', input: { file_path: 'README.md' } }),
        event(5, 'tool.started', { toolUseId: 'a', name: 'Child tool' }, { taskId: 'child', runnerId: 'claude' }),
        event(6, 'reasoning.delta', { text: 'Child reasoning' }, { taskId: 'child' }),
        event(7, 'task.result', { taskId: 'child' }), event(8, 'usage'), event(9, 'runner.unmapped'),
        event(10, 'tool.started', { name: 'Internal', internal: true }),
        event(11, 'reasoning.delta', { text: 'Reported by runner', format: 'snapshot', messageId: 'm', blockIndex: 0 }),
    ]);
    expect(rows.map(row => row.kind)).toEqual(['tool', 'reasoning']);
    expect(rows[0]).toMatchObject({ name: 'Read', summary: 'README.md', status: 'running' });
    expect(rows[1]).toMatchObject({ text: 'Reported by runner' });
});
test('paired calls merge real IDs, preserve input/name, and tolerate duplicate notifications and replay', () => {
    const start = event(2, 'tool.started', { toolUseId: 'a', name: 'Bash', input: { command: 'bun test' } });
    const rows = activityEvents([
        event(1, 'turn.started'), start, start,
        event(3, 'tool.started', start.data), event(4, 'tool.completed', { toolUseId: 'a', output: '12 passed', isError: false }),
        event(5, 'tool.completed', { toolUseId: 'a', output: '12 passed' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Bash', input: { command: 'bun test' }, output: '12 passed', status: 'completed', summary: 'bun test' });
});
test('IDs are isolated by runner, native session, session and turn; anonymous calls never guess a pair', () => {
    const source = { taskId: 'lead', runnerId: 'codex', nativeSessionId: 'native' };
    const rows = activityEvents([
        event(1, 'turn.started'), event(2, 'tool.started', { toolUseId: 'same', name: 'Read' }),
        event(3, 'tool.completed', { toolCallId: 'same', tool: 'commandExecution', output: 'Codex output' }, source),
        event(4, 'turn.completed', { status: 'completed' }), event(5, 'turn.started'),
        event(6, 'tool.completed', { toolUseId: 'same', output: 'New turn orphan' }),
        event(7, 'tool.started', { name: 'Anonymous' }), event(8, 'tool.completed', { name: 'Anonymous', output: 'Unpaired' }),
        { ...event(9, 'tool.completed', { toolUseId: 'same' }), sessionId: 'another' },
        event(10, 'tool.completed', { toolCallId: 'same', output: 'Other native session' }, { ...source, nativeSessionId: 'new' }),
    ]);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({ status: 'unfinished' });
    expect(rows[1]).toMatchObject({ name: 'commandExecution', output: 'Codex output', status: 'completed', orphan: true });
    expect(rows[2]).toMatchObject({ output: 'New turn orphan', orphan: true });
    expect(rows[3]).toMatchObject({ status: 'running' });
    expect(rows[4]).toMatchObject({ orphan: true });
});
test('terminal turns and session endings stop running tools without inventing successful completion', () => {
    for (const status of ['completed', 'failed', 'interrupted', 'interrupted-forced']) {
        const rows = activityEvents([event(1, 'tool.started', { toolUseId: 'a', name: 'Write' }), event(2, 'turn.completed', { status })]);
        expect(rows[0]).toMatchObject({ status: status.startsWith('interrupted') ? 'interrupted' : 'unfinished' });
    }
    expect(activityEvents([event(1, 'tool.started', { name: 'Write' }), event(2, 'session.ended')])[0]).toMatchObject({ status: 'unfinished' });
    expect(activityEvents([event(1, 'tool.started', { name: 'Write' }), event(2, 'task.continued')])[0]).toMatchObject({ status: 'unfinished' });
    const native = { taskId: 'lead', runnerId: 'claude', nativeSessionId: 'native' };
    const boundary = activityEvents([
        event(1, 'tool.started', { toolUseId: 'same', name: 'Read' }, native),
        event(2, 'turn.completed', { status: 'interrupted' }),
        event(3, 'tool.completed', { toolUseId: 'same', output: 'Later turn' }, native),
    ]);
    expect(boundary).toHaveLength(2); expect(boundary[0]).toMatchObject({ status: 'interrupted' }); expect(boundary[1]).toMatchObject({ orphan: true });
});
test('native tool failure metadata is visible and actual MCP names win over item types', () => {
    const rows = activityEvents([
        event(1, 'tool.started', { toolCallId: 'a', tool: 'mcpToolCall', toolName: 'search_graph', server: 'codebase-memory', input: { name_pattern: '.*Activity.*' } }),
        event(2, 'tool.completed', { toolCallId: 'a', status: 'failed', error: { message: 'Tool unavailable' } }),
        event(3, 'tool.completed', { toolCallId: 'b', tool: 'commandExecution', input: { command: 'bun test' }, output: '1 failed', exitCode: 1 }),
    ]);
    expect(rows[0]).toMatchObject({ name: 'search_graph', server: 'codebase-memory', status: 'failed', error: { message: 'Tool unavailable' } });
    expect(rows[1]).toMatchObject({ status: 'failed', exitCode: 1 });
});
test('reasoning merges explicit deltas and snapshots by identity with action and turn boundaries', () => {
    const reasoning = (seq: number, text: string, data: Record<string, unknown> = {}) => event(seq, 'reasoning.delta', { text, format: 'delta', messageId: 'm', partId: 'p', reasoningKind: 'summary', ...data });
    const rows = activityEvents([
        event(1, 'turn.started'), reasoning(2, 'First '), reasoning(3, 'step.'),
        event(4, 'tool.started', { toolUseId: 'a', name: 'Read' }), reasoning(5, 'Next step.'),
        reasoning(6, 'Other block.', { partId: 'q' }), event(7, 'turn.completed', { status: 'completed' }),
        reasoning(8, 'New turn.'), reasoning(9, 'Full', { format: 'snapshot', partId: 'r' }), reasoning(10, 'Full snapshot.', { format: 'snapshot', partId: 'r' }),
        event(11, 'tool.completed', { toolUseId: 'b' }), reasoning(12, 'Full snapshot. More.', { format: 'snapshot', partId: 'r' }),
    ]);
    expect(rows.filter(row => row.kind === 'reasoning').map(row => row.kind === 'reasoning' && row.text)).toEqual(['First step.', 'Next step.', 'Other block.', 'New turn.', 'Full snapshot.', ' More.']);
});
test('legacy reasoning without format remains standalone; empty, opaque and hidden content stay excluded', () => {
    const raw = { runnerId: 'claude', protocol: 'native', payload: { thinking: 'OPAQUE CONTENT' }, truncated: false };
    const rows = activityEvents([
        event(1, 'reasoning.delta', { text: 'Legacy one' }), event(2, 'reasoning.delta', { text: 'Legacy two' }),
        { ...event(3, 'reasoning.delta', { opaque: 'Ignored' }), raw }, event(4, 'reasoning.delta', { text: '', format: 'delta' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.kind === 'reasoning' && row.text)).toEqual(['Legacy one', 'Legacy two']);
});
test('completed snapshots do not duplicate streamed reasoning, and later snapshots preserve action order', () => {
    const reasoning = (seq: number, text: string, format: string) => event(seq, 'reasoning.delta', { text, format, messageId: 'm', partId: 'text:0', reasoningKind: 'text' });
    const rows = activityEvents([
        reasoning(1, 'Read ', 'delta'), reasoning(2, 'the code.', 'delta'),
        event(3, 'tool.started', { toolUseId: 'read', name: 'Read' }),
        reasoning(4, 'Read the code.', 'snapshot'), reasoning(5, 'Read the code. Then ', 'snapshot'), reasoning(6, 'Read the code. Then verify.', 'snapshot'),
    ]);
    expect(rows.map(row => row.kind === 'reasoning' ? row.text : row.kind === 'transition' ? row.title : row.name)).toEqual(['Read the code.', 'Read', ' Then verify.']);
    const adjacent = activityEvents([reasoning(1, 'Partial ', 'delta'), reasoning(2, 'Partial complete.', 'snapshot')]);
    expect(adjacent).toHaveLength(1); expect(adjacent[0]).toMatchObject({ text: 'Partial complete.' });
});
test('historical activity replay redacts secrets, terminal controls and oversized output before rendering', () => {
    const html = renderToStaticMarkup(<Activity events={[
        event(1, 'tool.started', { toolUseId: 'a', name: 'Read', input: { command: 'TOKEN=private-token bun test', password: 'private-password' } }),
        event(2, 'tool.completed', { toolUseId: 'a', output: '\u001b[31mBearer private-bearer\n' + 'x'.repeat(25000), error: 'api_key=private-api-key' }),
        event(3, 'reasoning.delta', { text: 'Authorization: Bearer private-reasoning', format: 'snapshot' }),
        event(4, 'reasoning.delta', { text: 'api_', format: 'delta', messageId: 'split' }), event(5, 'reasoning.delta', { text: 'key=private-split', format: 'delta', messageId: 'split' }),
    ]}/>);
    for (const secret of ['private-token', 'private-password', 'private-bearer', 'private-api-key', 'private-reasoning', 'private-split', '\u001b']) expect(html).not.toContain(secret);
    expect(html).toContain('[redacted]'); expect(html).toContain('[Display truncated]');
});
test('Activity renders explicit Skill invocations, safe details, honest reasoning labels and an informative empty state', () => {
    const html = renderToStaticMarkup(<Activity events={[
        event(1, 'tool.started', { toolUseId: 'skill', name: 'Skill', input: { skill: 'frontend-ui-engineering' } }),
        event(2, 'tool.completed', { toolUseId: 'skill', output: '<script>window.executed=true</script>' }),
        event(3, 'tool.started', { name: 'Read', input: { file_path: 'skills/fixing-accessibility/SKILL.md' } }),
        event(4, 'reasoning.delta', { text: '**Reported** reasoning <img src="https://tracker.invalid">', reasoningKind: 'text', format: 'snapshot' }),
        event(5, 'reasoning.delta', { text: 'A summary', reasoningKind: 'summary' }),
        event(6, 'diagnostic', { message: 'HIDDEN NOISE' }),
    ]}/>);
    expect(html).toContain('Skill · frontend-ui-engineering');
    expect(html).toContain('Read'); expect(html).toContain('Runner reasoning'); expect(html).toContain('Reasoning summary');
    expect(html).toContain('Input'); expect(html).toContain('Output'); expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('HIDDEN NOISE');
    expect(html).not.toContain('Skill · fixing-accessibility');
    const empty = renderToStaticMarkup(<Activity events={[event(1, 'session.created'), event(2, 'usage')]}/>);
    expect(empty).toContain('No Lead details yet'); expect(empty).toContain('when the runner provides them');
});
const hook = (seq: number, kind: 'hook.started' | 'hook.completed', data: Record<string, unknown> = {}): SessionEvent => event(seq, kind, { hookId: 'native-hook', hookEvent: 'SessionStart', provenance: 'claude-stream-json', status: kind === 'hook.started' ? 'running' : 'completed', ...data });
test('native hooks pair across initialization and late native identity without splitting into tool rows', () => {
    const start = hook(2, 'hook.started', { attempt: 1, hookName: 'Workspace setup', executionMode: 'sync', handlerType: 'command' });
    const rows = activityEvents([
        event(1, 'task.created', { taskId: 'lead', attempt: 1 }), start, start,
        event(3, 'turn.started'),
        { ...hook(4, 'hook.completed', { attempt: 1, durationMs: 1200, exitCode: 0 }), source: { taskId: 'lead', runnerId: 'claude', nativeSessionId: 'initialized' } },
        hook(5, 'hook.completed', { attempt: 1, durationMs: 1200 }),
        event(6, 'tool.started', { toolUseId: 'read', name: 'Read' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'hook', name: 'Workspace setup', hookEvent: 'SessionStart', status: 'completed', durationMs: 1200, executionMode: 'sync', handlerType: 'command' });
    expect(rows[1]).toMatchObject({ kind: 'tool', name: 'Read' });
});
test('hooks use stamped attempts and historical task boundaries, never reusable IDs across attempts/runners/sessions', () => {
    const rows = activityEvents([
        event(1, 'task.created', { taskId: 'lead', attempt: 1 }), hook(2, 'hook.started'),
        event(3, 'task.continued', { taskId: 'lead', attempt: 2 }), hook(4, 'hook.started'),
        hook(5, 'hook.completed', { attempt: 1 }), hook(6, 'hook.completed', { attempt: 2 }),
        { ...hook(7, 'hook.started', { attempt: 2 }), source: { taskId: 'lead', runnerId: 'codex' } },
        { ...hook(8, 'hook.started', { attempt: 2 }), sessionId: 'other' },
        { ...hook(9, 'hook.started', { attempt: 2 }), source: { taskId: 'child', runnerId: 'claude' } },
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ kind: 'hook', status: 'completed' }); expect(rows[1]).toMatchObject({ kind: 'hook', status: 'completed' });
    const legacy = activityEvents([event(1, 'task.created', { taskId: 'lead' }), hook(2, 'hook.started'), event(3, 'task.continued', { taskId: 'lead' }), hook(4, 'hook.completed')]);
    expect(legacy).toHaveLength(2); expect(legacy[0]).toMatchObject({ status: 'unfinished' }); expect(legacy[1]).toMatchObject({ orphan: true });
});
test('completion-first hooks retain their terminal outcome after late starts; unfinished is honest and can later settle', () => {
    const rows = activityEvents([hook(1, 'hook.completed', { status: 'blocked' }), hook(2, 'hook.started', { hookName: 'Approval policy' }), event(3, 'turn.completed', { status: 'failed' })]);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ name: 'Approval policy', status: 'blocked', orphan: false });
    const start = hook(1, 'hook.started', { attempt: 1 });
    expect(activityEvents([start, event(2, 'turn.completed', { status: 'completed' })])[0]).toMatchObject({ status: 'unfinished' });
    expect(activityEvents([start, event(2, 'session.ended')])[0]).toMatchObject({ status: 'unfinished' });
    expect(activityEvents([start, event(2, 'task.state', { taskId: 'lead', state: 'failed' })])[0]).toMatchObject({ status: 'unfinished' });
    expect(activityEvents([start, event(2, 'turn.completed', { status: 'completed' }), hook(3, 'hook.completed', { attempt: 1, status: 'stopped' })])[0]).toMatchObject({ status: 'stopped' });
});
test('hook rendering is generic unless native provider attribution exists and never exposes omitted payloads or claims memory success', () => {
    const html = renderToStaticMarkup(<Activity events={[
        hook(1, 'hook.started', { hookName: '<script>native</script>', command: 'PRIVATE COMMAND', output: 'PRIVATE OUTPUT', path: 'PRIVATE PATH' }),
        hook(2, 'hook.completed', { status: 'completed' }),
        hook(3, 'hook.completed', { hookId: 'memory', hookEvent: 'UserPromptSubmit', provider: 'supermemory', integration: 'runner-plugin', status: 'failed', durationMs: 200, exitCode: 1 }),
        hook(4, 'hook.completed', { hookId: 'unknown', hookEvent: 'Stop', status: 'unknown' }),
    ]}/>);
    expect(html).toContain('Native hook'); expect(html).toContain('Supermemory runner plugin'); expect(html).toContain('Outcome unknown'); expect(html).toContain('Failed');
    expect(html).not.toContain('<script');
    for (const text of ['PRIVATE COMMAND', 'PRIVATE OUTPUT', 'PRIVATE PATH', 'Memory saved', 'Memory recalled']) expect(html).not.toContain(text);
    const generic = renderToStaticMarkup(<Activity events={[hook(1, 'hook.completed')]}/>);
    expect(generic).not.toContain('Supermemory'); expect(generic).toContain('SessionStart');
});
test('Lead generations retain activity and isolate reused hook IDs by actual task identity', () => {
    const old = hook(1, 'hook.completed', { attempt: 1 });
    const source = { taskId: 'lead-g1', memberId: 'lead', runnerId: 'claude' };
    const rows = activityEvents([old, { ...hook(2, 'hook.started', { attempt: 1 }), source }, { ...event(3, 'tool.started', { toolUseId: 'generation-tool', name: 'Read' }), source }]);
    expect(rows).toHaveLength(3); expect(rows[0]).toMatchObject({ kind: 'hook', status: 'completed' }); expect(rows[1]).toMatchObject({ kind: 'hook', status: 'running' }); expect(rows[2]).toMatchObject({ kind: 'tool', name: 'Read' });
});
