// Exercise authenticated assignment writes while real browser input and native attempts are pending.
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: wait} = require('node:timers/promises');
const {chromium} = require('playwright');

const binary = path.resolve(process.argv[2] || 'target/debug/deck2');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-assign-busy-'));
const file = name => path.join(root, name);
const state = file('state');
const project = file('project');
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'Fixture project');
execFileSync('git', ['init', '-q', project]);
fs.copyFileSync(path.join(__dirname, '../crates/host/tests/fake_claude_sdk.py'), file('claude'));
fs.chmodSync(file('claude'), 0o700);
const codex = fs.readFileSync(path.join(__dirname, '../crates/host/tests/fake_session_native.py'), 'utf8')
    .replace("  if not member and text.startswith('CONTINUE_MIXED '):", `  if not member and text == 'Hold Lead and delegate two members':
   for role in ['apply-fast','quality']:
    task=tool('deck_delegate',{'agent':role,'task':'Waiting-policy hold '+role})
    (root/('task-'+role)).write_text(task['taskId'])
   for _ in range(2000):
    if (root/'release-lead').exists():break
    time.sleep(.025)
   else:raise RuntimeError('Fixture Lead release deadline')
  if not member and text.startswith('CONTINUE_MIXED '):`);
fs.writeFileSync(file('codex'), codex, {mode: 0o700});
fs.writeFileSync(file('waiting-fixture'), '');
const host = spawn(binary, ['serve', '--foreground', '--project', project, '--state-dir', state, '--codex', file('codex'), '--no-open', '--no-history'], {
    stdio: 'inherit',
    env: {PATH: root + ':' + process.env.PATH, HOME: root, CODEX_HOME: file('codex-home'),
        CLAUDE_CONFIG_DIR: file('claude-config'), XDG_DATA_HOME: file('data'),
        XDG_CONFIG_HOME: file('config'), XDG_RUNTIME_DIR: file('runtime')},
});
const stopped = new Promise(resolve => host.once('exit', resolve));

async function until(check, description) {
    for (let i = 0; i < 200; i++) {
        const value = await check();
        if (value) return value;
        await wait(100);
    }
    throw Error('Timed out waiting for ' + description);
}

