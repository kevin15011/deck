/** Swatches are fixed previews of each palette's canvas and accent, independent of the active theme. */
export const THEMES = [
    { id: 'dark', label: 'Dark', swatch: ['#141819', '#ff7040'] },
    { id: 'light', label: 'Light', swatch: ['#f3f5f4', '#a33b17'] },
    { id: 'green', label: 'Green', swatch: ['#141819', '#93c9b1'] },
    { id: 'eva01', label: 'EVA-01', swatch: ['#1a1625', '#a6ff4d'] },
    { id: 'cyberpunk', label: 'Cyberpunk', swatch: ['#05050f', '#ff00ff'] },
    { id: 'github', label: 'GitHub Dark', swatch: ['#0d1117', '#4493f8'] },
    { id: 'github-light', label: 'GitHub Light', swatch: ['#ffffff', '#1f883d'] },
    { id: 'one-dark-pro', label: 'One Dark Pro', swatch: ['#282c34', '#61afef'] },
    { id: 'dracula', label: 'Dracula', swatch: ['#282a36', '#bd93f9'] },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', swatch: ['#1e1e2e', '#cba6f7'] },
    { id: 'catppuccin-latte', label: 'Catppuccin Latte', swatch: ['#eff1f5', '#8839ef'] },
    { id: 'tokyo-night', label: 'Tokyo Night', swatch: ['#1a1b26', '#7aa2f7'] },
    { id: 'nord', label: 'Nord', swatch: ['#2e3440', '#88c0d0'] },
    { id: 'gruvbox-dark', label: 'Gruvbox Dark', swatch: ['#282828', '#fe8019'] },
    { id: 'monokai-pro', label: 'Monokai Pro', swatch: ['#2d2a2e', '#ffd866'] },
    { id: 'rose-pine', label: 'Rosé Pine', swatch: ['#1f1d2e', '#c4a7e7'] },
    { id: 'night-owl', label: 'Night Owl', swatch: ['#011627', '#82aaff'] },
    { id: 'solarized-light', label: 'Solarized Light', swatch: ['#fdf6e3', '#217ab9'] },
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
