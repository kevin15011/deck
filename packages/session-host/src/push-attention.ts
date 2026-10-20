/** Read-only attention projection. Trailing assistant text is a heuristic, not semantic proof. */
import { redactText } from '@deck/core/session/redaction';
import type { SessionEvent } from '@deck/core/session/events';
import type { Ledger } from './ledger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
export type AttentionKind = 'question' | 'approval' | 'decision' | 'result' | 'finished' | 'failure';
export type AttentionItem = {
    sessionId: string;
    kind: AttentionKind;
    key: string;
    revision: number;
    seq: number;
    ts: number;
    summary?: string;
    replyId?: string;
    othersActive?: boolean;
};
const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment);
const SUMMARY_INPUT_LIMIT = 8192;
type ProseNode = { type: string; value?: string; alt?: string | null; children?: ProseNode[] };
export function summarize(text: string): string | undefined {
    // At-limit input may already be truncated upstream: never publish an unclassified prefix.
    if (text.length >= SUMMARY_INPUT_LIMIT) return undefined;
    const blocks: string[] = [];
    try {
        const root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
        const check = [{ node: root as ProseNode, depth: 0 }];
        let nodes = 0;
        while (check.length) {
            const { node, depth } = check.pop()!;
            if (++nodes > SUMMARY_INPUT_LIMIT || depth > 64) return undefined;
            for (const child of node.children ?? []) check.push({ node: child, depth: depth + (child.type === 'list' || child.type === 'blockquote' ? 1 : 0) });
        }
        const pending: { node: ProseNode; depth: number; listed: boolean }[] = [{ node: root, depth: 0, listed: false }];
        let budget = SUMMARY_INPUT_LIMIT;
        while (pending.length) {
            const { node, depth, listed } = pending.pop()!;
            if (--budget < 0 || depth > 128) return undefined;
            if (node.type === 'paragraph') {
                let prose = '';
                const inline = [...(node.children ?? [])].reverse();
                while (inline.length) {
                    const child = inline.pop()!;
                    if (--budget < 0) return undefined;
                    if (child.type === 'text' || child.type === 'inlineCode') prose += child.value ?? '';
                    else if (child.type === 'image') prose += child.alt ?? '';
                    else if (child.type === 'break') prose += ' ';
                    else if (['emphasis', 'strong', 'delete', 'link', 'linkReference'].includes(child.type))
                        inline.push(...[...(child.children ?? [])].reverse());
                }
                prose = prose.replace(/https?:\/\/[^\s<>]+/g, u => { try { return new URL(u).hostname; } catch { return ''; } }).replace(/\s+/g, ' ').trim();
                prose = redactText(prose, SUMMARY_INPUT_LIMIT);
                if (/\[redacted/i.test(prose)) continue;
                prose = prose.replace(/\S+/gu, token => Array.from(token).length > 40 ? '…' : token);
                if (listed && blocks.at(-1)?.match(/[:：]$/)) blocks.pop();
                if (prose) blocks.push(prose);
            } else if (['root', 'blockquote', 'list', 'listItem'].includes(node.type)) {
                const children = node.children ?? [];
                for (let i = children.length - 1; i >= 0; i--)
                    pending.push({ node: children[i]!, depth: depth + 1, listed: listed || node.type === 'list' });
            }
            // Only prose containers are traversed. Code, tables, HTML, headings,
            // definitions and unknown extension subtrees cannot contribute content.
        }
    } catch { return undefined; }
    let result = '';
    for (const rawBlock of blocks) {
        const block = redactText(rawBlock, 8192);
        if (/\[redacted/i.test(block)) continue;
        const sentence = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block)][0]?.segment.trim() ?? '';
        const next = result ? result + ' · ' + sentence : sentence;
        if (graphemes(next).length <= 160) {
            result = next;
            continue;
        }
        if (!result) {
            const prefix = graphemes(sentence).slice(0, 159).join('');
            const words = [...new Intl.Segmenter(undefined, {granularity:'word'}).segment(sentence)];
            const boundary = words.filter(w => w.index + w.segment.length <= prefix.length).at(-1);
            result = (boundary ? sentence.slice(0, boundary.index + boundary.segment.length).trimEnd() : prefix) + '…';
        }
        break;
    }
    const parts = graphemes(result);
    while (Buffer.byteLength(parts.join('')) > 480)
        parts.pop();
    // redactText's UTF-16 cap can bisect a surrogate pair; never transmit a lone half.
    return Array.from(parts.join('')).filter(c => { const n = c.codePointAt(0)!; return n < 0xd800 || n > 0xdfff; }).join('').trim() || undefined;
}
export function finalSegment(events: Iterable<SessionEvent>, taskId: string, start: number, end: number): string {
    let texts: string[] = [];
    for (const e of events) {
        if (e.seq <= start || e.seq >= end || e.source.taskId !== taskId)
            continue;
        if (e.kind === 'message.completed') {
            if (e.data.role !== 'assistant') {
                texts = [];
                continue;
            }
            if (typeof e.data.text === 'string' && !e.data.internal && e.data.text.trim())
                texts.push(e.data.text.slice(0, 8192));
        }
        else if (/^(tool\.(started|completed)|question\.|approval\.|task\.(integration|delivery|retrieval)|decision\.)/.test(e.kind))
            texts = [];
    }
    return texts.join('\n\n').slice(0, 8192);
}
export type AttentionInput = {
    ledger: Ledger;
    events: (after?: number) => Iterable<SessionEvent>;
    leadTaskId: string;
    running: ReadonlySet<string>;
    disabled?: boolean;
    idle: boolean;
    notices: number;
    preparationFailed?: boolean;
};
export function deriveAttention(i: AttentionInput): AttentionItem[] {
    const l = i.ledger, s = l.session;
    if (i.disabled || s.removed || s.removalPending || s.stopRequested || s.state === 'ended' || s.state === 'stopping' || s.released && !s.releaseFailure)
        return [];
    // Bound retained content and extraction work. If a turn exceeds the window, fail
    // closed for reply/result attention; unresolved structured attention still derives.
    const lead = l.latest(i.leadTaskId);
    const events: SessionEvent[] = [];
    let overflow = false;
    if (lead)
        for (const e of i.events(lead.startedSeq)) {
            if(lead.endedSeq && e.seq > lead.endedSeq)break;
            if (events.length >= 4096) {
                overflow = true;
                break;
            }
            events.push({...e,data:{status:e.data.status,role:e.data.role,internal:e.data.internal,...(e.kind==='message.completed'&&typeof e.data.text==='string'?{text:e.data.text.slice(0,8192)}:{})}});
        }
    const time = (seq: number) => { for (const e of i.events(seq - 1)) {
        if (e.seq === seq)
            return Date.parse(e.ts);
        if (e.seq >= seq)
            break;
    } return undefined; };
    const out: AttentionItem[] = [];
    const add = (kind: AttentionKind, key: string, seq: number, revision = 1, summary?: string, othersActive?: boolean) => { const ts = time(seq); if (seq > 0 && ts !== undefined && Number.isFinite(ts))
        out.push({ sessionId: l.sessionId, kind, key, seq, revision, ts, ...(summary ? { summary } : {}), ...(othersActive ? { othersActive } : {}) }); };
    for (const q of l.pendingQuestions())
        add('question', `question:${q.questionId}`, q.seq);
    for (const a of l.pendingApprovals())
        add('approval', `approval:${a.approvalId}`, a.seq);
    for (const d of l.decisions())
        if (d.state === 'pending' && !i.running.has(`${d.origin.taskId}:${d.origin.attempt}`))
            add('decision', `decision:${d.decisionId}`, d.questionSeq, d.questionRevision, summarize(d.question));
    if (!overflow && lead?.state === 'completed' && !i.running.has(`${i.leadTaskId}:${lead.attempt}`)) {
        const end = events.find(e => e.seq > lead.startedSeq && e.kind === 'turn.completed' && e.source.taskId === i.leadTaskId && e.data.status === 'completed')?.seq;
        if (end && !l.prompts().some(p => (p.firstAdmissionSeq ?? 0) > end)) {
            const integrations = l.tasks().flatMap(t => t.attempts.flatMap(a => a.integrations ?? (a.integration ? [a.integration] : []))).filter(x => x.state === 'integrated' && x.leadTaskId === i.leadTaskId && x.leadAttempt === lead.attempt);
            const last = Math.max(0, ...integrations.map(x => x.seq));
            const text = finalSegment(events, i.leadTaskId, Math.max(lead.startedSeq, last), end);
            const others = l.tasks().some(t => t.memberId !== 'lead' && ['created', 'queued', 'running'].includes(t.attempts.at(-1)?.state ?? '')) || l.prompts().some(p => p.state === 'queued');
            if (last && text)
                add('result', `result:${i.leadTaskId}:${lead.attempt}`, end, 1, summarize(text), others);
            else if (i.idle)
                add('finished', `finished:${i.leadTaskId}:${lead.attempt}`, end, 1, summarize(text));
        }
    }
    if (lead?.state === 'failed' && (l.promptQueue.lastResumeSeq ?? 0) < (lead.endedSeq ?? 0))
        add('failure', `lead-failed:${i.leadTaskId}:${lead.attempt}`, lead.endedSeq!);
    for (const t of l.tasks()) {
        const a = t.attempts.at(-1);
        if (a?.state === 'ownership-unsettled' && (t.memberId === 'lead' || i.notices > 0))
            add('failure', `unsettled:${t.taskId}:${a.attempt}`, a.unsettledSeq ?? 0);
    }
    if (s.releaseFailure)
        add('failure', `release:${s.releaseEpoch}`, s.releaseFailureSeq ?? 0);
    if (i.preparationFailed) {
        let latest: SessionEvent | undefined;
        for (const e of i.events(Math.max(0, l.seq - 256)))
            if (e.kind === 'diagnostic' && e.data.code === 'session.preparation' && e.data.status === 'failed')
                latest = e;
        if (latest)
            add('failure', `prep:${latest.seq}`, latest.seq);
    }
    return out;
}
