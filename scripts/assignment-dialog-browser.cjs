// Exercise the shipped modal with a revisioned fake at the host HTTP boundary.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

async function run() {
    const assets = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-assign-'));
    let browser;
    try {
        execFileSync('bun', ['build', 'frontend/src/app.tsx', '--target=browser', '--external', '/fonts/*', '--outdir', assets]);
        browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM || chromium.executablePath(), args: ['--no-sandbox']});
        const page = await browser.newPage({viewport: {width: 1280, height: 900}, reducedMotion: 'reduce', serviceWorkers: 'block'});
        page.setDefaultTimeout(5000);
        const assignment = (modelId = 'a', thinking) => ({runnerId: 'codex', modelId, thinking});
        const project = {id: 'project', root: '/fixture', identity: null, available: true};
        const contract = {version: 1, revision: 1, generation: 1, leadTask: 'lead-task', approvals: 'relay',
            members: {lead: assignment(), architect: assignment(), quality: assignment()}};
        const session = {id: 'assign', title: 'Assignment fixture', native: null, project, contract};
        const workspace = {api: 7, session: session.id, project: project.root, runner: 'codex', availability: null,
            host_id: 'assignment-fixture', queue_paused: false, steering_unavailable: '', sessions: [session],
            tasks: [], team_availability: null, receipts: [], projects: [project]};
        const calls = [];
        let reject = 'architect';
        let loseReply = false;
        let externalChange;
        let unblock;
        const firstWrite = new Promise(resolve => { unblock = resolve; });
        const origin = 'http://127.0.0.1:7654';
        await page.route(origin + '/**', async route => {
            const endpoint = new URL(route.request().url()).pathname;
            const json = value => route.fulfill({json: value});
            if (endpoint === '/') return route.fulfill({path: 'frontend/index.html', contentType: 'text/html'});
            if (endpoint === '/app.js' || endpoint === '/app.css') return route.fulfill({path: path.join(assets, endpoint.slice(1))});
            if (endpoint === '/api/workspace') return json(workspace);
            if (endpoint === '/api/sidebar') return json({projects: {}, sessions: {}});
            if (endpoint === '/api/history/projects') return json({projects: [], issues: []});
            if (endpoint === '/api/models') return json({runners: [{runnerId: 'codex', label: 'Codex', available: true,
                models: ['a', 'b'].map(modelId => ({modelId, label: modelId, thinkingLevels: ['high', 'low']}))}]});
            if (endpoint === '/api/sessions/assign/assignments') {
                const input = route.request().postDataJSON();
                calls.push([input.memberId, input.expectedRevision]);
                if (calls.length === 1) await firstWrite;
                if (externalChange) {
                    externalChange();
                    externalChange = undefined;
                    contract.revision++;
                }
                if (input.expectedRevision !== contract.revision) return route.fulfill({status: 409, json: {message: 'assignment-revision-stale'}});
                if (input.memberId === reject) return route.fulfill({status: 409, json: {message: 'Fixture write declined'}});
                contract.members[input.memberId] = input.assignment;
                contract.revision++;
                if (loseReply) {
                    loseReply = false;
                    return route.abort();
                }
                return json(session);
            }
            return route.fulfill({status: 404, body: ''});
        });
        await page.goto(origin);
        await page.getByRole('button', {name: 'Session', exact: true}).press('Enter');
        await page.getByRole('button', {name: 'Session assignments', exact: true}).click();
        const modal = page.getByRole('dialog', {name: 'Session assignments'});
        const save = modal.getByRole('button', {name: 'Save', exact: true});
        const saved = save.and(modal.locator('button:disabled'));
        const model = role => modal.getByLabel('Model for ' + role, {exact: true});
        const reasoning = role => modal.getByLabel('Reasoning level for ' + role, {exact: true});
        await model('Lead').waitFor();
        assert.equal(await save.count(), 1, 'one global save');
        assert(await save.isDisabled());
        await model('Lead').selectOption('b');
        assert(await save.isEnabled());
        await model('Lead').selectOption('a');
        assert(await save.isDisabled());
        await reasoning('Lead').selectOption('high');
        await model('architect').selectOption('b');
        await model('quality').selectOption('b');
        await save.evaluate(button => { button.click(); button.click(); });
        await modal.getByRole('button', {name: 'Saving…', exact: true}).waitFor();
        assert.deepEqual(calls.slice(1), []);
        assert(await modal.getByRole('button', {name: 'Done', exact: true}).isDisabled());
        unblock();
        await modal.getByRole('alert').filter({hasText: 'Fixture write declined'}).waitFor();
        assert.deepEqual(calls, [['lead', 1], ['architect', 2]]);
        assert.equal(contract.members.lead.thinking, 'high');
        assert.equal(await model('architect').inputValue(), 'b');
        assert.equal(await model('quality').inputValue(), 'b');
        reject = '';
        await save.click();
        await saved.waitFor();
        assert.deepEqual(calls, [['lead', 1], ['architect', 2], ['architect', 2], ['quality', 3]]);
        assert.equal(contract.revision, 4);

        await reasoning('Lead').selectOption('low');
        await model('architect').selectOption('a');
        externalChange = () => {
            contract.members.lead = assignment('b');
            contract.members.quality = assignment('a');
        };
        await save.click();
        await modal.getByRole('button', {name: 'Keep my draft for Lead'}).waitFor();
        assert(await save.isDisabled());
        assert.equal(await model('quality').inputValue(), 'a');
        assert.equal(await reasoning('Lead').inputValue(), 'low');
        await modal.getByRole('button', {name: 'Keep my draft for Lead'}).click();
        await save.click();
        await saved.waitFor();
        assert.deepEqual(calls.slice(4), [['lead', 4], ['lead', 5], ['architect', 6]]);
        assert.equal(contract.members.lead.thinking, 'low');

        const desktop = await reasoning('Lead').boundingBox();
        const modelBox = await model('Lead').boundingBox();
        const roleBox = await modal.getByRole('heading', {name: 'Lead', exact: true}).boundingBox();
        assert.equal(desktop.y, modelBox.y);
        assert(roleBox.y >= modelBox.y && roleBox.y < modelBox.y + modelBox.height);
        assert(desktop.width < modelBox.width);
        // A response lost after commit must clear that draft and leave later rows for retry.
        loseReply = true;
        await model('Lead').selectOption('a');
        await model('quality').selectOption('b');
        await save.click();
        await model('Lead').and(modal.locator('select:enabled')).waitFor();
        assert(await save.isEnabled());
        assert.deepEqual(calls.slice(7), [['lead', 7]]);
        await save.click();
        await saved.waitFor();
        assert.deepEqual(calls.slice(7), [['lead', 7], ['quality', 8]]);

        // Accepting latest clears the dirty row and does not send a replacement.
        await model('Lead').selectOption('b');
        externalChange = () => { contract.members.lead = assignment('a', 'high'); };
        await save.click();
        await modal.getByRole('button', {name: 'Use latest for Lead'}).click();
        assert(await save.isDisabled());
        assert.equal(await model('Lead').inputValue(), 'a');
        assert.equal(await reasoning('Lead').inputValue(), 'high');
        assert.deepEqual(calls.slice(9), [['lead', 9]]);

        await page.setViewportSize({width: 320, height: 780});
        assert(await modal.evaluate(node => node.scrollWidth <= node.clientWidth));
        await modal.getByRole('button', {name: 'Done', exact: true}).click();
        await modal.waitFor({state: 'hidden'});
        console.log('Assignment dialog revision, retries, conflicts, pending clicks and responsive layout passed');
    } finally {
        await browser?.close();
        fs.rmSync(assets, {recursive: true, force: true});
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
