import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const script = readFileSync(
  new URL('./service-worker.js', import.meta.url),
  'utf8',
);
function fixture(
  options: {
    windows?: any[];
    current?: boolean;
    status?: number;
    enabled?: boolean;
    offline?: boolean;
  } = {},
) {
  const handlers: Record<string, (event: any) => void> = {},
    shown: any[] = [],
    opened: string[] = [],
    calls: any[] = [];
  const self = {
    location: { origin: 'https://deck.test' },
    addEventListener: (name: string, fn: any) => (handlers[name] = fn),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => options.windows ?? [],
      openWindow: async (url: string) => opened.push(url),
    },
    registration: {
      showNotification: async (...args: any[]) => shown.push(args),
      pushManager: {
        subscribe: async () => ({
          toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/new' }),
        }),
      },
    },
  };
  runInNewContext(script, {
    self,
    MessageChannel,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Uint8Array,
    TextEncoder,
    atob,
    fetch: async (url: string, init: any) => {
      calls.push({ url, init });
      if (options.offline) throw new Error('offline');
      return new Response(
        JSON.stringify(
          url === '/api/push'
            ? { enabled: options.enabled ?? false, publicKey: 'AQ' }
            : { current: options.current ?? true },
        ),
        { status: options.status ?? 200 },
      );
    },
  });
  const run = async (name: string, extra: any = {}) => {
    let pending: Promise<unknown> | undefined;
    handlers[name]!({
      waitUntil: (promise: Promise<unknown>) => (pending = promise),
      ...extra,
    });
    await pending;
  };
  return { run, shown, opened, calls };
}
const payload = {
  sessionId: 'exact-session',
  seq: 20,
  kind: 'question',
  requestId: 'q',
  text: 'secret command',
  error: 'raw secret',
};
test('every valid push shows fixed copy without authentication, stale-state or visibility checks', async () => {
  const f = fixture();
  await f.run('push', { data: { json: () => payload } });
  expect(f.shown).toHaveLength(1);
  expect(f.shown[0]).toEqual([
    'Deck',
    {
      body: 'A question needs your response.',
      tag: 'deck:exact-session:question:20',
      data: { sessionId: 'exact-session' },
      renotify: false,
    },
  ]);
  expect(JSON.stringify(f.shown)).not.toContain('secret');
  for (const opts of [{ current: false }, { status: 401 }, { offline: true }]) {
    const stale = fixture(opts);
    await stale.run('push', { data: { json: () => payload } });
    expect(stale.shown).toHaveLength(1);
    expect(stale.calls).toHaveLength(0);
  }
  for (const data of [
    { ...payload, kind: 'toString' },
    { ...payload, sessionId: '../secret' },
    { ...payload, seq: '1' },
  ]) {
    const invalid = fixture();
    await invalid.run('push', { data: { json: () => data } });
    expect(invalid.shown).toHaveLength(0);
  }
});
test('visible conversation tabs cannot silently consume a received push', async () => {
  for (const viewing of [true, false]) {
    const f = fixture({
      windows: [
        {
          focused: true,
          visibilityState: 'visible',
          url: 'https://deck.test/?session=exact-session',
          postMessage: (_data: any, ports: MessagePort[]) =>
            ports[0]!.postMessage({ viewing }),
        },
        { focused: false, visibilityState: 'hidden' },
      ],
    });
    await f.run('push', { data: { json: () => payload } });
    expect(f.shown).toHaveLength(1);
    expect(f.calls).toHaveLength(0);
  }
});
test('unacknowledged click opens exact session in a new window and never navigates an existing tab', async () => {
  const navigated: string[] = [],
    focused: string[] = [];
  const windows = ['other', 'exact-session'].map((id) => ({
    postMessage: (_data: any, ports: MessagePort[]) =>
      ports[0]!.postMessage({ opened: false }),
    url: `https://deck.test/?session=${id}`,
    navigate: async (url: string) => {
      navigated.push(url);
      return { focus: async () => focused.push(id) };
    },
  }));
  const warm = fixture({ windows });
  await warm.run('notificationclick', {
    notification: { data: { sessionId: 'exact-session' }, close: () => {} },
  });
  expect(navigated).toEqual([]);
  expect(focused).toEqual([]);
  expect(warm.opened).toEqual(['https://deck.test/?session=exact-session']);
  const cold = fixture();
  await cold.run('notificationclick', {
    notification: { data: { sessionId: 'exact-session' }, close: () => {} },
  });
  expect(cold.opened).toEqual(['https://deck.test/?session=exact-session']);
  await cold.run('notificationclick', {
    notification: { data: { sessionId: 'https://evil.test' }, close: () => {} },
  });
  expect(cold.opened).toHaveLength(1);
});
test('subscription renewal cannot re-enable opted-out browser', async () => {
  const disabled = fixture();
  await disabled.run('pushsubscriptionchange');
  expect(disabled.calls).toHaveLength(1);
  const enabled = fixture({ enabled: true });
  await enabled.run('pushsubscriptionchange');
  expect(enabled.calls[1].init.method).toBe('POST');
  expect(JSON.parse(enabled.calls[1].init.body).subscription.endpoint).toBe(
    'https://fcm.googleapis.com/new',
  );
});

