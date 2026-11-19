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
    { id: 'one-dark-blood', label: 'One Dark Blood', swatch: ['#282c34', '#982b3a'] },
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

export function resolveTheme(value: unknown): Theme { return THEMES.find(theme=>theme.id===value)?.id??'dark'; }
type PreferenceStorage=Pick<Storage,'getItem'|'setItem'>;
// Only original appearance is shared; scoped Git views retain their existing namespace.
function preferenceKey(key:string):string {
 return (['theme','font','pane-split','sidebar-collapsed','content-mode','workspace-collapsed'].includes(key)?'deck.':'deck2.')+key;
}
export function readPreference(key:string,storage:()=>Pick<PreferenceStorage,'getItem'>=()=>window.localStorage):string {
 try{return storage().getItem(preferenceKey(key))??'';}catch{return '';}
}
export function savePreference(key:string,value:string,storage:()=>Pick<PreferenceStorage,'setItem'>=()=>window.localStorage):void {
 try{storage().setItem(preferenceKey(key),value);}catch{/* Appearance is usable without persistence; command identity storage remains mandatory. */}
}

export type ContentMode='chat'|'both'|'workspace';
export function resolveContentMode(value:unknown,legacyCollapsed:unknown=''):ContentMode {
 return value==='chat'||value==='both'||value==='workspace'?value:legacyCollapsed==='true'?'chat':'both';
}

export type ChatWidth='full'|'compact';
export function resolveChatWidth(value:unknown):ChatWidth { return value==='full'?'full':'compact'; }

export function resolveSidebarPinned(value:unknown,legacyCollapsed:unknown):boolean {
 return value==='true'||value!=='false'&&legacyCollapsed!=='true';
}
