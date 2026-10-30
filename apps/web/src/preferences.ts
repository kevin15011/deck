export const FONTS = [
    { id: 'system', label: 'System' }, { id: 'inter', label: 'Inter' },
    { id: 'geist', label: 'Geist' }, { id: 'jetbrains-mono', label: 'JetBrains Mono' },
    { id: 'fira-code', label: 'Fira Code' },
    { id: 'nunito-sans', label: 'Nunito Sans' }, { id: 'space-grotesk', label: 'Space Grotesk' },
    { id: 'source-serif-4', label: 'Source Serif 4' }, { id: 'lora', label: 'Lora' },
    { id: 'ibm-plex-mono', label: 'IBM Plex Mono' },
] as const;
export type Font = typeof FONTS[number]['id'];
export function resolveFont(value: unknown): Font { return FONTS.find(font => font.id === value)?.id ?? 'system'; }
export function resolveSplit(value: unknown): number {
    if (typeof value !== 'string' || !value.trim()) return 50;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(25, Math.min(75, number)) : 50;
}
export function readFont(storage: () => Pick<Storage, 'getItem'> = () => window.localStorage): Font {
    try { return resolveFont(storage().getItem('deck.font')); } catch { return 'system'; }
}
export function readSplit(storage: () => Pick<Storage, 'getItem'> = () => window.localStorage): number {
    try { return resolveSplit(storage().getItem('deck.pane-split')); } catch { return 50; }
}
export function savePreference(key: string, value: string): void {
    try { window.localStorage.setItem(key, value); } catch { /* Preferences are optional. */ }
}
