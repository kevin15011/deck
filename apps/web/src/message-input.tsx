import React, { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

function resize(input: HTMLTextAreaElement) {
    if (!input.clientWidth) return;
    const style = getComputedStyle(input);
    const line = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const scrollTop = input.scrollTop;
    input.style.height = '0px';
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.max(line + padding + border, Math.min(contentHeight + border, line * 4 + padding + border))}px`;
    input.style.overflowY = contentHeight > line * 4 + padding ? 'auto' : 'hidden';
    input.scrollTop = scrollTop;
}

/** One visible line, growing with wrapped text up to four lines. */
export function MessageInput({ value, ...props }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'rows' | 'style'> & { value: string }) {
    const input = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => { if (input.current) resize(input.current); }, [value]);
    useLayoutEffect(() => {
        const element = input.current;
        if (!element) return;
        let width = element.clientWidth;
        const observer = new ResizeObserver(() => {
            const next = element.clientWidth;
            if (width !== next) { width = next; resize(element); }
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return <textarea {...props} ref={input} value={value} rows={1} spellCheck={false}/>;
}
