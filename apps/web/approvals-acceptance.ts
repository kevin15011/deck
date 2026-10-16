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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-approvals-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'opus' }, reviewer: { runnerId: 'claude', modelId: 'opus' }, 'deck-investigate': { runnerId: 'claude', modelId: 'opus' } }, approvals: { claude: 'relay', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
const catalog = { runners: [
    { runnerId: 'claude', label: 'Claude', available: true, models: [{ modelId: 'opus', label: 'Opus', thinkingLevels: ['low', 'high'] }, { modelId: 'sonnet', label: 'Sonnet', thinkingLevels: ['low', 'high'] }] },
    { runnerId: 'codex', label: 'Codex', available: true, models: [{ modelId: 'codex-model', label: 'Codex model', thinkingLevels: ['low', 'high'] }] },
] };
let manager!: SessionManager, approvalBroker!: ApprovalBroker;
function createManager() {
    const broker = new ApprovalBroker({ sink: { emit: (sessionId, event) => { manager.openLog(sessionId)?.append(event); } } });
    approvalBroker=broker;
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

const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors:string[]=[],sent:any[]=[];
page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.url().endsWith('/api/commands'))sent.push(request.postDataJSON().command);});
try {
    const projectId=(await command({type:'project.register',path:projectOne,name:'Permissions'})).project.projectId;
    const session=(await command({type:'session.create',projectId,title:'Permissions',approvals:'relay',members:{lead:{runnerId:'codex',modelId:'codex-model'}}})).sessionId;
    await command({type:'session.prepare'},session);await page.goto(host.status().url!);
    await page.getByRole('button',{name:'Permissions',exact:true}).first().click();
    await command({type:'prompt.send',text:'Exercise approvals'},session);await wait(()=>codex.turns.length===1,'turn');
    const turn=codex.turns[0]!,card=page.getByRole('article',{name:'Approval for commandExecution',exact:true});
    const request=(exactKey:string,extra:Record<string,unknown>={})=>turn.io.approval({approvalId:randomUUID(),tool:'commandExecution',toolKey:'codex:commandExecution',risk:'high',exactKey,summary:'Run this exact command',input:{command:exactKey},...extra} as Parameters<typeof turn.io.approval>[0]);
    const result=async(promise:ReturnType<typeof request>)=>await Promise.race([promise,Bun.sleep(7000).then(()=>{throw new Error('Approval did not resolve');})]);
    const settled=()=>wait(async()=>await card.count()===0,'approval card resolved');
    const menu=()=>card.locator('.approval-scope-menu > summary');
    const permissions=page.locator('.session-permissions');
    async function openPermissions(){await permissions.waitFor();if(!await permissions.evaluate(el=>(el as HTMLDetailsElement).open))await permissions.locator('summary').click();}
    async function revoke(){await openPermissions();await permissions.getByRole('button',{name:'Revoke',exact:true}).click();await wait(async()=>await permissions.count()===0,'grant revoked');}
    let pending=request('printf once');await card.waitFor();
    assert.equal(await card.getByRole('button',{name:'Always allow…',exact:true}).count(),0,'always not advertised');
    await card.getByRole('button',{name:'Allow once',exact:true}).click();assert.deepEqual(await result(pending),{decision:'allow',scope:'once'});await settled();
    pending=request('printf once');await card.waitFor();await card.getByRole('button',{name:'Deny',exact:true}).click();assert.equal((await result(pending)).decision,'deny');await settled();
    const exact='cat "a file.txt"';pending=request(exact);await card.waitFor();
    assert.equal(await card.locator('.approval-pattern code').getAttribute('title'),exact);
    await menu().focus();await page.keyboard.press('Enter');
    await card.getByRole('button',{name:'This exact action',exact:true}).click();
    assert.deepEqual(await result(pending),{decision:'allow',scope:'once'});await settled();
    assert.equal(sent.at(-1).scope,'session');assert.equal(sent.at(-1).grant,'exact');assert.equal(sent.at(-1).confirmed,undefined);
    await permissions.waitFor();assert.equal(await page.locator('.session-controls').count(),1,'controls remain unique across approval updates');assert.equal(await permissions.count(),1);assert.match(await permissions.locator('summary').innerText(),/Session permissions \(1\)/);
    assert.deepEqual(await result(request(exact)),{decision:'allow',scope:'once'});await settled();
    const auto=page.locator('.conversation .auto-approval').filter({hasText:exact});await auto.waitFor();
    assert.match(await auto.innerText(),/Auto-approved by a session permission/);assert.equal(await auto.locator('[data-reply-seq]').count(),0);
    assert.equal(approvalBroker.pending().length,0);
    await page.reload();await page.getByRole('button',{name:'Permissions',exact:true}).first().click();await openPermissions();
    assert.match(await permissions.innerText(),/cat "a file.txt"/);
    let rejectRevoke=true;
    await page.route('**/api/commands',async route=>{const c=route.request().postDataJSON().command;if(rejectRevoke&&c.type==='session.revokeGrant'){rejectRevoke=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'revoke-test-error'})});}else await route.continue();});
    await permissions.getByRole('button',{name:'Revoke',exact:true}).click();await permissions.getByRole('alert').waitFor();assert.match(await permissions.innerText(),/revoke-test-error/);
    await revoke();await page.unroute('**/api/commands');
    pending=request(exact);await card.waitFor();await card.getByRole('button',{name:'Deny',exact:true}).click();await result(pending);await settled();
    pending=request('printf high-risk');await card.waitFor();await menu().click();assert.match(await card.locator('.approval-scope-choices').innerText(),/High risk/);
    await card.getByRole('button',{name:'Any use of commandExecution',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'Allow any use for this session',exact:true});
    assert.equal(await dialog.getByRole('button',{name:'Allow for this session',exact:true}).isEnabled(),false);
    await dialog.getByRole('checkbox').check();
    let rejectConfirm=true;
    await page.route('**/api/commands',async route=>{const c=route.request().postDataJSON().command;if(rejectConfirm&&c.type==='approval.respond'){rejectConfirm=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'approval-confirmation-required'})});}else await route.continue();});
    await dialog.getByRole('button',{name:'Allow for this session',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.innerText(),/approval-confirmation-required/);assert.equal(await card.count(),1,'error leaves request pending');
    await dialog.getByRole('button',{name:'Allow for this session',exact:true}).click();assert.deepEqual(await result(pending),{decision:'allow',scope:'once'});await settled();
    assert.equal(sent.at(-1).confirmed,true);assert.equal(sent.at(-1).grant,'tool');await page.unroute('**/api/commands');
    assert.deepEqual(await result(request('printf a-different-command')),{decision:'allow',scope:'once'});await settled();
    await revoke();
    const alwaysNote="Codex adds this command prefix to its exec-policy rules on this machine. It applies to future sessions.";
    pending=request('printf native-always',{nativeScopes:['always'],alwaysNote});await card.waitFor();await card.getByRole('button',{name:'Always allow…',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Always allow',exact:true});assert.equal(await dialog.locator('blockquote').innerText(),alwaysNote);assert.match(await dialog.innerText(),/printf native-always/);
    assert.equal(await dialog.getByRole('button',{name:'Always allow',exact:true}).isEnabled(),false);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Always allow',exact:true}).click();
    assert.deepEqual(await result(pending),{decision:'allow',scope:'always'});await settled();assert.equal(sent.at(-1).scope,'always');assert.equal(sent.at(-1).confirmed,true);assert.equal(await permissions.count(),0,'native always creates no Deck session grant');
    pending=request('printf unsupported');await card.waitFor();let rejectUnsupported=true;
    await page.route('**/api/commands',async route=>{if(rejectUnsupported&&route.request().postDataJSON().command.type==='approval.respond'){rejectUnsupported=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'approval-scope-unsupported'})});}else await route.continue();});
    await card.getByRole('button',{name:'Allow once',exact:true}).click();await card.getByRole('alert').waitFor();assert.match(await card.innerText(),/approval-scope-unsupported/);await card.getByRole('button',{name:'Allow once',exact:true}).click();await result(pending);await settled();await page.unroute('**/api/commands');
    await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
    const long='printf "'+ 'long-pattern-'.repeat(25)+'"';pending=request(long);await card.waitFor();await menu().click();await card.getByRole('button',{name:'Any use of commandExecution',exact:true}).click();
    dialog=page.getByRole('dialog',{name:'Allow any use for this session',exact:true});await dialog.getByRole('checkbox').waitFor();
    assert.equal(await dialog.locator('.approval-pattern code').innerText(),long);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
    await page.screenshot({path:'/tmp/deck-approval-scopes-mobile.png'});await dialog.press('Escape');await card.getByRole('button',{name:'Deny',exact:true}).click();await result(pending);await settled();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:['once','once-does-not-grant','deny','verbatim-pattern','session-exact','auto-exact','auto-audit-line','no-pending-after-auto','grants-replay','revoke-inline-error','revoke-restores-prompt','high-risk-warning','confirmation-ack-gating','confirmation-inline-error','session-tool-confirmed','auto-tool','native-always-advertised','always-ack-gating','native-always-driver-decision','unsupported-inline-error','mobile-reduced-motion']}));
} catch(error){console.error(error);console.error(errors);await Bun.write('/tmp/deck-scopes-failure.html',await page.content());console.log(await page.locator('.session-permissions').evaluateAll(nodes=>nodes.map(node=>({html:node.outerHTML,parent:node.parentElement?.className}))));process.exitCode=1;} finally{await browser.close();host.disable?.();await manager.close();rmSync(root,{recursive:true,force:true});process.exit(process.exitCode??0);}
