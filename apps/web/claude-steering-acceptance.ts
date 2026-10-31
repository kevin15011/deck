import { selectTheme } from './acceptance-theme';
/** Isolated HTTP/WebSocket/browser acceptance with production Claude driver and scripted native effects. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createClaudeSessionDriver} from '../../packages/adapter-claude/src/session-driver/driver';
import {claudeTranscriptPath} from '../../packages/adapter-claude/src/session-driver/steering';
import {harness} from '../../packages/adapter-claude/src/session-driver/test-support';
import type {DriverTaskInput,RunnerSessionDriver} from '../../packages/core/src/session/driver';
import type {CrossRunnerConfig} from '../../packages/core/src/config/deck-config';
import {SessionManager} from '../../packages/session-host/src/session-manager';
import {ApprovalBroker} from '../../packages/session-host/src/approval-broker';
import {CredentialRegistry} from '../../packages/session-host/src/credentials';
import {Supervisor} from '../../packages/session-host/src/supervisor';
import {FakeDriver} from '../../packages/session-host/src/testing/fake-driver';
import {WebService} from '../../packages/session-host/src/web-service';
import {ensureStateLayout,resolveStatePaths} from '../../packages/session-host/src/paths';
import {WEB_ASSETS} from '../cli/src/runtime/web-assets.generated';
const evidence='/tmp/deck-claude-steering-browser';mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/dcg-')),home=join(root,'home'),project=join(home,'project');mkdirSync(project,{recursive:true});
const paths=resolveStatePaths({env:{HOME:home,XDG_STATE_HOME:join(root,'state')},tmpdir:root});ensureStateLayout(paths);
const wait=async(fn:()=>boolean|Promise<boolean>,label:string)=>{for(let i=0;i<200;i++){if(await fn())return;await Bun.sleep(25);}throw Error('Timed out: '+label);};
const h=harness(),inputs:DriverTaskInput[]=[];
const append=(file:string,rows:unknown[])=>{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');};
const original=(n:number)=>JSON.parse(h.children[n]!.stdin[0]!);
const transcript=(n:number)=>claudeTranscriptPath(project,original(n).session_id,{HOME:home})!;
const actual=createClaudeSessionDriver({baseEnv:{HOME:home,PATH:'/bin'},exec:async()=>({code:0,stdout:'2.1.296 (Claude Code)'})});
const driver:RunnerSessionDriver={...actual,startTask:async(input,io)=>{
 const n=inputs.length;inputs.push(input);const handle=await actual.startTask(input,{...io,spawn:h.io.spawn});
 void wait(()=>!!h.children[n]?.stdin.length,'initial native input').then(()=>{const sent=original(n),child=h.children[n]!;
  append(transcript(n),[{type:'user',uuid:sent.uuid,parentUuid:null,sessionId:sent.session_id,version:'2.1.296',message:sent.message}]);
  child.stdout(JSON.stringify({type:'system',subtype:'init',session_id:sent.session_id,claude_code_version:'2.1.296',mcp_servers:input.mcp.servers.map(name=>({name,status:'connected'})),tools:['Bash']})+'\n');child.stdout(JSON.stringify({...sent,isReplay:true})+'\n');
 });return handle;
}};
const other=new FakeDriver('opencode');other.onStart=turn=>turn.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'haiku'}},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:'2026-10-12T00:00:00Z',web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,d)=>{manager.openLog(id)?.append(d);}}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:id==='opencode'?other:undefined,list:()=>[driver,other]},config:()=>config,sessionMcpCommand:['/not-started/deck'],homeDir:home,steeringTimeoutMs:500});
const host=new WebService({paths,assets:WEB_ASSETS,config:config.web,service:manager});host.enable();
const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);const errors:string[]=[],checks:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const command=async(body:any,sessionId?:string)=>{const r=await manager.execute({sessionId,clientId:'claude-browser-fixture',command:{v:1,commandId:randomUUID(),...body}});assert.equal(r.ok,true,JSON.stringify(r));return (r as any).data;};
const fold=(n:number,index:number)=>{
 const c=h.children[n]!,sent=original(n),wire=JSON.parse(c.stdin[index]!),tool=randomUUID(),result=randomUUID(),attachment=randomUUID(),delivery=randomUUID(),toolId='fixture-'+randomUUID(),base={sessionId:sent.session_id,version:'2.1.296',isSidechain:false};
 append(transcript(n),[
  {...base,type:'assistant',uuid:tool,parentUuid:sent.uuid,message:{role:'assistant',stop_reason:'tool_use',content:[{type:'tool_use',id:toolId,name:'Bash',input:{command:'/bin/sleep 1'}}]}},
  {...base,type:'user',uuid:result,parentUuid:tool,sourceToolAssistantUUID:tool,toolUseResult:{interrupted:false},message:{role:'user',content:[{type:'tool_result',tool_use_id:toolId,content:'',is_error:false}]}},
  {...base,type:'attachment',uuid:attachment,parentUuid:result,attachment:{type:'queued_command',source_uuid:wire.uuid,delivery_id:delivery,prompt:wire.message.content,commandMode:'prompt',origin:{kind:'human'},humanTurn:true}},
  {sessionId:sent.session_id,type:'queue-operation',operation:'remove',reason:'absorbed_mid_turn',commandUuid:wire.uuid,deliveryId:delivery,content:wire.message.content},
 ]);c.stdout(JSON.stringify({...wire,isReplay:true})+'\n');
};
const result=(n:number)=>{const sent=original(n);h.children[n]!.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:sent.session_id,user_message_uuid:sent.uuid,user_message_uuids:[sent.uuid],num_turns:1})+'\n');};
try{
 const registered=await command({type:'project.register',path:project,name:'Claude guarded workspace'});
 const id=(await command({type:'session.create',projectId:registered.project.projectId,title:'Claude conversation'})).sessionId;
 await command({type:'session.create',projectId:registered.project.projectId,title:'OpenCode conversation',members:{lead:{runnerId:'opencode',modelId:'fixture'}}});
 const select=async(name:string)=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));if(await page.getByRole('button',{name:'Open sessions',exact:true}).isVisible())await page.getByRole('button',{name:'Open sessions',exact:true}).click();else if(await page.getByRole('button',{name:'Expand sidebar',exact:true}).isVisible())await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();const mobile=await page.getByRole('navigation',{name:'Mobile sessions',exact:true}).isVisible();await page.getByRole('navigation',{name:mobile?'Mobile sessions':'Sessions',exact:true}).getByRole('button',{name,exact:true}).click();await wait(async()=>await page.locator('.app-header h1').innerText()===name,'session selection');};
 const input=page.getByLabel('Message the lead'),action=page.getByRole('button',{name:'Send to current turn',exact:true}),delivery=page.getByRole('region',{name:'Current-turn delivery',exact:true});
 await page.goto(host.status().url!);await select('Claude conversation');await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();
 await input.fill('Original genuine instruction');await input.press('Enter');await action.waitFor();assert.equal(await action.getAttribute('title'),'Send text to the running Claude Code execution');
 await input.fill('Ordinary queued input');await input.press('Enter');await page.getByRole('button',{name:'Remove queued message 1',exact:true}).waitFor();assert.equal(h.children[0]!.stdin.length,1);assert.equal(await action.count(),0);await page.getByRole('button',{name:'Remove queued message 1',exact:true}).click();await action.waitFor();checks.push('ordinary-enter-remains-FIFO');
 await input.fill('Confirmed current input');await action.focus();await page.keyboard.press('Enter');await wait(()=>h.children[0]!.stdin.length===2,'steering write');await delivery.getByText('Sending to Claude Code…',{exact:true}).waitFor();
 await wait(async()=>await input.evaluate(el=>el===document.activeElement),'focus recovery');assert.equal(JSON.parse(h.children[0]!.stdin[1]!).shouldQuery,false);fold(0,1);
 await delivery.getByText('Accepted by Claude Code',{exact:true}).waitFor();assert.equal(h.children.length,1);assert.equal(h.children[0]!.interrupts,0);checks.push('keyboard-sending-positive-fold-no-extra-execution');
 await action.waitFor();await input.fill('Text retained without current confirmation');await action.click();await wait(()=>h.children[0]!.stdin.length===3,'uncertain write');
 result(0);const unknown=JSON.parse(h.children[0]!.stdin[2]!);append(transcript(0),[{type:'user',uuid:unknown.uuid,parentUuid:original(0).uuid,sessionId:original(0).session_id,version:'2.1.296',queueTranscriptOnly:true,message:unknown.message}]);
 h.children[0]!.stdout(JSON.stringify({type:'result',subtype:'success',is_error:false,session_id:original(0).session_id,user_message_uuid:unknown.uuid,user_message_uuids:[unknown.uuid],num_turns:0})+'\n');
 await delivery.getByText(/not confirmed delivery to the selected execution/).waitFor();assert.equal(await delivery.getByRole('button').count(),0);assert.equal(await action.count(),0);assert.equal(h.children.length,1);
 await input.fill('Draft after uncertain delivery');await select('OpenCode conversation');assert.equal(await delivery.count(),0);await page.locator('.composer-gate').getByRole('button',{name:'Prepare session',exact:true}).click();await input.fill('Other draft kept');assert.equal(await action.count(),0);
 await select('Claude conversation');assert.equal(await input.inputValue(),'Draft after uncertain delivery');await delivery.getByText(/may remain in later context/).waitFor();checks.push('transcript-only-warning-no-current-acceptance-no-resend-session-isolation');
 const bounds=async()=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1),false,'no outer overflow');assert.equal(await page.locator('.composer').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight+1),true);};
 for(const theme of ['dark','light','cyberpunk']){await selectTheme(page,theme);await bounds();await page.screenshot({path:join(evidence,`desktop-${theme}.png`),fullPage:true});}
 await page.setViewportSize({width:390,height:844});await bounds();await page.screenshot({path:join(evidence,'mobile-390-cyberpunk.png'),fullPage:true});await page.setViewportSize({width:320,height:740});await bounds();await page.screenshot({path:join(evidence,'mobile-320-cyberpunk.png'),fullPage:true});checks.push('desktop-mobile-320-390-light-dark-cyberpunk-reduced-motion');
 await input.fill('');await page.reload();await select('Claude conversation');await delivery.getByText(/may remain in later context/).waitFor();assert.equal(h.children[0]!.stdin.length,3);checks.push('reload-restores-retention-warning-without-resend');
 await page.setViewportSize({width:1440,height:1000});await select('OpenCode conversation');await input.fill('Other draft after reload');await select('Claude conversation');await input.fill('New genuine instruction');await input.press('Enter');h.children[0]!.exit();await wait(()=>h.children.length===2,'new genuine turn');await action.waitFor();assert.equal(JSON.parse(h.children[1]!.stdin[0]!).message.content,'New genuine instruction');
 await input.fill('Accepted while viewing another session');await action.click();await wait(()=>h.children[1]!.stdin.length===2,'switching write');await input.fill('Claude draft kept');await select('OpenCode conversation');fold(1,1);assert.equal(await input.inputValue(),'Other draft after reload');assert.equal(await delivery.count(),0);await select('Claude conversation');assert.equal(await input.inputValue(),'Claude draft kept');await delivery.getByText('Accepted by Claude Code',{exact:true}).first().waitFor();checks.push('pending-proof-switching-drafts-and-runner-attribution');
 await action.waitFor();await input.fill('Confirmed after original execution finished');await action.click();await wait(()=>h.children[1]!.stdin.length===3,'late write');result(1);fold(1,2);
 await delivery.getByText('Confirmed for the original Claude Code execution.',{exact:true}).waitFor();await page.getByRole('region',{name:'Conversation',exact:true}).getByText('Accepted by Claude Code for its original turn.',{exact:true}).waitFor();assert.equal(await delivery.getByText(/Accepted by Codex/).count(),0);assert.equal(h.children.length,2);checks.push('end-before-proof-historical-only-no-Codex-attribution');
 h.children[1]!.exit();assert.deepEqual(errors,[]);writeFileSync(join(evidence,'browser.json'),JSON.stringify({ok:true,checks,native:'production Claude adapter, scripted supervised transport; no provider inference'},null,2));console.log(JSON.stringify({ok:true,checks,evidence}));
}catch(error){writeFileSync(join(evidence,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(evidence,'failure.png'),fullPage:true});throw error;}
finally{await browser.close();await host.close();config.enabled=false;for(const c of h.children)c.exit();for(const t of other.turns)t.finish();await manager.close();rmSync(root,{recursive:true,force:true});}
