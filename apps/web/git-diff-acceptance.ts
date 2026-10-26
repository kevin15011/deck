/** Real HTTP/WebSocket + persistent SessionManager acceptance; only native inference is faked. */
import { chromium, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-git-browser-'))), home = join(root, 'home');
const projectOne = join(home, 'project-one'), projectTwo = join(home, 'project-two');
mkdirSync(projectOne, { recursive: true }); mkdirSync(projectTwo, { recursive: true });
const nestedDirectory = join(projectOne, 'nested folder', 'leaf');
mkdirSync(nestedDirectory, { recursive: true });
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

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors: string[] = [];
page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
const artifacts=join(homedir(),'.cache','deck-git-acceptance','reveal-reopen'); mkdirSync(artifacts,{recursive:true});
const git=(...args:string[])=>execFileSync('git',args,{cwd:projectOne,encoding:'utf8'});
try {
 git('init','-q');git('config','user.name','Browser');git('config','user.email','browser@example.com');
 writeFileSync(join(projectOne,'sample.txt'),Array.from({length:180},(_,i)=>`original line ${i}`).join('\n')+'\n');
 writeFileSync(join(projectOne,'blank.txt'),'start\n\nold\ntail\n');
 writeFileSync(join(nestedDirectory,'renamed.ts'),'rename content\n');writeFileSync(join(nestedDirectory,'deleted.ts'),'deleted\n');
 writeFileSync(join(projectOne,'guide.md'),'# Original guide\n'+ 'Untouched paragraph.\n\n'.repeat(30));
 writeFileSync(join(projectOne,'docs'),'Former terminal file\n');
 mkdirSync(join(projectOne,'reverse'));
 writeFileSync(join(projectOne,'reverse','prior.md'),'# Deleted nested guide\n');
 mkdirSync(join(projectOne,'zz reveal','nested'),{recursive:true});
 for(let i=0;i<65;i++)writeFileSync(join(projectOne,'zz reveal',`file-${String(i).padStart(3,'0')}.txt`),'before\n');
 const revealPath='zz reveal/nested/quote" [file]\\name.MD';
 writeFileSync(join(projectOne,revealPath),'# Before\n');
 git('add','.');git('commit','-qm','initial');
 for(let i=0;i<65;i++)writeFileSync(join(projectOne,'zz reveal',`file-${String(i).padStart(3,'0')}.txt`),'after\n');
 writeFileSync(join(projectOne,revealPath),'# Staged reveal\n'+'Staged paragraph.\n\n'.repeat(80));git('add','zz reveal');
 writeFileSync(join(projectOne,revealPath),'# Working reveal\n'+'Working paragraph.\n\n'.repeat(80));
 rmSync(join(projectOne,'docs'));mkdirSync(join(projectOne,'docs'));
 writeFileSync(join(projectOne,'docs','guide.md'),'# Added nested guide\n');
 rmSync(join(projectOne,'reverse'),{recursive:true});writeFileSync(join(projectOne,'reverse'),'Replacement terminal file\n');
 git('add','docs','reverse');
 writeFileSync(join(projectOne,'guide.md'),'# Staged guide\n'+ 'Untouched paragraph.\n\n'.repeat(30));git('add','guide.md');
 writeFileSync(join(projectOne,'guide.md'),'# Working guide\n<script>window.previewInjected=true</script>\n[unsafe](javascript:alert(1))\n![remote](https://example.invalid/image.png)\n');
 git('mv','nested folder/leaf/renamed.ts','nested folder/leaf/new-name.ts');rmSync(join(nestedDirectory,'deleted.ts'));
 writeFileSync(join(nestedDirectory,'a-very-long-new-filename-that-should-not-expand-the-navigation-panel.ts'),'new nested\n');
 mkdirSync(join(projectOne,'nested-repo'));execFileSync('git',['init','-q'],{cwd:join(projectOne,'nested-repo')});writeFileSync(join(projectOne,'nested-repo','inside'),'nested\n');
 git('config','diff.suppressBlankEmpty','true');writeFileSync(join(projectOne,'blank.txt'),'start\n\nnew\ntail\n');
 writeFileSync(join(projectOne,'sample.txt'),Array.from({length:180},(_,i)=>i%8===0?`changed line ${i}`:`original line ${i}`).join('\n')+'\n');
 git('add','sample.txt');writeFileSync(join(projectOne,'sample.txt'),Array.from({length:180},(_,i)=>i%8===0?`working line ${i}`:`original line ${i}`).join('\n')+'\n');writeFileSync(join(projectOne,'new file.txt'),'<script>window.injected=true</script>\n'+'long line '.repeat(800)+'\n');
 writeFileSync(join(projectOne,'large.txt'),'x'.repeat(300_000));
 const project=(await command({type:'project.register',path:projectOne,name:'Git fixture'})).project.projectId;
 const session=(await command({type:'session.create',projectId:project,title:'Git workspace'})).sessionId;
 await command({type:'session.prepare'},session);await wait(async()=>((await manager.query('session.readiness',{sessionId:session})) as any).data.status==='ready','prepared');
 await command({type:'prompt.send',text:'Prepare browser session'},session);await wait(()=>claude.turns.length>0,'lead start');
 const tab=(name:string)=>page.getByRole('tab',{name,exact:true});
 const layout=(name:string)=>page.getByRole('group',{name:'Content view',exact:true}).getByRole('button',{name,exact:true});
 await page.addInitScript(()=>localStorage.setItem('deck.workspace-collapsed','true'));
 await page.goto(host.status().url!);await page.getByRole('button',{name:'Git workspace',exact:true}).first().click();
 await page.getByRole('heading',{name:'Git workspace',exact:true}).waitFor();
 assert.equal(await layout('Chat').getAttribute('aria-pressed'),'true','legacy collapsed preference migrates to Chat');await layout('Both').click();
 const composer=page.locator('textarea');await composer.waitFor();await composer.fill('Draft survives workspace layout');
 await tab('Review').click();
 assert.deepEqual(await page.locator('[role=tab]').evaluateAll(elements=>elements.map(el=>el.getAttribute('aria-label')||el.textContent)),['Chat','Activity','Subagents','Review']);
 assert.equal(await page.locator('#panel-openspec').count(),0);
 const selectFile=async(key:string)=>{await page.locator(`[data-file-key=${JSON.stringify(key)}]`).click();};
 const selectedFile=()=>page.locator('[data-file-key][aria-current=true]').getAttribute('data-file-key');
 await page.getByRole('navigation',{name:'Changed files',exact:true}).waitFor();await page.locator('[data-file-key]').first().waitFor();
 // Real staged file-to-folder and folder-to-file replacements: every row and preview is keyboard reachable.
 for(const [terminal,child,heading] of [['docs','docs/guide.md','Added nested guide'],['reverse','reverse/prior.md','Deleted nested guide']]) {
  const row=page.locator(`[data-file-key="staged:${terminal}"]`);
  await row.focus();await page.keyboard.press('Enter');
  await page.getByRole('table').waitFor();
  assert.equal(await selectedFile(),`staged:${terminal}`);
  await page.keyboard.press('Tab');
  const disclosure=page.locator('.git-folder > summary').filter({hasText:`${terminal}/`});
  assert.equal(await disclosure.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');
  assert.equal(await disclosure.locator('..').getAttribute('open'),null);
  assert.equal(await row.isVisible(),true,'terminal remains visible with descendants collapsed');
  await page.keyboard.press('Space');await page.keyboard.press('Tab');
  const childRow=page.locator(`[data-file-key="staged:${child}"]`);
  assert.equal(await childRow.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');
  await page.getByRole('table').waitFor();
  assert.equal(await selectedFile(),`staged:${child}`);
  await page.keyboard.press('Tab');
  const preview=page.locator('.git-file-tree').getByRole('button',{name:`Preview Markdown: staged: ${child}`,exact:true});
  assert.equal(await preview.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Enter');await page.getByRole('heading',{name:heading,exact:true}).waitFor();
  await page.getByText(terminal==='docs'?'Index · staged version':'HEAD · before deletion',{exact:true}).waitFor();
  await page.screenshot({path:join(artifacts,`collision-${terminal}.png`)});
  await page.getByRole('button',{name:'Return to diff',exact:true}).click();
 }
 await page.locator('.git-file-tree').getByRole('button',{name:'Preview Markdown: staged: guide.md',exact:true}).focus();await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Staged guide',exact:true}).waitFor();
 assert.ok((await page.locator('.diff-viewport').textContent())!.includes('Untouched paragraph.'));
 await page.getByText('Index · staged version',{exact:true}).waitFor();
 await page.screenshot({path:join(artifacts,'desktop-markdown-dark.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:join(artifacts,'desktop-markdown-light.png')});await page.evaluate(()=>delete document.documentElement.dataset.theme);
 await page.locator('.git-file-tree').getByRole('button',{name:'Preview Markdown: unstaged: guide.md',exact:true}).click();
 await page.getByRole('heading',{name:'Working guide',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>Boolean((window as any).previewInjected)),false);
 assert.equal(await page.locator('.diff-viewport a,.diff-viewport img,.diff-viewport script').count(),0);
 await page.getByRole('button',{name:'Return to diff',exact:true}).click();await page.getByRole('table').waitFor();
 async function checkHeaderPreview(layout:string) {
  const selected=await selectedFile();
  const action=page.locator('.git-document-header').getByRole('button',{name:'Preview Markdown: unstaged: guide.md',exact:true});
  await action.waitFor();await action.focus();await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Working guide',exact:true}).waitFor();
  assert.equal(await page.locator('.diff-viewport').evaluate(el=>el===document.activeElement),true,'header preview focuses document');
  assert.equal(await page.locator('.git-document-header button').count(),0);
  await page.getByRole('button',{name:'Return to diff',exact:true}).click();await page.getByRole('table').waitFor();
  assert.equal(await selectedFile(),selected,'header round trip preserves selection');
  assert.equal(await page.locator('.diff-viewport').evaluate(el=>el===document.activeElement),true,'return focuses diff');
  await action.waitFor();await page.screenshot({path:join(artifacts,`${layout}-header-preview.png`)});
 }
 await checkHeaderPreview('desktop');

 // Disclosures are native keyboard controls; groups retain distinct file identities.
 const nestedGroup=page.locator('.git-file-group').filter({has:page.locator('[data-file-key="staged:nested folder/leaf/new-name.ts"]')});
 const folder=nestedGroup.locator('.git-folder > summary').first();
 await folder.focus();await page.keyboard.press('Enter');assert.equal(await folder.locator('..').getAttribute('open'),null);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(400);
 assert.equal(await folder.locator('..').getAttribute('open'),null,'refresh retains collapsed folder');
 await page.keyboard.press('Tab');await folder.focus();await page.keyboard.press('Space');
 await selectFile('staged:nested folder/leaf/new-name.ts');
 await page.locator('.diff-metadata').waitFor();
 assert.equal(await page.locator('[data-file-key="unstaged:sample.txt"]').count(),1);
 assert.equal(await page.locator('[data-file-key="staged:sample.txt"]').count(),1);
 await selectFile('untracked:nested-repo');await page.getByText(/Nested repository content is not inspected/).waitFor();
 await selectFile('unstaged:blank.txt');
 for(const mode of ['Inline','Side-by-side']) {
  await page.getByRole('button',{name:mode,exact:true}).click();
  await page.locator('.diff-code.add').filter({hasText:'new'}).waitFor();
  const row=page.locator('tr').filter({has:page.locator('.diff-code.add').filter({hasText:'new'})});
  assert.ok((await row.locator('.diff-number').allTextContents()).includes('3'),'changed line is numbered 3');
  const tail=page.locator('tr').filter({has:page.locator('.diff-code.context').filter({hasText:'tail'})});
  assert.deepEqual(await tail.locator('.diff-number').allTextContents(),['4','4'],'tail follows blank context');
 }
 await selectFile('staged:sample.txt');await page.getByRole('table',{name:'Side-by-side diff',exact:true}).waitFor();
 assert.equal(await page.locator('.diff-code.add').count(),23);
 await page.getByRole('button',{name:'Inline',exact:true}).click();await page.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 assert.equal(await page.locator('.diff-code.add').count(),23);assert.equal(await selectedFile(),'staged:sample.txt');
 const viewport=page.locator('.diff-viewport'); await viewport.evaluate(el=>el.scrollTop=400); await page.waitForTimeout(80);
 const scroll=await viewport.evaluate(el=>el.scrollTop);assert.ok(scroll>0);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await selectedFile(),'staged:sample.txt');assert.ok(Math.abs(await viewport.evaluate(el=>el.scrollTop)-scroll)<3,'refresh preserves scroll');
 await page.getByRole('button',{name:'Side-by-side',exact:true}).click();assert.ok(Math.abs(await viewport.evaluate(el=>el.scrollTop)-scroll)<3,'first render-mode switch retains approximate reading position');await page.getByRole('button',{name:'Inline',exact:true}).click();
 await page.screenshot({path:join(artifacts,'desktop-both-inline.png')});
 for(const name of ['Workspace','Both','Chat','Workspace','Both']) {
  await layout(name).click();await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();assert.equal(await layout(name).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#panel-chat').isVisible(),name!=='Workspace');assert.equal(await page.locator('#session-workspace').isVisible(),name!=='Chat');
  assert.equal(await composer.inputValue(),'Draft survives workspace layout');
 }
 await layout('Workspace').click();
 for(const name of ['Activity','Subagents','Review']) {await tab(name).click();for(const mode of ['Both','Workspace','Both','Workspace']){await layout(mode).click();assert.equal(await layout(mode).getAttribute('aria-pressed'),'true');assert.equal(await tab(name).getAttribute('aria-selected'),'true');assert.equal(await composer.inputValue(),'Draft survives workspace layout');}}
 await tab('Review').click();assert.equal(await selectedFile(),'staged:sample.txt');
 await page.getByRole('button',{name:'Side-by-side',exact:true}).click();await page.screenshot({path:join(artifacts,'desktop-workspace-split.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:join(artifacts,'desktop-light.png')});await page.evaluate(()=>delete document.documentElement.dataset.theme);
 await folder.click();await layout('Both').click();await page.getByRole('button',{name:'Inline',exact:true}).click();assert.equal(await folder.locator('..').getAttribute('open'),null,'layout and diff mode preserve folder expansion');await layout('Workspace').click();await folder.click();
 await selectFile('untracked:new file.txt');await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>Boolean((window as any).injected)),false);
 assert.ok(await viewport.evaluate(el=>el.scrollWidth>el.clientWidth),'long lines scroll within diff');
 await selectFile('untracked:large.txt');await page.getByText('File exceeds the 256 KiB viewer limit.').waitFor();
 await page.screenshot({path:join(artifacts,'large-file.png')});
 await selectFile('staged:sample.txt');await page.waitForTimeout(200);
 await page.setViewportSize({width:390,height:844});await tab('Review').click();await page.getByRole('table',{name:'Inline diff',exact:true}).waitFor();
 assert.equal(await page.getByRole('group',{name:'Content view',exact:true}).count(),0);
 for(const name of ['Activity','Subagents','Chat','Review']) {await tab(name).click();await page.waitForTimeout(100);assert.equal(await tab(name).getAttribute('aria-selected'),'true');}
 await page.screenshot({path:join(artifacts,'mobile-inline.png')});
 const mobileNavigator=page.getByRole('button',{name:/Changed files ·/});await mobileNavigator.click();
 await page.screenshot({path:join(artifacts,'mobile-tree.png')});
 await page.locator('.git-file-tree').getByRole('button',{name:'Preview Markdown: unstaged: guide.md',exact:true}).click();await page.getByRole('heading',{name:'Working guide',exact:true}).waitFor();
 assert.equal(await mobileNavigator.getAttribute('aria-expanded'),'false');
 await page.screenshot({path:join(artifacts,'mobile-markdown-dark.png')});
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.screenshot({path:join(artifacts,'mobile-markdown-light.png')});await page.evaluate(()=>delete document.documentElement.dataset.theme);
 await page.getByRole('button',{name:'Return to diff',exact:true}).click();await page.getByRole('table').waitFor();await checkHeaderPreview('mobile');assert.equal(await mobileNavigator.getAttribute('aria-expanded'),'false');await mobileNavigator.click();
 await selectFile('unstaged:sample.txt');assert.equal(await mobileNavigator.getAttribute('aria-expanded'),'false');assert.equal(await mobileNavigator.evaluate(el=>el===document.activeElement),true,'mobile selection returns focus to navigator');
 await mobileNavigator.click();await selectFile('staged:sample.txt');
 // Reveal exactly the selected section/path, including CSS-special characters and collapsed ancestors.
 await mobileNavigator.click();
 const selectedReveal=page.locator('[data-file-key][aria-label^="unstaged:"]').filter({hasText:'quote" [file]'});
 await selectedReveal.click();await page.getByRole('table').waitFor();
 await mobileNavigator.click();
 const ancestors=selectedReveal.locator('xpath=ancestor::details');
 for(let i=await ancestors.count()-1;i>=0;i--)await ancestors.nth(i).locator(':scope > summary').click();
 await mobileNavigator.click();
 await page.locator('.diff-viewport').evaluate(el=>{el.scrollTop=25;});
 assert.ok(await page.locator('.diff-viewport').evaluate(el=>el.scrollTop)>0,'nonzero diff reading position');
 const beforeReveal=await page.evaluate(()=>({page:window.scrollY,doc:document.querySelector('.diff-viewport')!.scrollTop}));
 await mobileNavigator.focus();await page.keyboard.press('Enter');
 await wait(async()=>await selectedReveal.isVisible(),'selected row expanded');
 const bounds=await selectedReveal.evaluate(el=>{
  const row=el.getBoundingClientRect(),pane=el.closest('.git-navigator')!.getBoundingClientRect();
  const toggle=el.closest('.git-navigator')!.querySelector('.git-navigator-toggle')!.getBoundingClientRect();
  return {top:row.top,bottom:row.bottom,min:toggle.bottom,max:pane.bottom};
 });
 assert.ok(bounds.top>=bounds.min&&bounds.bottom<=bounds.max,JSON.stringify(bounds));
 assert.equal(await selectedFile(),`unstaged:${revealPath}`);
 assert.equal(await mobileNavigator.evaluate(el=>el===document.activeElement),true,'reveal retains keyboard focus');
 assert.deepEqual(await page.evaluate(()=>({page:window.scrollY,doc:document.querySelector('.diff-viewport')!.scrollTop})),beforeReveal);
 await page.screenshot({path:join(artifacts,'mobile-reveal.png')});
 // Browsing must remain free after the one-time reveal.
 await selectedReveal.locator('xpath=ancestor::details').last().locator(':scope > summary').click();
 await page.waitForTimeout(100);assert.equal(await selectedReveal.isVisible(),false);
 await mobileNavigator.click();await mobileNavigator.click();
 await wait(async()=>await selectedReveal.isVisible(),'second reopen expands selection');
 await mobileNavigator.click();
 const revealHeader=page.locator('.git-document-header button');
 await revealHeader.focus();await page.keyboard.press('Enter');
 await page.getByRole('heading',{name:'Working reveal',exact:true}).waitFor();
 await page.locator('.diff-viewport').evaluate(el=>{el.scrollTop=90;});
 await mobileNavigator.click();
 assert.equal(await page.locator('.diff-viewport').evaluate(el=>el.scrollTop),90,'reveal preserves Markdown reading position');
 await mobileNavigator.click();
 await page.getByRole('button',{name:'Return to diff',exact:true}).click();await page.getByRole('table').waitFor();
 assert.equal(await page.locator('.diff-viewport').evaluate(el=>el.scrollTop),beforeReveal.doc,'separate diff reading position restored');
 await page.setViewportSize({width:1440,height:1000});
 await selectedReveal.locator('xpath=ancestor::details').last().locator(':scope > summary').click();
 await tab('Activity').click();await tab('Review').click();
 await wait(async()=>await selectedReveal.isVisible(),'desktop reveal after tab reopen');
 const desktopReveal=await selectedReveal.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('.git-navigator')!.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;});
 assert.equal(desktopReveal,true,'desktop selected row in navigator viewport');
 await page.screenshot({path:join(artifacts,'desktop-reveal.png')});
 await page.setViewportSize({width:390,height:844});



 await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('button',{name:'Close sessions',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
 const nextTab=await tab('Review').evaluate(el=>{const tabs=[...el.closest('[role=tablist]')!.querySelectorAll('[role=tab]')];return tabs[(tabs.indexOf(el)+1)%tabs.length]!.textContent!.trim();});
 await tab('Review').press('ArrowRight');await wait(async()=>await tab(nextTab).getAttribute('aria-selected')==='true','keyboard tab switch');
 await tab('Review').click(); await page.setViewportSize({width:1440,height:1000});await layout('Both').click();
 assert.equal(await composer.inputValue(),'Draft survives workspace layout');
 assert.equal(await tab('Review').getAttribute('aria-selected'),'true');
 const before=claude.turns[0]!.input.taskId;claude.turns[0]!.say('Still running while hidden');await layout('Workspace').click();
 await page.waitForTimeout(100);assert.equal(claude.turns[0]!.input.taskId,before);
 // Delayed responses from a previous selection must not replace the selected document.
 let release:(()=>void)|undefined;await page.route('**/git/diff?**',async route=>{
  if(new URL(route.request().url()).searchParams.get('path')==='new file.txt')await new Promise<void>(resolve=>{release=resolve;});
  await route.continue().catch(()=>{});
 });
 await selectFile('untracked:new file.txt');await wait(()=>!!release,'delayed request');await selectFile('staged:sample.txt');release!();
 await page.getByRole('table').waitFor();assert.equal(await selectedFile(),'staged:sample.txt');assert.equal(await page.locator('.diff-code').filter({hasText:'window.injected'}).count(),0);
 await page.unroute('**/git/diff?**');
 release=undefined;await page.route('**/git/content?**',async route=>{await new Promise<void>(resolve=>{release=resolve;});await route.continue().catch(()=>{});});
 await page.locator('.git-file-tree').getByRole('button',{name:'Preview Markdown: staged: guide.md',exact:true}).click();await wait(()=>!!release,'delayed preview request');
 await selectFile('staged:sample.txt');release!();await page.getByRole('table').waitFor();await page.waitForTimeout(200);
 assert.equal(await selectedFile(),'staged:sample.txt');assert.equal(await page.getByRole('heading',{name:'Staged guide',exact:true}).count(),0,'stale preview cannot replace selected diff');
 await page.unroute('**/git/content?**');
 let gitRequests=0;page.on('request',request=>{if(request.url().includes('/git'))gitRequests++;});await tab('Activity').click();await page.waitForTimeout(1200);assert.equal(gitRequests,0,'hidden tab never polls Git');
 await layout('Chat').click();
 const delegated=await manager.callTaskTool({sessionId:session,taskId:'lead',memberId:'lead',runnerId:'claude'} as never,'deck_delegate',{agent:'investigate',task:'Continue while workspace is hidden'});
 assert.equal(delegated.ok,true);const childId=(delegated as any).data.taskId;await wait(()=>claude.turns.some(turn=>turn.input.taskId===childId),'hidden child start');
 const child=claude.turns.find(turn=>turn.input.taskId===childId)!;child.say('Completed while hidden');child.finish();await wait(()=>child.closed,'hidden child completion');
 assert.equal(await layout('Chat').getAttribute('aria-pressed'),'true');await layout('Workspace').click();
 const secondProject=(await command({type:'project.register',path:projectTwo,name:'Other project'})).project.projectId;
 const second=(await command({type:'session.create',projectId:secondProject,title:'Other session'})).sessionId;
 await page.reload();const otherProjectToggle=page.getByRole('button',{name:/^Sessions in Other project/});await otherProjectToggle.waitFor();if(await otherProjectToggle.getAttribute('aria-expanded')==='false')await otherProjectToggle.click();await page.getByRole('button',{name:'Other session',exact:true}).first().click();await tab('Review').click();
 await page.getByText('Git changes are unavailable. Open a session at a Git worktree root.').waitFor();
 assert.equal(await page.getByRole('table').count(),0,'session change never displays prior project content');
 await page.screenshot({path:join(artifacts,'unavailable-repository.png')});
 execFileSync('git',['init','-q'],{cwd:projectTwo});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('No working changes.').waitFor();
 await page.screenshot({path:join(artifacts,'no-changes.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,artifacts,checks:'Header SVG diff/Markdown round trips; reveal on reopen with collapsed ancestors, duplicate section paths and unusual filename; long mobile tree; keyboard focus; unchanged page and nonzero diff/Markdown scroll; no continuous reveal; desktop tab reopen; Both file/folder collision directions; Tab/Enter/Space terminal/child selection and Markdown preview; Review tab order; full index/working Markdown; safe markup; preview keyboard and return; stale preview cancellation; folder keyboard disclosure; nested paths; rename/delete/new colors; duplicate staged/unstaged paths; unavailable directory; expansion persistence; mobile focus; dark/light; both render modes; numbered hunks; refresh selection/scroll; header modes; four workspace tabs; desktop/mobile; keyboard; inert/long/large content; draft; stale responses; no hidden polling; hidden lead/subagent execution; migration; empty/error states'}));
} catch(error) {console.error(await page.locator('.git-view').innerText().catch(()=>''));await page.screenshot({path:join(artifacts,'failure.png')});throw error;} finally {await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
