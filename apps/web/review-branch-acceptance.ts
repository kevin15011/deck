/** Real HTTP/WebSocket + persistent SessionManager acceptance; only native inference is faked. */
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-review-acceptance-'))),home=join(root,'home'),projectOne=join(home,'project');
mkdirSync(projectOne,{recursive:true});
const paths = resolveStatePaths({ env: { XDG_STATE_HOME: join(root, 'state') } }); ensureStateLayout(paths);
const claude = new FakeDriver('claude'), codex = new FakeDriver('codex'), drivers = [claude, codex];
for (const driver of drivers) driver.onStart = turn => turn.init();
const config: CrossRunnerConfig = { enabled: true, members: { lead: { runnerId: 'claude', modelId: 'opus' }, reviewer: { runnerId: 'claude', modelId: 'opus' }, investigate: { runnerId: 'claude', modelId: 'opus' } }, approvals: { claude: 'relay', codex: 'runner-default', opencode: 'relay' }, maxConcurrentTasks: 4, claudeTosAcknowledgedAt: null, web: { port: 0, trustedProxy: null, allowedOrigins: [], allowFunnel: false } };
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
page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(host.status().url!).origin?route.continue():route.abort());
const git=(...args:string[])=>execFileSync('git',args,{cwd:projectOne,encoding:'utf8'}).trim();
try {
 git('init','-q','-b','main');git('config','user.name','Browser');git('config','user.email','browser@example.invalid');
 mkdirSync(join(projectOne,'docs'));writeFileSync(join(projectOne,'docs','guide.md'),'# Base guide\n');writeFileSync(join(projectOne,'deleted.md'),'# Deleted guide\n');
 git('add','.');git('commit','-qm','base');git('update-ref','refs/remotes/origin/main','HEAD');git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');git('checkout','-qb','feature/review');
 writeFileSync(join(projectOne,'docs','guide.md'),'# Committed guide\n');git('rm','-q','deleted.md');writeFileSync(join(projectOne,'binary.bin'),Buffer.from([0,1,2]));git('add','.');git('commit','-qm','branch');
 writeFileSync(join(projectOne,'docs','guide.md'),'# Working guide\n');
 const project=(await command({type:'project.register',path:projectOne,name:'Review fixture'})).project.projectId;
 const session=(await command({type:'session.create',projectId:project,title:'Review branch controls'})).sessionId;
 await command({type:'session.prepare'},session);await wait(async()=>((await manager.query('session.readiness',{sessionId:session})) as any).data.status==='ready','prepared');
 await page.goto(host.status().url!);await page.getByRole('button',{name:'Review branch controls',exact:true}).first().click();
 await page.getByRole('heading',{name:'Review branch controls',exact:true}).waitFor();await page.getByLabel('Current branch: feature/review',{exact:true}).waitFor();
 const left=page.getByRole('button',{name:'Left panel',exact:true}),right=page.getByRole('button',{name:'Right panel',exact:true});
 if(await right.getAttribute('aria-pressed')==='false')await right.click();await page.getByRole('tab',{name:'Review',exact:true}).click();
 const panel=page.locator('.review-panel:visible'),mode=panel.getByRole('combobox',{name:'Review mode',exact:true});
 assert.equal(await panel.locator('.git-toolbar').count(),1);
 // Protects keyboard continuity when the selected Review panel hides its own toolbar.
 // Oracle: consecutive mode choices must retain a visible, usable selector (P2 review).
 const keyboardModes=async(label:string)=>{
  for(let attempt=0;attempt<80&&!await mode.evaluate(el=>el===document.activeElement);attempt++)await page.keyboard.press('Tab');
  assert(await mode.evaluate(el=>el===document.activeElement),`${label}: keyboard reaches selector`);
  for(const [key,value] of [['c','changes'],['d','diff'],['f','files'],['d','diff'],['c','changes'],['f','files']]){
   await page.keyboard.press(key!);
   assert.equal(await mode.inputValue(),value,`${label}: next keyboard choice ${value}`);
   assert(await mode.evaluate(el=>el===document.activeElement&&el.checkVisibility()),`${label}: ${value} retains visible selector focus`);
  }
  await page.keyboard.press('Tab');
  assert(await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.checkVisibility()),`${label}: Tab reaches visible next control`);
  await page.keyboard.press('Shift+Tab');
  assert(await mode.evaluate(el=>el===document.activeElement),`${label}: reverse Tab returns to selector`);
 };
 await keyboardModes('desktop');
 // Programmatic mode updates must not take focus from another control.
 await left.focus();await mode.selectOption('diff');
 assert(await left.evaluate(el=>el===document.activeElement),'mode change preserves unrelated focus');
 await keyboardModes('desktop rapid reversal');
 await page.keyboard.press('d');await page.keyboard.press('Tab');
 await wait(async()=>await panel.getByText('origin/main (merge base) → feature/review',{exact:true}).count()>0,'keyboard Diff selection');
 const file=(path:string)=>panel.locator(`[data-file-key="branch:${path}"]`);
 await file('docs/guide.md').click();await panel.getByRole('table',{name:'Side-by-side diff',exact:true}).waitFor();
 assert((await panel.locator('.diff-viewport').innerText()).includes('Committed guide'));assert(!(await panel.locator('.diff-viewport').innerText()).includes('Working guide'));
 assert((await file('docs/guide.md').innerText()).includes('+1'));
 await panel.getByRole('button',{name:'Inline',exact:true}).click();await panel.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Preview Markdown',exact:true}).click();await panel.getByRole('heading',{name:'Committed guide',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Show text',exact:true}).click();await panel.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 await file('deleted.md').click();await panel.getByRole('button',{name:'Preview Markdown',exact:true}).click();await panel.getByRole('heading',{name:'Deleted guide',exact:true}).waitFor();
 await file('binary.bin').click();await panel.getByText('Binary file changed. Content is not rendered.',{exact:true}).waitFor();
 let held=false,release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);
 await page.route('**/git/diff?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('path')!=='docs/guide.md'){await route.continue();return;}
  const response=await route.fetch();held=true;await barrier;await route.fulfill({response}).catch(()=>{});
 });
 await file('docs/guide.md').click();await wait(()=>held,'held old selection');await file('deleted.md').click();release();
 await panel.getByRole('table',{name:'Inline diff',exact:true}).waitFor();assert((await panel.locator('.diff-viewport').innerText()).includes('Deleted guide'));
 assert(!(await panel.locator('.diff-viewport').innerText()).includes('Committed guide'));await page.unroute('**/git/diff?**');

 // Real HTTP admission accepts only known query fields and opaque revision tokens.
 const api=await page.evaluate(async session=>{
  const catalog=await fetch(`/api/sessions/${session}/git?comparison=branch`).then(r=>r.json());
  const invalid=await fetch(`/api/sessions/${session}/git?comparison=arbitrary`);
  const duplicate=await fetch(`/api/sessions/${session}/git?comparison=branch&comparison=branch`);
  const cursor=await fetch(`/api/sessions/${session}/git?comparison=branch&cursor=--output=unsafe`);
  const identityCursor=await fetch(`/api/sessions/${session}/git?comparison=identity&cursor=anything`);
  const revision=await fetch(`/api/sessions/${session}/git/diff?section=branch&path=deleted.md&revision=--output=unsafe`);
  return {catalog,invalid:invalid.status,duplicate:duplicate.status,revision:revision.status,cursor:cursor.status,identityCursor:identityCursor.status};
 },session);
 assert.equal(api.catalog.ok,true);assert.equal(api.invalid,400);assert.equal(api.duplicate,400);assert.equal(api.revision,400);assert.equal(api.cursor,400);assert.equal(api.identityCursor,400);
 await mode.selectOption('files');await panel.locator('.git-folder > summary').filter({hasText:'docs'}).click();await panel.locator('[data-project-path="docs/guide.md"]').click();
 await panel.getByRole('button',{name:'Preview Markdown',exact:true}).click();await panel.getByRole('heading',{name:'Working guide',exact:true}).waitFor();await panel.getByRole('button',{name:'Show text',exact:true}).click();
 assert.equal(await panel.locator('.git-document-header,.git-preview-toolbar').count(),0);
 // Quick changes must retain only the selected mode and document.
 for(const value of ['changes','diff','files','diff'])await mode.selectOption(value);
 await file('docs/guide.md').click();await panel.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await page.getByRole('button',{name:'Expand sidebar',exact:true}).focus();await page.keyboard.press('Enter');
 for(let i=0;i<3;i++){await left.click();await left.click();await right.click();await right.click();}
 assert.equal(await left.getAttribute('aria-pressed'),'true');assert.equal(await right.getAttribute('aria-pressed'),'true');
 await wait(async()=>await panel.locator('.git-view').getAttribute('aria-busy')==='false','settled document');await page.waitForTimeout(450);await page.screenshot({path:join(root,'desktop.png')});
 await page.emulateMedia({reducedMotion:'reduce'});await keyboardModes('reduced motion');await mode.selectOption('files');await mode.selectOption('diff');await file('docs/guide.md').click();
 await panel.getByRole('button',{name:'Preview Markdown',exact:true}).click();await panel.getByRole('heading',{name:'Committed guide',exact:true}).waitFor();
 assert.equal(await panel.locator('.git-document').evaluate(el=>getComputedStyle(el).opacity),'1');
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.getByRole('tab',{name:'Review',exact:true}).click();
  await page.getByLabel('Current branch: feature/review',{exact:true}).waitFor();
  assert.equal(await left.isVisible(),false);
  await keyboardModes(`mobile ${width}`);await mode.selectOption('diff');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const navigation=panel.getByRole('button',{name:/Changed files/});await navigation.click();await file('docs/guide.md').focus();await page.keyboard.press('Enter');
  assert.equal(await navigation.getAttribute('aria-expanded'),'false');
  await panel.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 }
 await wait(async()=>await panel.locator('.git-view').getAttribute('aria-busy')==='false','settled mobile');await page.screenshot({path:join(root,'mobile.png')});
 // Protects branch identity under actual metadata budget failure, then recovery and progressive catalogs.
 // Oracle: identity needs only HEAD; no failed catalog may hide it; every committed file stays reachable.
 await page.setViewportSize({width:1440,height:1000});
 await wait(async()=>await panel.locator('.git-view').getAttribute('aria-busy')==='false','settled before failure');
 const packedRefs=join(projectOne,'.git','packed-refs');
 writeFileSync(packedRefs,Buffer.alloc(65*1024*1024));
 await page.reload();await page.getByLabel('Current branch: feature/review',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Review',exact:true}).click();await mode.selectOption('diff');
 await wait(async()=>await panel.locator('.git-status').innerText().then(text=>text.includes('snapshot')),'precise actual metadata failure');
 assert((await panel.locator('.git-status').innerText()).includes('commit metadata'));
 assert(await page.getByLabel('Current branch: feature/review',{exact:true}).isVisible());
 await page.screenshot({path:join(root,'metadata-failure.png')});
 rmSync(packedRefs);await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await file('docs/guide.md').click();await panel.getByRole('table',{name:'Side-by-side diff',exact:true}).waitFor();
 for(let i=0;i<597;i++)writeFileSync(join(projectOne,`file-${String(i).padStart(4,'0')}.txt`),'committed addition\n');
 writeFileSync(join(projectOne,'oversized.txt'),'large\n'.repeat(60000));
 // Commit only the fixture additions: the dirty guide must stay outside Diff.
 git('add','--',...Array.from({length:597},(_,i)=>`file-${String(i).padStart(4,'0')}.txt`),'oversized.txt');git('commit','-qm','large branch catalog');
 await panel.getByRole('button',{name:'Refresh',exact:true}).click();
 await wait(async()=>await panel.locator('.git-status').innerText().then(text=>text.startsWith('200 of 601 files')),'first bounded page');
 assert((await panel.locator('.git-comparison').innerText()).includes('Loaded files'));
 // Protects failed continuations: exact prior tree, total, comparison, counts and retry
 // remain available; Refresh obtains a fresh catalog after remote/history recovery.
 await wait(async()=>await panel.locator('.git-view').getAttribute('aria-busy')==='false','settled first page');
 const snapshot=async()=>({status:await panel.locator('.git-status').innerText(),comparison:await panel.locator('.git-comparison').innerText(),files:await panel.locator('[data-file-key]').evaluateAll(nodes=>nodes.map(node=>[node.getAttribute('data-file-key'),node.textContent]))});
 const remoteBase=git('rev-parse','refs/remotes/origin/main');
 for(const fault of ['missing-remote','missing-history','empty-response','changed-response']){
  const before=await snapshot();
  if(fault==='missing-remote')git('symbolic-ref','--delete','refs/remotes/origin/HEAD');
  else if(fault==='missing-history')git('update-ref','refs/remotes/origin/main',git('commit-tree',git('rev-parse','HEAD^{tree}'),'-m','unrelated'));
  else await page.route('**/git?comparison=branch&cursor=*',async route=>{
   const response=await route.fetch(),body=await response.json();
   if(fault==='empty-response')body.data={files:[],warnings:['Unavailable']};
   else body.data.comparison.revision='changed';
   await route.fulfill({response,json:body});
  });
  await panel.getByRole('button',{name:'Load more changed files',exact:true}).click();
  await wait(async()=>await panel.getByRole('alert').count()>0,`${fault}: actionable continuation failure`);
  assert((await panel.getByRole('alert').innerText()).includes('Refresh'));
  assert.deepEqual(await snapshot(),before,`${fault}: exact previous catalog retained`);
  assert(await panel.getByRole('button',{name:'Load more changed files',exact:true}).isEnabled());
  if(fault==='missing-remote')git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');
  else if(fault==='missing-history')git('update-ref','refs/remotes/origin/main',remoteBase);
  else await page.unroute('**/git?comparison=branch&cursor=*');
  await panel.getByRole('button',{name:'Refresh',exact:true}).click();
  await panel.getByRole('table',{name:'Side-by-side diff',exact:true}).waitFor();
  await wait(async()=>JSON.stringify(await snapshot())===JSON.stringify(before)&&await panel.getByRole('alert').count()===0,`${fault}: refresh recovery`);
  assert.deepEqual(await snapshot(),before,`${fault}: refreshed catalog recovers`);
 }
 // A late page reply after switching modes must not append or leave pagination disabled.
 let pageHeld=false,releasePage!:()=>void;const pageGate=new Promise<void>(resolve=>{releasePage=resolve;});
 await page.route('**/git?comparison=branch&cursor=*',async route=>{pageHeld=true;await pageGate;await route.continue().catch(()=>{});});
 await panel.getByRole('button',{name:'Load more changed files',exact:true}).click();await wait(()=>pageHeld,'held next page');
 await mode.selectOption('files');releasePage();await mode.selectOption('diff');
 await page.unroute('**/git?comparison=branch&cursor=*');
 await wait(async()=>await panel.locator('.git-view').getAttribute('aria-busy')==='false','settled after page cancellation');
 assert((await panel.locator('.git-status').innerText()).startsWith('200 of 601 files'));
 for(const count of [400,600,601]){
  await panel.getByRole('button',{name:'Load more changed files',exact:true}).click();
  await wait(async()=>await panel.locator('.git-status').innerText().then(text=>text.startsWith(`${count} of 601 files`)),'next page');
 }
 assert.equal(await panel.getByRole('button',{name:'Load more changed files',exact:true}).count(),0);
 await file('oversized.txt').click();await wait(async()=>await panel.locator('.diff-viewport').innerText().then(text=>text.includes('exceeded')||text.includes('exceeds')),'local document limit');
 assert.equal(await panel.locator('[data-file-key]').count(),601);
 await file('file-0596.txt').click();await panel.getByRole('table',{name:'Side-by-side diff',exact:true}).waitFor();
 assert((await panel.locator('.diff-viewport').innerText()).includes('committed addition'));
 await page.screenshot({path:join(root,'large-catalog.png')});
 // Protects intrinsic header space allocation: a branch that fits beside the title
 // stays readable, while constrained names truncate without hiding controls or overflowing.
 const headerLayouts: unknown[]=[];
 for(const [label,title,branch] of [
  ['short-short','Review','feature/review'],
  ['long-short','Review branch controls for a very long session title','feature/review'],
  ['short-long','Review','feature/review-with-a-long-descriptive-branch-name-for-responsive-header-layout'],
  ['long-long','Review branch controls for a very long session title','feature/review-with-a-long-descriptive-branch-name-for-responsive-header-layout'],
 ]){
  git('branch','-m',branch!);await command({type:'session.rename',title:title!},session);
  await page.reload();await page.getByRole('heading',{name:title!,exact:true}).waitFor();
  const branchLabel=page.getByLabel(`Current branch: ${branch}`,{exact:true});await branchLabel.waitFor();
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:844});
   const layout=await page.locator('.session-title-line').evaluate(line=>{
    const title=line.querySelector('h1')!,branch=line.querySelector('.session-branch')!,text=branch.querySelector('span')??branch;
    const naturalWidth=(element:Element)=>{const range=document.createRange();range.selectNodeContents(element);return range.getBoundingClientRect().width;};
    const icon=branch.querySelector('svg'),gap=parseFloat(getComputedStyle(line).columnGap),branchStyle=getComputedStyle(branch);
    const branchNatural=naturalWidth(text)+(icon?icon.getBoundingClientRect().width+parseFloat(branchStyle.columnGap):0);
    return {line:line.getBoundingClientRect().width,title:title.getBoundingClientRect().width,titleNatural:naturalWidth(title),branch:branch.getBoundingClientRect().width,branchNatural,textWidth:text.clientWidth,textScroll:text.scrollWidth,gap,icon:!!icon,iconBeforeText:!!icon&&icon.getBoundingClientRect().right<=text.getBoundingClientRect().left,overflow:document.documentElement.scrollWidth>innerWidth};
   });
   headerLayouts.push({label,width,...layout});
   writeFileSync(join(root,'header-layouts.json'),JSON.stringify(headerLayouts,null,2));
   assert.equal(layout.overflow,false,`${label} ${width}: no horizontal overflow`);
   assert(layout.title>=Math.min(layout.titleNatural,(layout.line-layout.gap)/2)-1,`${label} ${width}: readable session title`);
   if(layout.titleNatural+layout.branchNatural+layout.gap<=layout.line){
    assert(layout.branch>=layout.branchNatural-1,`${label} ${width}: branch uses available space: ${JSON.stringify(layout)}`);
   }
   assert(layout.icon&&layout.iconBeforeText,`${label} ${width}: Git branch icon precedes text`);
   assert.equal(await branchLabel.getAttribute('title'),branch);
   if(width<=1000){
    assert(await page.getByRole('button',{name:'Open sessions',exact:true}).isVisible());
    const controls=await page.locator('.session-compact-toggle').boundingBox();
    assert(controls&&controls.width>=44&&controls.height>=40,`${label} ${width}: session control hit area`);
   }else assert(await left.isVisible()&&await right.isVisible());
   await page.screenshot({path:join(root,`header-${label}-${width}.png`)});
  }
 }
 writeFileSync(join(root,'header-layouts.json'),JSON.stringify(headerLayouts,null,2));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'pass',artifacts:root,checks:'actual metadata failure with branch identity retained and recovery; 601 committed files paged 200/400/600/601; missing remote/history and malformed/mismatched continuation preserve exact catalog and recover on Refresh; oversized document isolated; keyboard Files → Changes → Diff → Files with visible activeElement and next-key/Tab assertions (desktop, rapid reversal, reduced motion, 390/320 mobile), unrelated focus preserved, real Git/API, keyboard Diff, committed/deleted/binary, counts, Markdown/text, rapid modes/panels, sidebar keyboard, reduced motion, desktop and 390/320 mobile'}));
} catch(error){console.error(await page.locator('.review-panel:visible').innerText().catch(()=>''));await page.screenshot({path:join(root,'failure.png')});console.error('Artifacts:',root);throw error;} finally {await browser.close();await host.close();await manager.close();}
