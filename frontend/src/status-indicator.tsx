import React,{useEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
export function indicatorState(state: string, approvals = 0, questions = 0) {
    if (questions) return 'question';
    if (approvals) return 'approval';
    if (['running','cancelling'].includes(state)) return 'working';
    if (['failed', 'uncertain', 'ownership-unsettled'].includes(state)) return 'error';
    if (['queued', 'accepted', 'preparing', 'dispatching', 'created'].includes(state)) return 'waiting';
    if (state === 'completed') return 'completed';
    if (['cancelled', 'interrupted'].includes(state)) return 'stopped';
    return 'idle';
}
const labels = { question: 'Waiting for your answer', working: 'Working', approval: 'Waiting for approval', waiting: 'Waiting', error: 'Error', completed: 'Available', stopped: 'Stopped', idle: 'Available' };
export const indicatorLabel = (state: string, approvals = 0, unread = false, questions = 0) => `${labels[indicatorState(state, approvals, questions)]}${unread ? ' · Unread reply' : ''}`;
export function StatusIndicator({ state, approvals = 0, questions = 0, unread = false, recorded = false }: { recorded?: boolean; state: string; approvals?: number; questions?: number; unread?: boolean }) {
    const kind = recorded ? 'idle' : indicatorState(state, approvals, questions), ref = useRef<HTMLSpanElement>(null), [onscreen, setOnscreen] = useState(false), [pageVisible, setPageVisible] = useState(typeof document !== 'undefined' && document.visibilityState === 'visible');
    useEffect(() => { const observer = new IntersectionObserver(([entry]) => setOnscreen(!!entry?.isIntersecting)); if (ref.current) observer.observe(ref.current); const show = () => setPageVisible(document.visibilityState === 'visible'); document.addEventListener('visibilitychange', show); return () => { observer.disconnect(); document.removeEventListener('visibilitychange', show); }; }, []);
    useEffect(()=>{const node=ref.current?.querySelector('.work-orbit');if(!node||!onscreen||!pageVisible||kind!=='working')return;const media=matchMedia('(prefers-reduced-motion: reduce)');let tween:gsap.core.Tween|undefined;const update=()=>{tween?.kill();if(!media.matches)tween=gsap.to(node,{rotation:360,svgOrigin:'8 8',duration:1.5,repeat:-1,ease:'none'});else gsap.set(node,{clearProps:'transform'});};update();media.addEventListener('change',update);return()=>{media.removeEventListener('change',update);tween?.kill();gsap.set(node,{clearProps:'transform'});};},[onscreen,pageVisible,kind]);
    const label = recorded ? `Recorded ${state}${unread?' · Unread reply':''}` : state === 'unknown'  ? 'Status unavailable' : indicatorLabel(state, approvals, unread, questions);
    return <span ref={ref} className={`agent-indicator agent-indicator--${kind}`} data-state={kind} data-unread={unread || undefined} data-animate={kind === 'working' && onscreen && pageVisible || undefined} role="img" aria-label={label} title={label}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{kind === 'working' ? <path key="working" className="work-orbit" d="M8 2a6 6 0 1 1-6 6"/> : kind === 'completed' ? <circle key="completed" cx="8" cy="8" r="3"/> : kind === 'error' ? <><path d="m8 2 6 11H2Z"/><path d="M8 6v3m0 2h.01"/></> : (kind === 'approval' || kind === 'question') ? <><path d="M5 2h6v3L8 8l3 3v3H5v-3l3-3-3-3Z"/></> : kind === 'waiting' ? <><circle cx="8" cy="8" r="5.5"/><path d="M8 4v4l2 1"/></> : kind === 'stopped' ? <rect x="4" y="4" width="8" height="8" rx="1"/> : <circle cx="8" cy="8" r="3"/>}</svg>{unread && <svg className="unread-dot" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>}</span>;
}
/** A read acknowledgement is tied to this exact rendered response, never to a newer poll cursor. */
export function VisibleReply({ children, visible, replyKey, seq, acknowledge, className }: { children: React.ReactNode; visible: boolean; replyKey: string; seq: number; acknowledge: (key: string, seq: number) => void; className?: string }) {
    const ref = useRef<HTMLDivElement>(null), callback = useRef(acknowledge); callback.current = acknowledge;
    useEffect(() => {
        if (!visible || !seq || !ref.current) return;
        const element = ref.current;
        let intersecting = false;
        const check = () => {
            if (!intersecting || element.closest('details:not([open])') || document.visibilityState !== 'visible' || !document.hasFocus() || document.querySelector('dialog[open]')) return;
            const bounds = element.getBoundingClientRect(), viewport = element.closest('.conversation, .workspace-panel')?.getBoundingClientRect();
            if (!viewport || bounds.width <= 0 || bounds.height <= 0) return;
            if (Math.min(bounds.bottom, viewport.bottom, innerHeight) > Math.max(bounds.top, viewport.top, 0) && Math.min(bounds.right, viewport.right, innerWidth) > Math.max(bounds.left, viewport.left, 0)) callback.current(replyKey, seq);
        };
        const observer = new IntersectionObserver(([entry]) => { intersecting = !!entry?.isIntersecting; check(); }, { root: element.closest('.conversation, .workspace-panel') }); observer.observe(element);
        const mutations = new MutationObserver(check); mutations.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
        document.addEventListener('visibilitychange', check); window.addEventListener('focus', check); element.closest('.conversation, .workspace-panel')?.addEventListener('scroll', check, { passive: true }); check();
        return () => { observer.disconnect(); mutations.disconnect(); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); element.closest('.conversation, .workspace-panel')?.removeEventListener('scroll', check); };
    }, [visible, replyKey, seq]);
    return <div ref={ref} className={className} data-reply-seq={seq || undefined}>{children}</div>;
}
