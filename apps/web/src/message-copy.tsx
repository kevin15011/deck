import React, { useEffect, useRef, useState } from 'react';
import { copyText } from './clipboard';

export function MessageCopy({ text }: { text: string }) {
    const [status, setStatus] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    return <span className="message-copy-control">
        <button type="button" className="quiet message-copy" aria-label="Copy message" title="Copy message" onClick={async () => {
            clearTimeout(timer.current);
            setStatus('');
            try { await copyText(text); setStatus('Copied'); }
            catch { setStatus('Copy failed'); }
            timer.current = setTimeout(() => setStatus(''), 1500);
        }}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d={status === 'Copied' ? 'm3 8 3 3 7-7' : 'M6 6h7v8H6ZM10 6V2H2v8h4'}/>
            </svg>
        </button>
        <span className={status === 'Copy failed' ? 'message-copy-error' : 'sr-only'} role="status" aria-live="polite" aria-atomic="true">{status}</span>
    </span>;
}
