import type { Page } from '@playwright/test';
import { THEMES } from './src/theme';

/** Select through the same searchable dialog on desktop and mobile. */
export async function selectTheme(page: Page, value: string) {
    const theme = THEMES.find(theme => theme.id === value);
    if (!theme) throw new Error(`Unknown theme: ${value}`);
    const dialog = page.getByRole('dialog', { name: 'Theme', exact: true });
    if (!await dialog.isVisible() && await page.evaluate(() => matchMedia('(max-width: 1000px)').matches)) {
        const drawer = page.locator('.session-drawer');
        if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Open sessions', exact: true }).click();
        await drawer.getByRole('button', { name: /^Theme/ }).click();
    } else if (!await dialog.isVisible()) {
        const menu = page.getByRole('menu', { name: 'Deck', exact: true });
        if (!await menu.isVisible()) await page.getByRole('button', { name: 'Deck menu', exact: true }).click();
        await menu.getByRole('menuitem', { name: /^Theme/ }).click();
    }
    await dialog.getByRole('combobox', { name: 'Search themes' }).fill(theme.id);
    await dialog.getByRole('option', { name: theme.label, exact: true }).click();
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, value);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}
