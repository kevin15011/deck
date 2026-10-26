/** Hydrated GD-019 regression with deterministic paginated transport. */
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const temp=mkdtempSync(join(import.meta.dir,'.reveal-'));
const artifacts=process.env.DECK_REVEAL_ARTIFACTS??join(homedir(),'.cache/deck-git-acceptance/gd019');
mkdirSync(artifacts,{recursive:true});
writeFileSync(join(temp,'entry.tsx'),`
import React from '${import.meta.dir}/node_modules/react';
import {createRoot} from '${import.meta.dir}/node_modules/react-dom/client';
import {ProjectFiles} from '${import.meta.dir}/src/project-files';
window.fixture={mode:'normal',calls:[],aborted:0};
const file=path=>({name:path.split('/').pop(),path,kind:'file'});
const directory=path=>({...file(path),kind:'directory'});
const api=async(path,options)=>{
 const u=new URL(path,location.origin),p=u.searchParams.get('path')||'',cursor=u.searchParams.get('cursor');
 if(u.pathname.endsWith('/git'))return {data:{files:[]}};
 if(u.pathname.endsWith('/content'))return {data:{kind:'text',path:p,size:1000,content:'reading\\n'.repeat(500)}};
 window.fixture.calls.push([p,cursor]);
 if(cursor&&window.fixture.mode==='delay')await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>{window.fixture.aborted++;reject(new Error('aborted'));},{once:true});});
 if(cursor&&window.fixture.mode==='failure')throw new Error('Folder changed');
 const entries=p===''?(cursor?[directory('z-nested')]:[directory('pages')]):p==='pages'?(cursor?(['absent','repeat','budget'].includes(window.fixture.mode)?[]:[file('pages/1000')]):Array.from({length:40},(_,i)=>file('pages/'+String(i).padStart(4,'0')))):p==='z-nested'?[file('z-nested/read.md')]:[];
 return {data:{path:p,entries,truncated:!cursor&&p!=='z-nested',nextCursor:!cursor&&p!=='z-nested'?'next':window.fixture.mode==='budget'?String(Number(cursor)||0)+ '1':window.fixture.mode==='repeat'?'next':undefined}};
};
function App(){const [session,setSession]=React.useState('s'),[visible,setVisible]=React.useState(true);window.fixture.setSession=setSession;window.fixture.setVisible=setVisible;return <ProjectFiles api={api} sessionId={session} visible={visible} narrow={!location.search.includes('desktop')}/>;}
createRoot(document.getElementById('root')).render(<App/>);
`);
const build=await Bun.build({entrypoints:[join(temp,'entry.tsx')],target:'browser'});
if(!build.success)throw new Error(String(build.logs));
const js=await build.outputs[0].text(),css=await Bun.file(join(import.meta.dir,'src/style.css')).text();
const server=Bun.serve({port:0,fetch(req){const path=new URL(req.url).pathname;return new Response(path==='/app.js'?js:path==='/style.css'?css:'<link rel="stylesheet" href="/style.css"><style>.diff-viewport{height:280px!important;overflow:auto}.git-navigator{max-height:300px;overflow:auto}</style><div id="root" style="height:700px"></div><script type="module" src="/app.js"></script>',{headers:{'Content-Type':path==='/app.js'?'text/javascript':path==='/style.css'?'text/css':'text/html'}});}});
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'.cache/ms-playwright/chromium-1237/chrome-linux64/chrome'),headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
page.setDefaultTimeout(5000);
const toggle=()=>page.locator('.git-navigator-toggle');
const row=(path:string)=>page.locator(`[data-project-path="${path}"]`);
const more=(path:string)=>page.getByRole('button',{name:`Load more in ${path}`,exact:true});
try{
 await page.goto(server.url.href);await toggle().click();
 await page.locator('summary').filter({hasText:'pages'}).click();await more('pages').click();
 await expect(row('pages/1000')).toBeFocused();await page.keyboard.press('Enter');
 await expect(page.locator('.project-text')).toContainText('reading');
 await page.locator('.diff-viewport').evaluate(el=>{el.scrollTop=120;});
 const scroll=await page.evaluate(()=>({outer:scrollY,document:document.querySelector('.diff-viewport')!.scrollTop}));
 expect(scroll.document).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
 await expect(row('pages/1000')).toBeVisible();await expect(toggle()).toBeFocused();
 expect(await page.evaluate(()=>({outer:scrollY,document:document.querySelector('.diff-viewport')!.scrollTop}))).toEqual(scroll);
 await page.screenshot({path:join(artifacts,'refresh-reveal.png')});
 // A failed continuation can be retried locally and reveal the same selection.
 await toggle().click();await page.evaluate(()=>{(window as any).fixture.mode='failure';});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
 await page.getByRole('button',{name:'Reload pages',exact:true}).waitFor();
 await page.evaluate(()=>{(window as any).fixture.mode='normal';});
 await page.getByRole('button',{name:'Reload pages',exact:true}).click();await expect(row('pages/1000')).toBeVisible();
 // Selected ancestor itself occurs on a continuation page of the root.
 await more('project root').click();await page.locator('summary').filter({hasText:'z-nested'}).click();
 await row('z-nested/read.md').click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
 await expect(row('z-nested/read.md')).toBeVisible();await expect(toggle()).toBeFocused();
 // Hiding aborts a pending automatic continuation; reopening starts a fresh attempt.
 await toggle().click();await page.evaluate(()=>{(window as any).fixture.mode='delay';(window as any).fixture.calls=[];});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls.some((c:any)=>c[1]))).toBe(true);
 await toggle().click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.aborted)).toBeGreaterThan(0);
 await page.evaluate(()=>{(window as any).fixture.mode='normal';});await toggle().click();await expect(row('z-nested/read.md')).toBeVisible();
 // Absent target and repeated cursor both terminate instead of requesting forever.
 if(!await page.locator('details').filter({has:page.locator('summary').filter({hasText:'pages'})}).getAttribute('open').then(v=>v!==null))await page.locator('summary').filter({hasText:'pages'}).click();await more('pages').click();await row('pages/1000').click();
 for(const mode of ['absent','repeat','budget']){
  await page.evaluate(mode=>{(window as any).fixture.mode=mode;(window as any).fixture.calls=[];},mode);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
  await expect(page.getByRole('status').filter({hasText:/Selected file|Automatic reveal/})).toBeVisible();
  const count=await page.evaluate(()=>(window as any).fixture.calls.length);expect(count).toBeLessThanOrEqual(mode==='budget'?66:5);await page.waitForTimeout(150);expect(await page.evaluate(()=>(window as any).fixture.calls.length)).toBe(count);
  await toggle().click();
 }
 // Session change cancels an admitted reveal and clears the old selection.
 await page.evaluate(()=>{(window as any).fixture.mode='delay';(window as any).fixture.calls=[];});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await toggle().click();
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls.some((c:any)=>c[1]))).toBe(true);
 const aborted=await page.evaluate(()=>(window as any).fixture.aborted);
 await page.evaluate(()=>{(window as any).fixture.setSession('other');});
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.aborted)).toBeGreaterThan(aborted);
 await expect(page.locator('.git-document-header')).toHaveCount(0);
 console.log('mobile passed');
 await page.setViewportSize({width:1440,height:1000});await page.goto(server.url.href+'?desktop');
 await page.locator('summary').filter({hasText:'pages'}).click();await more('pages').click();await row('pages/1000').click();
 await page.locator('.diff-viewport').evaluate(el=>{el.scrollTop=120;});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(row('pages/1000')).toBeVisible();
 await expect(page.getByRole('button',{name:'Refresh',exact:true})).toBeFocused();
 expect(await page.locator('.diff-viewport').evaluate(el=>el.scrollTop)).toBe(120);
 console.log('desktop refresh passed');
 // Ordinary browsing may collapse the selected ancestor without a forced reveal.
 await page.locator('summary').filter({hasText:'pages'}).click();await page.waitForTimeout(150);await expect(row('pages/1000')).toHaveCount(0);
 await page.evaluate(()=>{(window as any).fixture.setVisible(false);});await page.waitForTimeout(50);
 await page.evaluate(()=>{(window as any).fixture.setVisible(true);});await expect(row('pages/1000')).toBeVisible();
 await page.screenshot({path:join(artifacts,'desktop-reveal.png')});
 // A different selection cancels automatic paging before it can overwrite the UI.
 await page.evaluate(()=>{(window as any).fixture.mode='delay';(window as any).fixture.calls=[];});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).fixture.calls.some((c:any)=>c[1]))).toBe(true);
 const beforeSelection=await page.evaluate(()=>(window as any).fixture.aborted);
 await row('pages/0000').click();await expect.poll(()=>page.evaluate(()=>(window as any).fixture.aborted)).toBeGreaterThan(beforeSelection);
 await expect(row('pages/0000')).toHaveAttribute('aria-current','true');
 console.log('PASS: desktop/mobile, session/selection cancellation, bounded budget, ordinary browsing, refresh, local reload, later-page ancestor, focus/scroll, manual pagination, hide cancellation, absent/repeated cursor');
}catch(error){console.log(await page.evaluate(()=>({fixture:(window as any).fixture,text:document.body.innerText.slice(0,600)})));throw error;}finally{await browser.close();server.stop(true);rmSync(temp,{recursive:true,force:true});}
