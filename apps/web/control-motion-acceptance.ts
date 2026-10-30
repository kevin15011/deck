/** Protects: dismissal/focus, interruption, reduced motion and disposal of every owned surface/button.
 * Oracle: working-brief lifecycle requirements; real components must release all GSAP targets on unmount.
 * Fails if: a retained surface/descendant tween survives disposal or feedback leaves inline opacity.
 * Red-first: not required; strengthens verification of an already reviewed implementation.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import fixture from './acceptance/control-motion.html';
const evidence = '/tmp/deck-control-motion-browser'; mkdirSync(evidence, { recursive: true });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, routes: { '/fixture-fonts.css': new Response(await Bun.file(new URL('./src/font-faces.css', import.meta.url)).text(), { headers: { 'Content-Type': 'text/css' } }), '/fonts/:name': request => { const name = request.params.name; return /^[a-z0-9-]+\.woff2$/.test(name) ? new Response(Bun.file(new URL(`./src/assets/fonts/${name}`, import.meta.url))) : new Response('', { status: 404 }); }, '/*': fixture }, development: { hmr: false, console: false } });
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME ?? '/snap/bin/chromium', headless: true, args: ['--no-sandbox'] });
const errors: string[] = [];
try {
    for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'no-preference' });
        page.setDefaultTimeout(6000);
        page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
        await page.goto(`http://127.0.0.1:${server.port}`);
        const install = page.locator('.install-dialog');
        await page.getByRole('button', { name: 'Installation help', exact: true }).click();
        await install.waitFor({ state: 'visible' });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.install-dialog')!).opacity === '1');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => document.querySelector('.install-dialog')!.hasAttribute('inert'));
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.install-dialog')!).opacity) < .9);
        // Reopen during exit, retaining current presentation instead of jumping to zero.
        const interruption = await page.evaluate(async () => {
            const f = (window as any).controlFixture, node = document.querySelector('.install-dialog')!;
            const before = Number(getComputedStyle(node).opacity); f.setInstall(true);
            await new Promise(requestAnimationFrame);
            return { before, after: Number(getComputedStyle(node).opacity) };
        });
        assert(interruption.after >= interruption.before - .05, 'Reopen preserves live opacity');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.install-dialog')!).opacity === '1');
        await page.getByRole('button', { name: 'Done', exact: true }).click();
        await page.waitForFunction(() => !(document.querySelector('.install-dialog') as HTMLDialogElement).open);
        assert(await page.getByRole('button', { name: 'Installation help', exact: true }).evaluate(el => el === document.activeElement), 'Native dialog restores focus');
        await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
        const theme = page.locator('.theme-dialog'); await theme.waitFor();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.theme-dialog')!).opacity === '1');
        assert(await page.getByRole('combobox', { name: 'Search themes' }).evaluate(el => el === document.activeElement));
        for (const palette of ['dark', 'light', 'eva01']) for (const font of ['inter', 'source-serif-4', 'jetbrains-mono']) {
            await page.evaluate(({ palette, font }) => { document.documentElement.dataset.theme = palette; document.documentElement.dataset.font = font; }, { palette, font });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: `${evidence}/${width}-${palette}-${font}.png`, fullPage: true });
        }
        const cdp = await page.context().newCDPSession(page);
        for (const [name, value] of [['prefers-reduced-transparency', 'reduce'], ['prefers-contrast', 'more']]) {
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
            assert(await page.evaluate(({ name, value }) => matchMedia(`(${name}: ${value})`).matches, { name, value }));
            await page.screenshot({ path: `${evidence}/${width}-${name}.png`, fullPage: true });
            console.log(JSON.stringify({ width, preference: name, material: await theme.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, backdrop: getComputedStyle(el).backdropFilter, border: getComputedStyle(el).borderColor })) }));
        }
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        const done = theme.getByRole('button', { name: 'Done', exact: true });
        await done.scrollIntoViewIfNeeded();
        const box = await done.boundingBox(); assert(box);
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.theme-dialog .dialog-actions button')!).opacity) < .9);
        await page.mouse.move(1, 1); await page.mouse.up();
        await page.waitForFunction(() => (document.querySelector('.theme-dialog .dialog-actions button') as HTMLElement).style.opacity === '');
        await page.keyboard.press('Escape'); await theme.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        const menu = page.getByRole('menu', { name: 'Settings', exact: true }); await menu.waitFor();
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByRole('menuitem', { name: /Font/ }).click();
        const fontDialog = page.locator('.font-dialog'); await fontDialog.waitFor();
        await page.keyboard.press('Escape'); await fontDialog.waitFor({ state: 'detached' });
        assert(await page.getByRole('button', { name: 'Settings', exact: true }).evaluate(el => el === document.activeElement), 'Font dialog restores menu focus');
        const context = page.getByRole('button', { name: 'Context details', exact: true }); await context.click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.secondary-info-panel')!).opacity === '1');
        await page.screenshot({ path: `${evidence}/${width}-secondary-info.png`, fullPage: true });
        for (const [name, value] of [['prefers-reduced-transparency', 'reduce'], ['prefers-contrast', 'more']]) {
            await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] });
            const material = await page.locator('.secondary-info-panel').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, backdrop: getComputedStyle(el).backdropFilter, border: getComputedStyle(el).borderColor }));
            assert.equal(material.backdrop, 'none', name + ' uses solid surface');
            await page.screenshot({ path: `${evidence}/${width}-secondary-${name}.png`, fullPage: true });
            console.log(JSON.stringify({ width, preference: name, secondaryMaterial: material }));
        }
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        await page.keyboard.press('Escape'); await page.locator('.secondary-info-panel').waitFor({ state: 'detached' });
        assert(await context.evaluate(el => el === document.activeElement), 'Secondary panel preserves focus return');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'Choose theme', exact: true }).click(); await theme.waitFor();
        assert.equal(await theme.evaluate(el => el.style.opacity), '', 'Reduced motion has no animated opacity');
        await page.keyboard.press('Escape'); await theme.waitFor({ state: 'detached' });
        // Live media changes settle an in-flight transition immediately.
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => (window as any).controlFixture.setInstall(true)); await install.waitFor();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => (document.querySelector('.install-dialog') as HTMLElement).style.opacity === '');
        await page.evaluate(() => (window as any).controlFixture.setInstall(false));
        await page.waitForFunction(() => !(document.querySelector('.install-dialog') as HTMLDialogElement).open);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => (window as any).controlFixture.setInstall(true)); await install.waitFor();
        const cleanup = [];
        for (const surface of ['install', 'theme', 'menu', 'font', 'secondary']) {
            await page.reload();
            if (surface === 'install') await page.getByRole('button', { name: 'Installation help', exact: true }).click();
            if (surface === 'theme') await page.getByRole('button', { name: 'Choose theme', exact: true }).click();
            if (surface === 'menu' || surface === 'font') await page.getByRole('button', { name: 'Settings', exact: true }).click();
            if (surface === 'font') await page.getByRole('menuitem', { name: /Font/ }).click();
            if (surface === 'secondary') await page.getByRole('button', { name: 'Context details', exact: true }).click();
            const selector = ({ install: '.install-dialog', theme: '.theme-dialog', menu: '[role="menu"]', font: '.font-dialog', secondary: '.secondary-info-panel' })[surface]!;
            await page.locator(selector).waitFor();
            const result = await page.evaluate(async selector => {
                const f = (window as any).controlFixture;
                const root = document.querySelector(selector)!;
                const nodes = [root, ...root.querySelectorAll('*')];
                const button = root.querySelector('button');
                button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
                const buttonTween = button ? f.gsap.getTweensOf(button).length : null;
                f.dispose(); await new Promise(requestAnimationFrame);
                return { count: nodes.length, connected: nodes.some(node => node.isConnected), tweens: f.gsap.getTweensOf(nodes).length,
                    opacity: (root as HTMLElement).style.opacity, buttonOpacity: button?.style.opacity ?? '', buttonTween };
            }, selector);
            assert(result.count > 1);
            assert.equal(result.connected, false, surface);
            assert.equal(result.tweens, 0, surface + ' descendants released');
            assert.equal(result.opacity, '', surface + ' surface opacity restored');
            assert.equal(result.buttonOpacity, '', surface + ' button opacity restored');
            if (surface === 'install' || surface === 'theme' || surface === 'font') assert(result.buttonTween! > 0, surface + ' exercises active feedback at unmount');
            cleanup.push({ surface, ...result });
        }
        await page.close(); console.log(JSON.stringify({ width, interruption, cleanup, lifecycle: 'pass' }));
    }
    assert.deepEqual(errors, []);
} finally { await browser.close(); server.stop(true); }