async function run() {
    let browser;
    try {
        const launcher = await until(() => {
            try { return JSON.parse(fs.readFileSync(path.join(state, 'launcher.json'))); } catch { return null; }
        }, 'isolated host');
        const base = 'http://' + launcher.host;
        const launch = await (await fetch(base + '/launch', {method: 'POST', body: launcher.admin})).json();
        browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM, args: ['--no-sandbox']});
        const page = await browser.newPage({viewport: {width: 1440, height: 900}, serviceWorkers: 'block'});
        page.setDefaultTimeout(8000);
        page.on('pageerror', error => console.error(error.message));
        if (process.env.DECK2_UI_ASSETS) {
            for (const asset of ['app.js', 'app.css']) {
                await page.route(base + '/' + asset, route => route.fulfill({path: path.join(process.env.DECK2_UI_ASSETS, asset)}));
            }
        }
        await page.goto(launch.url);
        await page.waitForURL(base + '/');
        const workspace = async () => (await page.request.get(base + '/api/workspace')).json();
        const codexAssignment = {runnerId: 'codex', modelId: 'gpt-6.1-sol'};
        const id = 'busy-assignment-fixture';
        const creation = await page.request.post(base + '/api/sessions', {
            headers: {origin: base}, data: {api: 7, id, title: 'Busy assignment fixture',
                members: {lead: codexAssignment, 'apply-fast': codexAssignment, quality: codexAssignment}, approvals: 'relay'},
        });
        assert.equal(creation.status(), 200, await creation.text());
        const session = (await workspace()).sessions.find(s => s.id === id);
        const endpoint = base + '/api/sessions/' + session.id + '/assignments';
        const assign = (memberId, assignment, expectedRevision) => page.request.post(endpoint, {
            headers: {origin: base}, data: {api: 7, memberId, assignment, expectedRevision},
        });
        const revision = session.contract.revision;
        await page.goto(base + '/?session=' + id);
        const prompt = page.locator('#prompt');
        const leadText = 'Hold Lead and delegate two members';
        const queuedText = 'An actual queued user input';
        await prompt.fill(leadText);
        await prompt.press('Enter');
        await until(() => ['apply-fast', 'quality'].every(role => fs.existsSync(file('ready-' + role))), 'live Apply Fast and Quality');
        await prompt.fill(queuedText);
        await page.getByRole('button', {name: 'Queue message', exact: true}).click();
        const queue = page.getByRole('region', {name: 'Queued messages'});
        await queue.getByText(queuedText, {exact: true}).waitFor();

        const before = await workspace();
        const current = ws => ws.sessions.find(s => s.id === session.id);
        const receipt = (ws, text) => ws.receipts.find(r => r.session === session.id && r.prompt === text);
        const member = (ws, role) => ws.tasks.find(t => t.id === fs.readFileSync(file('task-' + role), 'utf8')).attempts[0];
        assert.equal(receipt(before, leadText).phase, 'running');
        assert.equal(receipt(before, queuedText).phase, 'queued');
        assert.equal(member(before, 'apply-fast').phase, 'running');
        assert.equal(member(before, 'quality').phase, 'running');

        const edit = await assign('apply-fast', {...codexAssignment, modelId: 'recorded-worker', thinking: 'high'}, revision);
        const editBody = await edit.json();
        console.log('Apply Fast HTTP write:', edit.status(), editBody.message || 'saved');
        await page.reload();
        await page.getByRole('button', {name: 'Session', exact: true}).press('Enter');
        await page.getByRole('button', {name: 'Session assignments', exact: true}).click();
        const modal = page.getByRole('dialog', {name: 'Session assignments'});
        const runner = modal.getByLabel('Runner for apply-fast', {exact: true});
        await runner.waitFor();
        const claude = runner.locator('option[value=claude]');
        assert.equal(await claude.getAttribute('disabled'), null, await claude.textContent());
        await runner.selectOption('claude');
        assert.equal(await runner.inputValue(), 'claude');
        const model = modal.getByLabel('Model for apply-fast', {exact: true});
        await model.selectOption('sonnet');
        await modal.getByLabel('Reasoning level for apply-fast', {exact: true}).selectOption('high');
        const save = modal.getByRole('button', {name: 'Save', exact: true});
        const browserWrite = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
        await save.click();
        const browserResponse = await browserWrite;
        const browserBody = await browserResponse.json();
        assert.deepEqual([edit.status(), browserResponse.status()], [200, 200], JSON.stringify([editBody.message, browserBody.message]));
        await save.and(modal.locator('button:disabled')).waitFor();
        assert.deepEqual(browserBody.contract.members['apply-fast'], {runnerId: 'claude', modelId: 'sonnet', thinking: 'high'});
        assert.deepEqual(browserBody.contract, {...current(before).contract, revision: revision + 2,
            members: {...current(before).contract.members, 'apply-fast': browserBody.contract.members['apply-fast']}});
        assert.deepEqual(browserBody.native, current(before).native);

        const stale = await assign('apply-fast', codexAssignment, revision);
        assert.equal(stale.status(), 409);
        assert.equal((await stale.json()).message, 'assignment-revision-stale');
        await modal.getByLabel('Model for Lead', {exact: true}).selectOption('recorded-worker');
        const leadWrite = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST');
        await save.click();
        const leadResponse = await leadWrite;
        assert.equal(leadResponse.status(), 409);
        assert.equal((await leadResponse.json()).message, 'session-busy');
        await modal.getByRole('alert').filter({hasText: /Lead/}).waitFor();
        assert.equal(await modal.getByLabel('Model for Lead', {exact: true}).inputValue(), 'recorded-worker');

        const after = await workspace();
        assert.deepEqual(current(after).contract, browserBody.contract);
        for (const text of [leadText, queuedText]) {
            assert.deepEqual(receipt(after, text), receipt(before, text));
        }
        for (const role of ['apply-fast', 'quality']) {
            assert.deepEqual(member(after, role), member(before, role));
        }
        for (const name of ['lead', 'apply-fast', 'quality']) fs.writeFileSync(file('release-' + name), '');
        const completed = await until(async () => {
            const row = receipt(await workspace(), queuedText);
            return row?.phase === 'completed' && row;
        }, 'queued user input to complete');
        const starts = fs.readFileSync(file('wire'), 'utf8').trim().split('\n').map(JSON.parse);
        assert.equal(starts.filter(entry => entry.method === 'turn/start' &&
            entry.params.input.some(item => item.text?.includes(`promptId=${completed.id} `))).length, 1);
        assert.equal(completed.attempt, receipt(before, queuedText).attempt);
        assert.deepEqual(completed.configuration.session_contract, receipt(before, queuedText).configuration.session_contract);

        await modal.getByRole('button', {name: 'Done', exact: true}).click();
        const followup = 'Work admitted after the Apply Fast edit';
        await prompt.fill(followup);
        await prompt.press('Enter');
        const latest = await until(async () => receipt(await workspace(), followup), 'newly admitted user input');
        assert.deepEqual(latest.configuration.session_contract, browserBody.contract);
        console.log('Busy Apply Fast HTTP and browser saves, revision conflict, Lead guard, unchanged attempts, queued delivery and new admissions passed');
    } finally {
        await browser?.close();
        for (const name of ['lead', 'apply-fast', 'quality']) fs.writeFileSync(file('release-' + name), '');
        host.kill('SIGINT');
        await stopped;
        fs.rmSync(root, {recursive: true, force: true});
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
