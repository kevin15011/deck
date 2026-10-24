import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { PromptQueue, emptyInbox, reduceInbox, failedQueuedPrompts } from './prompt-queue';
test('queued prompts render in server order as safe compact previews with independent removal',()=>{
 const html=renderToStaticMarkup(<PromptQueue items={[{promptId:'first',text:'<img src=x onerror=alert(1)>',position:10},{promptId:'second',text:'Follow up',position:11}]} paused={false} connected busy={false} onCancel={()=>{}} onResume={()=>{}}/>);
 expect(html.indexOf('&lt;img')).toBeLessThan(html.indexOf('Follow up'));expect(html).not.toContain('<img');expect(html).toContain('2 queued messages');expect(html).toContain('Remove queued message 1');expect(html).not.toContain('Resume queue');
});
test('paused inbox has one explicit resume action and can still remove waiting messages',()=>{
 const html=renderToStaticMarkup(<PromptQueue items={[{promptId:'p',text:'Next',position:1}]} paused pauseReason="interrupted" connected busy={false} onCancel={()=>{}} onResume={()=>{}}/>);
 expect(html).toContain('Queue paused');expect(html.match(/>Resume queue</g)).toHaveLength(1);expect(html).toContain('Remove queued message 1');expect(html).not.toContain('role="dialog"');
});
test('queued text and images have an explicit Edit action gated by connectivity and request state',()=>{
 const props={items:[{promptId:'p',text:'Full text',attachments:[{attachmentId:'image',name:'kept.png',mimeType:'image/png',sizeBytes:12}]}],paused:true,onCancel:()=>{},onEdit:()=>{},onResume:()=>{}};
 const html=renderToStaticMarkup(<PromptQueue {...props} connected busy={false}/>);
 expect(html).toContain('Edit queued message 1');expect(html).toContain('View image 1: kept.png');expect(html).not.toMatch(/disabled=""[^>]*aria-label="Edit/);
 for(const status of [{connected:false,busy:false},{connected:true,busy:true}])expect(renderToStaticMarkup(<PromptQueue {...props} {...status}/>)).toMatch(/disabled=""[^>]*aria-label="Edit/);
});

const event=(seq:number,kind:SessionEvent['kind'],data:Record<string,unknown>):SessionEvent=>({v:1,sessionId:'s',seq,kind,data,source:{},ts:'2026-01-01T00:00:00Z'});
test('delivery runner comes from its immutable fence and survives later capability changes',()=>{
 const inbox=[event(1,'prompt.queued',{promptId:'a',text:'Claude input'}),event(2,'prompt.steering',{promptId:'a',runnerId:'claude'}),event(3,'diagnostic',{code:'prompt.steering-capability',available:true,runnerId:'codex'}),event(4,'prompt.steered',{promptId:'a',state:'unknown',eligible:false})].reduce(reduceInbox,emptyInbox());
 expect(inbox.steeringRunnerId).toBe('codex');expect(inbox.deliveries).toEqual([{promptId:'a',text:'Claude input',state:'unknown',runnerId:'claude',historical:true}]);expect(inbox.queued).toEqual([]);
});
test('refusal after uncertainty stays terminal on replay; only explicit pending-barrier fallback restores queue',()=>{
 const start=[event(1,'prompt.queued',{promptId:'a',text:'Earlier text'}),event(2,'prompt.steering',{promptId:'a'})];
 for(const uncertain of [false,true])for(const permission of [undefined,false,true]){
  const events=[...start,...(uncertain?[event(3,'prompt.steered',{promptId:'a',state:'unknown'})]:[]),event(4,'prompt.steered',{promptId:'a',state:'not-accepted',...(permission===undefined?{}:{queueFallback:permission})})];
  const inbox=events.reduce(reduceInbox,emptyInbox());
  if(permission===true&&!uncertain){expect(inbox.queued).toEqual([{promptId:'a',text:'Earlier text'}]);expect(inbox.deliveries).toEqual([]);}
  else{expect(inbox.queued).toEqual([]);expect(inbox.deliveries).toEqual([{promptId:'a',text:'Earlier text',state:'not-accepted'}]);}
 }
});
test('durable inbox replays FIFO, duplicate receipt, cancel and actual dispatch without inventing chat',()=>{
 const queued=event(1,'prompt.queued',{promptId:'one',text:'First',position:1});
 let inbox=reduceInbox(emptyInbox(),queued);expect(reduceInbox(inbox,queued)).toBe(inbox);
 inbox=reduceInbox(inbox,event(2,'prompt.queued',{promptId:'two',text:'Second',position:2}));
 inbox=reduceInbox(inbox,event(3,'prompt.dispatched',{promptId:'one',taskId:'lead-g1',attempt:2}));
 expect(inbox.queued.map(item=>item.promptId)).toEqual(['two']);expect(inbox.active).toMatchObject({promptId:'one',attempt:2});
 inbox=reduceInbox(inbox,event(4,'prompt.state',{promptId:'two',state:'cancelled'}));expect(inbox.queued).toEqual([]);expect(inbox.active?.promptId).toBe('one');
 expect(reduceInbox(inbox,event(3,'prompt.queue',{paused:true}))).toBe(inbox);
});
test('pause survives enqueue and unrelated completion until explicit resume; failed never-dispatched text remains available',()=>{
 const events=[event(1,'prompt.queue',{paused:true,reason:'interrupted'}),event(2,'prompt.queued',{promptId:'one',text:'Accepted but could not start'}),event(3,'prompt.state',{promptId:'one',state:'failed',reason:'Runner unavailable'})];
 const inbox=events.reduce(reduceInbox,emptyInbox());expect(inbox.paused).toBe(true);expect(inbox.queued).toEqual([]);
 expect(failedQueuedPrompts(events)).toEqual([{promptId:'one',text:'Accepted but could not start',reason:'Runner unavailable'}]);
 expect(failedQueuedPrompts([events[1]!,event(3,'prompt.dispatched',{promptId:'one',taskId:'lead',attempt:1}),events[2]!])).toEqual([]);
 expect(reduceInbox(inbox,event(4,'prompt.queue',{paused:false})).paused).toBe(false);
});
test('image-only acceptance and pre-admission failure replay retain compact preview references',()=>{
 const attachment={attachmentId:'image-one',mimeType:'image/png',name:'clipboard.png',sizeBytes:128,width:10,height:10};
 const queued=event(1,'prompt.queued',{promptId:'image-prompt',text:'',attachments:[attachment],position:1});
 const pending=reduceInbox(emptyInbox(),queued);
 expect(pending.queued[0]?.attachments).toEqual([attachment]);
 const events=[queued,event(2,'prompt.state',{promptId:'image-prompt',state:'failed',reason:'Runner unavailable'}),event(3,'prompt.queue',{paused:true})];
 const failed=failedQueuedPrompts(events);
 expect(events.reduce(reduceInbox,emptyInbox()).queued).toEqual([]);
 expect(failed).toEqual([{promptId:'image-prompt',text:'',attachments:[attachment],reason:'Runner unavailable'}]);
 const html=renderToStaticMarkup(<PromptQueue items={[]} failed={failed} paused connected busy={false} onCancel={()=>{}} onResume={()=>{}}/>);
 expect(html).toContain('Image message');expect(html).toContain('View image 1: clipboard.png');expect(html).toContain('Runner unavailable');
});
test('empty restart pause is hidden while queued and failed input keep resume visible',()=>{
 for(const pauseReason of ['daemon-stopped','web-restart-forced:restart']) {
  const render=(items:any[]=[],failed:any[]=[])=>renderToStaticMarkup(<PromptQueue items={items} failed={failed} paused pauseReason={pauseReason} connected busy={false} onCancel={()=>{}} onResume={()=>{}}/>);
  expect(render()).toBe('');
  expect(render([{promptId:'q',text:'Waiting'}])).toContain('Resume queue');
  expect(render([],[{promptId:'f',text:'Failed',reason:'failed'}])).toContain('Resume queue');
 }
});
