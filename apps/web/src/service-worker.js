/* Only a local boolean preference is cached; authenticated responses are never cached. */
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
// Push, view and dismissal events can overlap at every await. Serialize the
// notification read/replace/count cycle; the displayed notification is the
// durable source of counts when the browser restarts this worker.
let notificationWork = Promise.resolve();
const enqueueNotifications = (work) => {
  const next = notificationWork.then(work);
  notificationWork = next.catch(() => {});
  return next;
};
const notifications = async () => {
  try { return await self.registration.getNotifications(); }
  catch { return []; } // Limited platforms still display each valid push.
};
const updateBadge = async (pending) => {
  const count = pending.filter(n => n.tag.startsWith('deck:')).reduce((total, n) =>
    total + (Number.isSafeInteger(n.data?.count) && n.data.count > 0 ? n.data.count : 1), 0);
  let timer;
  try {
    const operation = count ? self.navigator.setAppBadge?.(count) : self.navigator.clearAppBadge?.();
    // Some platform integrations leave these promises pending. An optional OS
    // effect must not hold the notification queue (or click routing) indefinitely.
    await Promise.race([operation, new Promise(resolve => { timer = setTimeout(resolve, 250); })]);
  } catch { /* Badging is optional and must never prevent display or routing. */ }
  finally { clearTimeout(timer); }
};
const closeSessionNotifications = async (id) => {
  const pending = await notifications(), prefix = `deck:${id}:`;
  for (const notification of pending) if (notification.tag.startsWith(prefix)) notification.close();
  await updateBadge(pending.filter(n => !n.tag.startsWith(prefix)));
};
const plainText = (value, bytes) => typeof value === 'string' && new TextEncoder().encode(value).length <= bytes
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim() : '';
const approvalIdentity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const approvalActionsEnabled = async () => {
  try {
    const cache = await caches.open('deck-notification-preferences');
    const response = await cache.match(new URL('/__deck_notification_preferences__', self.location.origin).href);
    return (await response?.json())?.approvalActions === true;
  } catch { return false; }
};
self.addEventListener('push', (event) => {
  event.waitUntil(
    enqueueNotifications(async () => {
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
      const summary = attention === 'approval' ? '' : plainText(data.summary, 480);
      const canAnswer = attention === 'approval' && approvalIdentity(data.approvalId) && data.risk === 'normal'
        && typeof Notification !== 'undefined' && Notification.maxActions >= 2 && await approvalActionsEnabled();
      const tool = typeof data.tool === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(data.tool) ? data.tool : 'Tool';
      const isReply = attention === 'finished' || attention === 'result';
      const tag = isReply ? `deck:${data.sessionId}:replies`
        : attention === 'decision' && typeof data.tagId === 'string' && /^[A-Za-z0-9_-]{16}$/.test(data.tagId)
          ? `deck:${data.sessionId}:decision:${data.tagId}` : `deck:${data.sessionId}:${attention}:${data.seq}`;
      const pending = await notifications(), previous = pending.find(n => n.tag === tag);
      const seqs = isReply ? [...new Set([...(previous?.data?.replySeqs ?? []), data.seq])] : [];
      const duplicate = isReply ? previous?.data?.replySeqs?.includes(data.seq) : previous?.data?.seq === data.seq;
      const latest = isReply && previous?.data?.seq > data.seq;
      const count = seqs.length;
      const name = plainText(data.sessionName, 640) || data.sessionId;
      const title = canAnswer ? `Allow ${tool} once?` : isReply ? `${count} new ${count === 1 ? 'reply' : 'replies'} · ${name}` : attention === 'decision' ? 'Decision needed' : 'Deck';
      const identity = latest ? previous.data : {
        sessionId: data.sessionId, seq: data.seq,
        ...(typeof data.replyId==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(data.replyId)&&data.replyId.length<=48?{replyId:data.replyId}:{})
      };
      await self.registration.showNotification(title, {
        body: latest ? previous.body : summary || bodies[attention],
        tag,
        data: {...identity, ...(isReply ? { count, replySeqs: seqs } : {}), ...(canAnswer ? {approvalId:data.approvalId,risk:'normal',approvalActions:true} : {})},
        ...(canAnswer ? {actions:[{action:'allow',title:'Allow once'},{action:'deny',title:'Deny'}]} : {}),
        renotify: !duplicate,
      });
      await updateBadge(await notifications());
    }),
  );
});
self.addEventListener('message', event => {
  const {type, sessionId} = event.data ?? {}, source = event.source;
  if (type !== 'deck.session-viewed' || !safeId(sessionId) ||
    !source?.focused || source.visibilityState !== 'visible') return;
  try { if (new URL(source.url).origin !== self.location.origin) return; }
  catch { return; }
  event.waitUntil(enqueueNotifications(() => closeSessionNotifications(sessionId)));
});
self.addEventListener('notificationclose', event => {
  event.waitUntil(enqueueNotifications(async () => {
    const closed = event.notification;
    await updateBadge((await notifications()).filter(n => n.tag !== closed.tag || n.data?.seq !== closed.data?.seq));
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data?.sessionId;
  if (!safeId(id)) return;
  if (event.action) {
    event.waitUntil((async () => {
      const data = event.notification.data;
      let timer;
      try {
        if (!['allow','deny'].includes(event.action) || !data.approvalActions || data.risk !== 'normal' ||
          !approvalIdentity(data.approvalId) || !await approvalActionsEnabled()) throw Error('notification-action-disabled');
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch('/api/commands', {
          method:'POST', credentials:'same-origin', redirect:'error', cache:'no-store', signal:controller.signal,
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sessionId:id,command:{v:1,commandId:crypto.randomUUID(),type:'approval.respond',
            approvalId:data.approvalId,decision:event.action,scope:'once',origin:'notification'}}),
        });
        if (!response.ok || (await response.json()).ok !== true) throw Error('approval-not-applied');
        await enqueueNotifications(async () => {
          const pending = await notifications();
          for (const notification of pending) if (notification.data?.sessionId === id && notification.data?.approvalId === data.approvalId) notification.close();
          await updateBadge(await notifications());
        });
      } catch {
        // The request may have reached the server. Never retry or infer success.
        await enqueueNotifications(async () => {
          await self.registration.showNotification('Deck', {
            body:'Couldn’t apply — open Deck', tag:`deck:${id}:approval-action-failed:${data.seq}`,
            data:{sessionId:id,seq:data.seq},
          });
          await updateBadge(await notifications());
        });
      } finally { clearTimeout(timer); }
    })());
    return;
  }
  const replyId=event.notification.data?.replyId;
  const reply=typeof replyId==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(replyId)&&replyId.length<=48?replyId:'';
  event.waitUntil(
    (async () => {
      await enqueueNotifications(() => closeSessionNotifications(id));
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
