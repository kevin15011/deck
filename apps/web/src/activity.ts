import type { SessionEvent } from '../../../packages/core/src/session/events';
import { redactText } from '../../../packages/core/src/session/redaction';
import { isLeadEvent } from './event-source';

type ActivityBase = { key: string; ts: string; runner?: string };
export type ToolActivity = ActivityBase & {
    kind: 'tool'; name: string; server?: string; summary: string; skill?: string;
    status: 'running' | 'completed' | 'failed' | 'interrupted' | 'unfinished';
    input?: unknown; output?: unknown; error?: unknown; exitCode?: number; durationMs?: number; orphan: boolean;
};
export type ReasoningActivity = ActivityBase & { kind: 'reasoning'; text: string; summary: boolean };
export type AssignmentActivity = ActivityBase & { kind: 'transition'; title: string; text: string };
export type HookActivity = ActivityBase & {
    kind: 'hook'; name: string; hookId: string; hookEvent: string; provenance: string;
    status: 'running' | 'completed' | 'failed' | 'blocked' | 'stopped' | 'unknown' | 'unfinished';
    executionMode?: string; handlerType?: string; durationMs?: number; exitCode?: number; provider?: 'supermemory'; orphan: boolean;
};
export type LeadActivity = ToolActivity | ReasoningActivity | HookActivity | AssignmentActivity;
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length ? value : undefined;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Old ledgers may predate mapper sanitization; apply the same display policy on replay. */
export function activityText(value: unknown, cap = 24000): string {
    const text = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);
    return redactText(text, cap) + (text.length > cap ? '\n[Display truncated]' : '');
}

function toolSummary(input: unknown): string {
    const fields = object(input);
    const summary = fields ? ['command', 'file_path', 'filePath', 'path', 'query', 'pattern', 'name_pattern', 'url', 'skill'].map(key => string(fields[key])).find(Boolean) : string(input);
    return summary ? activityText(summary, 220) : '';
}
function mergeTool(row: ToolActivity, event: SessionEvent) {
    const data = event.data;
    row.name = string(data.toolName) ?? string(data.name) ?? (row.name === 'Tool' ? string(data.tool) : undefined) ?? row.name;
    row.server = string(data.server) ?? row.server;
    if (data.input !== undefined) row.input = data.input;
    if (data.output !== undefined || data.result !== undefined) row.output = data.output ?? data.result;
    if (data.error !== undefined && data.error !== null) row.error = data.error;
    if (typeof data.exitCode === 'number') row.exitCode = data.exitCode;
    if (typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0) row.durationMs = data.durationMs;
    row.summary = toolSummary(row.input);
    row.skill = row.name.toLowerCase() === 'skill' && row.input !== undefined ? string(object(row.input)?.skill) ?? string(object(row.input)?.name) ?? string(row.input) : undefined;
    if (event.kind === 'tool.completed') {
        row.status = data.isError === true || row.error !== undefined || (row.exitCode !== undefined && row.exitCode !== 0) || data.status === 'failed' ? 'failed'
            : ['interrupted', 'cancelled', 'canceled'].includes(String(data.status)) ? 'interrupted' : 'completed';
    }
}

