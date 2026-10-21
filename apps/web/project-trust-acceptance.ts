/** Isolated real-browser project consent acceptance. No native/provider turns. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium} from '@playwright/test';
import {buildWebAssets} from '../../scripts/generate-web-assets';
import {SessionManager} from '../../packages/session-host/src/session-manager';
import {ApprovalBroker} from '../../packages/session-host/src/approval-broker';
import {CredentialRegistry} from '../../packages/session-host/src/credentials';
import {Supervisor} from '../../packages/session-host/src/supervisor';
import {FakeDriver} from '../../packages/session-host/src/testing/fake-driver';
import {WebService} from '../../packages/session-host/src/web-service';
import {ensureStateLayout,resolveStatePaths} from '../../packages/session-host/src/paths';
import type {CrossRunnerConfig} from '../../packages/core/src/config/deck-config';
import type {SessionCommandBody} from '../../packages/core/src/session/commands';
const evidence=resolve(process.env.DECK_TRUST_EVIDENCE??'/tmp/deck-project-trust-browser');mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/deck-project-trust-ui-')),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});symlinkSync(project,join(home,'alias'));
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);const driver=new FakeDriver('opencode');driver.autoComplete=true;const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;const modelTrust:boolean[]=[];
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'opencode',modelId:'fixture/model'}},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='opencode'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home,modelCatalog:async(_root,trusted)=>{modelTrust.push(trusted===true);return{runners:[{runnerId:'opencode',label:'OpenCode',available:true,models:[{modelId:'fixture/model',label:'Fixture',thinkingLevels:[]}]}]};}});
const host=new WebService({paths,assets:await buildWebAssets(),config:config.web,service:manager});host.enable();const base=host.status().url!;
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME,headless:true});const command=async(body:SessionCommandBody,sessionId?:string)=>{const r=await manager.execute({sessionId,clientId:'isolated-browser-test',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(r.ok,true);return(r as any).data;};
const results:any[]=[];
try{
 const projectId=(await command({type:'project.register',path:join(home,'alias')})).project.projectId;assert.equal((await command({type:'project.register',path:project})).project.projectId,projectId);const sessionId=(await command({type:'session.create',projectId})).sessionId;
 const trust=async()=> (await manager.query('project.trust',{projectId}) as any).data;assert.equal((await trust()).trusted,false);
 for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors:string[]=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/?session='+sessionId);await page.getByRole('button',{name:'Assignments',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Trust project',exact:true}).waitFor();assert.equal((await trust()).trusted,false);assert.equal(modelTrust.at(-1),false);
  const reviewedRevision=(await trust()).revision,uiTrustRequests:any[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url()===base+'/api/commands'){const command=request.postDataJSON()?.command;if(command?.type==='project.trust')uiTrustRequests.push(command);}});
  // A second authenticated settings client changes trust while this dialog is stale.
  for(const [trusted,expectedRevision] of [[true,reviewedRevision],[false,reviewedRevision+1]] as const){const response=await context.request.post(base+'/api/commands',{headers:{Origin:base},data:{command:{v:1,commandId:randomUUID(),type:'project.trust',projectId,runnerId:'opencode',trusted,expectedRevision}}});assert.equal((await response.json()).ok,true);}
  await dialog.getByRole('button',{name:'Trust project',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'Project trust changed. Review the current state and choose again.'}).waitFor();
  assert.equal(uiTrustRequests.length,1);assert.equal(uiTrustRequests[0].expectedRevision,reviewedRevision);assert.equal((await trust()).trusted,false);assert.equal((await trust()).revision,reviewedRevision+2);await page.screenshot({path:join(evidence,`conflict-${width}.png`)});
  await dialog.getByRole('button',{name:'Trust project',exact:true}).click();await dialog.getByRole('button',{name:'Revoke project trust',exact:true}).waitFor();assert.equal(uiTrustRequests.length,2);assert.equal(uiTrustRequests[1].expectedRevision,reviewedRevision+2);assert.equal((await trust()).trusted,true);assert.equal(modelTrust.at(-1),true);await page.screenshot({path:join(evidence,`trusted-${width}.png`)});
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Assignments',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Revoke project trust',exact:true}).waitFor();assert.equal((await trust()).trusted,true);
  await page.getByRole('dialog').getByRole('button',{name:'Revoke project trust',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Trust project',exact:true}).waitFor();assert.equal((await trust()).trusted,false);assert.equal(modelTrust.at(-1),false);await page.screenshot({path:join(evidence,`revoked-${width}.png`)});
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);results.push({width,grantReloadRevoke:true,staleConflictRequiresFreshClick:true,uiTrustRevisions:uiTrustRequests.map(c=>c.expectedRevision),noPageErrors:true,noHorizontalOverflow:true});await context.close();
 }
 const commandBody={command:{v:1,commandId:randomUUID(),type:'project.trust',projectId,runnerId:'opencode',trusted:true,expectedRevision:(await trust()).revision}};
 assert.equal((await fetch(base+'/api/commands',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(commandBody)})).status,401);
 const context=await browser.newContext(),page=await context.newPage();await page.goto(base+'/?session='+sessionId);await page.getByRole('button',{name:'Assignments',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Trust project',exact:true}).waitFor();assert.equal((await context.request.post(base+'/api/commands',{headers:{Origin:'http://evil.example'},data:commandBody})).status(),403);
 const {expectedRevision:_revision,...legacyCommand}=commandBody.command;const legacyResponse=await context.request.post(base+'/api/commands',{headers:{Origin:base},data:{command:legacyCommand}});assert.equal(legacyResponse.status(),400);assert.equal((await legacyResponse.json()).code,'command-invalid');assert.equal((await trust()).trusted,false);
 for(const device of host.devices())host.revoke(device.id);
 assert.equal((await context.request.post(base+'/api/commands',{headers:{Origin:base},data:commandBody})).status(),401);assert.equal((await trust()).trusted,false);await context.close();
 writeFileSync(join(evidence,'results.json'),JSON.stringify({results,unauthenticated:401,crossOrigin:403,revokedDevice:401,legacyRevisionlessClient:400,folderSelectionDoesNotTrust:true,canonicalAlias:true,modelTrust,sourceAssetsBuiltInMemory:true},null,2)+'\n');console.log('Browser trust acceptance: 2 viewports; explicit grant/reload/revoke, alias and authentication boundaries pass.');
}finally{await browser.close();await host.close();await manager.close();rmSync(root,{recursive:true,force:true});}
