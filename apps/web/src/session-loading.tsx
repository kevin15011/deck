import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import './session-loading.css';

/** Feedback belongs to the requested route, never to the previous transcript. */
export function SessionLoading({ name, error, onRetry }: { name: string; error?: string; onRetry: () => void }) {
    const root = useRef<HTMLDivElement>(null), trace = useRef<SVGPathElement>(null);
    useLayoutEffect(() => {
        const media = gsap.matchMedia();
        media.add({ motion: '(prefers-reduced-motion: no-preference)', reduced: '(prefers-reduced-motion: reduce)' }, context => {
            if (context.conditions?.reduced || error) return;
            gsap.fromTo(root.current, { opacity: .5 }, { opacity: 1, duration: .12, ease: 'power2.out', clearProps: 'opacity' });
            gsap.fromTo(trace.current, { strokeDashoffset: 0 }, { strokeDashoffset: -114, duration: 1.7, repeat: -1, ease: 'none' });
        });
        return () => media.revert();
    }, [error]);
    return <div ref={root} className="session-loading">
        <div className="session-loading-status" role="status" aria-live="polite" aria-atomic="true">
            <svg viewBox="0 0 120 36" aria-hidden="true" focusable="false"><path className="session-loading-track" d="M8 24H32L44 8H72L84 24H112"/><path ref={trace} className="session-loading-trace" pathLength="100" d="M8 24H32L44 8H72L84 24H112"/></svg>
            <p>{error ? 'Could not open conversation' : 'Opening conversation'}</p>
            <strong>{name}</strong>
            {error && <><small>{error}</small><button type="button" className="quiet" onClick={onRetry}>Retry conversation</button></>}
        </div>
    </div>;
}
