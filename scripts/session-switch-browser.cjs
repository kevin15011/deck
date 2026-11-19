// Build the browser bundle into a private directory and fake only the host HTTP boundary.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const project = {id:'project',root:'/fixture',identity:null,available:true};
const sessions = [
    {id:'cap',title:'CAP 2',native:null,project},
    {id:'continue',title:'Continue 2',native:null,project},
    {id:'short',title:'Short',native:null,project},
];
const markdown = Array.from({length:6}, (_, i) => [
    '### Finding ' + i,
    '- Review **the change**, record `result` and [the source](https://example.org).',
    '- Follow the next step and confirm the associated evidence.',
    '',
    '| Case | Outcome |',
    '| --- | --- |',
    '| Build | Passed |',
    '| Browser | Verified |',
].join('\n')).join('\n\n');
const turn = (session, i) => ({
    id:session+'-'+i, session, prompt:'Question '+i, text:markdown+'\n\nFinal marker '+i,
    detail:'', policy:'read_only', runner:'codex', delivery:'settled', phase:'completed',
    fresh:false, model:null, thread:null, turn:null, native_pid:null, handshake_ms:null,
    dispatch_ms:null, first_output_ms:null, accepted_ms:1000+i, revision:1, local_tool_calls:0,
});
const receipts = Array.from({length:156}, (_, i) => turn('continue', i));
const workspace = {
    api:7, session:'cap', project:project.root, runner:'codex', availability:null,
    host_id:'switch-fixture', queue_paused:false, steering_unavailable:'',
    sessions, tasks:[], team_availability:null, receipts, projects:[project],
};

