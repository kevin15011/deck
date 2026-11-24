import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

const root=join(import.meta.dir,'..');
const fixture=await mkdtemp(join(tmpdir(),'deck-permissions-'));
const path=join(fixture,'browser.js');
const source=(path:string)=>JSON.stringify(join(root,path));
const continuation='\\'+'\n';
const leadCommandTail=JSON.stringify('\nclientSecret=FIXTURE_SENTINEL\nfixture --clientSecret FIXTURE_PUBLIC_SENTINEL\n'
  +'fixture --clientSecret '+continuation+'   FIXTURE_CONTINUED_SENTINEL\n'
  +'fixture --clientSecret'+continuation+'   "FIXTURE_QUOTED_SENTINEL two words"\necho next line').slice(1,-1);
let browser;
try{
 const host=Bun.spawnSync(['cargo','test','--locked','-p','deck2','--lib',
  'persistence_tests::codex_command_projection_withholds_continued_credentials','--','--exact','--nocapture'],
  {cwd:root,stderr:'inherit'});
 const hostOutput=host.stdout.toString();
 const projection=hostOutput.split('\n').find(line=>line.startsWith('CODEX_DOCK_PROJECTION='));
 assert(projection,hostOutput);
 const codexPresentation=JSON.parse(projection.slice('CODEX_DOCK_PROJECTION='.length));
 await writeFile(path,`
import React,{useRef,useState} from ${source('node_modules/react/index.js')};
import {createRoot} from ${source('node_modules/react-dom/client.js')};
import {pendingPermissionRows,PermissionDock} from ${source('frontend/src/permission-dock.tsx')};
import {SidebarAttention} from ${source('frontend/src/sidebar-attention.tsx')};
const h=React.createElement;
window.dockErrors=[];
const permission=(id,session,task)=>({
 id,session,task,command:'root-'+session,attempt:'attempt',generation:'gen',thread:'thread',turn:'turn',
 item:id,request:id,revision:1,state:'pending',file:null,questions:[],resolution:null,
 dispatch_ms:null,delivered_ms:null,grant_consumed:false,detail:'',
 presentation:{version:1,kind:'bash',validated:true,responses:['allow_once','deny'],
  details:{tool:'Bash',command:'"echo '+id+'"'+'a'.repeat(5000)+' END'+(id==='lead'?${JSON.stringify(leadCommandTail)}:'')}}
});
const initial=[permission('lead','current'),permission('worker','current','task'),permission('other','other')];
initial[1].presentation=${JSON.stringify(codexPresentation)};
const tasks=[{id:'task',session:'current',owner:'apply-deep'}];
function App(){
 const [decisions,setDecisions]=useState(initial);
 window.resolvePermission=id=>setDecisions(rows=>rows.map(row=>row.id===id?{...row,state:'responded',revision:2}:row));
 window.fixtureDecisions=initial;
 const composer=useRef(null);
 const receipts=['current','other'].map(session=>({id:'root-'+session,session,decisions:decisions.filter(d=>d.session===session)}));
 const rows=pendingPermissionRows('current',receipts,tasks);
 const other=decisions.filter(d=>d.session==='other'&&d.state==='pending');
 return h(React.Fragment,null,
  h('main',{className:'chat-pane slice-panes',style:{height:640,width:700}},
   h('section',{className:'conversation','aria-label':'Recorded messages'},h('div',{style:{height:3000}},'A long transcript')),
   // Mirrors app.tsx: the dock is a sibling of the clipping composer dock.
   h(PermissionDock,{rows,composer,connected:true,storageScope:'fixture',onError:message=>{window.dockErrors.push(message);}}),
   h('div',{className:'composer-dock'},
    h('div',{className:'composer-wrap'},h('textarea',{ref:composer,'aria-label':'Composer'})))),
  h(SidebarAttention,{connected:true,onNavigate:()=>{},rows:other.length?[{
    id:'other',title:'Other session',project:'p',projectName:'Project',count:other.length,
    permissions:other,storageScope:'fixture',history:false,
  }]:[]}));
}
createRoot(document.getElementById('root')).render(h(App));
 `);
 const bundle=await Bun.build({entrypoints:[path],target:'browser',define:{'process.env.NODE_ENV':'"production"'}});
 assert(bundle.success,bundle.logs.map(String).join('\n'));
 browser=await chromium.launch({executablePath:process.env.DECK2_CHROMIUM,args:['--no-sandbox']});
 const page=await browser.newPage({reducedMotion:'reduce'});
 const errors:Error[]=[];
 page.on('pageerror',error=>errors.push(error));
 const base='http://localhost:41377';
 await page.route(base+'/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
 let posts=0,failNext=false;
 let deliver=()=>{};
 await page.route(base+'/api/decisions/*/responses',async route=>{
  const released=new Promise<void>(resolve=>{deliver=resolve;});
  posts++;
  const id=new URL(route.request().url()).pathname.split('/')[3];
  const decision=await page.evaluate(id=>(window as any).fixtureDecisions.find((d:any)=>d.id===id),id);
  await released;
  if(failNext){failNext=false;await route.fulfill({status:500,json:{error:'fixture rejection'}});return;}
  await route.fulfill({json:{...decision,state:'responded',revision:2,resolution:route.request().postDataJSON()}});
 });
 await page.goto(base+'/');
 // Same stylesheets, in the same order, as app.tsx.
 for(const sheet of ['font-faces','style','themes','slice','calm-workspace'])
  await page.addStyleTag({path:join(root,`frontend/src/${sheet}.css`)});
 await page.addScriptTag({content:await bundle.outputs[0]!.text()});
 const dock=page.getByRole('region',{name:'Pending permissions'});
 const lead=dock.getByRole('button',{name:/Bash · Lead/});
 const worker=dock.getByRole('button',{name:/Command · apply-deep/});
 await lead.waitFor();
 await worker.waitFor();
 assert.equal(await dock.getByRole('button',{name:/other/}).count(),0);
 const transcript=page.getByRole('region',{name:'Recorded messages'});
 const before=await dock.boundingBox();
 await transcript.evaluate(e=>{e.scrollTop=e.scrollHeight;});
 assert((await transcript.evaluate(e=>e.scrollTop))>0);
 await transcript.evaluate(e=>{e.scrollTop=0;});
 assert.deepEqual(await dock.boundingBox(),before,'permission dock stays anchored while the transcript scrolls');
 // A hit test catches clipping and covering that boundingBox/visibility checks miss.
 const hit=async(locator:typeof lead)=>locator.evaluate(node=>{
  const box=node.getBoundingClientRect();
  return node.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2));
 });
 assert(await hit(lead),'Lead request receives pointer input at its visible position');
 assert(await hit(worker),'member request receives pointer input at its visible position');
 await lead.click();
 const leadCard=dock.getByRole('region',{name:'Lead Bash permission'});
 const command = leadCard.locator('.permission-action pre').filter({hasText:'echo next line'});
 await command.waitFor();
 assert((await command.textContent())?.includes(' END\\nclientSecret='), 'full multiline command remains visible');
 assert(!(await leadCard.innerHTML()).includes('FIXTURE_SENTINEL'), 'dock HTML withholds credential values');
 assert(!(await leadCard.innerHTML()).includes('FIXTURE_PUBLIC_SENTINEL'), 'dock HTML withholds separate credential arguments');
 assert(!(await leadCard.innerHTML()).includes('FIXTURE_CONTINUED_SENTINEL'), 'dock HTML withholds credential arguments after a line continuation');
 assert(!(await leadCard.innerHTML()).includes('FIXTURE_QUOTED_SENTINEL'), 'dock HTML withholds quoted credential arguments after a line continuation');
 assert((await command.textContent())?.includes('--clientSecret '+JSON.stringify(continuation).slice(1,-1)+'   [redacted]'), 'redaction preserves the displayed line continuation');
 await lead.click();

 const codexCard=dock.getByRole('region',{name:'apply-deep Command permission'});
 const codexSummary=await worker.innerHTML();
 await worker.click();
 const codexDetails=codexCard.locator('.permission-action');
 await codexDetails.waitFor();
 const codexDockHtml=await dock.innerHTML();
 assert(!codexSummary.includes('FIXTURE_QUOTED_SENTINEL')&&!codexDockHtml.includes('FIXTURE_QUOTED_SENTINEL'),
  'Codex dock HTML withholds the continued credential in the excerpt and expanded details');
 await worker.click();
 assert.equal(host.exitCode,0,hostOutput);

 // The dock hides a request as soon as its response is sent and does not wait
 // for the host; a single POST is made even for a double click.
 async function dockSubmit(name:string,region:string,responseCount:number){
  const button=dock.getByRole('region',{name:region}).getByRole('button',{name,exact:true});
  await button.evaluate(button=>{button.focus();button.click();button.click();});
  await dock.getByRole('region',{name:region}).waitFor({state:'detached'});
  for(let i=0;posts<responseCount&&i<100;i++)await Bun.sleep(10);
  assert.equal(posts,responseCount);
  deliver();
 }
 async function submit(button:ReturnType<typeof dock.getByRole>,container:typeof dock,responseCount:number){
  await button.evaluate(button=>{button.focus();button.click();button.click();});
  await container.getByText('Sending response…').waitFor();
  assert(await button.isDisabled());
  for(let i=0;posts<responseCount&&i<100;i++)await Bun.sleep(10);
  assert.equal(posts,responseCount);
  deliver();
  await container.getByText('Response recorded').waitFor();
  assert(await button.isDisabled(),'acknowledged response must stay disabled before the workspace catches up');
 }
 if(process.env.DECK2_DOCK_SCREENSHOT)await dock.screenshot({path:process.env.DECK2_DOCK_SCREENSHOT});
 // Hierarchy invariant: the primary allow is visually distinct from Deny.
 const fill=(name:string)=>dock.getByRole('region',{name:'Lead Bash permission'}).getByRole('button',{name,exact:true}).evaluate(b=>getComputedStyle(b).backgroundColor);
 assert.notEqual(await fill('Allow once'),await fill('Deny'),'primary and tertiary actions share one appearance');
 // A rejected submission returns the request for another decision.
 failNext=true;
 await dockSubmit('Deny','Lead Bash permission',1);
 await dock.getByRole('region',{name:'Lead Bash permission'}).waitFor();
 await page.waitForFunction(()=>(window as any).dockErrors.length===1);
 await dockSubmit('Deny','Lead Bash permission',2);
 await page.waitForFunction(()=>document.activeElement?.textContent?.includes('apply-deep'));
 await page.evaluate(()=>(window as any).resolvePermission('lead'));
 await dockSubmit('Allow once','apply-deep Command permission',3);
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Composer');
 await page.evaluate(()=>(window as any).resolvePermission('worker'));

 await page.getByRole('button',{name:'Review permissions for Other session · Project'}).click();
 const bubble=page.getByRole('region',{name:'Other session'});
 await submit(bubble.getByRole('button',{name:'Deny',exact:true}),bubble,4);
 await page.evaluate(()=>(window as any).resolvePermission('other'));
 await bubble.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log('Permission dock and bubble verified with delayed host decisions.');
}finally{
 await browser?.close();
 await rm(fixture,{recursive:true,force:true});
}
