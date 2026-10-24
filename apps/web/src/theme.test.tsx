import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { THEMES, resolveTheme, readTheme, persistTheme } from './theme';
import { DeckMenu } from './install-deck';
import { DeckBrand } from './deck-logo';
import { ThemeDialog, themeMatches } from './theme-select';

test('theme registry has unique stable IDs; only registered values are accepted and dark is default', () => {
    expect(THEMES.map(theme => [theme.id, theme.label])).toEqual([['dark', 'Dark'], ['light', 'Light'], ['green', 'Green'], ['eva01', 'EVA-01'], ['cyberpunk', 'Cyberpunk'], ['github', 'GitHub Dark'], ['github-light', 'GitHub Light'], ['one-dark-pro', 'One Dark Pro'], ['dracula', 'Dracula'], ['catppuccin-mocha', 'Catppuccin Mocha'], ['catppuccin-latte', 'Catppuccin Latte'], ['tokyo-night', 'Tokyo Night'], ['nord', 'Nord'], ['gruvbox-dark', 'Gruvbox Dark'], ['monokai-pro', 'Monokai Pro'], ['rose-pine', 'Rosé Pine'], ['night-owl', 'Night Owl'], ['solarized-light', 'Solarized Light']]);
    expect(new Set(THEMES.map(theme => theme.id)).size).toBe(THEMES.length);
    for (const { id } of THEMES) expect(resolveTheme(id)).toBe(id);
    for (const invalid of [null, undefined, '', 'unknown', 'Green', '__proto__', 'toString', {}, 0]) expect(resolveTheme(invalid)).toBe('dark');
});

test('theme storage preserves old preferences and all opt-in themes using deck.theme', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readTheme(() => storage)).toBe('dark');
    for (const { id } of THEMES) {
        persistTheme(id, () => storage);
        expect(values.get('deck.theme')).toBe(id);
        expect(readTheme(() => storage)).toBe(id);
    }
    values.set('deck.theme', 'cyberpunk');
    expect(readTheme(() => storage)).toBe('cyberpunk'); // No palette-identity migration.
    values.set('deck.theme', 'eva01');
    expect(readTheme(() => storage)).toBe('eva01');
    values.set('deck.theme', 'unregistered');
    expect(readTheme(() => storage)).toBe('dark');
});

test('blocked storage getters and operations never prevent theme switching', () => {
    const blocked = () => { throw new Error('storage blocked'); };
    expect(readTheme(blocked)).toBe('dark');
    expect(readTheme(() => ({ getItem: blocked }))).toBe('dark');
    expect(() => persistTheme('green', blocked)).not.toThrow();
    expect(() => persistTheme('light', () => ({ setItem: blocked }))).not.toThrow();
});

test('theme menu entry summarizes the active theme instead of listing every theme', () => {
    // The popup stays closed until opened, so the collapsed trigger renders no theme names.
    const closed = renderToStaticMarkup(<DeckMenu hidden onInstall={() => {}} theme="github" onTheme={() => {}}/>);
    expect(closed).toContain('aria-label="Deck menu"');
    expect(closed).not.toContain('<select');
    const inline = renderToStaticMarkup(<DeckMenu inline hidden onInstall={() => {}} theme="github" onTheme={() => {}}/>);
    expect(inline).toContain('aria-haspopup="dialog"');
    expect(inline).toContain('Theme');
    expect(inline).toContain('GitHub');
    expect(inline).toContain('class="theme-swatch"');
    expect(inline).not.toContain('Cyberpunk');
    expect(inline).not.toContain('theme-options');
});

test('theme search matches labels and IDs without case or diacritic sensitivity', () => {
    expect(themeMatches({ id: 'cafe-dark', label: 'Café' }, ' CAFE ')).toBe(true);
    expect(themeMatches({ id: 'eva01', label: 'EVA-01' }, 'ÉVA01')).toBe(true);
    expect(themeMatches({ id: 'dark', label: 'Dark' }, 'light')).toBe(false);
    expect(THEMES.filter(theme => themeMatches(theme, ''))).toHaveLength(THEMES.length);
});

test('theme dialog exposes searchable listbox semantics and one selected option', () => {
    const html = renderToStaticMarkup(<ThemeDialog value="github" onChange={() => {}} onClose={() => {}}/>);
    expect(html).toContain('class="workspace-dialog theme-dialog"');
    expect(html).toContain('aria-label="Search themes"');
    expect(html).toContain('role="listbox"');
    expect((html.match(/role="option"/g) ?? []).length).toBe(THEMES.length);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect(html).toContain('>Done</button>');
});

test('sidebar and empty brands read logo plus eck with one accessible Deck name', () => {
    for (const large of [false, true]) {
        const html = renderToStaticMarkup(<DeckBrand large={large}/>);
        expect(html).toContain('role="img" aria-label="Deck"');
        expect(html).toContain('class="brand-word">eck</span>');
        expect(html).not.toContain('>deck<');
        expect(html).toContain(`width="${large ? 40 : 24}" height="${large ? 40 : 24}"`);
        expect(html).toContain('viewBox="0 0 464 464"');
    }
});

test('every registered theme except the base dark palette has a CSS palette block', () => {
    const css = require('node:fs').readFileSync(new URL('./style.css', import.meta.url), 'utf8') + require('node:fs').readFileSync(new URL('./themes.css', import.meta.url), 'utf8');
    for (const { id } of THEMES.filter(theme => theme.id !== 'dark')) expect(css).toContain(`:root[data-theme=${id}] {`);
    expect(themeMatches({ id: 'rose-pine', label: 'Rosé Pine' }, 'rose')).toBe(true);
});
