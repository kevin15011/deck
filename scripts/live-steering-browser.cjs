// Drive the real browser and host with a controllable Codex app-server edge.
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {setTimeout: wait} = require('node:timers/promises');
const {DatabaseSync} = require('node:sqlite');

const binary = path.resolve(process.argv[2] || 'target/debug/deck2');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-steering-'));
const project = path.join(root, 'project');
const state = path.join(root, 'state');
const nativeHome = path.join(root, 'native-home');
fs.mkdirSync(project);
execFileSync('git', ['init', '-q', project]);
const edge = fs.readFileSync(path.join(__dirname, '../crates/host/tests/fake_session_native.py'), 'utf8')
    .replace('codex-cli 0.166.0', 'codex-cli 0.170.0')
    .replace(" elif m=='turn/start':", ` elif m=='turn/steer':
  with (root/'wire').open('a') as f:f.write(json.dumps({'method':m,'params':p})+'\\n')
  if p['threadId']!=thread or p['expectedTurnId']!=turn:
   out({'id':v['id'],'error':{'code':-32600,'message':'wrong turn'}})
  elif 'reject at native' in p['input'][0]['text']:
   out({'id':v['id'],'error':{'code':-32600,'message':'turn just ended'}})
  elif 'lose native ack' not in p['input'][0]['text']:
   result(v,{'turnId':turn})
   if p['input'][0]['text']=='Steer the synthetic Lead':
    for _ in range(600):
     if (root/'release-outcome').exists():break
     time.sleep(.025)
    else:raise RuntimeError('Synthetic work fixture release deadline')
    out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
 elif m=='turn/interrupt':
  result(v,{})
  out({'method':'turn/completed','params':{'threadId':p['threadId'],'turn':{'id':p['turnId'],'status':'interrupted'}}})
 elif m=='turn/start':`)
    .replace("  result(v,{'turn':{'id':turn}})", "  if any(item.get('text','').endswith('Keyboard hold before acknowledgment') for item in p['input']):continue\n  result(v,{'turn':{'id':turn}})")
    .replace("  def tool(name,args):", "  if text.startswith('Keyboard hold'):continue\n  def tool(name,args):")
    .replace("  if not member and text.startswith('CONTINUE_MIXED '):", `  if not member and text=='Seed two automatic outcomes':
   tool('deck_delegate',{'agent':'investigate','task':'Outcome fixture alpha'})
   tool('deck_delegate',{'agent':'quality','task':'Outcome fixture beta'})
  if not member and text.startswith('Host task outcome'):
   if not (root/'held-outcome').exists():
    (root/'held-outcome').touch()
   else:
    out({'method':'item/agentMessage/delta','params':{'threadId':thread,'turnId':turn,'delta':'Reviewed second task outcome'}})
    out({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':turn,'status':'completed'}}})
   continue
  if not member and text.startswith('CONTINUE_MIXED '):`);