/** Project explicit normalized Lead work; opaque runner envelopes never enter the UI. */
export function activityEvents(events: SessionEvent[]): LeadActivity[] {
    const rows: LeadActivity[] = [], turns = new Map<string, number>(), calls = new Map<string, ToolActivity>();
    const active = new Map<string, Set<ToolActivity>>(), seen = new Set<string>(), snapshots = new Map<string, string>();
    const scopes = new Set<string>();
    const hookCalls = new Map<string, { row: HookActivity; attemptScope: string; settled: boolean }>();
    const hookAttempts = new Map<string, string>(), hookBoundaries = new Map<string, number>(), closedHookAttempts = new Set<string>();
    const attemptNumber = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
    function closeHooks(sessionId: string, runner?: string) {
        const matches = (base: string) => { const [session, , sourceRunner] = JSON.parse(base); return session === sessionId && (!runner || sourceRunner === runner); };
        for (const [base, attempt] of hookAttempts) if (matches(base)) closedHookAttempts.add(JSON.stringify([base, attempt]));
        for (const record of hookCalls.values()) {
            const [base] = JSON.parse(record.attemptScope);
            if (!matches(base)) continue;
            closedHookAttempts.add(record.attemptScope);
            if (!record.settled) record.row.status = 'unfinished';
        }
    }
    let reasoning: { row: ReasoningActivity; stream: string; format: string; offset: number } | undefined;
    function close(scope: string, status: ToolActivity['status']) {
        for (const row of active.get(scope) ?? []) if (row.status === 'running') row.status = status;
        active.delete(scope); turns.set(scope, (turns.get(scope) ?? 0) + 1);
        reasoning = undefined;
    }
    for (const event of events) {
        const receipt = JSON.stringify([event.sessionId, event.seq]);
        if (seen.has(receipt)) continue;
        seen.add(receipt);
        if (event.data.internal === true || event.data.role === 'system' || !isLeadEvent(event)) continue;
        const scope = JSON.stringify([event.sessionId, event.source.runnerId, event.source.nativeSessionId, event.source.taskId ?? 'lead']);
        scopes.add(scope);
        const turn = JSON.stringify([scope, turns.get(scope) ?? 0]);
        const hookBase = JSON.stringify([event.sessionId, event.source.taskId ?? 'lead', event.source.runnerId ?? string(event.data.runnerId)]);
        if (event.kind === 'task.created' || event.kind === 'task.continued') {
            closeHooks(event.sessionId);
            const boundary = (hookBoundaries.get(hookBase) ?? 0) + 1;
            hookBoundaries.set(hookBase, boundary);
            const attempt = attemptNumber(event.data.attempt);
            hookAttempts.set(hookBase, attempt ? `attempt:${attempt}` : `legacy:${boundary}`);
        }
        if (event.kind === 'task.state' && ['completed', 'failed', 'interrupted', 'cancelled', 'ownership-unsettled'].includes(String(event.data.state))) closeHooks(event.sessionId, event.source.runnerId);
        if (event.kind === 'session.assignment') {
            reasoning = undefined;
            const assignment = object(event.data.assignment), previous = object(event.data.previous), member = string(event.data.memberId);
            if (!member || !string(assignment?.runnerId) || !string(assignment?.modelId)) continue;
            const before = previous && string(previous.runnerId) && string(previous.modelId) ? `${previous.runnerId} / ${previous.modelId} → ` : '';
            rows.push({ kind: 'transition', key: receipt, ts: event.ts, title: member === 'lead' ? 'Lead assignment changed' : `${member} assignment changed`, text: `${before}${assignment!.runnerId} / ${assignment!.modelId}${event.data.continuity === 'reseeded' ? '. New native context with a limited handoff.' : ''}` });
            continue;
        }
        if (event.kind === 'session.ended') {
            closeHooks(event.sessionId);
            for (const key of scopes) if (JSON.parse(key)[0] === event.sessionId) close(key, 'unfinished');
            reasoning = undefined; continue;
        }
        if (event.kind === 'turn.started' || event.kind === 'turn.completed' || event.kind === 'task.continued') {
            if (event.kind === 'turn.completed') closeHooks(event.sessionId, event.source.runnerId);
            const status = event.data.status;
            // Host lifecycle events can omit nativeSessionId. A Lead runs one turn per runner.
            for (const key of scopes) {
                const [session, runner] = JSON.parse(key);
                if (session === event.sessionId && (!event.source.runnerId || runner === event.source.runnerId))
                    close(key, typeof status === 'string' && status.startsWith('interrupted') ? 'interrupted' : 'unfinished');
            }
            continue;
        }
        if (event.kind === 'hook.started' || event.kind === 'hook.completed') {
            reasoning = undefined;
            const hookId = string(event.data.hookId), hookEvent = string(event.data.hookEvent);
            if (!hookId || !hookEvent) continue;
            const explicit = attemptNumber(event.data.attempt);
            const attempt = explicit ? `attempt:${explicit}` : hookAttempts.get(hookBase) ?? 'legacy:0';
            const attemptScope = JSON.stringify([hookBase, attempt]), key = JSON.stringify([attemptScope, hookId]);
            let record = hookCalls.get(key);
            if (!record) {
                const row: HookActivity = { kind: 'hook', key: receipt, ts: event.ts, runner: event.source.runnerId, name: hookEvent, hookId, hookEvent, provenance: '', status: 'unknown', orphan: event.kind === 'hook.completed' };
                record = { row, attemptScope, settled: false }; hookCalls.set(key, record); rows.push(row);
            }
            const { row } = record;
            row.name = string(event.data.hookName) ?? row.name;
            row.provenance = string(event.data.provenance) ?? row.provenance;
            row.executionMode = string(event.data.executionMode) ?? row.executionMode;
            row.handlerType = string(event.data.handlerType) ?? row.handlerType;
            if (typeof event.data.durationMs === 'number' && Number.isFinite(event.data.durationMs) && event.data.durationMs >= 0) row.durationMs = event.data.durationMs;
            if (typeof event.data.exitCode === 'number' && Number.isInteger(event.data.exitCode)) row.exitCode = event.data.exitCode;
            if (event.data.provider === 'supermemory' && event.data.integration === 'runner-plugin') row.provider = 'supermemory';
            if (event.kind === 'hook.started') row.orphan = false;
            if (event.kind === 'hook.completed' || !record.settled) {
                row.status = ['running', 'completed', 'failed', 'blocked', 'stopped', 'unknown'].includes(String(event.data.status)) ? event.data.status as HookActivity['status'] : 'unknown';
                if (event.kind === 'hook.completed') { record.settled = true; if (row.status === 'running') row.status = 'unknown'; }
                else if (closedHookAttempts.has(attemptScope)) row.status = 'unfinished';
            }
            continue;
        }
        if (event.kind === 'reasoning.delta') {
            const text = string(event.data.text);
            if (!text) continue;
            const format = string(event.data.format), summary = event.data.reasoningKind === 'summary';
            const identity = [event.data.messageId, event.data.partId ?? event.data.blockIndex];
            const stream = JSON.stringify([turn, ...identity, summary]);
            const adjacent = reasoning?.stream === stream && reasoning.format === format;
            const identified = identity.some(value => value !== undefined);
            const previous = identified || reasoning?.stream === stream ? snapshots.get(stream) : undefined;
            if (format === 'snapshot') {
                snapshots.set(stream, text);
                if (reasoning?.stream === stream) {
                    if (previous && !text.startsWith(previous)) reasoning!.offset = 0;
                    reasoning!.row.text = text.slice(reasoning!.offset); reasoning!.format = format; continue;
                }
                if (previous === text) continue;
                // A cumulative snapshot after a tool adds only the newly reported suffix.
                const offset = previous && text.startsWith(previous) ? previous.length : 0;
                const row: ReasoningActivity = { kind: 'reasoning', key: receipt, ts: event.ts, runner: event.source.runnerId, text: text.slice(offset), summary };
                rows.push(row); reasoning = { row, stream, format, offset };
            } else if (format === 'delta' && adjacent) {
                reasoning!.row.text += text; snapshots.set(stream, (previous ?? '') + text);
            }
            else {
                const row: ReasoningActivity = { kind: 'reasoning', key: receipt, ts: event.ts, runner: event.source.runnerId, text, summary };
                rows.push(row);
                if (format === 'delta') snapshots.set(stream, (previous ?? '') + text);
                reasoning = format === 'delta' ? { row, stream, format, offset: previous?.length ?? 0 } : undefined;
            }
            continue;
        }
        if (event.kind === 'tool.started' || event.kind === 'tool.completed') {
            reasoning = undefined;
            const id = string(event.data.toolUseId) ?? string(event.data.toolCallId);
            const call = id ? JSON.stringify([turn, id]) : undefined;
            let row = call ? calls.get(call) : undefined;
            if (!row) {
                row = { kind: 'tool', key: receipt, ts: event.ts, runner: event.source.runnerId, name: 'Tool', summary: '', status: 'running', orphan: event.kind === 'tool.completed' };
                rows.push(row);
                if (call) calls.set(call, row);
                if (!active.has(scope)) active.set(scope, new Set());
                active.get(scope)!.add(row);
            }
            mergeTool(row, event);
        } else if (event.kind.startsWith('message.')) reasoning = undefined;
    }
    return rows;
}
