import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import lead from './assets/avatars/lead.png';
import investigate from './assets/avatars/investigate.png';
import architect from './assets/avatars/architect.png';
import applyFast from './assets/avatars/apply-fast.png';
import applyDeep from './assets/avatars/apply-deep.png';
import quality from './assets/avatars/quality.png';

const avatars: Record<string, { label: string; src: string }> = {
    lead: { label: 'Lead', src: lead },
    investigate: { label: 'Investigate', src: investigate },
    architect: { label: 'Architect', src: architect },
    'apply-fast': { label: 'Apply Fast', src: applyFast },
    'apply-deep': { label: 'Apply Deep', src: applyDeep },
    quality: { label: 'Quality', src: quality },
};

/** Team members are named `deck-<role>`; unknown members fall back to a monogram. */
export function agentProfile(memberId: string): { label: string; src?: string } {
    const key = memberId.replace(/^deck-/, '');
    return avatars[key] ?? { label: memberId };
}

export function Avatar({ memberId, size = 48 }: { memberId: string; size?: number }) {
    const { label, src } = agentProfile(memberId);
    return src
        ? <img className="agent-avatar" src={src} alt="" width={size} height={size} draggable={false}/>
        : <span className="agent-avatar agent-avatar--fallback" style={{ width: size, height: size }} aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Keeps a scroll container pinned to its newest content while the reader is at the bottom.
 * Scrolling up pauses following; `jump` resumes it. `active` re-pins when the container is revealed.
 */
export function useFollowBottom<T extends HTMLElement>(ref: RefObject<T | null>, signal: unknown, active = true) {
    const pinned = useRef(true), [behind, setBehind] = useState(false);
    const measure = useCallback(() => {
        const element = ref.current;
        if (!element) return;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        if (pinned.current) setBehind(false);
    }, [ref]);
    useEffect(() => {
        const element = ref.current;
        element?.addEventListener('scroll', measure, { passive: true });
        return () => element?.removeEventListener('scroll', measure);
    }, [ref, measure]);
    useLayoutEffect(() => {
        if (active) { pinned.current = true; setBehind(false); const element = ref.current; if (element) element.scrollTop = element.scrollHeight; }
    }, [active]);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !active) return;
        if (pinned.current) element.scrollTop = element.scrollHeight;
        else setBehind(true);
    }, [signal]);
    const jump = useCallback(() => {
        const element = ref.current;
        if (!element) return;
        pinned.current = true; setBehind(false);
        element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    }, [ref]);
    return { behind, jump };
}

/** Scrolling conversation that follows new messages. `children` are the message articles. */
export function FollowTranscript({ signal, active, className, label, children }: { signal: unknown; active: boolean; className?: string; label: string; children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null), { behind, jump } = useFollowBottom(ref, signal, active);
    return <div className="transcript-frame">
        <div ref={ref} className={className} tabIndex={0} role="log" aria-live="off" aria-label={label}>{children}</div>
        {behind && <button type="button" className="transcript-latest" onClick={jump}>New messages ↓</button>}
    </div>;
}
