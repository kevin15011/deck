export const THEMES = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'green', label: 'Green' },
] as const;
export type Theme = typeof THEMES[number]['id'];
const THEME_KEY = 'deck.theme';
export function resolveTheme(value: unknown): Theme {
    return THEMES.find(theme => theme.id === value)?.id ?? 'dark';
}
export function readTheme(storage: () => Pick<Storage, 'getItem'> = () => window.localStorage): Theme {
    try { return resolveTheme(storage().getItem(THEME_KEY)); }
    catch { return 'dark'; }
}
export function persistTheme(theme: Theme, storage: () => Pick<Storage, 'setItem'> = () => window.localStorage): void {
    try { storage().setItem(THEME_KEY, theme); }
    catch { /* Switching still works when storage is unavailable. */ }
}
