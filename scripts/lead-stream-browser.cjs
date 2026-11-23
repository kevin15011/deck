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
        async function verifyComposerClearance() {
            const clearance = await page.locator('.chat-pane').evaluate(pane => {
                const tail = pane.querySelector('.transcript-window').getBoundingClientRect();
                const stack = pane.querySelector('.conversation-float-stack').getBoundingClientRect();
                return {aboveStatus:stack.top-tail.bottom,aboveComposer:pane.querySelector('.composer-dock').getBoundingClientRect().top-tail.bottom};
            });
            assert(clearance.aboveStatus>=0 && clearance.aboveStatus<=48,
                'The latest reply should clear the floating status without reserving the composer a second time: '+JSON.stringify(clearance));
            return clearance;
        }
        if (process.argv.includes('--chat-layout-only')) {
            await page.setViewportSize({width:1440,height:420});
            const id = await send('Motion keyboard fixture answer',true);
            const answer = page.locator('#exchange-'+id+' .answer');
            await answer.getByText('word-47',{exact:false}).waitFor({state:'attached'});
            await page.getByText('Working…',{exact:true}).waitFor();
            await page.waitForFunction(() => {
                const view = document.querySelector('#conversation');
                return view.scrollHeight > view.clientHeight && view.scrollHeight-view.scrollTop-view.clientHeight<=2;
            });
            console.log('Live composer clearance',await verifyComposerClearance());
            fs.writeFileSync(path.join(root,'finish-motion'),'');
            assert.equal((await completed(id)).text,burst+final);
            assert.deepEqual(pageErrors,[]);
            return;
        }
        // Seed settled history only inside the private fixture database.
        execFileSync('python3', ['-c', `
import sqlite3,sys,json
with sqlite3.connect(sys.argv[1]) as db:
    row=json.loads(db.execute("select body from receipts where id=?", (sys.argv[2],)).fetchone()[0])
    for i in range(105):
        row.update(id=f'history-{i}',attempt=f'old-{i}',text='Older answer',prompt=f'Older question {i}')
        db.execute("insert into receipts values (?,?)",(row['id'],json.dumps(row)))
`, path.join(state,'state.db'), first.id]);
        // Fixture SQL bypasses the daemon's commit notification; bootstrap the seeded history.
        await page.reload();
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

        // Sample the live DOM across updates and compare the entrance geometry to
        // the actual submit control, before the host acknowledgement can alter it.
        await page.evaluate(() => {
            const form = document.querySelector('.composer');
            const viewport = document.querySelector('#conversation');
            window.motion = {samples:[],flights:[],origin:null,longTasks:[]};
            new PerformanceObserver(list=>window.motion.longTasks.push(...list.getEntries().map(entry=>({
                start: entry.startTime, duration: entry.duration,
            })))).observe({type:'longtask'});
            const capture = () => {
                const bounds = form.querySelector('button[type=submit]').getBoundingClientRect();
                window.motion.origin = {x:(bounds.left+bounds.right)/2,y:(bounds.top+bounds.bottom)/2};
                window.motion.prompt = form.querySelector('textarea').value;
                window.motion.samples.length = 0;
                window.motion.flights.length = 0;
                window.motion.longTasks.length = 0;
            };
            form.addEventListener('submit', capture, true);
            form.addEventListener('keydown', e => {if(e.key==='Enter')capture();}, true);
            new MutationObserver(records => {
                for (const record of records) for (const node of record.addedNodes) {
                    const bubble = node instanceof HTMLElement && node.matches('.chat-send-flight') && node.firstElementChild;
                    if (!bubble) continue;
                    const bounds = bubble.getBoundingClientRect();
                    window.motion.flights.push({
                        text:bubble.querySelector('.slice-prompt').textContent,
                        error:Math.hypot(bounds.right-window.motion.origin.x,(bounds.top+bounds.bottom)/2-window.motion.origin.y),
                        ariaHidden:node.getAttribute('aria-hidden'), inert:node.inert,
                    });
                }
                const latest = [...viewport.querySelectorAll('.exchange')].at(-1);
                const value = latest?.querySelector('.slice-prompt')?.textContent===window.motion.prompt
                    ? latest.querySelector('.answer')?.textContent : undefined;
                if (value?.startsWith('Burst begins') && window.motion.samples.at(-1)?.text!==value) {
                    window.motion.samples.push({
                        text:value,time:performance.now(),
                        bottomGap:viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight,
                    });
                }
            }).observe(document.querySelector('.chat-pane'), {subtree:true,childList:true,characterData:true});
        });
        async function checkMotion(prompt, keyboard, reduce) {
            await page.emulateMedia({reducedMotion:reduce?'reduce':'no-preference'});
            const id = await send(prompt, keyboard);
            const exchange = page.locator('#exchange-'+id);
            const answer = exchange.locator('.answer');
            await answer.getByText('word-47', {exact:false}).waitFor();
            const {samples,flights,longTasks} = await page.evaluate(() => window.motion);
            assert.equal(samples.at(-1).text, burst.replaceAll('**',''));
            if (reduce) {
                assert.equal(samples.length,1,'Reduced motion should present each snapshot immediately');
                assert.equal(flights.length,0,'Reduced motion should skip the send entrance');
            } else {
                assert(samples.length>=2,'A native burst should reveal in more than one visible update '+JSON.stringify({samples,flights}));
                const revealDuration = samples.at(-1).time-samples[0].time;
                assert(revealDuration<180,`Live text reveal for ${prompt} took ${revealDuration.toFixed(1)} ms `+
                    JSON.stringify({updates:samples.map(s=>[s.time,s.text.length]),longTasks}));
                assert(samples.every((sample,i)=>!i||sample.text.startsWith(samples[i-1].text)),'Existing text should remain visible as the burst grows');
                assert.equal(flights.length,1,'Each local send should have one entrance');
                assert.equal(flights[0].text,prompt);
                assert(flights[0].error<12,'The entrance should start at the send control');
                assert.equal(flights[0].ariaHidden,'true');
                assert.equal(flights[0].inert,true);
            }
            assert(samples.every(sample=>sample.bottomGap<=2),'The transcript should follow live output at the bottom');
            await verifyComposerClearance();
            assert(await page.locator('#prompt').evaluate(node=>node===document.activeElement));
            const copyLead = exchange.locator('.assistant-message').getByRole('button',{name:'Copy message'});
            if (!keyboard) {
                await copyLead.press('Enter');
                assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),burst,'Live copy must use the source Markdown');
            }
            const viewport = page.locator('#conversation');
            if (keyboard && !reduce) {
                await viewport.hover();
                await page.mouse.wheel(0,-480);
                await page.waitForFunction(()=> {
                    const view = document.querySelector('#conversation');
                    return view.scrollHeight-view.scrollTop-view.clientHeight>=320;
                });
            }
            const readingPosition = await viewport.evaluate(node=>node.scrollTop);
            fs.writeFileSync(path.join(root,'finish-motion'),'');
            const settled = await completed(id);
            assert.equal(settled.text,burst+final);
            fs.unlinkSync(path.join(root,'finish-motion'));
            await answer.locator('strong').getByText('Burst begins',{exact:true}).waitFor();
            await answer.locator('pre').getByText('Final marker 🧭',{exact:true}).waitFor({state:'attached'});
            if (keyboard && !reduce) {
                assert.equal(await viewport.evaluate(node=>node.scrollTop),readingPosition,'Final output must preserve the reading position');
                await viewport.evaluate(node=>{node.scrollTop=node.scrollHeight;});
            }
            await page.locator('.chat-send-flight').waitFor({state:'detached'});
            if (!keyboard) {
                assert.equal(await exchange.locator('.assistant-message time').getAttribute('datetime'),
                    new Date(settled.first_output_ms).toISOString());
                await copyLead.press('Enter');
                assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),burst+final);
            }
            console.log(JSON.stringify({prompt,reducedMotion:reduce,updates:samples.length,
                revealDurationMs:Math.round(samples.at(-1).time-samples[0].time),entrances:flights.length}));
            return id;
        }
        const pointer = await checkMotion('Motion pointer fixture answer', false, false);
        await checkMotion('Motion keyboard fixture answer', true, false);
        await checkMotion('Reduced motion fixture answer', true, true);
        await page.emulateMedia({reducedMotion:'no-preference'});
        const liveId = await send('Live navigation fixture answer');
        const liveAnswer = page.locator('#exchange-'+liveId+' .answer');
        await liveAnswer.getByText('word-47', {exact:false}).waitFor();
        await page.locator('.chat-send-flight').waitFor({state:'detached'});
        const activeSession = new URL(page.url()).searchParams.get('session');
        assert(activeSession);
        const otherSession = page.getByRole('button',{name:'Project conversation',exact:true});
        const streamSession = page.getByRole('button',{name:'Stream timing',exact:true});
        await page.evaluate(id => {
            window.navigationMotion = {flights:0, openings:[], output:[]};
            const observer = new MutationObserver(records => {
                for (const record of records) for (const node of record.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    if (node.matches('.chat-send-flight')) window.navigationMotion.flights++;
                    const loading = node.matches('.session-loading') ? node : node.querySelector('.session-loading');
                    if (loading) window.navigationMotion.openings.push({
                        name:loading.querySelector('strong')?.textContent,
                        previousInert:document.querySelector('.session-panes > .panes')?.inert,
                    });
                }
                const text = document.querySelector('#exchange-'+id+' .answer')?.textContent;
                if (text?.startsWith('Burst begins')) window.navigationMotion.output.push(text);
            });
            observer.observe(document.querySelector('.workbench'),{subtree:true,childList:true,characterData:true});
        },liveId);
        await otherSession.click();
        const otherUrl = page.url();
        assert.notEqual(new URL(otherUrl).searchParams.get('session'),activeSession);
        await streamSession.click();
        await page.locator('#exchange-'+pointer+' pre').waitFor({state:'attached'});
        await liveAnswer.getByText('word-47',{exact:false}).waitFor();
        const switched = await page.evaluate(()=>window.navigationMotion);
        assert.deepEqual(switched.openings,[{name:'Stream timing',previousInert:true}]);
        assert.equal(switched.flights,0,'Reopening history should not replay sends');
        assert(switched.output.length>0 && switched.output.every(text=>text===burst.replaceAll('**','')),
            'Reopening the live session should show its full existing reply');
        // Reselect the lightweight session before the heavy transcript commits.
        await otherSession.click();
        await page.evaluate(() => {
            const button = [...document.querySelectorAll('.sidebar button')].find(node=>node.textContent.trim()==='Project conversation');
            const observer = new MutationObserver(() => {
                if (!document.querySelector('.session-panes .session-loading')) return;
                observer.disconnect();
                button.click();
                window.supersededOpening = true;
            });
            observer.observe(document.querySelector('.workbench'),{subtree:true,childList:true});
        });
        await streamSession.click();
        await page.waitForFunction(()=>window.supersededOpening && !document.querySelector('.session-panes .session-loading'));
        assert.equal(page.url(),otherUrl);
        await streamSession.click();
        await liveAnswer.getByText('word-47',{exact:false}).waitFor();
        await page.addInitScript(id => {
            window.reloadMotion = {flights:0, output:[]};
            new MutationObserver(records => {
                if (records.some(r=>[...r.addedNodes].some(n=>n instanceof HTMLElement&&n.matches('.chat-send-flight')))) window.reloadMotion.flights++;
                const text = document.querySelector('#exchange-'+id+' .answer')?.textContent;
                if (text?.startsWith('Burst begins')) window.reloadMotion.output.push(text);
            }).observe(document,{subtree:true,childList:true});
        },liveId);
        await page.reload();
        await page.locator('#exchange-'+pointer+' pre').waitFor({state:'attached'});
        await liveAnswer.getByText('word-47',{exact:false}).waitFor();
        const reloaded = await page.evaluate(()=>window.reloadMotion);
        assert.equal(reloaded.flights,0);
        assert(reloaded.output.length>0 && reloaded.output.every(text=>text===burst.replaceAll('**','')),
            'Reload should show the full existing reply');
        fs.writeFileSync(path.join(root,'finish-motion'),'');
        assert.equal((await completed(liveId)).text,burst+final);
        await liveAnswer.locator('pre').getByText('Final marker 🧭',{exact:true}).waitFor();
        assert.deepEqual(pageErrors,[]);
        console.log('Controlled native burst, terminal Markdown, send entrance, focus, reduced motion, scroll, named loader, switch supersession and live reload passed');
    } catch (error) {
        console.error('Stream fixture state:',root,await page?.content().then(html=>html.slice(0,800)).catch(()=>'<unavailable>'));
        throw error;
    } finally {
        if (browser) await browser.close();
        host.kill('SIGINT');
    }
}
check().catch(e=>{console.error(e);process.exitCode=1;});
