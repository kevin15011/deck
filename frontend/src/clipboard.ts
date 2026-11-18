/** Copy source text unchanged, including on LAN HTTP where Clipboard API is unavailable. */
export async function copyText(text: string): Promise<void> {
    try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
    } catch { /* A denied Clipboard API can still permit the legacy user-gesture copy. */ }
    const active = document.activeElement as HTMLElement | null;
    const selection = document.getSelection();
    const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.tabIndex = -1;
    Object.assign(textarea.style, {position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px', pointerEvents: 'none'});
    document.body.appendChild(textarea);
    try {
        textarea.select();
        if (!document.execCommand?.('copy')) throw new Error('Copy failed');
    } finally {
        textarea.remove();
        active?.focus?.({preventScroll: true});
        if (selection && ranges.length) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
    }
}
