// Exercises the packaged UI, authenticated quota routes and real SDK with fake native providers.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require('playwright');

const repo = path.resolve(__dirname, '..');
const binary = path.resolve(process.argv[2] || 'dist/deck2');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck2-quota-'));
const state = path.join(root, 'state');
const project = path.join(root, 'project');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const file = name => path.join(root, name);
const nativeWire = name => fs.existsSync(file(name))
    ? fs.readFileSync(file(name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
fs.mkdirSync(project);
fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'Fixture project');
fs.copyFileSync(path.join(repo, 'crates/host/tests/fake_claude_sdk.py'), file('claude'));
fs.chmodSync(file('claude'), 0o700);
const codex = fs.readFileSync(path.join(repo, 'scripts/fixtures/s7-codex.py'), 'utf8').replace(
    " elif m=='account/read':",
    ` elif m=='account/rateLimits/read':
  reply(q,{'rateLimits':{'planType':'pro','accountId':'private-codex-account','primary':{'windowDurationMins':300,'usedPercent':95.1},'secondary':{'windowDurationMins':10080,'usedPercent':89.9,'resetsAt':1901000000}}})
 elif m=='account/read':`,
);
fs.writeFileSync(file('codex'), codex, {mode:0o700});
const host = spawn(binary, ['serve','--foreground','--project',project,'--state-dir',state,'--codex',file('codex'),'--no-open','--no-history'], {
    stdio:'ignore',
    env:{...process.env, HOME:root, CLAUDE_CONFIG_DIR:file('claude-config'), CODEX_HOME:file('codex-auth'), PATH:root+':'+process.env.PATH},
});
const stopped = new Promise(resolve => host.once('exit', resolve));
let browser;
const started = performance.now();

async function main() {
    const launcherPath = path.join(state, 'launcher.json');
    for (let i = 0; i < 100 && !fs.existsSync(launcherPath); i++) await wait(50);
    const launcher = JSON.parse(fs.readFileSync(launcherPath));
    const base = 'http://' + launcher.host;
    const launch = await (await fetch(base+'/launch', {method:'POST', body:launcher.admin})).json();
    const refreshUrl = runner => base+'/api/quota/'+runner+'/refresh';
    assert.equal((await fetch(refreshUrl('claude'), {method:'POST', headers:{Origin:base}})).status, 403);

    browser = await chromium.launch({executablePath:process.env.DECK2_CHROMIUM, args:['--no-sandbox']});
    async function routeAssets(context) {
        const assets = process.env.DECK2_COMPOSER_ASSETS;
        if (!assets) return;
        for (const file of ['app.js','app.css']) {
            await context.route(base+'/'+file, route => route.fulfill({path:path.join(assets,file)}));
        }
    }
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await routeAssets(context);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const assertEventually = (condition, arg) => page.waitForFunction(condition, arg);
    const read = async () => await (await page.request.get(base+'/api/quota')).json();
    let quotaReads = 0;
    page.on('request', request => { if(request.url() === base+'/api/quota') quotaReads++; });
    await page.goto(launch.url);

    const trigger = page.getByRole('button',{name:/Subscription usage, remaining quota/});
    await trigger.waitFor();
    assert.equal(await page.locator('.sidebar .usage-section').count(),0);
    await trigger.click();
    const panel = page.getByRole('region',{name:'Subscription usage',exact:true});
    const refreshClaude = panel.getByRole('button',{name:'Refresh Claude quota'});
    await assertEventually(() => document.querySelector('.composer-quota-panel button[aria-label="Refresh Claude quota"]')?.disabled === false);
    assert.equal(quotaReads,1);
    assert.equal((await read()).runners.claude.snapshot, undefined);
    assert.equal(nativeWire('wire').length,0,'Reading host state starts no Claude process');

    const post = runner => page.waitForResponse(response => response.url() === refreshUrl(runner));
    const claudePost = post('claude');
    await refreshClaude.click();
    const claude = await claudePost;
    assert.equal(claude.status(),200,await claude.text());
    await trigger.getByText('10%',{exact:true}).waitFor();
    const codexPost = post('codex');
    await panel.getByRole('button',{name:'Refresh Codex quota'}).click();
    const codex = await codexPost;
    assert.equal(codex.status(),200,await codex.text());
    await trigger.getByText('10.1%',{exact:true}).waitFor();
    assert.equal(await trigger.getByText('4.9%',{exact:true}).filter({visible:true}).count(),0,'the footer omits the Codex 5-hour value');
    await panel.getByRole('progressbar',{name:'Codex 5-hour subscription quota'}).waitFor();
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'hidden'});
    assert.equal((await page.request.post(refreshUrl('claude'), {headers:{Origin:base}})).status(),409);
    const snapshot = await read();
    assert.deepEqual(snapshot.runners.claude.snapshot.windows,[
        {id:'five-hour',usedPercent:90,resetsAt:1900000000000},
        {id:'seven-day',usedPercent:95},
    ]);
    assert(!JSON.stringify(snapshot).includes('private-codex-account'));
    assert(!JSON.stringify(snapshot).includes('used_credits'));
    assert.deepEqual(nativeWire('wire').map(record => record.message.request?.subtype),['initialize','get_usage']);
    assert.equal(nativeWire('wire')[1].message.request.skip_behaviors,true);
    assert.deepEqual(nativeWire('calls.jsonl').map(record => record.method),['initialize','initialized','account/rateLimits/read']);

    await page.getByRole('button',{name:'New session in project',exact:true}).press('Enter');
    await page.getByLabel('Session name',{exact:true}).fill('Quota with a Codex Lead');
    await page.getByRole('button',{name:'Create session',exact:true}).click({timeout:20_000});
    await page.getByRole('heading',{name:'Quota with a Codex Lead',exact:true}).waitFor();
    const workspace = await(await page.request.get(base+'/api/workspace')).json();
    assert.equal(workspace.sessions.find(session => session.title === 'Quota with a Codex Lead')?.contract?.members?.lead?.runnerId,'codex');

    async function checkDetails(target) {
        const isolated = target.getByRole('region',{name:'Subscription usage',exact:true});
        const inspect = async (name, remaining, tone) => {
            const bar = isolated.getByRole('progressbar',{name});
            assert.equal(await bar.getAttribute('aria-valuenow'),remaining);
            assert.equal(await bar.evaluate(node => node.closest('.quota-window').dataset.quotaTone),tone);
        };
        await inspect('Claude 5-hour subscription quota','10','warning');
        await inspect('Claude 7-day subscription quota','5','critical');
        await inspect('Codex 5-hour subscription quota','4.9','critical');
        await inspect('Codex 7-day subscription quota','10.1',undefined);
        await isolated.getByText('Resets in',{exact:false}).first().waitFor();
        await isolated.getByText('Reset time not reported',{exact:true}).first().waitFor();
    }

    async function checkLayout(target, triggerAction, width) {
        const launcher = target.getByRole('button',{name:/Subscription usage, remaining quota/});
        const bounds = await target.locator('.composer').evaluate(composer => {
            const rect = node => ({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom});
            return {form:rect(composer), textarea:rect(composer.querySelector('textarea')), quota:rect(composer.querySelector('.composer-quota')), runners:[...composer.querySelectorAll('.composer-quota-runner')].map(rect), actions:rect(composer.querySelector('.composer-actions'))};
        });
        assert(bounds.form.left <= bounds.quota.left && bounds.quota.right <= bounds.actions.left);
        for (const runner of bounds.runners) assert(runner.right <= bounds.actions.left,'provider labels stay clear of the action hit targets');
        assert(bounds.actions.right <= bounds.form.right && bounds.textarea.bottom <= bounds.quota.top);
        assert(bounds.form.right <= width);
        await launcher.getByText('10.1%',{exact:true}).waitFor();
        assert.equal(await launcher.getByText('4.9%',{exact:true}).filter({visible:true}).count(),0,'the footer always uses the Codex weekly value');
        await launcher[triggerAction]();
        await checkDetails(target);
        const details = target.getByRole('region',{name:'Subscription usage',exact:true});
        const popup = await details.boundingBox();
        assert(popup.x >= 0 && popup.x+popup.width <= width+1 && popup.y >= 0);
        const evidence = process.env.DECK2_EVIDENCE_DIR;
        if (evidence) {
            fs.mkdirSync(evidence,{recursive:true});
            await target.screenshot({path:path.join(evidence,`composer-quota-${width}-details.png`)});
        }
        if(triggerAction==='tap') await details.getByRole('button',{name:'Close subscription usage'}).tap();
        else await target.keyboard.press('Escape');
        await details.waitFor({state:'hidden'});
        if(evidence) await target.screenshot({path:path.join(evidence,`composer-quota-${width}.png`)});
    }

    await trigger.focus();
    await page.keyboard.press('Enter');
    await checkDetails(page);
    await panel.getByRole('button',{name:'Close subscription usage'}).focus();
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'hidden'});
    await assertEventually(() => document.activeElement?.matches('.composer-quota'));
    await checkLayout(page,'click',1440);
    await page.setViewportSize({width:860,height:850});
    await checkLayout(page,'click',860);
    const mobile = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await context.storageState()});
    await routeAssets(mobile);
    const touch = await mobile.newPage();
    await touch.goto(base);
    await touch.getByRole('button',{name:/Subscription usage, remaining quota/}).getByText('10%',{exact:true}).waitFor();
    const touchNavigation = touch.getByRole('dialog',{name:'Projects and sessions'});
    await touch.touchscreen.tap(5,300);
    await touch.waitForTimeout(250);
    assert.equal(await touchNavigation.isVisible(),false,'touching the edge does not open navigation');
    await touch.getByRole('button',{name:/^Open projects and sessions/}).tap();
    assert(await touchNavigation.evaluate(el=>el.matches(':modal')));
    await touchNavigation.getByRole('button',{name:'Close project navigation'}).tap();
    await touchNavigation.waitFor({state:'hidden'});
    for (const button of await touch.locator('.composer-actions button:not([hidden]), .composer-quota').all()) {
        const target = await button.boundingBox();
        if (target) assert(target.width >= 44 && target.height >= 44);
    }
    await checkLayout(touch,'tap',390);
    await touch.setViewportSize({width:320,height:710});
    await checkLayout(touch,'tap',320);
    await page.clock.setFixedTime(new Date(1900000001000));
    await trigger.click();
    const stale = panel.getByRole('region',{name:'Claude quota'});
    await stale.getByText('Scheduled reset time passed',{exact:true}).waitFor();
    assert.equal(await stale.getByRole('progressbar',{name:'Claude 5-hour subscription quota'}).getAttribute('aria-valuenow'),'10');
    const finalWire = nativeWire('wire').map(record => record.message);
    assert.equal(finalWire.filter(message => message.request?.subtype === 'get_usage').length,1,'Opening or resizing Usage does not refresh Claude');
    assert(!finalWire.some(message => message.type === 'user'));
    assert.deepEqual(errors,[]);
    console.log(`Composer quota, authenticated refresh, independent cooldown and 4 viewport checks passed in ${((performance.now()-started)/1000).toFixed(1)}s.`);
}

main().catch(error => {console.error(error);process.exitCode=1;}).finally(async () => {
    await browser?.close();
    host.kill('SIGTERM');
    await Promise.race([stopped,wait(3000)]);
    if(host.exitCode===null) host.kill('SIGKILL');
    fs.rmSync(root,{recursive:true,force:true});
});
