import { expect, test } from 'bun:test';
import { reconcilePushSubscription } from './push-notifications';
import {readApprovalNotificationPreference,writeApprovalNotificationPreference,NotificationsDialog} from './push-notifications';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
test('approval notification opt-in persists only a boolean and fails closed on unavailable storage',async()=>{
 const entries=new Map<string,Response>();
 const cache={match:async(key:string)=>entries.get(key)?.clone(),put:async(key:string,response:Response)=>{entries.set(key,response);}};
 const store={open:async(name:string)=>{expect(name).toBe('deck-notification-preferences');return cache;}} as unknown as CacheStorage;
 expect(await readApprovalNotificationPreference(store,'https://deck.test')).toBe(false);
 await writeApprovalNotificationPreference(true,store,'https://deck.test');
 expect(await readApprovalNotificationPreference(store,'https://deck.test')).toBe(true);
 expect([...entries.keys()]).toEqual(['https://deck.test/__deck_notification_preferences__']);
 expect(await entries.values().next().value!.clone().json()).toEqual({approvalActions:true});
 await writeApprovalNotificationPreference(false,store,'https://deck.test');
 expect(await readApprovalNotificationPreference(store,'https://deck.test')).toBe(false);
 const unavailable={open:async()=>{throw Error('blocked');}} as unknown as CacheStorage;
 expect(await readApprovalNotificationPreference(unavailable,'https://deck.test')).toBe(false);
 await expect(writeApprovalNotificationPreference(true,unavailable,'https://deck.test')).rejects.toThrow();
});
test('Notifications dialog labels the optional approval setting and explains its limits',()=>{
 const html=renderToStaticMarkup(React.createElement(NotificationsDialog,{settings:{enabled:true,loading:false,busy:false,approvalActions:false} as any,onClose:()=>{}}));
 expect(html).toContain('Answer approvals from notifications');expect(html).toContain('type="checkbox"');
 expect(html).toContain('aria-describedby="notification-approvals-help"');expect(html).not.toContain('checked=""');
 expect(html).toContain('Allow once');expect(html).toContain('normal-risk');
});
const key = 'BAECAw';
function fixture(unsubscribeResult = true) {
  let removed = 0,
    created = 0;
  const old = {
    options: {
      applicationServerKey: Uint8Array.from(atob(key), (c) => c.charCodeAt(0))
        .buffer,
    },
    unsubscribe: async () => {
      removed++;
      return unsubscribeResult;
    },
  };
  const fresh = { endpoint: 'https://fcm.googleapis.com/fresh' };
  const manager = {
    getSubscription: async () => old,
    subscribe: async () => {
      created++;
      return fresh;
    },
  } as unknown as PushManager;
  return { manager, old, fresh, counts: () => ({ removed, created }) };
}
test('cleared/expired cookie re-enrollment replaces a surviving subscription even with the same VAPID key', async () => {
  const f = fixture();
  expect(await reconcilePushSubscription(f.manager, key, false)).toBe(
    f.fresh as any,
  );
  expect(f.counts()).toEqual({ removed: 1, created: 1 });
});
test('the current opted-in device reuses its own subscription', async () => {
  const f = fixture();
  expect(await reconcilePushSubscription(f.manager, key, true)).toBe(
    f.old as any,
  );
  expect(f.counts()).toEqual({ removed: 0, created: 0 });
});
test('failed browser unsubscribe cannot reuse an endpoint owned by a previous device', async () => {
  const f = fixture(false);
  await expect(
    reconcilePushSubscription(f.manager, key, false),
  ).rejects.toThrow();
  expect(f.counts().created).toBe(0);
});

test('delivery status distinguishes provider acceptance, read suppression and safe failures', async () => {
  const { pushDeliveryText } = await import('./push-notifications');
  const base = {
    eligible: 1,
    sent: 0,
    suppressed: 0,
    deferred: 0,
    stale: 0,
    failed: 0,
    expired: 0,
    queueFull: 0,
    retried: 0,
  };
  expect(pushDeliveryText()).toContain('No eligible alerts');
  expect(
    pushDeliveryText({ ...base, sent: 1, lastOutcome: 'accepted' }),
  ).toContain('device display is not confirmed');
  expect(
    pushDeliveryText({ ...base, suppressed: 1, lastOutcome: 'viewed' }),
  ).toContain('visible conversation');
  expect(
    pushDeliveryText({
      ...base,
      failed: 1,
      lastOutcome: 'rejected',
      lastStatus: 403,
    }),
  ).toContain('HTTP 403');
  expect(
    pushDeliveryText({ ...base, failed: 1, lastOutcome: 'transport-error' }),
  ).toContain('Could not reach');
});

test('storage failure is visible without implying delivery or covering other attention',async()=>{
 const {pushDeliveryText}=await import('./push-notifications');
 expect(pushDeliveryText({eligible:1,sent:0,suppressed:0,deferred:1,stale:0,failed:0,expired:0,queueFull:0,retried:0,lastOutcome:'waiting-for-storage' as any})).toContain('Notification storage is unavailable');
});

test('storage failure is truthful even before any alert was eligible',async()=>{
 const {pushDeliveryText}=await import('./push-notifications');
 expect(pushDeliveryText({eligible:0,sent:0,suppressed:0,deferred:1,stale:0,failed:0,expired:0,queueFull:0,retried:0,lastOutcome:'waiting-for-storage'})).toContain('Notification storage is unavailable');
});

test('session notification clearing reaches the worker only while the same conversation remains visible and focused',async()=>{
 const {notifySessionViewed}=await import('./push-notifications');
 const messages:any[]=[];let viewing=true,ready!:(r:any)=>void;
 const worker={postMessage:(message:any)=>messages.push(message)};
 const container={ready:new Promise(resolve=>{ready=resolve;})} as unknown as ServiceWorkerContainer;
 const pending=notifySessionViewed('exact-session',()=>viewing,container);
 viewing=false;ready({active:worker});await pending;
 expect(messages).toEqual([]);
 viewing=true;await notifySessionViewed('exact-session',()=>viewing,container);
 expect(messages).toEqual([{type:'deck.session-viewed',sessionId:'exact-session'}]);
 await notifySessionViewed('other',()=>false,container);
 expect(messages).toHaveLength(1);
});
