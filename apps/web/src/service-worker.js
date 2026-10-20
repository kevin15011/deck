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
  decision: 'A decision is waiting for you.',
  result: 'A reviewed result is ready.',
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
      const attention = Object.hasOwn(bodies, data.attention) ? data.attention : data.kind;
      const titles = {decision:'Decision needed',result:data.othersActive === true ? 'Result reviewed · other work continues' : 'Result reviewed',finished:'Lead replied'};
      const summary = typeof data.summary === 'string' && new TextEncoder().encode(data.summary).length <= 480
        ? data.summary.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim() : '';
      const tag = attention === 'decision' && typeof data.tagId === 'string' && /^[A-Za-z0-9_-]{16}$/.test(data.tagId)
        ? `deck:${data.sessionId}:decision:${data.tagId}` : `deck:${data.sessionId}:${attention}:${data.seq}`;
      await self.registration.showNotification(data.attention ? titles[attention] ?? 'Deck' : 'Deck', {
        body: summary || bodies[attention],
        tag,
        data: { sessionId: data.sessionId, ...(typeof data.replyId==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(data.replyId)&&data.replyId.length<=48?{replyId:data.replyId}:{}) },
        renotify: false,
      });
    })(),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.sessionId;
  if (!safeId(id)) return;
  const replyId=event.notification.data?.replyId;
  const reply=typeof replyId==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(replyId)&&replyId.length<=48?replyId:'';
  event.waitUntil(
    (async () => {
      const target = new URL(
        `/?session=${encodeURIComponent(id)}${reply?`&reply=${encodeURIComponent(reply)}`:''}`,
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
          client.postMessage({ type: 'deck.open-session', sessionId: id, ...(reply?{replyId:reply}:{}) }, [
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
