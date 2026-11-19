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
    ...['Hybrid','Compact'].map(title=>({
        id:title.toLowerCase(),title,native:null,project,
        original:{fingerprint:'fixture',task:'lead',attempt:1,thread:'fixture',model:'fixture'},
    })),
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
const receipts = [
    ...Array.from({length:156}, (_, i) => turn('continue', i)),
    ...Array.from({length:4}, (_, i) => ({...turn('hybrid',i),text:markdown+'\n\nHybrid completed '+i})),
];
const historySummary=id=>({
    sessionId:id,projectId:project.id,title:{hybrid:'Hybrid',compact:'Compact',standalone:'Standalone'}[id],
    members:{lead:{runnerId:id==='standalone'?'claude':'codex',modelId:'fixture'}},createdAt:'2026-01-01T00:00:00Z',
});
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
        browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM, args:['--no-sandbox'],headless:true});
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
        const historyRequests = [];
        let holdOldest;
        page.on('pageerror', error => {errors.push(error.message);console.error(error);});
        const address = 'http://127.0.0.1:7654';
        await page.route(address+'/**', async route => {
            const endpoint = new URL(route.request().url()).pathname;
            const json = value => route.fulfill({json:value});
            if (endpoint==='/') return route.fulfill({path:'frontend/index.html',contentType:'text/html'});
            if (endpoint==='/app.js'||endpoint==='/app.css') return route.fulfill({path:path.join(assets,endpoint.slice(1))});
            if (endpoint==='/api/workspace') return json(workspace);
            if (endpoint==='/api/sidebar') return json({projects:{},sessions:{}});
            if (endpoint==='/api/history/projects') return json({adopted:true,projects:[{projectId:project.id,path:project.root,name:'Fixture',available:true}],issues:[]});
            if (endpoint==='/api/history/projects/project/sessions') return json({sessions:['hybrid','compact','standalone'].map(historySummary)});
            if (/^\/api\/history\/sessions\/(hybrid|compact)\/activate$/.test(endpoint)) return json({});
            if (/^\/api\/history\/sessions\/(hybrid|compact|standalone)$/.test(endpoint)){
                const id=endpoint.split('/').at(-1);
                const query=new URL(route.request().url()).searchParams;
                const total=id==='compact'?2:123,limit=id==='compact'?1:40;
                const before=Number(query.get('before')),after=Number(query.get('after'));
                const end=before?before-1:after?Math.min(total,after+limit):total;
                const start=after?after+1:Math.max(1,end-limit+1);
                const direction=before?'older':after?'newer':'initial';
                historyRequests.push({id,direction,cursor:before||after});
                if(id==='standalone'&&before===4&&holdOldest)await holdOldest;
                const messages=Array.from({length:end-start+1},(_,index)=>{
                    const seq=start+index;
                    return {historyId:seq,seq,ts:'2026-01-01T00:00:00Z',kind:'message.completed',source:{memberId:'lead',runnerId:'codex'},data:{role:'assistant',text:`${id} imported ${seq}`}};
                });
                return json({messages,summary:historySummary(id),tasks:[],boundary:total,snapshot:'fixture',before:start>1?start:null,after:end<total?end:null});
            }
            if (route.request().method()!=='GET') writes.push(endpoint);
            return route.fulfill({status:404,body:''});
        });
        await page.goto(address);
        const sidebar = name => page.locator('.sidebar').getByRole('button',{name,exact:true});
        const heading = name => page.getByRole('heading',{name,exact:true,level:1});
        const loader = page.getByRole('status').filter({hasText:'Opening conversation'});
        await heading('CAP 2').waitFor();
        await sidebar('Continue 2').waitFor();
        await sidebar('Standalone').waitFor();

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

        const conversation = page.getByRole('region',{name:'Recorded messages'});
        const marker = number=>page.getByText('Final marker '+number,{exact:true});
        const rowPosition = number=>page.locator('#exchange-continue-'+number).evaluate(el=>{
            const bounds=el.getBoundingClientRect(),viewport=el.closest('.conversation').getBoundingClientRect();
            return {top:bounds.top-viewport.top,bottom:bounds.bottom-viewport.bottom};
        });
        await conversation.hover();
        await page.mouse.wheel(0,-100000);
        await marker(154).waitFor();
        const anchored = await rowPosition(155);
        assert(anchored.top>=-2&&anchored.top<70,'Prepending changed the visible exchange');
        for (let previous=153;previous>=151;previous--){
            await page.mouse.wheel(0,-100000);
            await marker(previous).waitFor();
        }
        assert.equal(await latest.count(),0,'Browsing mounted the whole transcript');
        assert.equal(await conversation.locator('#exchange-continue-151').count(),1,'A page introduced duplicate exchanges');

        await conversation.focus();
        for (const next of [154,155]){
            await page.keyboard.press('End');
            await marker(next).waitFor();
        }
        let atTail;
        for (let i=0;i<4&&!atTail;i++){
            await page.keyboard.press('End');
            atTail=await conversation.evaluate(el=>new Promise(resolve=>requestAnimationFrame(()=>resolve(el.scrollHeight-el.clientHeight-el.scrollTop<2))));
        }
        assert(atTail,'Keyboard navigation did not reach the latest reply');
        assert(await rowPosition(155).then(pos=>pos.bottom<2),'The latest reply did not return to the viewport');
        // An absolute offset change uses the native scroll event path used by the scrollbar.
        await conversation.evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));
        await marker(152).waitFor();

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
        await latest.waitFor();
        const liveTail=receipts.find(receipt=>receipt.id==='continue-155');
        liveTail.text+='\n\nGrowth at the tail';
        liveTail.revision++;
        const growth=page.getByText('Growth at the tail',{exact:true});
        await growth.waitFor();
        assert(await growth.evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.conversation').getBoundingClientRect().bottom),
            'New output did not stay visible while following the tail');
        await conversation.hover();
        await page.mouse.wheel(0,-450);
        await page.waitForFunction(()=>{
            const el=document.querySelector('.chat-pane > .conversation');
            return el&&el.scrollHeight-el.clientHeight-el.scrollTop>300;
        });
        const reading=await conversation.evaluate(el=>el.scrollTop);
        liveTail.text+='\n\nGrowth while reading earlier';
        liveTail.revision++;
        await page.getByText('Growth while reading earlier',{exact:true}).waitFor();
        assert(Math.abs(await conversation.evaluate(el=>el.scrollTop)-reading)<2,'New output moved the reading position');

        // A continued session has one reading order across imported and live messages.
        await sidebar('Hybrid').click();
        await heading('Hybrid').waitFor();
        const hybrid = number=>page.getByText('Hybrid completed '+number,{exact:true});
        const imported = number=>page.getByText('hybrid imported '+number,{exact:true});
        await hybrid(3).waitFor();
        await page.locator('.composer:visible').waitFor();
        await imported(123).waitFor({state:'hidden'});
        for (const earlier of [2,1,0]){
            await conversation.press('Home');
            await hybrid(earlier).waitFor();
        }
        await imported(123).waitFor();
        for (const earlier of [44,4,1]){
            await conversation.press('Home');
            await imported(earlier).waitFor();
        }
        await hybrid(0).waitFor({state:'hidden'});
        await conversation.press('End');
        await imported(123).waitFor();
        await hybrid(0).waitFor();
        const hybridPages=historyRequests.filter(request=>request.id==='hybrid'&&request.direction!=='initial');
        assert.equal(new Set(hybridPages.map(request=>request.direction+request.cursor)).size,hybridPages.length,'One scroll requested the same history page twice');

        // The read-only transcript uses the same keyboard navigation.
        await sidebar('Standalone').click();
        await heading('Standalone').waitFor();
        await page.getByText('standalone imported 123',{exact:true}).waitFor();
        for (const earlier of [44,4]){
            await conversation.press('Home');
            await page.getByText('standalone imported '+earlier,{exact:true}).waitFor();
        }
        let release;
        holdOldest=new Promise(resolve=>{release=resolve;});
        const started=page.waitForRequest(request=>new URL(request.url()).searchParams.get('before')==='4');
        await conversation.press('Home');
        await started;
        try{
            await conversation.press('End');
            await page.waitForFunction(()=>{const el=document.querySelector('.history-view .conversation');return el&&el.scrollHeight-el.clientHeight-el.scrollTop<2;});
        }finally{
            release();
            holdOldest=undefined;
        }
        await conversation.locator('[aria-busy="false"]').waitFor();
        await page.getByText('standalone imported 123',{exact:true}).waitFor();
        await conversation.press('Home');
        await page.getByText('standalone imported 1',{exact:true}).waitFor();
        await conversation.press('End');
        await page.getByText('standalone imported 123',{exact:true}).waitFor();

        // A touch gesture must still page when every mounted message fits in the viewport.
        await page.setViewportSize({width:1440,height:1100});
        await sidebar('Compact').click();
        await heading('Compact').waitFor();
        await page.locator('.history-view').waitFor({state:'detached'});
        await page.reload();
        await heading('Compact').waitFor();
        await page.getByText('compact imported 2',{exact:true}).waitFor();
        const scrollRange=await conversation.evaluate(el=>el.scrollHeight-el.clientHeight);
        assert(scrollRange<=1,`Compact fixture scroll range is ${scrollRange}px`);
        const touchArea=await conversation.boundingBox();
        await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
        const touch={x:Math.round(touchArea.x+touchArea.width/2),y:Math.round(touchArea.y+100)};
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...touch,y:touch.y+80}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.getByText('compact imported 1',{exact:true}).waitFor();
        assert.deepEqual(historyRequests.filter(request=>request.id==='compact'&&request.direction!=='initial').map(r=>r.direction),['older']);

        assert.deepEqual(errors,[]);
        assert(!writes.includes('/api/commands'),'Session navigation dispatched a command');
        console.log('PASS: session arrival, newest selection, saved draft, retry, older/newer browsing and reduced motion');
    } finally {
        await browser?.close();
        if (!process.env.DECK2_UI_ASSETS) fs.rmSync(assets,{recursive:true,force:true});
    }
}

run().catch(error => {console.error(error);process.exitCode=1;});
