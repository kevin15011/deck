/** Real HTTP/WebSocket + persistent SessionManager acceptance; only native inference is faked. */
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CrossRunnerConfig } from '../../packages/core/src/config/deck-config';
import type { SessionCommandBody } from '../../packages/core/src/session/commands';
import { SessionManager } from '../../packages/session-host/src/session-manager';
import { ApprovalBroker } from '../../packages/session-host/src/approval-broker';
import { CredentialRegistry } from '../../packages/session-host/src/credentials';
import { Supervisor } from '../../packages/session-host/src/supervisor';
import { FakeDriver } from '../../packages/session-host/src/testing/fake-driver';
import { WebService } from '../../packages/session-host/src/web-service';
import { ensureStateLayout, resolveStatePaths } from '../../packages/session-host/src/paths';
import { WEB_ASSETS } from '../cli/src/runtime/web-assets.generated';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-yolo-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'opus' }, reviewer: { runnerId: 'claude', modelId: 'opus' }, 'deck-investigate': { runnerId: 'claude', modelId: 'opus' } }, approvals: { claude: 'runner-default', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
const catalog = { runners: [
    { runnerId: 'claude', label: 'Claude', available: true, models: [{ modelId: 'opus', label: 'Opus', thinkingLevels: ['low', 'high'] }, { modelId: 'sonnet', label: 'Sonnet', thinkingLevels: ['low', 'high'] }] },
    { runnerId: 'codex', label: 'Codex', available: true, models: [{ modelId: 'codex-model', label: 'Codex model', thinkingLevels: ['low', 'high'] }] },
] };
let manager!: SessionManager;
function createManager() {
    const broker = new ApprovalBroker({ sink: { emit: (sessionId, event) => { manager.openLog(sessionId)?.append(event); } } });
    return new SessionManager({ paths, broker, credentials: new CredentialRegistry({ socketPath: paths.socket.path }), supervisor: new Supervisor({ anchorCommand: ['unused'] }), drivers: { get: id => drivers.find(driver => driver.runnerId === id), list: () => drivers }, config: () => config, sessionMcpCommand: ['/not-launched/deck', 'internal', 'session-mcp'], homeDir: home, modelCatalog: async () => catalog });
}
manager = createManager();
const host = new WebService({ paths, assets: WEB_ASSETS, config: config.web, service: {
    execute: input => manager.execute(input), query: (name, args) => manager.query(name, args), openLog: id => manager.openLog(id), hasRunningWork: () => manager.hasRunningWork(),
} }); host.enable();
const browser = await chromium.launch({ executablePath: process.env.DECK_TEST_CHROME ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true });
const command = async (body: SessionCommandBody, sessionId?: string) => {
    const result = await manager.execute({ sessionId, clientId: 'acceptance', command: { v: 1, commandId: randomUUID(), ...body } as never });
    assert.equal(result.ok, true, JSON.stringify(result)); return result.ok ? result.data as any : undefined;
};
const wait = async (condition: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 160; attempt++) { if (await condition()) return; await Bun.sleep(25); }
    throw new Error(`Timed out: ${label}`);
};

