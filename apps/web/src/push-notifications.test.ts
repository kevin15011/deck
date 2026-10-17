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
