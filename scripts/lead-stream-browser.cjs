// Measure native emission through visible text in the packaged browser UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

async function check() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-lead-stream-'));
    const project = path.join(root, 'project');
    const state = path.join(root, 'state');
    const codex = path.join(root, 'codex');
    fs.mkdirSync(project);
    fs.copyFileSync(path.join(__dirname, '../crates/host/tests/fake_session_native.py'), codex);
    fs.chmodSync(codex, 0o700);
    fs.writeFileSync(path.join(root, 'startup-fixture'), '');
    const binary = path.resolve(process.argv[2] || 'dist/deck2');
    const host = spawn(binary, ['serve', '--foreground', '--no-open', '--project', project,
        '--state-dir', state, '--codex', codex], {
        env: { ...process.env, HOME: root, CODEX_HOME: path.join(root, 'native'),
            XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config') },
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    let browser;
    try {
        const launcher = path.join(state, 'launcher.json');
        for (let i = 0; i < 600 && !fs.existsSync(launcher); i++) {
            assert.equal(host.exitCode, null);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const {host: address, admin} = JSON.parse(fs.readFileSync(launcher));
        const base = 'http://' + address;
        const { url } = await (await fetch(base + '/launch', {method: 'POST', body: admin})).json();
        browser = await chromium.launch({ executablePath: process.env.DECK2_CHROMIUM,
            args: ['--no-sandbox'], headless: true });
        const page = await browser.newPage();
        if (process.env.DECK2_UI_ASSETS) {
            await page.route('**/app.js', route => route.fulfill({
                path:path.join(process.env.DECK2_UI_ASSETS,'app.js'), contentType:'text/javascript',
            }));
        }
        await page.goto(url);
        await page.getByRole('button', {name: 'New session in project', exact: true}).press('Enter');
        await page.getByLabel('Session name', {exact: true}).fill('Stream timing');
        await page.getByRole('button', {name: 'Create session', exact: true}).click();
        await page.getByRole('dialog').waitFor({state: 'hidden'});
        async function send(prompt) {
            await page.locator('#prompt').fill(prompt);
            const sendButton = page.locator('.composer-actions button.send[type=submit]:enabled');
            await sendButton.waitFor();
            const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/commands' && r.request().method() === 'POST');
            await sendButton.click();
            return (await (await response).json()).id;
        }
        async function completed(id) {
            for (let i = 0; i < 300; i++) {
                const w = await (await page.request.get(base + '/api/workspace')).json();
                const row = w.receipts.find(r => r.id === id);
                if (row && ['failed','uncertain','completed','cancelled'].includes(row.phase)) {
                    assert.equal(row.phase, 'completed', row.detail);
                    return row;
                }
                await page.waitForTimeout(100);
            }
            throw Error('Turn did not finish');
        }
        const first = await completed(await send('Remember and continue'));
        // Seed settled history only inside the private fixture database.
        execFileSync('python3', ['-c', `
import sqlite3,sys,json
with sqlite3.connect(sys.argv[1]) as db:
    row=json.loads(db.execute("select body from receipts where id=?", (sys.argv[2],)).fetchone()[0])
    for i in range(105):
        row.update(id=f'history-{i}',attempt=f'old-{i}',text='Older answer',prompt=f'Older question {i}')
        db.execute("insert into receipts values (?,?)",(row['id'],json.dumps(row)))
`, path.join(state,'state.db'), first.id]);
        await page.getByText('Older question 104', {exact:true}).waitFor();
        const expected = Array.from({length:100}, (_,i)=>String(i).padStart(4,'0')+' ').join('');
        await page.evaluate(expected => {
            const observer = new MutationObserver(() => {
                const text = document.body.innerText;
                if (text.includes('0000') && !window.firstStreamPaint) window.firstStreamPaint = Date.now();
                if (text.includes(expected.trimEnd()) && !window.lastStreamPaint) {
                    observer.disconnect();
                    requestAnimationFrame(() => { window.lastStreamPaint = Date.now(); });
                }
            });
            observer.observe(document.body, {subtree:true, childList:true, characterData:true});
        }, expected);
        // The loaded process and thread stay put while its live inventory changes.
        fs.writeFileSync(path.join(root, 'paginated-mcp'), '');
        fs.writeFileSync(path.join(root, 'unadmitted-mcp'), '');
        const id = await send('Stream fixture answer');
        await page.waitForFunction(() => window.lastStreamPaint);
        const turn = await completed(id);
        assert.equal(turn.text, expected);
        const painted = await page.evaluate(() => [window.firstStreamPaint,window.lastStreamPaint]);
        const end = Number(fs.readFileSync(path.join(root,'stream-end-ms')));
        const events = JSON.parse(execFileSync('python3',['-c',`
import sqlite3,sys,json
db=sqlite3.connect(sys.argv[1]); rows=[json.loads(r[0]) for r in db.execute("select body from session_events where attempt=? and kind like 'receipt:%' order by seq",(sys.argv[2],))]
print(json.dumps([[r['delta'],r['attemptNumber']] for r in rows if r['delta']]))
`,path.join(state,'state.db'),turn.attempt],{encoding:'utf8'}));
        assert.equal(events.map(r=>r[0]).join(''),expected);
        assert.equal(events[0][0],expected.slice(0,4));
        assert(events.every(r=>r[1]===107));
        console.log(JSON.stringify({chunks:125, published:events.length,firstOutputMs:turn.first_output_ms-turn.accepted_ms,
            firstPaintAfterOutputMs:painted[0]-turn.first_output_ms, lastPaintAfterNativeMs:painted[1]-end,
            cold:first.startup_timing,warm:turn.startup_timing}));
        for (const timing of [first.startup_timing, turn.startup_timing]) {
            assert(timing.mcp_inventory_entries > 0);
            assert(timing.mcp_inventory_passes >= 1);
            assert.equal(timing.mcp_initial_page_ms + timing.mcp_pagination_ms + timing.mcp_retry_rpc_ms,
                timing.mcp_inventory_ms);
        }
        assert(turn.startup_timing.thread_reused);
        assert.equal(turn.native_pid, first.native_pid);
        assert.equal(turn.startup_timing.mcp_status_requests, 2);
        assert(turn.startup_timing.mcp_inventory_entries > first.startup_timing.mcp_inventory_entries);
        assert(events.length < 40);
        assert(painted[1]-end < 1000,'Last fragment took at least a second to appear');
    } finally {
        if (browser) await browser.close();
        host.kill('SIGINT');
    }
}
check().catch(e=>{console.error(e);process.exitCode=1;});
