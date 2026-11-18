import React, { useId } from 'react';

/** Landing Deck Apertura artwork, fitted to the existing navigation mark slot. */
export function DeckLogo({ size = 24 }: { size?: number }) {
    const gaps = `deck-logo-${useId().replace(/:/g, '')}`;
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 464 464" aria-hidden="true" focusable="false">
        <defs><mask id={gaps} maskUnits="userSpaceOnUse" x="0" y="0" width="464" height="464"><path fill="white" d="M0 0H464V464H0Z"/><g fill="none" stroke="black" strokeWidth="16"><path d="M276.789814 147.089032L336.509567 33.874408"/><path d="M328.000000 232.000000L456.000000 232.000000"/><path d="M276.789814 316.910968L336.509567 430.125592"/></g></mask></defs>
        <path fill="var(--logo-ink, #FFF3E3)" d="M24 24H120V440H24Z"/>
        <g mask={`url(#${gaps})`}>
        <g fill="#FF703E"><path d="M136 24H232 A208 208 0 0 1 329.044598 48.026236 L284.254784 132.937204 A112 112 0 0 0 232 120H136Z"/><path d="M329.044598 415.973764 A208 208 0 0 1 232 440H136V344H232 A112 112 0 0 0 284.254784 331.062796Z"/></g>
        <g fill="var(--logo-ink, #FFF3E3)"><path d="M329.044598 48.026236 A208 208 0 0 1 440.000000 232.000000 L344.000000 232.000000 A112 112 0 0 0 284.254784 132.937204Z"/><path d="M440.000000 232.000000 A208 208 0 0 1 329.044598 415.973764 L284.254784 331.062796 A112 112 0 0 0 344.000000 232.000000Z"/></g>
        </g>
        <circle fill="#FF703E" cx="152" cy="232" r="80"/>
    </svg>;
}

export function DeckBrand({ large = false }: { large?: boolean }) {
    return <div className={large ? 'empty-mark' : 'brand'} role="img" aria-label="Deck"><span className="brand-mark" aria-hidden="true"><DeckLogo size={large ? 40 : 24}/></span><span className="brand-word">eck</span></div>;
}