const runner = path.join(root, 'codex');
fs.writeFileSync(runner, edge, {mode: 0o700});
let host, browser;
const env = {
    PATH: process.env.PATH,
    HOME: root,
    CODEX_HOME: nativeHome,
    XDG_DATA_HOME: path.join(root,'data'),
    XDG_CONFIG_HOME: path.join(root,'config'),
    XDG_RUNTIME_DIR: path.join(root,'runtime'),
};
async function until(check, description) {
    for (let i=0;i<200;i++) {
        const value = await check();
        if (value) return value;
        await wait(100);
    }
    throw Error('Timed out waiting for ' + description);
}
async function stopHost() {
    if (!host || host.exitCode !== null || host.signalCode !== null) return;
    const exited = new Promise(resolve => host.once('exit', (code,signal)=>resolve({code,signal})));
    host.kill('SIGINT');
    return await exited;
}
async function startHost() {
    host = spawn(binary, ['serve','--foreground','--project',project,'--state-dir',state,'--codex',runner,'--no-open'], {stdio: 'inherit', env});
    return await until(async () => {
        try {
            const launcher = JSON.parse(fs.readFileSync(path.join(state,'launcher.json')));
            const base = 'http://' + launcher.host;
            const response = await fetch(base+'/launch', {method:'POST', body:launcher.admin});
            if (response.ok) return {base, url:(await response.json()).url};
        } catch {}
    }, 'isolated host');
}
const wire = method => fs.readFileSync(path.join(root,'wire'),'utf8').trim().split('\n').map(JSON.parse).filter(entry=>entry.method===method);
function assertHistory(session, live) {
    const db = new DatabaseSync(path.join(state,'state.db'), {readOnly:true});
    try {
        const rows = db.prepare("SELECT body FROM session_events WHERE session=? AND kind LIKE 'steering:%'").all(session);
        assert.deepEqual(rows.map(r=>JSON.parse(r.body)).map(r=>[r.role,r.promptId,r.turnId,r.text]), [['user',live.id,live.expectedTurnId,live.text]]);
    } finally {
        db.close();
    }
}
(async () => {
    let {base,url} = await startHost();
    browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM || '/snap/bin/chromium',headless:true,args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    page.setDefaultTimeout(10000);
    if (process.env.DECK2_UI_ASSETS) {
        for (const file of ['app.js','app.css']) {
            await page.route('**/'+file, route=>route.fulfill({path:path.join(process.env.DECK2_UI_ASSETS,file), contentType:file.endsWith('.js')?'application/javascript':'text/css'}));
        }
    }
    await page.goto(url);
    const ws = async()=> (await page.request.get(base+'/api/workspace')).json();
    await page.getByRole('button',{name:'New session in project',exact:true}).press('Enter');
    await page.getByLabel('Session name',{exact:true}).fill('Live steering fixture');
    await page.getByRole('button',{name:'Create session',exact:true}).click();
    const session = await until(async()=> (await ws()).sessions.find(s=>s.title==='Live steering fixture')?.id,'session creation');
    const prompt = page.locator('#prompt');
    const queue = page.getByRole('region',{name:'Queued messages',exact:true});
    const row = text => queue.locator('li').filter({has:page.getByText(text,{exact:true})});
    const sendNow = text => row(text).getByRole('button',{name:/^Send now/});
    const receipt = async id => (await ws()).receipts.find(r=>r.id===id);
    const input = async (text, withIcon=false) => {
        await prompt.fill(text);
        const composer = page.locator('form.composer');
        assert.equal(await composer.getByRole('button',{name:/Send now|Queue for next turn/}).count(),0);
        if (withIcon) await composer.getByRole('button',{name:'Queue message',exact:true}).click();
        else await prompt.press('Enter');
        await row(text).waitFor();
        return await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.prompt===text&&r.phase==='queued'),'queued receipt for '+text);
    };
    async function exerciseOutcomes() {
        for (const memberId of ['investigate','quality']) {
            const {contract} = (await ws()).sessions.find(s=>s.id===session);
            const assignment = await page.request.post(base+`/api/sessions/${session}/assignments`,{
                headers:{origin:base},data:{api:7,memberId,expectedRevision:contract.revision,
                    assignment:{runnerId:'codex',modelId:'gpt-6.1-sol',thinking:'high'}},
            });
            assert.equal(assignment.status(),200,await assignment.text());
        }
        await prompt.fill('Seed two automatic outcomes');
        await prompt.press('Enter');
        const [owner, backlog] = await until(async()=> {
            const outcomes = (await ws()).receipts.filter(r=>r.session===session&&r.continuation);
            const owner = outcomes.find(r=>r.phase==='running');
            const backlog = outcomes.find(r=>r.phase==='queued');
            return owner && backlog && [owner, backlog];
        }, 'running synthetic Lead with another outcome queued');
        const first = await input('First explicitly queued user message');
        const second = await input('Second explicitly queued user message');
        const live = await input('Steer the synthetic Lead');
        const draft = 'Unsent draft during synthetic work';
        await prompt.fill(draft);
        await sendNow(live.prompt).waitFor();
        const started = performance.now();
        await sendNow(live.prompt).click();
        const accepted = await until(async()=> (await receipt(owner.id)).steering?.find(s=>s.state==='accepted'),'synthetic turn live acknowledgment');
        const liveMs = performance.now() - started;
        assert(liveMs<5000,`live delivery took ${liveMs.toFixed()} ms`);
        console.log(`Synthetic Lead live acknowledgment after ${liveMs.toFixed()} ms`);
        assert.deepEqual(accepted.queuedSource,{id:live.id,attempt:live.attempt});
        assert.equal(accepted.text,live.prompt);
        assert.equal(accepted.expectedTurnId,owner.turn);
        assert.equal((await receipt(live.id)).steered_to,owner.id);
        assert.equal((await receipt(owner.id)).phase,'running');
        assert.equal(await prompt.inputValue(),draft);
        assertHistory(session, accepted);
        const retry = await page.request.post(base+'/api/commands/'+owner.id+'/steering/queued',{
            data:acceptedCommand(accepted),headers:{origin:base},
        });
        assert.equal(retry.status(),200);
        assert.equal(wire('turn/steer').length,1);
        for (const queued of [first,second,backlog]) {
            const current = await receipt(queued.id);
            assert.equal(current.phase,'queued');
            assert.equal(current.dispatch_ms,null);
        }
        const released = Date.now();
        fs.writeFileSync(path.join(root,'release-outcome'),'');
        await until(async()=> (await receipt(backlog.id)).phase==='completed'
            && (await receipt(second.id)).phase==='completed','user messages and needed outcome complete');
        const starts = wire('turn/start').map(e=>e.params.input[0]?.text?.match(/Current host input reference: promptId=(\S+)/)?.[1]);
        const expected = [owner.id,first.id,second.id,backlog.id];
        assert.deepEqual(starts.filter(id=>expected.includes(id)),expected);
        assert(!starts.includes(live.id),'steering must not also start a turn');
        const dispatched = await receipt(first.id);
        console.log(`Next user dispatch ${dispatched.dispatch_ms-released} ms after fixture released the synthetic turn; queued user FIFO and needed outcome verified`);
    }
    if (process.env.DECK2_STEERING_OUTCOME_ONLY) {
        await exerciseOutcomes();
        return;
    }
    await prompt.fill('Keyboard hold live steering fixture');
    await prompt.press('Enter');
    const held = await until(async()=> (await ws()).receipts.find(r=>r.session===session&&r.phase==='running'),'held active turn');
    const first = await input('the first queued message');
    const picked = await input('live message through browser',true);
    await sendNow(picked.prompt).waitFor({timeout:5000});
    if (process.env.DECK2_STEERING_RED_ONLY) return;
    const endpointPath = '/api/commands/'+held.id+'/steering/queued';
    const command = (queued, overrides={})=>({
        id:randomUUID(),session,threadId:held.thread,expectedTurnId:held.turn,
        queuedSource:{id:queued.id,attempt:queued.attempt},...overrides,
    });
    const post = (data, context=page.request) => context.post(base+endpointPath,{data,headers:{origin:base}});
    const recall = (queued,override={})=>page.request.post(base+'/api/commands/'+queued.id+'/recall',{
        data:{api:7,session,attempt:queued.attempt,...override},headers:{origin:base},
    });
    assert.equal((await post(command(picked,{expectedTurnId:'expired-turn'}))).status(),409);
    assert.equal((await post(command(picked,{queuedSource:{id:picked.id,attempt:'wrong-attempt'}}))).status(),409);
    assert.equal((await post(command(picked,{session:'another-session'}))).status(),409);
    const foreign = await browser.newContext();
    assert.equal((await post(command(picked),foreign.request)).status(),403);
    await foreign.close();

    const untouched = 'a different draft composed while the queue waits';
    await prompt.fill(untouched);
    const attach = async () => {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button',{name:'Attach images',exact:true}).click();
        await (await chooser).setFiles(path.join(__dirname,'fixtures/s8c-synthetic.png'));
        await page.locator('.image-draft').getByText('Ready',{exact:true}).waitFor();
    };
    await attach();
    await page.route('**'+endpointPath, async route=>{await route.fetch();await route.abort('failed');},{times:1});
    await sendNow(picked.prompt).press('Enter');
    const accepted = await until(async()=> (await receipt(held.id)).steering?.find(s=>s.state==='accepted'),'durable live acknowledgment');
    assert.deepEqual(accepted.queuedSource,{id:picked.id,attempt:picked.attempt});
    assert.equal(accepted.text,picked.prompt);
    assert.equal(accepted.threadId,held.thread);
    assert.equal(accepted.expectedTurnId,held.turn);
    await row(picked.prompt).waitFor({state:'detached'});
    await page.waitForFunction(()=>document.activeElement?.id==='prompt');
    await page.getByText(accepted.text,{exact:true}).waitFor();
    assert.equal(await prompt.inputValue(),untouched);
    assert.equal(await page.locator('.image-draft').count(),1);
    assert.deepEqual((await receipt(first.id)).phase,'queued');
    assert.equal((await recall(picked)).status(),409);
    await page.reload();
    await page.getByText(accepted.text,{exact:true}).waitFor();
    assert.equal(await prompt.inputValue(),untouched);
    assert((await post(acceptedCommand(accepted))).ok());
    assert.equal((await post({...acceptedCommand(accepted),queuedSource:{id:first.id,attempt:first.attempt}})).status(),409);
    assert.equal((await post(command(picked))).status(),409);
    assert.equal(wire('turn/steer').length,1);
    assert.equal(wire('turn/steer')[0].params.clientUserMessageId,accepted.id);

    await page.locator('.image-draft').getByText('Ready',{exact:true}).waitFor();
    const images = await input('queued with an image',true);
    assert.equal(images.attachments.length,1);
    assert.equal(await sendNow(images.prompt).count(),0);
    assert.equal((await post(command(images))).status(),409);
    assert.equal((await recall(images)).status(),200);
    await row(images.prompt).waitFor({state:'detached'});
    const cancelled = await input('recall before live reservation');
    assert.equal((await recall(cancelled)).status(),200);
    assert.equal((await post(command(cancelled))).status(),409);
    await row(cancelled.prompt).waitFor({state:'detached'});

    const rejects = await input('reject at native');
    await sendNow(rejects.prompt).click();
    await until(async()=> (await receipt(held.id)).steering?.some(s=>s.state==='rejected'),'native rejection');
    assert.equal((await receipt(rejects.id)).phase,'queued');
    const restoredPrompts = await until(async()=> {
        const prompts = await queue.locator('.queue-prompt').allTextContents();
        return prompts.length >= 2 ? prompts : null;
    }, 'restored queue renders');
    assert.deepEqual(restoredPrompts,[first.prompt,rejects.prompt]);

    const lostInput = await input('lose native ack');
    const lostCommand = command(lostInput);
    const competingCommand = command(lostInput);
    const promotions = await Promise.all([post(lostCommand),post(lostCommand),post(competingCommand)]);
    assert(promotions.slice(0,2).every(r=>r.ok()),'the exact retry observes the same live operation');
    assert.equal(promotions[2].status(),409);
    assert.equal((await recall(lostInput)).status(),409);
    const cancelLiveSource = await page.request.post(base+'/api/commands/'+lostInput.id+'/cancel',{headers:{origin:base}});
    assert.equal(cancelLiveSource.status(),409);
    await until(async()=>wire('turn/steer').length===3,'ambiguous dispatch');

    const staleSource = await input('settlement race queued message');
    await prompt.fill('');
    const stop = page.getByRole('button',{name:'Stop Lead',exact:true});
    const [stopped] = await Promise.all([
        page.waitForResponse(response=>response.url()===base+'/api/commands/'+held.id+'/cancel'&&response.request().method()==='POST'),
        stop.click(),
    ]);
    assert(stopped.ok(),await stopped.text());
    assert.equal((await post(command(staleSource))).status(),409);
    await until(async()=> (await receipt(staleSource.id)).phase==='completed','remaining queued turns complete');
    const old = await receipt(held.id);
    const lost = old.steering.find(s=>s.text===lostInput.prompt);
    assert.equal(lost.state,'uncertain');
    assert.equal((await receipt(lostInput.id)).steered_to,held.id);
    assert((await post(acceptedCommand(lost))).ok());
    const starts = ()=>wire('turn/start').map(record=>record.params.input.map(item=>item.text||'').join('\n').split(/Current (?:user )?input: /).at(-1).trim());
    assert.deepEqual(starts(),['Keyboard hold live steering fixture',first.prompt,rejects.prompt,staleSource.prompt]);
    assert.equal(wire('turn/steer').length,3);

    await restartWithQueuedInput('Keyboard hold across host restart', 'running', 'queue across host restart');
    await restartWithQueuedInput('Keyboard hold before acknowledgment', 'dispatching', 'queue after an unacknowledged start');
    console.log('Passed queue-first Enter and icon, keyboard Send now, exact-source live delivery, draft isolation, lost browser response, concurrency, native rejection, Stop, unknown outcome, FIFO and both restart boundaries.');

    async function restartWithQueuedInput(previousPrompt, phase, queuedPrompt) {
        const priorStarts = starts();
        await prompt.fill(previousPrompt);
        await prompt.press('Enter');
        const previous = await until(async()=> (await ws()).receipts.find(
            r=>r.session===session&&r.prompt===previousPrompt&&r.phase===phase
        ), previousPrompt);
        await until(()=>starts().includes(previousPrompt),'native received the held turn');
        assert(previous.thread && previous.native_pid && previous.dispatch_ms);
        assert.equal(Boolean(previous.turn),phase==='running');
        const queued = await input(queuedPrompt,true);
        assert.equal(queued.dispatch_ms,null);

        assert.deepEqual(await stopHost(),{code:0,signal:null});
        assert.throws(()=>process.kill(previous.native_pid,0),{code:'ESRCH'});
        assert.throws(()=>process.kill(-previous.native_pid,0),{code:'ESRCH'});
        ({base,url} = await startHost());
        await page.goto(url);
        await page.getByText(accepted.text,{exact:true}).waitFor();
        await page.getByText('Live delivery unconfirmed',{exact:true}).waitFor();
        assert.deepEqual((await receipt(held.id)).steering,old.steering);
        assertHistory(session, accepted);
        assert((await post(acceptedCommand(lost))).ok());
        await until(async()=> (await receipt(queued.id))?.phase==='completed', queuedPrompt);
        const settled = await receipt(previous.id);
        assert(['failed','cancelled'].includes(settled.phase));
        assert.equal(settled.thread,previous.thread);
        assert.equal(settled.dispatch_ms,previous.dispatch_ms);
        assert.deepEqual(starts(),[...priorStarts,previousPrompt,queuedPrompt]);
        assert.equal(wire('turn/steer').length,3,'restart never replays live input');
    }

})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    await browser?.close();
    await stopHost();
    console.log('Isolated fixture:', root);
});
function acceptedCommand({id,session,threadId,expectedTurnId,queuedSource}) { return {id,session,threadId,expectedTurnId,queuedSource}; }
