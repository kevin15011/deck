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
    badge?: 'unsupported' | 'reject' | 'pending';
    approvalActions?: boolean;
    maxActions?: number;
    commandOutcome?: {ok:boolean;code?:string};
    storageError?: boolean;
  } = {},
) {
  const handlers: Record<string, (event: any) => void> = {},
    shown: any[] = [],
    opened: string[] = [],
    calls: any[] = [],
    notifications: any[] = [],
    badges: number[] = [];
  let preference = options.approvalActions ?? false;
  const cache = {match:async(key:string)=>{expect(key).toBe('https://deck.test/__deck_notification_preferences__');return new Response(JSON.stringify({approvalActions:preference}));}};
  const self = {
    location: { origin: 'https://deck.test' },
    navigator: options.badge === 'unsupported' ? {} : {
      setAppBadge: async (count: number) => { if(options.badge === 'reject') throw Error('denied'); if(options.badge === 'pending')return new Promise(()=>{}); badges.push(count); },
      clearAppBadge: async () => { if(options.badge === 'reject') throw Error('denied'); if(options.badge === 'pending')return new Promise(()=>{}); badges.push(0); },
    },
    addEventListener: (name: string, fn: any) => (handlers[name] = fn),
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => options.windows ?? [],
      openWindow: async (url: string) => opened.push(url),
    },
    registration: {
      getNotifications: async () => [...notifications],
      showNotification: async (...args: any[]) => {
        shown.push(args);
        const [title, init] = args;
        for (const old of [...notifications]) if(old.tag === init.tag) old.close();
        const notification = {title, ...init, close: () => { const i=notifications.indexOf(notification); if(i>=0)notifications.splice(i,1); }};
        notifications.push(notification);
      },
      pushManager: {
        subscribe: async () => ({
          toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/new' }),
        }),
      },
    },
  };
  const reload = () => runInNewContext(script, {
    self,
    MessageChannel,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Uint8Array,
    TextEncoder,
    Response,
    Notification: {maxActions:options.maxActions ?? 2},
    crypto: globalThis.crypto,
    caches: {open:async(name:string)=>{expect(name).toBe('deck-notification-preferences');if(options.storageError)throw Error('storage');return cache;}},
    atob,
    fetch: async (url: string, init: any) => {
      calls.push({ url, init });
      if (options.offline) throw new Error('offline');
      return new Response(
        JSON.stringify(
          url === '/api/push'
            ? { enabled: options.enabled ?? false, publicKey: 'AQ' }
            : url === '/api/commands' ? options.commandOutcome ?? {ok:true}
            : { current: options.current ?? true },
        ),
        { status: options.status ?? 200 },
      );
    },
  });
  reload();
  const run = async (name: string, extra: any = {}) => {
    let pending: Promise<unknown> | undefined;
    handlers[name]!({
      waitUntil: (promise: Promise<unknown>) => (pending = promise),
      ...extra,
    });
    await pending;
  };
  return { run, reload, shown, opened, calls, notifications, badges, setPreference:(value:boolean)=>{preference=value;} };
}
const approval={sessionId:'exact-session',seq:20,kind:'approval',approvalId:'ap-1',tool:'Bash',risk:'normal'};
test('approval actions require opt-in, explicit normal risk, valid identity and two platform actions',async()=>{
 for(const opts of [{},{approvalActions:true},{approvalActions:true,maxActions:1},{approvalActions:true,storageError:true}]){
  for(const risk of ['normal','high',undefined,'unknown']){
   const f=fixture(opts);await f.run('push',{data:{json:()=>({...approval,risk})}});
   const allowed=opts.approvalActions && !('storageError' in opts) && !('maxActions' in opts) && risk==='normal';
   expect(f.shown[0][1].actions??[]).toEqual(allowed?[{action:'allow',title:'Allow once'},{action:'deny',title:'Deny'}]:[]);
   if(allowed)expect(f.shown[0][0]).toBe('Allow Bash once?');
  }
 }
 const f=fixture({approvalActions:true});await f.run('push',{data:{json:()=>({...approval,tool:'Bash /private/path',summary:'SECRET',input:'SECRET'})}});
 expect(f.shown[0][0]).toBe('Allow Tool once?');expect(JSON.stringify(f.shown)).not.toMatch(/SECRET|private/);
 await f.run('push',{data:{json:()=>({...approval,seq:21,approvalId:undefined})}});
 expect(f.shown.at(-1)[1].actions??[]).toEqual([]);
});
test('notification actions send one authenticated once-only command and retain unrelated notifications',async()=>{
 for(const action of ['allow','deny']){
  const f=fixture({approvalActions:true});
  await f.run('push',{data:{json:()=>({...payload,kind:'finished'})}});
  await f.run('push',{data:{json:()=>approval}});f.reload();
  await f.run('notificationclick',{notification:f.notifications.find(n=>n.data.approvalId),action});
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({url:'/api/commands',init:{method:'POST',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json'}}});
  const body=JSON.parse(f.calls[0].init.body);
  expect(body).toMatchObject({sessionId:'exact-session',command:{v:1,type:'approval.respond',approvalId:'ap-1',decision:action,scope:'once',origin:'notification'}});
  expect(body.command.commandId).toMatch(/^[a-f0-9-]{36}$/);
  expect(f.notifications.map(n=>n.tag)).toEqual(['deck:exact-session:replies']);
  expect(f.badges.at(-1)).toBe(1);expect(f.opened).toEqual([]);
 }
});
test('failed, stale and rejected actions never retry and provide an open-app fallback',async()=>{
 for(const opts of [{offline:true},{status:401},{commandOutcome:{ok:false,code:'already-resolved'}},{commandOutcome:{ok:false,code:'unknown-approval'}},{commandOutcome:{ok:false,code:'approval-notification-risk'}}]){
  const f=fixture({approvalActions:true,...opts});await f.run('push',{data:{json:()=>approval}});
  await f.run('notificationclick',{notification:f.notifications[0],action:'allow'});
  expect(f.calls).toHaveLength(1);expect(f.opened).toEqual([]);
  expect(f.notifications[0].body).toBe('Couldn’t apply — open Deck');
  expect(f.notifications[0].actions??[]).toEqual([]);
  await f.run('notificationclick',{notification:f.notifications[0],action:''});
  expect(f.opened).toEqual(['https://deck.test/?session=exact-session']);expect(f.calls).toHaveLength(1);
 }
});
test('revoking opt-in disables previously displayed actions; body tap never answers',async()=>{
 const f=fixture({approvalActions:true});await f.run('push',{data:{json:()=>approval}});f.setPreference(false);
 await f.run('notificationclick',{notification:f.notifications[0],action:'allow'});expect(f.calls).toEqual([]);
 expect(f.notifications[0].body).toBe('Couldn’t apply — open Deck');
 const body=fixture({approvalActions:true});await body.run('push',{data:{json:()=>approval}});
 await body.run('notificationclick',{notification:body.notifications[0]});expect(body.calls).toEqual([]);expect(body.opened).toHaveLength(1);
});
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
      data: { sessionId: 'exact-session', seq:20 },
      renotify: true,
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

test('successive Lead replies replace one session notification and duplicate occurrences do not add to the count', async () => {
  const f = fixture();
  for (const seq of [1, 1, 2])
    await f.run('push', {
      data: { json: () => ({ ...payload, kind: 'finished', seq }) },
    });
  expect(f.shown[0][1].tag).toBe(f.shown[1][1].tag);
  expect(f.shown[2][1].tag).toBe(f.shown[1][1].tag);
  expect(f.notifications).toHaveLength(1);
  expect(f.notifications[0].data.count).toBe(2);
  expect(f.shown.map(n=>n[1].renotify)).toEqual([true,false,true]);
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
 await f.run('push',{data:{json:()=>({...data,kind:'finished',attention:'result',summary:'Fixed delivery.',othersActive:true})}});expect(f.shown.at(-1)[0]).toBe('1 new reply · s');
});

test('exact reply identity survives push, cold click, warm routing and legacy notification fallback',async()=>{
 const f=fixture();await f.run('push',{data:{json:()=>({...payload,kind:'finished',replyId:'reply-20-18'})}});
 expect(f.shown[0][1].data).toMatchObject({sessionId:'exact-session',replyId:'reply-20-18',seq:20,count:1});
 await f.run('notificationclick',{notification:{data:f.shown[0][1].data,close:()=>{}}});expect(f.opened).toEqual(['https://deck.test/?session=exact-session&reply=reply-20-18']);
 const messages:any[]=[];const warm=fixture({windows:[{url:'https://deck.test/?session=other',focus:async()=>{},postMessage:(data:any,ports:any[])=>{messages.push(data);ports[0].postMessage({opened:true});}}]});
 await warm.run('notificationclick',{notification:{data:f.shown[0][1].data,close:()=>{}}});expect(messages[0].replyId).toBe('reply-20-18');expect(warm.opened).toEqual([]);
 const legacy=fixture();await legacy.run('notificationclick',{notification:{data:{sessionId:'exact-session'},close:()=>{}}});expect(legacy.opened).toEqual(['https://deck.test/?session=exact-session']);
});

test('concurrent and out-of-order replies keep their unique count, latest preview and exact link across worker restarts', async () => {
  const f=fixture();
  const push=(seq:number)=>f.run('push',{data:{json:()=>({...payload,kind:'finished',attention:seq===2?'result':'finished',seq,sessionName:'Delivery work',summary:`Reply ${seq}`,replyId:`reply-${seq}-1`})}});
  await Promise.all([push(3),push(2),push(3),push(4)]);
  expect(f.notifications).toHaveLength(1);
  expect(f.notifications[0]).toMatchObject({title:'3 new replies · Delivery work',body:'Reply 4',tag:'deck:exact-session:replies',data:{count:3,seq:4,replyId:'reply-4-1'}});
  expect(f.badges.at(-1)).toBe(3);
  f.reload();
  await push(5);
  expect(f.notifications[0]).toMatchObject({title:'4 new replies · Delivery work',body:'Reply 5',data:{count:4,replyId:'reply-5-1'}});
  expect(f.badges.at(-1)).toBe(4);
});

test('decisions and approvals remain separate from grouped replies and badges sum across sessions', async()=>{
 const f=fixture();
 for(const data of [
  {...payload,kind:'finished'},
  {...payload,kind:'finished',seq:21},
  {...payload,kind:'finished',sessionId:'other'},
  {...payload,attention:'decision',tagId:'abcdefghijklmnop'},
  {...payload,kind:'approval'},
 ])await f.run('push',{data:{json:()=>data}});
 expect(f.notifications).toHaveLength(4);
 expect(f.notifications.map(n=>n.tag)).toEqual(['deck:exact-session:replies','deck:other:replies','deck:exact-session:decision:abcdefghijklmnop','deck:exact-session:approval:20']);
 expect(f.badges.at(-1)).toBe(5);
 await f.run('message',{data:{type:'deck.session-viewed',sessionId:'exact-session'},source:{url:'https://deck.test/',visibilityState:'visible',focused:true}});
 expect(f.notifications.map(n=>n.tag)).toEqual(['deck:other:replies']);
 expect(f.badges.at(-1)).toBe(1);
 await f.run('message',{data:{type:'deck.session-viewed',sessionId:'other'},source:{url:'https://deck.test/',visibilityState:'visible',focused:true}});
 expect(f.notifications).toHaveLength(0);
 expect(f.badges.at(-1)).toBe(0);
 await f.run('push',{data:{json:()=>({...payload,kind:'finished'})}});
 expect(f.notifications[0].data.count).toBe(1);
});

test('hidden, unfocused, foreign and malformed view messages cannot clear session notifications',async()=>{
 const f=fixture();await f.run('push',{data:{json:()=>({...payload,kind:'finished'})}});
 for(const source of [undefined,{url:'https://deck.test/',visibilityState:'hidden',focused:true},{url:'https://deck.test/',visibilityState:'visible',focused:false},{url:'https://evil.test/',visibilityState:'visible',focused:true}])
  await f.run('message',{data:{type:'deck.session-viewed',sessionId:'exact-session'},source});
 await f.run('message',{data:{type:'deck.session-viewed',sessionId:'../exact-session'},source:{url:'https://deck.test/',visibilityState:'visible',focused:true}});
 expect(f.notifications).toHaveLength(1);
});

test('click and manual dismissal reconcile badges, with unsupported or rejected badging remaining optional',async()=>{
 for(const badge of [undefined,'unsupported','reject'] as const){
  const f=fixture({badge});
  for(const kind of ['finished','approval'])await f.run('push',{data:{json:()=>({...payload,kind})}});
  await f.run('notificationclick',{notification:f.notifications[0]});
  expect(f.notifications).toHaveLength(0);
  if(!badge)expect(f.badges.at(-1)).toBe(0);
  await f.run('push',{data:{json:()=>payload}});
  const notification=f.notifications[0];notification.close();
  await f.run('notificationclose',{notification});
  if(!badge)expect(f.badges.at(-1)).toBe(0);
 }
});

test('an unresponsive optional OS badging API cannot stall subsequent notification delivery',async()=>{
 const f=fixture({badge:'pending'});
 await Promise.race([
  f.run('push',{data:{json:()=>({...payload,kind:'finished'})}}).then(()=>f.run('push',{data:{json:()=>({...payload,kind:'finished',seq:21})}})),
  new Promise(resolve=>setTimeout(resolve,1500)),
 ]);
 expect(f.notifications[0].data.count).toBe(2);
});
