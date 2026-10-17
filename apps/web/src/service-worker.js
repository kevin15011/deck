/* No application caching: authenticated workspace responses must never enter a worker cache. */
self.addEventListener('install', (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);
const safeId = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) &&
  !value.includes('..');
const bodies = {
  finished: 'The Lead is ready for you.',
  question: 'A question needs your response.',
  approval: 'An approval needs your response.',
  failure: 'Work needs your attention.',
};
self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data;
      try {
        data = event.data.json();
      } catch {
        return;
      }
      if (
        !data ||
        !safeId(data.sessionId) ||
        !Object.hasOwn(bodies, data.kind) ||
        !Number.isSafeInteger(data.seq) ||
        data.seq < 1
      )
        return;
      // userVisibleOnly requires every received valid push to display, even after
      // authorization expires or attention resolves. Suppression happens before send.
      await self.registration.showNotification('Deck', {
        body: bodies[data.kind],
        tag: `deck:${data.sessionId}:${data.kind}:${data.seq}`,
        data: { sessionId: data.sessionId },
        renotify: false,
      });
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.sessionId;
  if (!safeId(id)) return;
  event.waitUntil(
    (async () => {
      const target = new URL(
        `/?session=${encodeURIComponent(id)}`,
        self.location.origin,
      ).href;
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const client =
        windows.find(
          (c) => new URL(c.url).searchParams.get('session') === id,
        ) ?? windows[0];
      if (client) {
        const accepted = await new Promise((resolve) => {
          const channel = new MessageChannel(),
            timer = setTimeout(() => {
              channel.port1.close();
              resolve(false);
            }, 500);
          channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(event.data?.opened === true);
          };
          client.postMessage({ type: 'deck.open-session', sessionId: id }, [
            channel.port2,
          ]);
        });
        if (accepted) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) =>
  event.waitUntil(
    (async () => {
      try {
        const status = await fetch('/api/push', {
          credentials: 'same-origin',
          redirect: 'error',
          cache: 'no-store',
        });
        if (!status.ok) return;
        const state = await status.json();
        if (!state.enabled) return;
        const key = Uint8Array.from(
          atob(state.publicKey.replace(/-/g, '+').replace(/_/g, '/')),
          (c) => c.charCodeAt(0),
        );
        const subscription =
          event.newSubscription ??
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          }));
        await fetch('/api/push', {
          method: 'POST',
          credentials: 'same-origin',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            renew: true,
          }),
        });
      } catch {
        /* Reconnect from Notifications if renewal cannot reach the private daemon. */
      }
    })(),
  ),
);