const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[];
page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
try {
    const projectId=(await command({type:'project.register',path:projectOne,name:'YOLO project'})).project.projectId;
    const normal=(await command({type:'session.create',projectId,title:'Normal by default'})).sessionId;
    const defaults=await manager.query('sessions.status',{projectId,sessionIds:[normal]}) as any;
    assert.equal(defaults.data.sessions[0].approvalMode,'relay');assert.equal(defaults.data.sessions[0].approvalModeSource,'default');
    const normalList=await manager.query('sessions.list',{projectId}) as any;
    assert.equal(normalList.data.sessions.find((row:any)=>row.sessionId===normal).approvalModeSource,'default');
    await page.goto(host.status().url!);
    const chip=page.locator('.session-controls .approval-mode-chip');
    const controls=page.getByRole('region',{name:'Session controls'});
    await page.getByRole('button',{name:'Normal by default',exact:true}).first().click();
    await wait(async()=>await chip.innerText()==='Ask first','default relay chip');
    assert.equal(await chip.getAttribute('title'),'Agents ask for your approval before acting');
    assert.equal(await controls.innerText().then(value=>value.includes('Source:')),false,'normal session has no origin label');
    const createCommands:any[]=[];
    page.on('request',request=>{if(request.url().endsWith('/api/commands')){const body=request.postDataJSON();if(body.command?.type==='session.create')createCommands.push(body.command);}});
    async function create(title:string,yolo:boolean){
        await page.locator('.sidebar .project-group').getByRole('button',{name:/^New session in /}).click();
        const dialog=page.getByRole('dialog',{name:'New session',exact:true});
        await dialog.getByLabel('Session name',{exact:true}).fill(title);
        await dialog.getByLabel('Runner',{exact:true}).selectOption('claude');
        await dialog.getByLabel('Model',{exact:true}).selectOption('opus');
        const toggle=dialog.getByRole('checkbox',{name:'YOLO mode — agents run without asking for permission',exact:true});
        assert.equal(await toggle.isChecked(),false,'new session defaults to ask first');
        assert.equal(await dialog.getByText('YOLO is off by default and applies only to this session. You can enable it later from the session controls.',{exact:true}).count(),1);
        const submit=dialog.getByRole('button',{name:'Create session',exact:true});
        if(yolo){
            await toggle.check();
            assert.equal(await submit.isEnabled(),false,'YOLO requires acknowledgement');
            for(const text of ['shell commands','edit or delete files','network','Claude cannot ask you structured questions','full-access sandbox','every tool permission is auto-allowed','Deck does not sandbox','next message'])assert.equal(await dialog.locator('.yolo-warning').innerText().then(value=>value.includes(text)),true,text);
            await dialog.getByRole('checkbox',{name:'I understand the risks',exact:true}).check();
            assert.equal(await submit.isEnabled(),true);
            // Turning the feature off and on invalidates the earlier acknowledgement.
            await toggle.uncheck();await toggle.check();assert.equal(await submit.isEnabled(),false);
            await dialog.getByRole('checkbox',{name:'I understand the risks',exact:true}).check();
        }
        await submit.click();
        await page.locator('.app-header').getByRole('heading',{name:title,exact:true}).waitFor();
        await wait(async()=>await chip.innerText()===(yolo?'YOLO':'Ask first'),'created mode chip');
        const list=await manager.query('sessions.list',{projectId}) as any;
        const row=list.data.sessions.find((item:any)=>item.title===title);
        assert.equal(row.approvalMode,yolo?'yolo':'relay');assert.equal(row.approvalModeSource,'session');
        assert.equal(createCommands.at(-1).approvals,yolo?'yolo':'relay','explicit creation override');
        assert.equal(await chip.getAttribute('title'),yolo?'Agents act without asking. Enabled for this session.':'Agents ask for your approval before acting');
        return row.sessionId as string;
    }
    const relay=await create('Ask first session',false);
    await page.getByRole('button',{name:'Prepare session',exact:true}).click();
    await page.locator('#prompt').waitFor();
    await page.locator('#prompt').fill('First relay turn');await page.getByRole('button',{name:'Send prompt',exact:true}).click();
    await wait(()=>claude.turns.length===1,'relay driver input');
    assert.equal(claude.turns[0]!.input.approvals,'relay');
    await page.locator('#prompt').fill('Draft survives approval changes');
    await controls.getByRole('button',{name:'Enable YOLO',exact:true}).click();
    let confirmation=page.getByRole('dialog',{name:'Enable YOLO',exact:true});
    assert.equal(await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).isEnabled(),false);
    await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await chip.innerText(),'Ask first','cancel keeps mode');
    await controls.getByRole('button',{name:'Enable YOLO',exact:true}).click();
    confirmation=page.getByRole('dialog',{name:'Enable YOLO',exact:true});
    await confirmation.getByRole('checkbox',{name:'I understand the risks',exact:true}).check();
    let reject=true;
    await page.route('**/api/commands',async route=>{const data=route.request().postDataJSON();if(reject&&data.command?.type==='session.setApprovals'){reject=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Mode update failed'})});}else await route.continue();});
    await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).click();
    await confirmation.getByRole('alert').waitFor();
    assert.match(await confirmation.getByRole('alert').innerText(),/Mode update failed/);
    assert.equal(await chip.innerText(),'Ask first','failure keeps mode');
    await confirmation.getByRole('button',{name:'Enable YOLO',exact:true}).click();
    await wait(async()=>await chip.innerText()==='YOLO','live enable');
    assert.equal(await controls.getByText('Applies from your next message',{exact:true}).count(),1);
    assert.equal(await page.locator('#prompt').inputValue(),'Draft survives approval changes');
    assert.equal(claude.turns[0]!.input.approvals,'relay','in-flight turn keeps approvals');
    claude.turns[0]!.finish();
    await wait(async()=>{const reply=await manager.query('sessions.status',{projectId,sessionIds:[relay]}) as any;return reply.data.sessions[0]?.running===false;},'first turn finished');
    await page.getByRole('button',{name:'Send prompt',exact:true}).click();
    await wait(()=>claude.turns.length===2,'next yolo turn');
    assert.equal(claude.turns[1]!.input.approvals,'runner-default');
    await controls.getByRole('button',{name:'Disable YOLO',exact:true}).click();
    await wait(async()=>await chip.innerText()==='Ask first','live disable');
    assert.equal(await page.getByRole('dialog').count(),0,'disable needs no confirmation');
    assert.equal(claude.turns[1]!.input.approvals,'runner-default','in-flight YOLO turn keeps mode');
    claude.turns[1]!.finish();
    await wait(async()=>{const reply=await manager.query('sessions.status',{projectId,sessionIds:[relay]}) as any;return reply.data.sessions[0]?.running===false;},'second turn finished');
    await page.locator('#prompt').fill('Next relay turn');await page.getByRole('button',{name:'Send prompt',exact:true}).click();
    await wait(()=>claude.turns.length===3,'next relay turn');assert.equal(claude.turns[2]!.input.approvals,'relay');
    claude.turns[2]!.finish();
    const yolo=await create('YOLO session',true);
    await page.getByRole('button',{name:'Prepare session',exact:true}).click();
    await page.locator('#prompt').fill('Created in YOLO');await page.getByRole('button',{name:'Send prompt',exact:true}).click();
    await wait(()=>claude.turns.length===4,'created yolo turn');assert.equal(claude.turns[3]!.input.approvals,'runner-default');
    assert.equal(claude.turns[3]!.input.prompt.includes('Created in YOLO'),true);
    await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
    await controls.getByRole('button',{name:'Disable YOLO',exact:true}).click();
    await wait(async()=>await chip.innerText()==='Ask first','mobile disable');
    await controls.getByRole('button',{name:'Enable YOLO',exact:true}).click();
    await page.getByRole('dialog',{name:'Enable YOLO',exact:true}).getByRole('checkbox',{name:'I understand the risks',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile bounds');
    await page.screenshot({path:'/tmp/deck-yolo-mobile.png'});
    await page.getByRole('dialog',{name:'Enable YOLO',exact:true}).press('Escape');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['normal-default-relay','deprecated-approvals-ignored','default-relay-chip','per-session-default-copy','create-relay-explicit','create-yolo-ack-warnings','ack-reset','mode-chip-behavior','cancel-keeps-mode','inline-command-error','live-enable','live-disable','draft-preserved','in-flight-mode-preserved','next-turn-yolo','next-turn-relay','created-yolo-driver','mobile-reduced-motion']}));
} catch(error){console.error(error);console.error(errors);process.exitCode=1;} finally{await browser.close();host.disable?.();await manager.close();rmSync(root,{recursive:true,force:true});process.exit(process.exitCode??0);}
