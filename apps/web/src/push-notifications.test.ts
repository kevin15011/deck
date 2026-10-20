import { expect, test } from 'bun:test';
import { reconcilePushSubscription } from './push-notifications';
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
