// Measure native emission through visible text in the packaged browser UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

async function check() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-autoscroll-'));
    const project = path.join(root, 'project');
    const state = path.join(root, 'state');
    const codex = path.join(root, 'codex');
    fs.mkdirSync(project);
    execFileSync('git', ['init', '-q', project]);
    const native = fs.readFileSync(path.join(__dirname, '../crates/host/tests/fake_session_native.py'), 'utf8');
    const burst = '**Burst begins** ' + Array.from({length:48}, (_,i)=>'word-'+i).join(' ');
    const final = '\n\n```text\nFinal marker 🧭\n```';
    fs.writeFileSync(codex, native.replace("  if text=='Stream fixture answer':", `  if text in ('Motion pointer fixture answer','Motion keyboard fixture answer','Reduced motion fixture answer','Live navigation fixture answer'):
   out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'itemId':'motion','delta':${JSON.stringify(burst)}}})
   for _ in range(500):
    if (root/'finish-motion').exists(): break
    time.sleep(.02)
   out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'itemId':'motion','delta':${JSON.stringify(final)}}})
   out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
   continue
  if text=='Stream fixture answer':`), {mode:0o700});
    fs.writeFileSync(path.join(root, 'startup-fixture'), '');
    const binary = path.resolve(process.argv[2] || 'dist/deck2');
    const host = spawn(binary, ['serve', '--foreground', '--no-open', '--project', project,
        '--state-dir', state, '--codex', codex], {
        env: { ...process.env, HOME: root, CODEX_HOME: path.join(root, 'native'),
            XDG_DATA_HOME: path.join(root, 'data'), XDG_CONFIG_HOME: path.join(root, 'config') },
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    let browser, page;
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
        page = await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
        await page.context().grantPermissions(['clipboard-read','clipboard-write']);
        page.setDefaultTimeout(10000);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        const assets = new Set();
        if (process.env.DECK2_UI_ASSETS) {
            for (const file of ['app.js','app.css']) await page.route('**/'+file, route => {
                assets.add(file);
                return route.fulfill({
                    path:path.join(process.env.DECK2_UI_ASSETS,file), contentType:file.endsWith('.js')?'text/javascript':'text/css',
                });
            });
        }
        const navigation = await page.goto(url);
        assert.equal(navigation?.status(), 200);
        await page.waitForFunction(()=>document.querySelector('.sidebar .project-new')?.disabled===false).catch(async error => {
            const html = await navigation.text().then(value=>value.slice(0,300)).catch(e=>e.message);
            const dom = await page.evaluate(()=>document.body?.innerText.slice(0,500)).catch(e=>e.message);
            throw Error(`Workspace did not render. Browser errors: ${pageErrors.join('; ')}, response: ${html}, DOM: ${dom}`,{cause:error});
        });
        if (process.env.DECK2_UI_ASSETS) assert.deepEqual(assets, new Set(['app.js','app.css']));
        await page.getByRole('button', {name: 'New session in project', exact: true}).press('Enter');
        await page.getByLabel('Session name', {exact: true}).fill('Stream timing');
        await page.getByRole('button', {name: 'Create session', exact: true}).click();
        await page.getByRole('dialog').waitFor({state: 'hidden'});
        async function send(prompt, keyboard=false) {
            await page.locator('#prompt').fill(prompt);
            assert(await page.locator('#prompt').evaluate(input =>
                document.activeElement === input && getComputedStyle(input).outlineStyle === 'none'
                && input.closest('.composer').classList.contains('composer-input-focused')
            ), 'Focus should follow the rounded composer after opening a session');
            const sendButton = page.locator('.composer-actions button.send[type=submit]:enabled');
            await sendButton.waitFor();
            const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/commands' && r.request().method() === 'POST');
            if (keyboard) await page.locator('#prompt').press('Enter');
            else await sendButton.click();
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
        const view = page.locator('#conversation');
        const gap = () => view.evaluate(v => Math.round(v.scrollHeight-v.scrollTop-v.clientHeight));
        const jump = page.getByRole('button', {name:'Jump to latest message'});
        await page.setViewportSize({width:1200,height:520});
        // Fill history so the transcript scrolls.
        for (let i = 0; i < 6; i++) await completed(await send('Stream fixture answer'));
        await page.waitForFunction(() => { const v=document.querySelector('#conversation'); return v.scrollHeight>v.clientHeight*1.5 && v.scrollHeight-v.scrollTop-v.clientHeight<=2; });
        assert.equal(await jump.count(), 0, 'No jump button while at latest');
        // 1. Streaming same-row growth follows bottom.
        const id = await send('Motion keyboard fixture answer', true);
        await page.locator('#exchange-'+id+' .answer').getByText('word-47',{exact:false}).waitFor({state:'attached'});
        await page.waitForFunction(() => { const v=document.querySelector('#conversation'); return v.scrollHeight-v.scrollTop-v.clientHeight<=2; });
        assert.equal(await jump.count(), 0);
        // 2. Intentional scroll up during streaming: position preserved, button shows.
        await view.hover(); await page.mouse.wheel(0, -600);
        await jump.waitFor();
        const held = await view.evaluate(v => v.scrollTop);
        fs.writeFileSync(path.join(root,'finish-motion'),'');
        await completed(id);
        await page.waitForTimeout(600);
        assert(Math.abs(await view.evaluate(v => v.scrollTop) - held) < 3, 'history position must be preserved');
        assert(await jump.isVisible());
        // keyboard + focus + accessible
        await jump.focus();
        assert(await jump.evaluate(b => getComputedStyle(b).outlineStyle !== 'none'), 'focus ring');
        const layoutBefore = await page.locator('.composer-dock').evaluate(e => e.getBoundingClientRect().top);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => { const v=document.querySelector('#conversation'); return v.scrollHeight-v.scrollTop-v.clientHeight<=2; });
        await jump.waitFor({state:'detached'});
        assert.equal(await page.locator('.composer-dock').evaluate(e => e.getBoundingClientRect().top), layoutBefore, 'no layout shift');
        // 3. After jump, follow resumes for a new row and delayed message.
        const id2 = await send('Stream fixture answer');
        await completed(id2);
        await page.waitForTimeout(400);
        assert(await gap() <= 2, 'follow resumed after jump: '+await gap());
        // 4. Scroll up, send new message: sending re-pins; scroll up again then jump by click.
        await view.hover(); await page.mouse.wheel(0, -2000);
        await jump.waitFor();
        await jump.click();
        await page.waitForFunction(() => { const v=document.querySelector('#conversation'); return v.scrollHeight-v.scrollTop-v.clientHeight<=2; });
        // 4b. Long transcript crossing the render window budget.
        execFileSync('python3', ['-c', `
import sqlite3,sys,json
with sqlite3.connect(sys.argv[1]) as db:
    row=json.loads(db.execute("select body from receipts where id=?", (sys.argv[2],)).fetchone()[0])
    for i in range(160):
        row.update(id=f'history-{i}',attempt=f'old-{i}',text='Older answer',prompt=f'Older question {i}')
        db.execute("insert into receipts values (?,?)",(row['id'],json.dumps(row)))
`, path.join(state,'state.db'), first.id]);
        await page.reload();
        await page.waitForFunction(() => +document.querySelector('#conversation .transcript-window')?.dataset.windowTotal >= 160);
        const win = () => page.locator('#conversation .transcript-window').evaluate(n => ({start:+n.dataset.windowStart,end:+n.dataset.windowEnd,total:+n.dataset.windowTotal}));
        const bottom = () => page.waitForFunction(() => { const v=document.querySelector('#conversation'); return v.scrollHeight-v.scrollTop-v.clientHeight<=2; });
        await bottom();
        let w0 = await win();
        assert(w0.start > 0 && w0.end === w0.total, 'long transcript must be windowed: '+JSON.stringify(w0));
        assert.equal(await jump.count(), 0);
        // Automatic shrink/growth while pinned must not page or unpin.
        await page.evaluate(() => { const last=document.querySelector('#conversation .transcript-window').lastElementChild; const d=document.createElement('div'); d.id='spacer'; d.style.height='1500px'; last.appendChild(d); });
        await bottom();
        await page.evaluate(() => document.querySelector('#spacer').remove());
        await page.waitForTimeout(300);
        assert.deepEqual(await win(), w0, 'automatic shrink must not page');
        await page.evaluate(() => { const last=document.querySelector('#conversation .transcript-window').lastElementChild; const d=document.createElement('div'); d.id='late'; d.style.height='400px'; setTimeout(()=>last.appendChild(d),300); });
        await page.waitForFunction(() => document.querySelector('#late'));
        await bottom();
        await page.evaluate(() => document.querySelector('#late').remove());
        // Read history until older rows are reached and the window no longer includes the newest row.
        for (let i = 0; i < 40; i++) { await view.hover(); await page.mouse.wheel(0, -4000); await page.waitForTimeout(80); }
        let w1 = await win();
        assert(w1.end < w1.total, 'window must have moved away from newest: '+JSON.stringify(w1));
        // Delayed growth while reading must not move the reader.
        const reading = await view.evaluate(v => v.scrollTop);
        await page.evaluate(() => { const first=document.querySelector('#conversation .transcript-window').lastElementChild; first.style.paddingBottom='600px'; });
        await page.waitForTimeout(400);
        assert(Math.abs(await view.evaluate(v => v.scrollTop) - reading) < 3, 'history reader moved on async growth');
        // Physical bottom of an older window is not the newest row: the button must still show.
        await page.waitForTimeout(2300);
        await view.evaluate(v => { v.scrollTop = v.scrollHeight; });
        await page.waitForTimeout(600);
        assert(await gap() <= 2, 'programmatic scroll reached the physical bottom: '+await gap());
        await jump.waitFor();
        const w2 = await win();
        assert(w2.end < w2.total, 'still an older window: '+JSON.stringify(w2));
        await jump.focus();
        await page.keyboard.press('Enter');
        await bottom();
        const w3 = await win();
        assert.equal(w3.end, w3.total, 'jump must return to the newest window');
        assert(await page.locator('#conversation .transcript-window').evaluate(n => { const r=n.lastElementChild.getBoundingClientRect(), v=document.querySelector('#conversation').getBoundingClientRect(); return r.bottom<=v.bottom+1&&r.bottom>v.top; }), 'newest row visible');
        await jump.waitFor({state:'detached'});
        // Streaming resumes following after the jump.
        const id3 = await send('Motion keyboard fixture answer', true);
        await page.locator('#exchange-'+id3+' .answer').getByText('word-47',{exact:false}).waitFor({state:'attached'});
        await bottom();
        fs.writeFileSync(path.join(root,'finish-motion'),'');
        await completed(id3);
        await page.waitForTimeout(300);
        assert(await gap() <= 2, 'follow after streaming resumed');
        // 5. Session switching resets.
        await page.getByRole('button', {name: 'New session in project', exact: true}).press('Enter');
        await page.getByLabel('Session name', {exact: true}).fill('Other');
        await page.getByRole('button', {name: 'Create session', exact: true}).click();
        await page.getByRole('dialog').waitFor({state:'hidden'});
        assert.equal(await jump.count(), 0, 'no jump button on fresh session');
        assert.deepEqual(pageErrors, []);
        console.log('autoscroll checks passed');
    } catch (error) {
        console.error('state:', root);
        throw error;
    } finally {
        if (browser) await browser.close();
        host.kill('SIGINT');
    }
}
check().catch(e=>{console.error(e);process.exitCode=1;});
