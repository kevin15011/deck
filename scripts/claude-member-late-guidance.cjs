// Production host + real SDK bridge + fake Claude CLI + Chromium. A late native receipt must
// turn "Delivery unknown" into "Delivered live" on an already-open conversation.
const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: wait} = require('node:timers/promises');
const {chromium} = require('playwright');

const binary = path.resolve(process.argv[2] || 'target/debug/deck2');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-late-guidance-'));
const file = name => path.join(root, name);
const state = file('state'), project = file('project'), primary = file('primary');
fs.mkdirSync(primary);
// The fixture's member reads a linked worktree with a fixed Git state.
const git = (cwd, ...args) => execFileSync('/usr/bin/git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.fsmonitor=false', ...args],
    {cwd, env: {PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null'}, stdio: 'pipe'});
git(primary, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(primary, 'CLAUDE.md'), 'Fixture only.');
fs.writeFileSync(path.join(primary, 'tracked.txt'), 'base\n');
git(primary, 'add', '.'); git(primary, 'commit', '-q', '-m', 'base commit');
git(primary, 'worktree', 'add', '-q', '-b', 'linked', '../project');
git(primary, 'commit', '-q', '--allow-empty', '-m', 'main-only commit');
git(project, 'commit', '-q', '--allow-empty', '-m', 'linked-only commit');
fs.writeFileSync(path.join(project, 'tracked.txt'), 'updated\n');
fs.writeFileSync(path.join(project, 'untracked.txt'), 'new\n');
fs.writeFileSync(path.join(primary, 'primary-only.txt'), 'not assigned');
fs.writeFileSync(path.join(project, 'staged.txt'), 'staged\n');
git(project, 'add', 'staged.txt');
fs.copyFileSync(path.join(__dirname, '../crates/host/tests/fake_claude_sdk.py'), file('claude'));
fs.chmodSync(file('claude'), 0o700);
fs.symlinkSync(fs.realpathSync(process.execPath), file('node'));
const host = spawn(binary, ['serve', '--foreground', '--project', project, '--state-dir', state, '--no-open', '--no-history'], {
    stdio: 'inherit',
    env: {PATH: root, HOME: root, CLAUDE_CONFIG_DIR: file('claude-config'), XDG_DATA_HOME: file('data'),
        XDG_CONFIG_HOME: file('config'), XDG_RUNTIME_DIR: file('runtime'), DECK2_SDK_FIXTURE: root},
});
const stopped = new Promise(resolve => host.once('exit', resolve));
async function until(check, description, tries = 300) {
    for (let i = 0; i < tries; i++) { const v = await check(); if (v) return v; await wait(100); }
    throw Error('Timed out waiting for ' + description);
}
let serial = 0;
async function drive(name, args) {
    const n = serial++;
    fs.writeFileSync(file(`drive-${n}.stage`), JSON.stringify({name, arguments: args}));
    fs.renameSync(file(`drive-${n}.stage`), file(`drive-${n}.json`));
    const reply = await until(() => { try { return JSON.parse(fs.readFileSync(file(`drive-${n}.out`), 'utf8')); } catch {} }, name);
    const result = reply.result ?? reply;
    assert(!reply.error && !result.isError, JSON.stringify(reply));
    return JSON.parse(result.content[0].text);
}

async function run() {
    let browser;
    try {
        const launcher = await until(() => { try { return JSON.parse(fs.readFileSync(path.join(state, 'launcher.json'))); } catch {} }, 'host');
        const base = 'http://' + launcher.host;
        const launch = await (await fetch(base + '/launch', {method: 'POST', body: launcher.admin})).json();
        browser = await chromium.launch({executablePath: process.env.DECK2_CHROMIUM || '/snap/bin/chromium', args: ['--no-sandbox']});
        const page = await browser.newPage({viewport: {width: 1440, height: 900}, serviceWorkers: 'block'});
        page.setDefaultTimeout(10000);
        page.on('pageerror', error => console.error(error.message));
        if (process.env.LATE_DEBUG) page.on('response', async r => { if (r.url().includes('/exchanges')) console.error('EX', r.url().split('?')[1], (await r.text().catch(() => '')).replace(/"provenance":\{[^}]*\},?/g, '').slice(0, 400)); });
        await page.goto(launch.url);
        await page.waitForURL(base + '/');
        const post = async (route, data) => { const r = await page.request.post(base + route, {data, headers: {origin: base}}); assert(r.ok(), route + ' ' + await r.text()); return r.json(); };
        const get = async route => (await page.request.get(base + route)).json();
        await post('/api/project/trust', {api: 7, project, trusted: true});
        const session = 'late-guidance';
        await post('/api/sessions', {api: 7, id: session, title: session, members: {
            lead: {runnerId: 'claude', modelId: 'default'}, investigate: {runnerId: 'claude', modelId: 'sonnet', thinking: 'high'}}});
        await post('/api/commands', {api: 7, id: 'late-root', session, mode: 'session_v1', prompt: 'Drive Lead tools'});
        await until(() => fs.existsSync(file('drive-lead')), 'Lead driver');
        const delegated = await drive('deck_delegate', {agent: 'investigate', task: 'Hold Claude member for delayed guidance'});
        const task = await until(async () => {
            const t = (await get('/api/workspace')).tasks.find(t => t.id === delegated.taskId);
            const a = t?.attempts[0];
            return a?.phase === 'running' && a.guidance_open && fs.existsSync(file('member-running-' + a.native_session)) && t;
        }, 'running member').catch(async e=>{const t=(await get('/api/workspace')).tasks.find(t=>t.id===delegated.taskId);console.error(fs.readFileSync(file('fixture-error'),'utf8'));console.error(JSON.stringify(t?.attempts.map(a=>[a.phase,a.detail,a.guidance_open,a.native_session])),fs.readdirSync(root));throw e;});
        const a = task.attempts[0];

        await page.reload();
        await page.locator('.sidebar .session').filter({hasText: session}).click();
        await page.getByRole('button', {name: 'Open Subagents', exact: true}).click();
        await page.getByRole('button', {name: 'Open full view'}).click();
        const log = page.getByRole('log', {name: /conversation$/});
        await log.waitFor();

        const text = 'Use the delayed v4 schema';
        const args = {taskId: task.id, attemptId: a.id, threadId: a.native_session, expectedTurnId: a.native_message, commandId: randomUUID(), text};
        const first = await drive('deck_task_guide', args);
        assert.equal(first.status, 'unknown');
        const row = log.locator('article').filter({hasText: text});
        await row.getByText('Delivery unknown', {exact: true}).waitFor();
        // Tag the live element and freeze the reader's scroll so reuse is observable.
        await row.evaluate(node => { node.dataset.liveRow = 'same'; });
        const before = await log.evaluate(node => ({top: node.scrollTop, order: [...node.querySelectorAll('article')].map(n => n.dataset.liveRow || '-')}));
        // A foreign receipt (already emitted by the member) and the passage of time settle nothing.
        await wait(2500);
        await row.getByText('Delivery unknown', {exact: true}).waitFor();
        assert.equal((await get('/api/workspace')).tasks.find(t => t.id === task.id).attempts[0].guidance[0].input.state, 'uncertain');
        const writes = () => fs.readdirSync(root).filter(n => n.startsWith('steer-')).length;
        assert.equal(writes(), 1);

        // The authoritative receipt arrives late. No reload, reopen, scroll or click follows.
        fs.writeFileSync(file('release-delayed-echo'), '');
        await row.getByText('Delivered live', {exact: true}).waitFor({timeout: 8000}).catch(async e => {
            console.error(JSON.stringify(await get(`/api/sessions/${session}/tasks/${task.id}/attempts/${a.id}/exchanges?limit=32`)), JSON.stringify((await get('/api/workspace')).tasks.find(t => t.id === task.id).attempts[0].guidance));
            throw e;
        });
        const after = await log.evaluate(node => ({top: node.scrollTop, order: [...node.querySelectorAll('article')].map(n => n.dataset.liveRow || '-')}));
        assert.deepEqual(after.order, before.order, 'same row, same position');
        assert.equal(await log.locator('article').filter({hasText: text}).count(), 1, 'one row only');
        assert.equal(await log.locator('article[data-live-row=same]').count(), 1, 'the original element was updated');
        assert.equal(writes(), 1, 'the input is never replayed');
        const done = await until(async () => { const t = (await get('/api/workspace')).tasks.find(t => t.id === task.id).attempts[0]; return t.phase === 'completed' && t; }, 'member completion');
        assert.equal(done.id, a.id);
        assert.equal(done.native_session, a.native_session);
        assert.equal(done.guidance[0].input.state, 'accepted');
        assert.equal(done.report.text, 'Claude member report delayed: ' + text);
        assert.equal(await log.locator('article').filter({hasText: text}).count(), 1);
        console.log(JSON.stringify({unknownThenAccepted: true, before, after, sameElement: true, replays: 0}));
    } finally {
        fs.writeFileSync(file('drive-stop'), '');
        await browser?.close();
        host.kill('SIGTERM');
        await stopped;
        fs.rmSync(root, {recursive: true, force: true});
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
