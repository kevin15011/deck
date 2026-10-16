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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-subagents-browser-'))), home = join(root, 'home');
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

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
try {
    await page.addInitScript(()=>{const WS=window.WebSocket;(window as any).__sockets=[];window.WebSocket=class extends WS{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);(window as any).__sockets.push(this);}};});
    const project = (await command({ type:'project.register', path:projectOne, name:'Questions' })).project.projectId;
    const session = (await command({ type:'session.create', projectId:project, title:'Questions' })).sessionId;
    const otherSession=(await command({type:'session.create',projectId:project,title:'Other session'})).sessionId;
    await command({type:'session.prepare'},session);
    await page.goto(host.status().url!);
    await page.getByRole('button',{name:'Questions',exact:true}).first().click();
    await command({type:'prompt.send',text:'Ask me'},session);
    await wait(()=>claude.turns.length>0,'lead');
    const turn=claude.turns[0]!;
    const base={multiple:false,allowOther:true,secret:false};
    const questions=[
        {...base,id:'single',header:'Single',prompt:'Pick one',options:[{label:'Alpha',description:'First option'},{label:'Beta'}]},
        {...base,id:'multi',header:'Multiple',prompt:'Pick several',multiple:true,options:[{label:'Red'},{label:'Blue'}]},
        {...base,id:'text',header:'Text',prompt:'Describe it',options:[]},
        {...base,id:'secret',header:'Secret',prompt:'Private token',options:[],secret:true},
        {...base,id:'other',header:'Custom',prompt:'Custom answer',options:[{label:'Default'}]},
    ];
    const result=turn.ask(questions);
    const dock=page.locator('.question-dock');
    await dock.locator('.question-toggle').click();
    await page.waitForTimeout(600); await page.screenshot({path:'/tmp/deck-questions.png'});
    const send=dock.getByRole('button',{name:/Send answers/});
    assert.equal(await send.isEnabled(),false);
    await dock.getByRole('radio',{name:'Alpha First option'}).check();
    assert.equal(await dock.getByRole('tab',{name:'Multiple',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await dock.evaluate(el=>el.contains(document.activeElement)),true,'auto-advance retains focus');
    await dock.getByRole('checkbox',{name:'Red',exact:true}).check();
    await dock.getByRole('checkbox',{name:'Blue',exact:true}).check();
    await dock.getByRole('tab',{name:'Text',exact:true}).click();
    await dock.getByLabel('Your answer').fill('browser-free-answer');
    await dock.getByRole('tab',{name:'Secret',exact:true}).click();
    const secret=dock.getByLabel('Secret answer');
    assert.equal(await secret.getAttribute('type'),'password');
    await secret.fill('browser-secret-answer');
    assert.equal(await secret.evaluate(el=>{
        const key=Object.keys(el).find(key=>key.startsWith('__reactFiber$'));
        if(!key)throw new Error('React fiber not found');
        const seen=new Set<object>();
        function contains(value:any,depth:number):boolean {
            if(typeof value==='string')return value.includes('browser-secret-answer');
            if(!value||typeof value!=='object'||value instanceof Node||depth===0||seen.has(value))return false;
            seen.add(value);
            return Object.keys(value).some(key=>contains(value[key],depth-1));
        }
        const fibers=[(el as any)[key]], visited=new Set<object>();
        for(let i=0;i<fibers.length&&i<10000;i++){
            const fiber=fibers[i]; if(!fiber||visited.has(fiber))continue;visited.add(fiber);
            if(contains(fiber.memoizedProps,12)||contains(fiber.memoizedState,12))return true;
            fibers.push(fiber.return,fiber.child,fiber.sibling,fiber.alternate);
        }
        return false;
    }),false,'secret stays out of React props and state');
    assert.equal(await send.isEnabled(),false);
    await page.getByRole('button',{name:'Other session',exact:true}).first().click();
    await wait(async()=>await dock.count()===0,'switch away');
    await page.getByRole('button',{name:'Questions',exact:true}).first().click();
    await dock.locator('.question-toggle').click();
    await dock.getByRole('tab',{name:'Secret',exact:true}).click();
    assert.equal(await dock.getByLabel('Secret answer').inputValue(),'');
    await dock.getByLabel('Secret answer').fill('browser-secret-answer');
    await dock.getByRole('tab',{name:'Custom',exact:true}).click();
    await dock.getByRole('textbox',{name:'Other answer'}).fill('browser-other-answer');
    await dock.locator('.question-toggle').click();
    await dock.locator('.question-toggle').click();
    assert.equal(await dock.getByRole('textbox',{name:'Other answer'}).inputValue(),'browser-other-answer');
    assert.equal(await send.isEnabled(),true);
    await page.route('**/api/commands',async route=>{
        const body=route.request().postDataJSON();
        if(body.command?.type==='question.answer'){
            await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'question-answers-invalid'})});
            await page.unroute('**/api/commands');
        }else await route.continue();
    });
    await send.click();
    await dock.getByRole('alert').waitFor();
    assert.match(await dock.getByRole('alert').innerText(),/Could not send/);
    assert.equal(await send.isEnabled(),false,'failed send wipes secret');
    assert.equal(await dock.getByRole('textbox',{name:'Other answer'}).inputValue(),'browser-other-answer');
    await dock.getByRole('tab',{name:'Secret',exact:false}).click();
    await dock.getByLabel('Secret answer').fill('browser-secret-answer');
    await send.click();
    assert.deepEqual(await result,{outcome:'answered',answers:{single:['Alpha'],multi:['Red','Blue'],text:['browser-free-answer'],secret:['browser-secret-answer'],other:['browser-other-answer']}});
    await wait(async()=>await dock.count()===0,'resolved dock');
    // Reuse the independent secret-option probe, with the expected fixed gating.
    const restricted=turn.ask([{...base,id:'__proto__',prompt:'Restricted secret',secret:true,allowOther:false,options:[{label:'Allowed'}]}],'secret-choice');
    await dock.locator('.question-toggle').click();
    await dock.getByLabel('Secret answer').fill('Disallowed');
    assert.equal(await send.isEnabled(),false,'disallowed secret cannot send');
    await dock.getByLabel('Secret answer').fill('Allowed');
    assert.equal(await send.isEnabled(),true);
    const oldInput=await dock.getByLabel('Secret answer').elementHandle();
    await page.evaluate(()=>{for(const socket of (window as any).__sockets)socket.close();});
    await wait(async()=>await oldInput!.evaluate(el=>(el as HTMLInputElement).value)==='','disconnect wipes detached secret');
    await wait(async()=>await page.locator('.connection').innerText().then(text=>text.includes('Connected')),'reconnected');
    assert.equal(await dock.getByLabel('Secret answer').inputValue(),'');
    assert.equal(await send.isEnabled(),false,'reconnect requires re-entry');
    await dock.getByLabel('Secret answer').fill('Allowed');
    await send.click();
    assert.deepEqual(await restricted,{outcome:'answered',answers:Object.fromEntries([['__proto__',['Allowed']]])});
    await wait(async()=>await dock.count()===0,'restricted resolved');
    for(const id of ['constructor','__proto__','toString']){
        const prototypeResult=turn.ask([{...base,id,prompt:'Prototype-safe answer',options:[]}],`prototype:${id}`);
        await dock.locator('.question-toggle').click();
        assert.equal(await send.isEnabled(),false,'prototype id starts unanswered');
        await dock.getByLabel('Your answer').fill('explicit-id-answer');
        await send.click();
        assert.deepEqual(await prototypeResult,{outcome:'answered',answers:Object.fromEntries([[id,['explicit-id-answer']]])});
        await wait(async()=>await dock.count()===0,'prototype resolved');
    }
    await page.setViewportSize({width:390,height:844});
    const dismissed=turn.ask([questions[0]!]);
    await dock.locator('.question-toggle').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile has no horizontal overflow');
    assert.ok(await dock.locator('.question-panel').evaluate(el=>el.getBoundingClientRect().height<=innerHeight*.51),'panel scrolls within half viewport');
    await dock.getByRole('button',{name:'Dismiss',exact:true}).click();
    assert.equal((await dismissed).outcome,'dismissed');
    const pending=[turn.ask([questions[2]!],'codex:0'),turn.ask([questions[2]!],'mobile:1'),turn.ask([questions[2]!],'mobile:2')];
    await wait(async()=>await dock.count()===3,'three mobile docks');
    await dock.nth(0).locator('.question-toggle').click();
    await dock.nth(0).getByLabel('Your answer').fill('scoped-draft');
    await dock.nth(1).locator('.question-toggle').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.question-toggle[aria-expanded=true]').count(),1,'accordion');
    await dock.nth(0).locator('.question-toggle').click();
    assert.equal(await dock.nth(0).getByLabel('Your answer').inputValue(),'scoped-draft','collapse retains ordinary draft');
    for(const toggle of await page.locator('.question-toggle').all())assert.equal(await toggle.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),true,'dock toggle on screen');
    await page.locator('#prompt').focus();
    assert.equal(await page.locator('#prompt').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.activeElement===el;}),true,'composer reachable');
    await page.getByRole('button',{name:'Open sessions',exact:true}).click();
    await page.getByRole('button',{name:'Other session',exact:true}).first().click();
    await manager.close(); manager=createManager();
    await Promise.all(pending);
    await command({type:'prompt.send',text:'Ask elsewhere'},otherSession);
    await wait(()=>claude.turns.length===2,'other lead');
    const other=claude.turns[1]!;
    const otherResult=other.ask([questions[2]!],'codex:0');
    await wait(async()=>await dock.count()===1,'other question after restart');
    await dock.locator('.question-toggle').click();
    assert.equal(await dock.getByLabel('Your answer').inputValue(),'','same request ID isolated after restart');
    await command({type:'question.dismiss',questionId:'codex:0'},otherSession);
    await otherResult;
    await page.getByRole('button',{name:'Open sessions',exact:true}).click();
    await page.getByRole('button',{name:'Questions',exact:true}).first().click();
    await wait(async()=>await dock.count()===0,'inactive cancellations replay after restart');
    const events=JSON.stringify([...manager.openLog(session)!.readAfter(0)]);
    for(const value of ['browser-free-answer','browser-secret-answer','browser-other-answer'])assert.equal(events.includes(value),false);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({ok:true,checks:35}));
} catch(error) { console.error(error);  process.exitCode=1; } finally { await browser.close(); host.disable?.(); await manager.close(); rmSync(root,{recursive:true,force:true}); process.exit(process.exitCode??0); }
