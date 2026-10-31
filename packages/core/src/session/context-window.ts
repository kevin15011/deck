import type { SessionEvent } from './events';
import { redactText } from './redaction';

/** Native context estimates use runner-specific arithmetic. Legacy aggregate
 * and input-only bases remain readable but cannot yield a usage percentage. */
export type ContextObservation = {
    basis: 'codex-last-total' | 'claude-aggregate-input' | 'opencode-message-input' | 'claude-last-request-input' | 'opencode-assistant-context';
    tokens: number | null;
    capacity: number | null;
    nativeThreadId: string;
    /** Same request fence used by each driver: Codex turn id, OpenCode native
     * user-message parent id, or Claude's per-process execution/user-message id. */
    nativeTurnId: string;
    modelId?: string;
};
export const contextIdentity = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 256 && redactText(v, 256) === v;
export const contextTokens = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export const contextCapacity = (v: unknown): number | null => contextTokens(v) !== null && (v as number) > 0 ? v as number : null;

/** Allowlist copied at both native and snapshot boundaries; raw never survives. */
export function sanitizeContextObservation(value: unknown): ContextObservation | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const c = value as Record<string, unknown>;
    if (!['codex-last-total', 'claude-aggregate-input', 'opencode-message-input', 'claude-last-request-input', 'opencode-assistant-context'].includes(String(c.basis)) || !contextIdentity(c.nativeThreadId) || !contextIdentity(c.nativeTurnId)) return;
    if (c.modelId !== undefined && !contextIdentity(c.modelId)) return;
    return { basis: c.basis as ContextObservation['basis'], tokens: contextTokens(c.tokens), capacity: contextCapacity(c.capacity), nativeThreadId: c.nativeThreadId, nativeTurnId: c.nativeTurnId, ...(c.modelId ? { modelId: c.modelId as string } : {}) };
}

/** Missing, fractional or overflowing components are unknown, never zero. */
export function contextTokenSum(...values: unknown[]): number | null {
    let sum = 0;
    for (const value of values) {
        const tokens = contextTokens(value);
        if (tokens === null || !Number.isSafeInteger(sum + tokens)) return null;
        sum += tokens;
    }
    return sum;
}

/** Mirrors Codex rust-v0.162.1's baseline-adjusted remaining percentage and
 * OpenCode v1.19.1's rounded ratio. Claude's latest-response input formula is
 * documented by its statusline API; Deck rounds that estimate for display.
 * No cumulative accounting or legacy input-only observation feeds a ratio. */
export function contextEstimate(value: unknown): { used: number | null; max: number | null; percent: number | null } {
    const c = sanitizeContextObservation(value);
    const max = c?.capacity ?? null;
    const used = c && ['codex-last-total', 'claude-last-request-input', 'opencode-assistant-context'].includes(c.basis) ? c.tokens : null;
    let percent: number | null = null;
    if (used !== null && max !== null) {
        percent = c?.basis === 'codex-last-total'
            ? max <= 12000 ? 100 : 100 - Math.round(Math.min(100, Math.max(0, max - 12000 - Math.max(used - 12000, 0)) / (max - 12000) * 100))
            : Math.round(used / max * 100);
    }
    return { used, max, percent };
}

type Fence = { attempt?: number; memberId?: string; runnerId?: string; thread?: string; turn?: string; model?: string; closed: boolean; compacted: boolean; observation?: SessionEvent; threadEvidence?: SessionEvent; turnEvidence?: SessionEvent };
const attemptNumber = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined;
const terminal = new Set(['completed', 'failed', 'interrupted', 'cancelled', 'ownership-unsettled']);

/** Retain only the identities established by an accepted lifecycle event, never
 * native init bodies or arbitrary task-state metadata. Do not truncate IDs. */
function attributionEvent(event: SessionEvent): SessionEvent | undefined {
    const source: SessionEvent['source'] = {}, data: Record<string, unknown> = {};
    for (const key of ['taskId', 'memberId', 'runnerId', 'nativeSessionId'] as const) {
        const value = event.source[key];
        if (value !== undefined && !contextIdentity(value)) return;
        if (value !== undefined) source[key] = value;
    }
    for (const key of ['taskId', 'nativeSessionId', 'nativeThreadId', 'nativeTurnId', 'modelId'])
        if (contextIdentity(event.data[key])) data[key] = event.data[key];
    const attempt = attemptNumber(event.data.attempt);
    if (attempt !== undefined) data.attempt = attempt;
    if (['created', 'queued', 'running', ...terminal].includes(String(event.data.state))) data.state = event.data.state;
    return { v: 1, sessionId: event.sessionId, seq: event.seq, ts: event.ts, kind: event.kind, source, data };
}

/** One sanitized last observation and one lifecycle fence per task. Shared by
 * host snapshots and browser projection; historical conversation never feeds it. */
