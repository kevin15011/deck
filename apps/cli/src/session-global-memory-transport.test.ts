import { afterEach, describe, expect, test } from 'bun:test';
import { startGlobalMemoryTransport, type MemoryTransportFetch } from './session-global-memory-transport.js';

const transports: Awaited<ReturnType<typeof startGlobalMemoryTransport>>[] = [];
afterEach(async () => { await Promise.all(transports.splice(0).map((transport) => transport.close())); });
async function setup(fetcher: MemoryTransportFetch = (async () => Response.json({ results: ['actual memory'] })) as MemoryTransportFetch) {
  const transport = await startGlobalMemoryTransport({ token: 'provider-secret', fetch: fetcher });
  transports.push(transport);
  return transport;
}
async function post(transport: Awaited<ReturnType<typeof setup>>, path: string, body: unknown) {
  return fetch(`${transport.apiUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${transport.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('untagged global memory transport', () => {
  test('starts without provider I/O and isolates child credentials', async () => {
    let calls = 0;
    const transport = await setup((async () => { calls++; return Response.json({}); }) as MemoryTransportFetch);
    expect(calls).toBe(0);
    expect(transport.token).not.toBe('provider-secret');
    expect(transport.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+$/);
    expect(transport.mcpUrl).toBe(`${transport.apiUrl}/mcp`);
    expect(JSON.stringify(transport)).not.toContain('provider-secret');
  });
  test('removes only top-level API selectors and forwards solely to fixed authenticated origin', async () => {
    const calls: {url: string; init: RequestInit}[] = [];
    const transport = await setup((async (url, init) => { calls.push({ url: String(url), init: init! }); return Response.json({ results: [1] }); }) as MemoryTransportFetch);
    for (const path of ['/v3/documents', '/v3/documents/list', '/v4/search']) {
      expect((await post(transport, path, { containerTag: 'folder', containerTags: ['folder'], content: 'containerTag text', metadata: {containerTag: 'preserve',originalContainerTags:['generated-folder'],source:'opencode'} })).ok).toBe(true);
      const call = calls.at(-1)!;
      expect(call.url).toBe(`https://api.supermemory.ai${path}`);
      expect(call.init.redirect).toBe('error');
      expect(new Headers(call.init.headers).get('authorization')).toBe('Bearer provider-secret');
      expect(new Headers(call.init.headers).get('cookie')).toBeNull();
      expect(JSON.parse(call.init.body as string)).toEqual({content:'containerTag text',metadata:{containerTag:'preserve',source:'opencode'}});
    }
  });
  test('preserves the pinned Claude native hook payload and actual provider response contract', async () => {
    // official-supermemory-915aba1b8056/hooks/lib/api.js: getProfile/addMemory.
    const calls: {url:string;body:unknown}[]=[];
    const transport=await setup((async(url,init)=>{
      calls.push({url:String(url),body:JSON.parse(init!.body as string)});
      return Response.json(String(url).endsWith('/search') ? {results:[{id:'memory-1',content:'Use Bun',similarity:0.9}],total:1} : {id:'document-1',status:'queued'});
    }) as MemoryTransportFetch);
    const document={content:'Durable user decision',containerTag:'sm-folder-hash',metadata:{sm_source:'claude-code',sessionId:'session-1'},customId:'session-1',entityContext:'Shared coding-agent memory'};
    expect(await (await post(transport,'/v3/documents',document)).json()).toEqual({id:'document-1',status:'queued'});
    expect(calls[0].body).toEqual({content:document.content,metadata:document.metadata,customId:document.customId,entityContext:document.entityContext});
    const recalled=await (await post(transport,'/v4/profile',{containerTag:'sm-folder-hash',q:'package manager'})).json();
    expect(calls[1]).toEqual({url:'https://api.supermemory.ai/v4/search',body:{q:'package manager'}});
    expect(recalled.searchResults.results[0].content).toBe('Use Bun');
    expect(recalled.profile).toEqual({static:[],dynamic:[]});
  });
  test('profile uses real untagged search and never invents facts', async () => {
    const calls: {url: string; body: unknown}[] = [];
    const transport = await setup((async (url, init) => { calls.push({url:String(url),body:JSON.parse(init!.body as string)}); return Response.json({results:['real'],total:1}); }) as MemoryTransportFetch);
    const empty = await post(transport, '/v4/profile', { containerTag: 'folder' });
    expect(await empty.json()).toEqual({profile:{static:[],dynamic:[]},searchResults:{results:[],total:0}});
    expect(calls).toHaveLength(0);
    const result = await post(transport, '/v4/profile', { q:'find',containerTag:'folder',threshold:0.6 });
    expect(await result.json()).toEqual({profile:{static:[],dynamic:[]},searchResults:{results:['real'],total:1}});
    expect(calls).toEqual([{url:'https://api.supermemory.ai/v4/search',body:{q:'find',threshold:0.6}}]);
  });
  test('MCP advertises and executes only global-safe tools including encoded arguments', async () => {
    const calls: {url:string;body:unknown}[]=[];
    const transport=await setup((async(url,init)=>{ calls.push({url:String(url),body:JSON.parse(init!.body as string)}); return Response.json({results:['actual']}); }) as MemoryTransportFetch);
    const rpc=async(method:string, params?:unknown)=> (await post(transport,'/mcp',{jsonrpc:'2.0',id:1,method,params})).json();
    const initialized=await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'native-supermemory',version:'1.0.0'}});
    expect(initialized.result.protocolVersion).toBe('2024-11-05');
    expect(initialized.result.capabilities).toEqual({tools:{}});
    expect((await post(transport,'/mcp',{jsonrpc:'2.0',method:'notifications/initialized'})).status).toBe(202);
    expect((await rpc('tools/list')).result.tools.map((tool:{name:string})=>tool.name)).toEqual(['search_memory','add_memory','listDocuments']);
    for(const [name,path,args] of [ ['search_memory','/v4/search',{q:'query'}], ['add_memory','/v3/documents',{content:'memory'}], ['listDocuments','/v3/documents/list',{limit:5}], ] as const) {
      const response=await rpc('tools/call',{name,arguments:JSON.stringify({...args,containerTag:'folder',containerTags:['folder'],spaceId:'active'})});
      expect(JSON.parse(response.result.content[0].text)).toEqual({results:['actual']});
      expect(calls.at(-1)).toEqual({url:`https://api.supermemory.ai${path}`,body:{...args}});
    }
    expect((await rpc('tools/call',{name:'create_space',arguments:{}})).error).toBeDefined();
    expect((await rpc('tools/call',{name:'listMemories',arguments:{}})).error).toBeDefined();
    expect((await rpc('tools/call',{name:'search_memory',arguments:{query:'x',url:'https://evil.test'}})).error).toBeDefined();
    expect(calls).toHaveLength(3);
  });
  test('rejects unauthenticated, wrong paths, tag management and oversized requests without forwarding', async () => {
    let calls=0;
    const transport=await setup((async()=>{calls++;return Response.json({});}) as MemoryTransportFetch);
    expect((await fetch(`${transport.apiUrl}/v4/search`,{method:'POST',body:'{}'})).status).toBe(401);
    for(const path of ['/v4/search?url=https://evil.test','/v4/search/','/v3/container-tags','/https://evil.test']) expect((await post(transport,path,{})).status).toBe(404);
    expect((await fetch(`${transport.apiUrl}/v3/container-tags/folder`,{headers:{Authorization:`Bearer ${transport.token}`}})).status).toBe(405);
    expect((await post(transport,'/v4/search',{q:'x'.repeat(600_000)})).status).toBe(413);
    expect(calls).toBe(0);
  });
  test('rejects wrong Host and browser Origin and never forwards inbound cookies', async () => {
    const headersSeen:Headers[]=[];
    const transport=await setup((async(_url,init)=>{headersSeen.push(new Headers(init!.headers));return Response.json({});}) as MemoryTransportFetch);
    const send=async(headers:Record<string,string>)=>fetch(`${transport.apiUrl}/v4/search`,{method:'POST',headers:{Authorization:`Bearer ${transport.token}`,'Content-Type':'application/json',...headers},body:'{}'});
    expect((await send({Host:'evil.test'})).status).toBe(403);
    expect((await send({Origin:'https://evil.test'})).status).toBe(403);
    expect(headersSeen).toHaveLength(0);
    expect((await send({Cookie:'private=never-forward','X-Sm-Source':'child-spoof'})).ok).toBe(true);
    expect([...headersSeen[0]!.keys()].sort()).toEqual(['authorization','content-type']);
  });
  test('bounds concurrent provider requests and releases capacity after completion', async () => {
    const release: (()=>void)[]=[];
    let allStarted!:()=>void;
    const ready=new Promise<void>(resolve=>{allStarted=resolve;});
    const transport=await setup((async()=>{
      await new Promise<void>(resolve=>{release.push(resolve);if(release.length===8)allStarted();});
      return Response.json({results:[]});
    }) as MemoryTransportFetch);
    const requests=Array.from({length:8},()=>post(transport,'/v4/search',{q:'x'}));
    await ready;
    expect((await post(transport,'/v4/search',{q:'excess'})).status).toBe(503);
    expect(release).toHaveLength(8);
    release.forEach(resolve=>resolve());
    expect((await Promise.all(requests)).every(response=>response.ok)).toBe(true);
  });
  test('cancels rejected provider response bodies and never exposes raw exceptions', async () => {
    let cancelled=false;
    const transport=await setup((async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:500})) as MemoryTransportFetch);
    expect((await post(transport,'/v4/search',{})).status).toBe(502);
    expect(cancelled).toBe(true);
    const failed=await setup((async()=>{throw new Error('provider-secret');}) as MemoryTransportFetch);
    const response=await post(failed,'/v4/search',{});
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('provider-secret');
  });
  test('rejects redirect and oversized provider responses without leaking provider errors', async () => {
    for(const providerResponse of [new Response('provider-secret',{status:302,headers:{location:'https://evil.test'}}),new Response('x'.repeat(2_100_000))]) {
      const transport=await setup((async()=>providerResponse) as MemoryTransportFetch);
      const response=await post(transport,'/v4/search',{q:'x'});
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('provider-secret');
    }
  });
  test('close aborts in-flight upstream and closes listener; parent abort closes too', async () => {
    let started!:()=>void;
    const ready=new Promise<void>(resolve=>{started=resolve;});
    let upstreamSignal:AbortSignal|undefined;
    const transport=await setup((async(_url,init)=>{upstreamSignal=init!.signal!;started();return new Promise((_resolve,reject)=>upstreamSignal!.addEventListener('abort',()=>reject(new Error('provider-secret')),{once:true}));}) as MemoryTransportFetch);
    const request=post(transport,'/v4/search',{q:'x'}).catch(()=>null);
    await ready;
    await transport.close();
    expect(upstreamSignal!.aborted).toBe(true);
    await request;
    await expect(post(transport,'/v4/search',{})).rejects.toBeDefined();
    const controller=new AbortController();
    const aborted=await startGlobalMemoryTransport({token:'provider-secret',signal:controller.signal});
    controller.abort();
    await aborted.close();
    await expect(post(aborted,'/v4/search',{})).rejects.toBeDefined();
  });
});