test('warm app accepts session routing without navigating away from unsent drafts', async () => {
  let routed = '',
    focused = false;
  const client = {
    url: 'https://deck.test/?session=other',
    postMessage: (data: any, ports: MessagePort[]) => {
      routed = data.sessionId;
      ports[0]!.postMessage({ opened: true });
    },
    focus: async () => {
      focused = true;
    },
    navigate: () => {
      throw new Error('must preserve mounted drafts');
    },
  };
  const f = fixture({ windows: [client] });
  await f.run('notificationclick', {
    notification: { data: { sessionId: 'exact-session' }, close: () => {} },
  });
  expect(routed).toBe('exact-session');
  expect(focused).toBe(true);
  expect(f.opened).toHaveLength(0);
});

test('successive Lead completions have distinct tags while duplicate occurrences reuse a tag', async () => {
  const f = fixture();
  for (const seq of [1, 1, 2])
    await f.run('push', {
      data: { json: () => ({ ...payload, kind: 'finished', seq }) },
    });
  expect(f.shown[0][1].tag).toBe(f.shown[1][1].tag);
  expect(f.shown[2][1].tag).not.toBe(f.shown[1][1].tag);
});
test('suspended client with no response retains its draft and a new window opens', async () => {
  const f = fixture({
    windows: [
      {
        url: 'https://deck.test/?session=exact-session',
        postMessage: () => {},
        navigate: () => {
          throw new Error('must preserve suspended draft');
        },
      },
    ],
  });
  await f.run('notificationclick', {
    notification: { data: { sessionId: 'exact-session' }, close: () => {} },
  });
  expect(f.opened).toEqual(['https://deck.test/?session=exact-session']);
});

test('new attention uses bounded plain text, stable decision tags and legacy-compatible kinds',async()=>{
 const f=fixture();const data={sessionId:'s',seq:1,kind:'question',attention:'decision',summary:'Approve storage?',tagId:'abcdefghijklmnop'};
 await f.run('push',{data:{json:()=>data}});await f.run('push',{data:{json:()=>({...data,seq:2,summary:'Approve retry?'})}});
 expect(f.shown[0][0]).toBe('Decision needed');expect(f.shown[0][1].body).toBe('Approve storage?');expect(f.shown[0][1].tag).toBe(f.shown[1][1].tag);
 for(const summary of ['界'.repeat(161),42]){await f.run('push',{data:{json:()=>({...data,summary})}});expect(f.shown.at(-1)[1].body).toBe('A decision is waiting for you.');}
 await f.run('push',{data:{json:()=>({...data,kind:'finished',attention:'result',summary:'Fixed delivery.',othersActive:true})}});expect(f.shown.at(-1)[0]).toBe('Result reviewed · other work continues');
});

test('exact reply identity survives push, cold click, warm routing and legacy notification fallback',async()=>{
 const f=fixture();await f.run('push',{data:{json:()=>({...payload,kind:'finished',replyId:'reply-20-18'})}});
 expect(f.shown[0][1].data).toEqual({sessionId:'exact-session',replyId:'reply-20-18'});
 await f.run('notificationclick',{notification:{data:f.shown[0][1].data,close:()=>{}}});expect(f.opened).toEqual(['https://deck.test/?session=exact-session&reply=reply-20-18']);
 const messages:any[]=[];const warm=fixture({windows:[{url:'https://deck.test/?session=other',focus:async()=>{},postMessage:(data:any,ports:any[])=>{messages.push(data);ports[0].postMessage({opened:true});}}]});
 await warm.run('notificationclick',{notification:{data:f.shown[0][1].data,close:()=>{}}});expect(messages[0].replyId).toBe('reply-20-18');expect(warm.opened).toEqual([]);
 const legacy=fixture();await legacy.run('notificationclick',{notification:{data:{sessionId:'exact-session'},close:()=>{}}});expect(legacy.opened).toEqual(['https://deck.test/?session=exact-session']);
});