export class ContextWindowProjection {
    private sessionId?: string;
    private seq = 0;
    private ended = false;
    private tasks = new Map<string, Fence>();
    apply(event: SessionEvent): void {
        this.sessionId ??= event.sessionId;
        if (event.sessionId !== this.sessionId || event.seq <= this.seq) return;
        this.seq = event.seq;
        const { kind, data, source } = event;
        if (kind === 'session.ended' || kind === 'session.removed' || kind === 'session.released') { this.ended = true; this.tasks.clear(); return; }
        if (kind === 'session.reopened') this.ended = false;
        if (this.ended) return;
        if (kind === 'session.assignment') {
            for (const f of this.tasks.values()) if (f.memberId === data.memberId) { f.observation = undefined; f.closed = true; }
            return;
        }
        const task = String(source.taskId ?? data.taskId ?? 'lead');
        let f = this.tasks.get(task);
        const attempt = attemptNumber(data.attempt);
        if (kind === 'task.created' || kind === 'task.continued') {
            if (f?.attempt && attempt && attempt < f.attempt) return;
            f = { attempt: attempt ?? (kind === 'task.created' ? 1 : undefined), memberId: source.memberId, runnerId: source.runnerId, thread: contextIdentity(source.nativeSessionId ?? data.nativeSessionId) ? String(source.nativeSessionId ?? data.nativeSessionId) : undefined, model: contextIdentity(data.modelId) ? data.modelId : undefined, closed: false, compacted: false };
            this.tasks.set(task, f);
            return;
        }
        if (!f) {
            if (kind !== 'turn.started' && kind !== 'task.state') return;
            f = { attempt, memberId: source.memberId, closed: false, compacted: false };
            this.tasks.set(task, f);
        }
        if (attempt && f.attempt && attempt !== f.attempt) return;
        if (kind === 'turn.started') {
            if (f.compacted && f.turn && data.nativeTurnId === f.turn) return;
            f.observation = undefined; f.compacted = false; f.closed = false;
            f.attempt = attempt ?? f.attempt;
            f.turn = contextIdentity(data.nativeTurnId) ? data.nativeTurnId : undefined;
            f.turnEvidence = attributionEvent(event);
        }
        if (kind === 'task.state' || kind === 'turn.started') {
            const thread = source.nativeSessionId ?? data.nativeThreadId ?? data.nativeSessionId;
            const model = data.modelId;
            if (contextIdentity(thread)) {
                // Later task.state/turn.completed records replace these events
                // in CurrentEvents. Preserve the establishing evidence before
                // the usage event, including when creation had no native id.
                if (f.thread !== thread) f.threadEvidence = attributionEvent(event);
                if (f.thread && f.thread !== thread) { f.observation = undefined; f.turn = undefined; if (kind === 'task.state') f.closed = true; }
                f.thread = thread;
            }
            if (contextIdentity(model)) { if (f.model && f.model !== model) { f.observation = undefined; if (kind === 'task.state') f.closed = true; } f.model = model; }
            if (source.runnerId && f.runnerId && source.runnerId !== f.runnerId) { f.observation = undefined; if (kind === 'task.state') f.closed = true; }
            f.runnerId = source.runnerId ?? f.runnerId; f.memberId = source.memberId ?? f.memberId;
            f.attempt ??= attempt;
            if (kind === 'task.state' && terminal.has(String(data.state))) f.closed = true;
        }
        if (kind === 'turn.completed') {
            if (source.nativeSessionId && f.thread && source.nativeSessionId !== f.thread || source.runnerId && f.runnerId && source.runnerId !== f.runnerId || data.nativeTurnId && f.turn && data.nativeTurnId !== f.turn) return;
            f.closed = true; return;
        }
        if (kind === 'diagnostic' && (data.code === 'context.compaction' && data.state === 'started' || data.code === 'context.invalidated')
            && !data.internal && (data.code === 'context.invalidated' || !f.closed) && data.nativeThreadId === f.thread
            && (!source.runnerId || source.runnerId === f.runnerId) && (!source.nativeSessionId || source.nativeSessionId === f.thread)
            && (!f.turn || data.nativeTurnId === f.turn || data.code === 'context.invalidated' && data.nativeTurnId === undefined)) {
            f.observation = undefined; f.compacted = true; return;
        }
        if (kind !== 'usage' || data.internal || f.closed || f.compacted) return;
        const c = sanitizeContextObservation(data.context);
        if (!c || !attempt || attempt !== f.attempt || source.runnerId !== f.runnerId
            || c.nativeThreadId !== f.thread || source.nativeSessionId !== c.nativeThreadId || f.turn && c.nativeTurnId !== f.turn) return;
        // An explicitly reported native model may resolve an alias. Never mix
        // counters/capacity across observations: replace the whole observation.
        f.turn ??= c.nativeTurnId;
        f.observation = { v: 1, sessionId: event.sessionId, seq: event.seq, ts: event.ts, kind: 'usage', source: { ...source }, data: { attempt, context: c } };
    }
    values(): SessionEvent[] { return [...this.tasks.values()].flatMap(f => f.observation ? [f.observation] : []).sort((a, b) => a.seq - b.seq); }
    /** At most two sanitized attribution records per task, also retained during
     * compaction so reconnect cannot erase the fence while usage is unavailable. */
    attributionEvents(): SessionEvent[] { return [...this.tasks.values()].flatMap(f => [f.threadEvidence, f.turnEvidence].filter((e): e is SessionEvent => e !== undefined)); }
}
