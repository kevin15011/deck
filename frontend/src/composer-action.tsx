import React, {useLayoutEffect, useRef} from 'react';

type ComposerActionProps = {
    stop: boolean;
    stopping: boolean;
    disabled: boolean;
    label: string;
    title: string;
    onStop: () => void;
};

export function ComposerAction({stop, stopping, disabled, label, title, onStop}: ComposerActionProps) {
    const action = useRef<HTMLButtonElement>(null);
    const focused = useRef(false);

    useLayoutEffect(() => {
        const button = action.current;
        if (!button || !disabled || !focused.current) return;
        focused.current = false;
        if (document.activeElement !== document.body && document.activeElement !== button) return;
        const prompt = button.form?.querySelector('textarea');
        if (prompt?.getClientRects().length && !prompt.disabled && !prompt.closest('[hidden], [inert]')) {
            prompt.focus({preventScroll: true});
        }
    }, [disabled]);

    return <button
        ref={action}
        type={stop ? 'button' : 'submit'}
        className={stop ? 'send stop' : 'send'}
        disabled={disabled}
        aria-label={label}
        aria-busy={stopping || undefined}
        title={title}
        onClick={stop ? onStop : undefined}
        onKeyDown={event => {
            if (event.key === 'Enter' && event.repeat) event.preventDefault();
        }}
        onFocus={() => { focused.current = true; }}
        onBlur={event => {
            if (event.relatedTarget && event.relatedTarget !== document.body) focused.current = false;
        }}
    >
        {stop
            ? <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>}
    </button>;
}
