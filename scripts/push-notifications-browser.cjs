const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

async function check() {
    const directory = mkdtempSync(path.join(__dirname, '.push-fixture-'));
    const entry = path.join(directory, 'entry.js');
    let build;
    try {
        writeFileSync(entry, `
            import React from 'react';
            import {createRoot} from 'react-dom/client';
            import {request} from '../../frontend/src/api';
            import {Appearance} from '../../frontend/src/appearance';
            import {usePushNotifications} from '../../frontend/src/push-notifications';
            const api = (path, init) => request(init?.method ?? 'GET', path,
                init?.body ? JSON.parse(init.body) : undefined);
            function App() {
                return React.createElement(Appearance, {
                    notifications: usePushNotifications(api), open: true,
                    theme: 'dark', font: 'system', chatWidth: 'full',
                    onDictation: () => {}, onBack: () => {},
                });
            }
            createRoot(document.getElementById('app')).render(React.createElement(App));
        `);
        build = spawnSync('bun', ['build', '--target=browser', entry], {encoding:'utf8', maxBuffer: 8 * 1024 * 1024});
    } finally {
        rmSync(directory, {recursive:true});
    }
    assert.equal(build.status, 0, build.stderr);
    const browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM});
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(8000);
        await page.addInitScript(() => {
            let subscription = null;
            window.workerFailure = false;
            window.permissionPrompts = 0;
            window.subscriptions = 0;
            window.notificationPermission = 'granted';
            Object.defineProperty(Notification, 'permission', {get: () => window.notificationPermission});
            Notification.requestPermission = async () => {
                window.permissionPrompts++;
                return window.notificationPermission = 'granted';
            };
            const registration = {active: {}, pushManager: {
                getSubscription: async () => subscription,
                subscribe: async () => {
                    window.subscriptions++;
                    return subscription = {
                        options: {applicationServerKey: new Uint8Array([1]).buffer},
                        toJSON: () => ({endpoint: 'https://wns2-ln2p.notify.windows.com/w/?token=fixture'}),
                        unsubscribe: async () => { subscription = null; return true; },
                    };
                },
            }};
            Object.defineProperty(navigator, 'serviceWorker', {value: {
                register: async () => {
                    if (window.workerFailure) throw Error('registration failed');
                    return registration;
                },
                ready: Promise.resolve(registration),
                getRegistration: async () => registration,
            }});
        });
        const base = 'http://127.0.0.1:7654';
        let device = false, enabled = false, offline = false, serverError = false, enrollmentDenied = false;
        let sessionAuthorized = true, historyUnavailable = false, registrationRejected = false;
        const writes = [];
        await page.route(base + '/**', async route => {
            const pathname = new URL(route.request().url()).pathname;
            const method = route.request().method();
            const json = (status, body) => route.fulfill({status, json: body});
            if (pathname === '/') return route.fulfill({contentType:'text/html', body:'<div id="app"></div><script src="/test.js"></script>'});
            if (pathname === '/test.js') return route.fulfill({contentType:'text/javascript', body:build.stdout});
            if (method !== 'GET') writes.push(pathname + ' ' + method);
            if (pathname === '/api/browser-device') {
                assert.deepEqual(route.request().postDataJSON(), {remember:true});
                if (enrollmentDenied) return json(403, {code: 'device-required'});
                device = true;
                return json(200, {ok:true});
            }
            assert.equal(pathname, '/api/push');
            if (!sessionAuthorized) return json(403, {code:'session_required'});
            if (offline) return route.abort('internetdisconnected');
            if (!device) return json(403, {code:'device-required'});
            if (serverError) return json(503, {code:'notification-storage-unavailable'});
            if (historyUnavailable) return json(503, {code:'push-history-unavailable'});
            if (method === 'POST') {
                assert.equal(route.request().postDataJSON().subscription.endpoint,
                    'https://wns2-ln2p.notify.windows.com/w/?token=fixture');
                if (registrationRejected) return json(400, {code:'push-subscription-invalid'});
                enabled = true;
            }
            if (method === 'DELETE') enabled = false;
            return json(200, {ok:true, enabled, publicKey:'AQ'});
        });
        const status = pattern => page.getByRole('status').filter({hasText:pattern}).waitFor();
        const button = name => page.getByRole('button', {name, exact:true}).click();
        await page.goto(base);
        await button('Notifications');
        await status(/remember this browser|device authorization/i);
        assert.deepEqual(writes, []);
        assert.equal(await page.evaluate(() => window.subscriptions), 0);
        await page.evaluate(() => { window.notificationPermission = 'denied'; });
        await button('Refresh status');
        await status(/blocked in browser settings/i);
        await button('Enable notifications');
        assert.deepEqual(writes, []);
        await page.evaluate(() => { window.notificationPermission = 'granted'; });
        sessionAuthorized = false;
        await button('Enable notifications');
        await status(/open Deck from the launcher/i);
        assert.deepEqual(writes, []);
        sessionAuthorized = true;
        enrollmentDenied = true;
        await button('Enable notifications');
        await status(/revoked|device access ended/i);
        assert.deepEqual(writes, ['/api/browser-device POST']);
        assert.equal(await page.evaluate(() => window.subscriptions), 0);
        enrollmentDenied = false;
        await button('Enable notifications');
        await status(/^On for this browser$/);
        assert.deepEqual(writes.slice(1), ['/api/browser-device POST', '/api/push POST']);
        assert.equal(await page.evaluate(() => window.permissionPrompts), 0);
        await button('Disable notifications');
        await status(/^Off for this browser$/);
        offline = true;
        await button('Refresh status');
        await status(/could not reach Deck/i);
        offline = false;
        serverError = true;
        await button('Refresh status');
        await status(/notification storage/i);
        serverError = false;
        await button('Refresh status');
        await status(/^Off for this browser$/);
        historyUnavailable = true;
        await button('Refresh status');
        await status(/original history/i);
        historyUnavailable = false;
        registrationRejected = true;
        await button('Enable notifications');
        await status(/rejected.*subscription/i);
        registrationRejected = false;
        await button('Refresh status');
        await status(/^Off for this browser$/);
        await page.evaluate(() => { window.workerFailure = true; });
        await page.evaluate(() => { window.notificationPermission = 'default'; });
        await button('Enable notifications');
        await status(/service worker/i);
        assert.equal(await page.evaluate(() => window.permissionPrompts), 1);
        await page.evaluate(() => { window.workerFailure = false; });
        await button('Enable notifications');
        await status(/^On for this browser$/);
        enabled = true;
        await page.reload();
        await button('Notifications');
        await status(/reconnect notifications/i);
        console.log('Notification authorization, opt-in, off state, retry and missing subscription passed');
    } finally {
        await browser.close();
    }
}

check().catch(error => { console.error(error); process.exitCode = 1; });