async function run() {
    const assets = process.env.DECK2_UI_ASSETS || fs.mkdtempSync(path.join(os.tmpdir(),'deck2-switch-'));
    let browser;
    try {
        if (!process.env.DECK2_UI_ASSETS) execFileSync('bun', [
            'build','frontend/src/app.tsx','--target=browser','--minify','--external','/fonts/*',
            '--define','process.env.NODE_ENV="production"','--outdir',assets,
        ]);
        browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM, args:['--no-sandbox'], headless:true});
        const page = await browser.newPage({viewport:{width:1440,height:900}, serviceWorkers:'block', reducedMotion:process.env.DECK2_SWITCH_REDUCED?'reduce':'no-preference'});
        page.setDefaultTimeout(15000);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.DECK2_SWITCH_CPU_RATE||2)});
        await cdp.send('Performance.enable');
        const timing = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics
            .filter(m=>['LayoutCount','LayoutDuration','ScriptDuration','RecalcStyleDuration'].includes(m.name))
            .map(m=>[m.name,m.value]));
        const errors = [];
        const writes = [];
        page.on('pageerror', error => errors.push(error.message));
        const address = 'http://127.0.0.1:7654';
        await page.route(address+'/**', route => {
            const endpoint = new URL(route.request().url()).pathname;
            const json = value => route.fulfill({json:value});
            if (endpoint==='/') return route.fulfill({path:'frontend/index.html',contentType:'text/html'});
            if (endpoint==='/app.js'||endpoint==='/app.css') return route.fulfill({path:path.join(assets,endpoint.slice(1))});
            if (endpoint==='/api/workspace') return json(workspace);
            if (endpoint==='/api/sidebar') return json({projects:{},sessions:{}});
            if (endpoint==='/api/history/projects') return json({projects:[],issues:[]});
            if (route.request().method()!=='GET') writes.push(endpoint);
            return route.fulfill({status:404,body:''});
        });
        await page.goto(address);
        const sidebar = name => page.locator('.sidebar').getByRole('button',{name,exact:true});
        const heading = name => page.getByRole('heading',{name,exact:true,level:1});
        const loader = page.getByRole('status').filter({hasText:'Opening conversation'});
        await heading('CAP 2').waitFor();
        await sidebar('Continue 2').waitFor();

        await page.exposeFunction('probeSwitchKey',()=>page.keyboard.press('Shift').catch(()=>{}));
        await page.evaluate(() => {
            window.switchRuns = [];
            document.addEventListener('click', event => {
                if (!event.target.closest('button[aria-label="Continue 2"]')) return;
                const origin = performance.now();
                const result = {frames:[],tasks:[],inputIntervals:[],loaderMs:null,arrivalMs:null};
                window.switchRuns.push(result);
                result.keyDelayMs = null;
                const key = event => { if (event.isTrusted && event.key==='Shift') result.keyDelayMs = Math.round(performance.now()-event.timeStamp); };
                document.addEventListener('keydown', key);
                let lastFrame = origin;
                let lastInput = origin;
                const observer = new PerformanceObserver(list => result.tasks.push(
                    ...list.getEntries().map(entry => Math.round(entry.duration))));
                observer.observe({type:'longtask'});
                const input = setInterval(() => document.dispatchEvent(new Event('fixture-input')), 16);
                const receive = () => {
                    const now = performance.now();
                    result.inputIntervals.push(Math.round(now-lastInput));
                    lastInput = now;
                };
                document.addEventListener('fixture-input', receive);
                const frame = () => {
                    const now = performance.now();
                    result.frames.push(Math.round(now-lastFrame));
                    lastFrame = now;
                    if (result.loaderMs===null && document.querySelector('.session-loading-status')) {
                        result.loaderMs = Math.round(now-origin);
                        void window.probeSwitchKey();
                    }
                    const title = document.querySelector('.app-header h1')?.textContent;
                    if (result.arrivalMs===null && title==='Continue 2' && document.querySelector('#exchange-continue-155') &&
                        !document.querySelector('.session-loading-status')) {
                        result.arrivalMs = Math.round(now-origin);
                    }
                    if ((result.arrivalMs===null && now-origin<30000) || now-origin<(result.arrivalMs??0)+50) requestAnimationFrame(frame);
                    else {
                        clearInterval(input);
                        document.removeEventListener('fixture-input',receive);
                        document.removeEventListener('keydown',key);
                        observer.disconnect();
                        result.finished = true;
                    }
                };
                requestAnimationFrame(frame);
            }, true);
        });
        const measures = [];
        for (let i=0;i<Number(process.env.DECK2_SWITCH_RUNS||3);i++) {
            const start = await timing();
            await sidebar('Continue 2').click({noWaitAfter:true});
            await page.waitForFunction(i => window.switchRuns[i]?.finished && window.switchRuns[i]?.arrivalMs!=null, i, {timeout:35000}).catch(async error => {
                console.error({errors, sample: await page.evaluate(()=>({title:document.querySelector('h1')?.textContent,
                    count: document.querySelectorAll('.exchange').length, switches:window.switchRuns?.map(run=>({
                        ...run,frames:run.frames.slice(-10),inputIntervals:run.inputIntervals.slice(-10),
                    }))}))});
                throw error;
            });
            await page.getByText('Final marker 155',{exact:true}).waitFor();
            measures.push(await page.evaluate(i => {
                const {frames,tasks,inputIntervals,loaderMs,arrivalMs,keyDelayMs} = window.switchRuns[i];
                return {loaderMs,arrivalMs,keyDelayMs,maxFrameMs:Math.max(...frames),
                    longestTaskMs:Math.max(0,...tasks),maxInputIntervalMs:Math.max(0,...inputIntervals)};
            },i));
            const end = await timing();
            Object.assign(measures.at(-1), Object.fromEntries(Object.keys(start).map(key=>[key,
                Math.round((end[key]-start[key])*(key.endsWith('Duration')?1000:1))])));
            await sidebar('CAP 2').click({noWaitAfter:true});
            await heading('CAP 2').waitFor();
        }
        console.log(JSON.stringify(measures));
        assert(measures.every(run => run.loaderMs!==null),'Heavy navigation should paint a loader');
        assert(measures.some(run => run.keyDelayMs!==null),'Chromium did not deliver keyboard input during the measurement');
        const medianFrame = measures.map(run => run.maxFrameMs).sort((a,b)=>a-b)[Math.floor(measures.length/2)];
        const medianInput = measures.map(run => run.maxInputIntervalMs).sort((a,b)=>a-b)[Math.floor(measures.length/2)];
        assert(medianFrame<300 && medianInput<350,'Long transcript blocks browser frames or input');
        assert.equal(await loader.count(),0);

        // One selection wins even when the next click lands between the loader paint
        // and the scheduled open. The test injects only the competing browser input.
        await page.evaluate(() => {
            document.querySelector('button[aria-label="Continue 2"]').click();
            requestAnimationFrame(()=>document.querySelector('button[aria-label="Short"]').click());
        });
        await heading('Short').waitFor();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const locationSession = () => page.evaluate(()=>new URL(location.href).searchParams.get('session'));
        assert.equal(await locationSession(),'short');

        const saved = 'deck2.host.switch-fixture.project.%2Ffixture.session.continue.';
        await page.evaluate(prefix=>{
            localStorage.setItem(prefix+'draft','Private fixture draft');
            localStorage.setItem(prefix+'pending-command.bad','invalid');
        },saved);
        await sidebar('Continue 2').click({noWaitAfter:true});
        const retry = page.getByRole('button',{name:'Retry conversation'});
        await retry.waitFor();
        await heading('Short').waitFor();
        assert.equal(await locationSession(),'short','Failed restore changed session ownership');
        await page.evaluate(prefix=>localStorage.removeItem(prefix+'pending-command.bad'),saved);
        await retry.click({noWaitAfter:true});
        await heading('Continue 2').waitFor();
        assert.equal(await page.locator('#prompt').inputValue(),'Private fixture draft');
        const latest = page.getByText('Final marker 155',{exact:true});
        await latest.waitFor();
        assert(await latest.evaluate(el=>{
            const viewport = el.closest('.conversation').getBoundingClientRect();
            const marker = el.getBoundingClientRect();
            return marker.bottom>viewport.top && marker.top<viewport.bottom;
        }),'Session did not open at its latest reply');

        const previous = page.getByRole('button',{name:'Load older messages',exact:true});
        await latest.evaluate(el=>new Promise(resolve=>{
            el.closest('.conversation').scrollTop=0;
            requestAnimationFrame(()=>requestAnimationFrame(resolve));
        }));
        assert.equal(await latest.count(),1,'Scrolling to the beginning prematurely evicted a dense turn');
        await previous.click({noWaitAfter:true});
        await page.getByText('Final marker 154',{exact:true}).waitFor();
        const newer = page.getByRole('button',{name:'Load newer messages',exact:true});
        await newer.evaluate(button=>button.click());
        await latest.waitFor();

        // Reduced motion keeps the same loader and omits the animated trace.
        await sidebar('CAP 2').click({noWaitAfter:true});
        await heading('CAP 2').waitFor();
        await page.emulateMedia({reducedMotion:'reduce'});
        const trace = await sidebar('Continue 2').evaluate(button=>new Promise(resolve=>{
            button.click();
            requestAnimationFrame(()=>{
                const stroke = document.querySelector('.session-loading-trace');
                resolve(stroke && {dash:stroke.style.strokeDashoffset, visible:stroke.getClientRects().length>0});
            });
        }));
        assert.deepEqual(trace,{dash:'',visible:true});
        await heading('Continue 2').waitFor();
        await latest.waitFor();

        await page.reload();
        await heading('Continue 2').waitFor();
        assert.equal(await page.locator('#prompt').inputValue(),'Private fixture draft');
        assert.deepEqual(errors,[]);
        assert(!writes.includes('/api/commands'),'Session navigation dispatched a command');
        console.log('PASS: session arrival, newest selection, saved draft, retry, older/newer browsing and reduced motion');
    } finally {
        await browser?.close();
        if (!process.env.DECK2_UI_ASSETS) fs.rmSync(assets,{recursive:true,force:true});
    }
}

run().catch(error => {console.error(error);process.exitCode=1;});
