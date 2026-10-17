import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { THEMES, resolveTheme, readTheme, persistTheme } from './theme';
import { ThemeSelect } from './theme-select';
import { DeckBrand } from './deck-logo';

test('theme registry has unique stable IDs; only registered values are accepted and dark is default', () => {
    expect(THEMES.map(theme => [theme.id, theme.label])).toEqual([['dark', 'Dark'], ['light', 'Light'], ['green', 'Green']]);
    expect(new Set(THEMES.map(theme => theme.id)).size).toBe(THEMES.length);
    for (const { id } of THEMES) expect(resolveTheme(id)).toBe(id);
    for (const invalid of [null, undefined, '', 'unknown', 'Green', '__proto__', 'toString', {}, 0]) expect(resolveTheme(invalid)).toBe('dark');
});

test('theme storage preserves old preferences and Green using deck.theme', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(readTheme(() => storage)).toBe('dark');
    for (const { id } of THEMES) {
        persistTheme(id, () => storage);
        expect(values.get('deck.theme')).toBe(id);
        expect(readTheme(() => storage)).toBe(id);
    }
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

test('native theme list exposes its label and selection from the registry', () => {
    const html = renderToStaticMarkup(<ThemeSelect value="green" onChange={() => {}}/>);
    expect(html).toContain('<select');
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain('<option value="green" selected="">Green</option>');
    expect((html.match(/<option/g) ?? []).length).toBe(THEMES.length);
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
