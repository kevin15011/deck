import {expect} from '@playwright/test';
import {buildWebAssets} from '../../scripts/generate-web-assets';
import {dictationFixture} from '../../packages/session-host/src/dictation/testing';
import {DictationService} from '../../packages/session-host/src/dictation/service';
import {encodeWav16} from './src/dictation/audio-pcm';
/** Opt-in mobile menu visual/interaction acceptance. Local HTTP + fake native effects only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import type {CrossRunnerConfig} from '../../packages/core/src/config/deck-config';
import type {SessionCommandBody} from '../../packages/core/src/session/commands';
import {SessionManager} from '../../packages/session-host/src/session-manager';
import {ApprovalBroker} from '../../packages/session-host/src/approval-broker';
import {CredentialRegistry} from '../../packages/session-host/src/credentials';
import {Supervisor} from '../../packages/session-host/src/supervisor';
import {FakeDriver} from '../../packages/session-host/src/testing/fake-driver';
import {WebService} from '../../packages/session-host/src/web-service';
import {ensureStateLayout,resolveStatePaths} from '../../packages/session-host/src/paths';
import {WEB_ASSETS} from '../cli/src/runtime/web-assets.generated';

const evidence='/private/tmp/deck-dictation-browser';mkdirSync(evidence,{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/deck-menu-')),home=join(root,'home');mkdirSync(home);
const paths=resolveStatePaths({env:{XDG_STATE_HOME:join(root,'state')}});ensureStateLayout(paths);
const driver=new FakeDriver();driver.onStart=turn=>turn.init();
const credentials=new CredentialRegistry({socketPath:paths.socket.path});let manager!:SessionManager;
const config:CrossRunnerConfig={enabled:true,members:{lead:{runnerId:'claude',modelId:'fixture'}},executionBudget:{lead:2,delegated:4},approvals:{claude:'relay',codex:'runner-default',opencode:'relay'},maxConcurrentTasks:4,claudeTosAcknowledgedAt:null,web:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}};
manager=new SessionManager({paths,credentials,broker:new ApprovalBroker({sink:{emit:(id,draft)=>manager.openLog(id)?.append(draft)}}),supervisor:new Supervisor({anchorCommand:['unused']}),drivers:{get:id=>id==='claude'?driver:undefined,list:()=>[driver]},config:()=>config,sessionMcpCommand:['/not-launched/deck'],homeDir:home});
const fixture=dictationFixture(true);fixture.store.download('large-v3-turbo-q5_0');while(fixture.store.active())await new Promise<void>(r=>setImmediate(r));await fixture.store.settings('large-v3-turbo-q5_0','es');
const dictation=new DictationService(fixture.dir,{store:fixture.store,runtimePath:fixture.runtime});
const assets={...await buildWebAssets()};
const host=new WebService({paths,assets,config:config.web,service:manager,dictation});host.enable();
const audio=join(root,'microphone.wav');writeFileSync(audio,encodeWav16(Float32Array.from({length:16000*8},(_,i)=>.2*Math.sin(2*Math.PI*440*i/16000))));

const browser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${audio}`]});
const command=async(body:SessionCommandBody,sessionId?:string)=>{const reply=await manager.execute({sessionId,clientId:'dictation-browser',command:{v:1,commandId:randomUUID(),...body} as never});assert.equal(reply.ok,true,JSON.stringify(reply));return(reply as any).data;};
const errors:string[]=[];
try{
 const projectPath=join(home,'project');mkdirSync(projectPath);const project=(await command({type:'project.register',path:projectPath,name:'Dictation fixture'})).project.projectId;
 const session=(await command({type:'session.create',projectId:project,title:'Dictation acceptance'})).sessionId;
 await command({type:'session.prepare'},session);
 if(!process.env.DECK_DICTATION_LIMIT_ONLY)for(const [width,reduced] of [[1440,false],[390,true],[320,true]] as const){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference',permissions:['microphone'],hasTouch:width<1000});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(host.pair().url);await page.locator('.app-header').waitFor();
  if(width<1000){await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('dialog',{name:'Workspace',exact:true}).getByRole('button',{name:'Dictation acceptance',exact:true}).click();}
  else await page.getByRole('button',{name:'Dictation acceptance',exact:true}).click();
  const input=page.locator('#prompt');await expect(input).toBeEnabled();await input.fill('Keep my draft');
  const openSettings=async()=>{if(width<1000){await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('dialog',{name:'Workspace',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();}else await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.settings-view')).toBeVisible();};
  await openSettings();await expect(page.locator('.settings-view h1')).toBeFocused();
  await page.getByRole('button',{name:'Dictation',exact:true}).click();await expect(page.locator('.settings-model')).toHaveCount(1);await expect(page.getByText('Ready · external whisper-cli')).toBeVisible();await expect(page.getByLabel('Recognition language')).toHaveValue('es');
  await page.screenshot({path:join(evidence,`settings-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await page.goBack();
  if(width<1000){await expect(page.getByRole('button',{name:'Appearance',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to session',exact:true}).click();}
  else await expect(input).toBeVisible();
  await expect(input).toHaveValue('Keep my draft');
  // A real browser capture/worklet/upload/native fixture loop; this is not speech-accuracy proof.
  let sends=0,uploads=0;page.on('request',r=>{if(r.url().endsWith('/api/commands')&&r.postData()?.includes('prompt.send'))sends++;if(r.url().endsWith('/transcriptions'))uploads++;});
  await input.focus();await input.evaluate((node:HTMLTextAreaElement)=>node.setSelectionRange(5,7));
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible().catch(async e=>{console.error('CAPTURE DEBUG',await page.locator('.dictation-control').innerText(),errors);throw e;});await expect(page.locator('.dictation-status')).toBeVisible();await page.screenshot({path:join(evidence,`recording-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.waitForTimeout(900);
  await page.getByRole('button',{name:'Stop dictation',exact:true}).click();await expect(input).toHaveValue('Keep local fixture transcript my draft');assert.equal(sends,0);assert.equal(uploads,1);await expect(page.locator('.dictation-status')).toHaveCount(0);await expect(page.locator('#prompt')).toBeFocused();
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible().catch(async e=>{console.error('CAPTURE DEBUG',await page.locator('.dictation-control').innerText(),errors);throw e;});await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(input).toHaveValue('Keep local fixture transcript my draft');assert.equal(uploads,1);
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(600);
  await input.fill('Concurrent typing stays');await page.getByRole('button',{name:'Stop dictation',exact:true}).click();await expect(input).toHaveValue('Concurrent typing stays local fixture transcript');assert.equal(sends,0);await expect(page.locator('.dictation-status')).toHaveCount(0);
  await page.getByRole('button',{name:'Send prompt',exact:true}).click();await expect(input).toHaveValue('');assert.equal(sends,1);await expect(page.locator('.dictation-status')).toHaveCount(0);await input.fill('Next draft');
  const beforeLate=await input.inputValue();let release!:()=>void,arrived!:()=>void;const held=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>arrived=r);
  await page.route('**/api/dictation/transcriptions',async route=>{arrived();await held;await route.fulfill({json:{ok:true,text:'late text must be discarded'}}).catch(()=>{});});
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(600);await page.getByRole('button',{name:'Stop dictation',exact:true}).click();await seen;
  await page.getByRole('button',{name:'Cancel',exact:true}).click();release();await page.unroute('**/api/dictation/transcriptions');await expect(input).toHaveValue(beforeLate);
  const beforeNavigation=await input.inputValue();
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();
  await openSettings();await page.getByRole('button',{name:'Back to session',exact:true}).click();await expect(page.getByRole('button',{name:'Start dictation',exact:true})).toBeVisible();await expect(input).toHaveValue(beforeNavigation);
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();
  const beforeInterrupt=uploads;await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(page.getByRole('button',{name:'Start dictation',exact:true})).toBeVisible();assert.equal(uploads,beforeInterrupt);await expect(input).toHaveValue(beforeNavigation);
  await openSettings();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByRole('button',{name:'Choose theme',exact:true}).click();const themes=page.getByRole('dialog',{name:'Theme',exact:true});await expect(themes).toBeVisible();await themes.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('radio').first().check();
  if(width<1000)await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'Notifications',exact:true}).click();await page.getByRole('button',{name:'Manage notifications',exact:true}).click();await expect(page.getByRole('dialog',{name:/Notifications/i})).toBeVisible();await page.keyboard.press('Escape');
  if(width<1000)await page.getByRole('button',{name:'Back to settings',exact:true}).click();await page.getByRole('button',{name:'App',exact:true}).click();await page.getByRole('button',{name:'Review restart',exact:true}).click();await expect(page.getByRole('dialog',{name:/Restart Deck/i})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.settings-view')).toBeVisible();
  await page.keyboard.press('Escape');if(width<1000)await page.keyboard.press('Escape');await expect(input).toBeVisible();await expect(page.getByRole('button',{name:width<1000?'Open sessions':'Settings',exact:true})).toBeFocused();
  console.log(`PASS ${width}px settings/back/focus/legacy controls + fake microphone/native fixture, no auto-send`);await context.close();
 }
 // Accelerate the real processor's input, preserving its production bounds and
 // message protocol. This tests retention, not elapsed-time or STT accuracy.
 const productionWorklet=assets['/dictation-worklet.js']!;
 assets['/dictation-worklet.js']={...productionWorklet,body:String(productionWorklet.body).replace('const input=inputs[0]?.[0];',"const original=inputs[0]?.[0];const input=original?Float32Array.from({length:original.length*32},(_,i)=>original[i%original.length]):undefined;")};
 for(const width of [1440,320]){
  const context=await browser.newContext({viewport:{width,height:900},permissions:['microphone'],reducedMotion:width===320?'reduce':'no-preference'});
  await context.addInitScript(()=>{
   const NativeContext=window.AudioContext;
   window.AudioContext=class extends NativeContext{constructor(){super({sampleRate:96000});}};
   const nativeInterval=window.setInterval.bind(window);
   window.setInterval=((fn:TimerHandler,ms?:number,...args:unknown[])=>nativeInterval(fn,ms===1000?25:ms,...args)) as typeof window.setInterval;
   const getMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
   (window as any).dictationTracks=[];
   navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await getMedia(constraints);(window as any).dictationTracks.push(...stream.getTracks());return stream;};
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(host.pair().url);await page.locator('.app-header').waitFor();
  if(width<1000){await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('dialog',{name:'Workspace',exact:true}).getByRole('button',{name:'Dictation acceptance',exact:true}).click();}
  else await page.getByRole('button',{name:'Dictation acceptance',exact:true}).click();
  const input=page.locator('#prompt');await input.fill('Retained draft');let uploads=0,sends=0;
  page.on('request',r=>{if(r.url().endsWith('/transcriptions'))uploads++;if(r.url().endsWith('/api/commands')&&r.postData()?.includes('prompt.send'))sends++;});
  const reachLimit=async()=>{
   await page.getByRole('button',{name:'Start dictation',exact:true}).click();
   await expect(page.locator('.dictation-status')).toContainText('Stop soon',{timeout:10000});
   await expect(page.getByRole('button',{name:'Transcribe recording',exact:true})).toBeVisible({timeout:30000});
   assert(await page.evaluate(()=>(window as any).dictationTracks.every((t:MediaStreamTrack)=>t.readyState==='ended')));
  };
  await reachLimit();assert.equal(uploads,0);await expect(input).toHaveValue('Retained draft');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(evidence,`retained-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Transcribe recording',exact:true}).click();await expect(input).toHaveValue('Retained draft local fixture transcript',{timeout:15000});assert.equal(uploads,1);assert.equal(sends,0);
  await reachLimit();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(uploads,1);await expect(input).toHaveValue('Retained draft local fixture transcript');
  await reachLimit();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(page.getByRole('button',{name:'Start dictation',exact:true})).toBeVisible();assert.equal(uploads,1);
  await reachLimit();await page.getByRole('button',{name:'Transcribe recording',exact:true}).focus();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Start dictation',exact:true})).toBeVisible();assert.equal(uploads,1);
  await reachLimit();
  if(width<1000){await page.getByRole('button',{name:'Open sessions',exact:true}).click();await page.getByRole('dialog',{name:'Workspace',exact:true}).getByRole('button',{name:'Settings',exact:true}).click();}
  else await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('.settings-view')).toBeVisible();await page.getByRole('button',{name:'Back to session',exact:true}).click();await expect(page.getByRole('button',{name:'Start dictation',exact:true})).toBeVisible();assert.equal(uploads,1);await expect(input).toHaveValue('Retained draft local fixture transcript');
  console.log(`PASS ${width}px accelerated 96kHz limit: effective warning, mic stopped, retained Transcribe/Cancel/Escape/interruption, no automatic upload/send`);await context.close();
 }
 assets['/dictation-worklet.js']=productionWorklet;
 // A separate real Chromium device source provides silence through the same worklet.
 const silentPath=join(root,'silence.wav');writeFileSync(silentPath,encodeWav16(new Float32Array(16000*4)));
 const silentBrowser=await chromium.launch({executablePath:process.env.DECK_TEST_CHROME??join(homedir(),'Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${silentPath}`]});
 try{const context=await silentBrowser.newContext({viewport:{width:1440,height:900},permissions:['microphone'],reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(host.pair().url);await page.locator('.app-header').waitFor();await page.getByRole('button',{name:'Dictation acceptance',exact:true}).click();await expect(page.locator('#prompt')).toBeEnabled();let uploads=0;page.on('request',r=>{if(r.url().endsWith('/transcriptions'))uploads++;});
  await page.getByRole('button',{name:'Start dictation',exact:true}).click();await expect(page.getByRole('button',{name:'Stop dictation',exact:true})).toBeVisible();await page.waitForTimeout(700);await page.getByRole('button',{name:'Stop dictation',exact:true}).click();await expect(page.getByText('No speech detected. Try again.',{exact:false})).toBeVisible();assert.equal(uploads,0);
  writeFileSync(fixture.runtime,'#!/bin/sh\necho "incompatible engine"\n',{mode:0o700});await page.getByRole('button',{name:'Dictation settings',exact:true}).click();await expect(page.getByText('whisper-cli was not found or is incompatible.')).toBeVisible();await page.screenshot({path:join(evidence,'missing-engine.png'),fullPage:true});console.log('PASS silence sends no audio; incompatible engine has actionable Settings guidance');
 }finally{await silentBrowser.close();}
 assert.deepEqual(errors,[]);console.log('PASS no browser runtime errors; screenshots '+evidence);
}finally{await browser.close();await host.close();await dictation.close();await manager.close();fixture.clean();rmSync(root,{recursive:true,force:true});}
