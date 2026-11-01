import { buildCodexMcpServers, mergeCodexMcpServers } from "../../../../../packages/adapter-codex/src/mcp-config";
// Standalone real-CLI acceptance. Run only in the loopback-only namespace recipe.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Supervisor } from '../../../../../packages/session-host/src/supervisor';
import { createDriverSpawn } from '../../../../../packages/session-host/src/driver-spawn';
import { runChildAnchor } from '../../../../../packages/session-host/src/anchor';
import { createOpenCodeSessionDriver } from '../../../../../packages/adapter-opencode/src/session-driver/driver';
import { createCodexSessionDriver } from '../../../../../packages/adapter-codex/src/session-driver/driver';
import { createCodexTools } from '../../../../../packages/adapter-codex/src/tools';
import { createClaudeSessionDriver } from '../../../../../packages/adapter-claude/src/session-driver/driver';
import { installClaudeFixture } from './claude';
import { prepareSessionNativeMemory } from '../../session-native-memory';
import { resolveCanonicalSupermemoryProjectScope, validateDeckConfig } from '@deck/core';
import { installOwnedOpenCodeSupermemory, configureOpenCodeSupermemoryCapture, OPENCODE_SUPERMEMORY_PACKAGE_VERSION, OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY } from '../../../../../packages/adapter-opencode/src/opencode-supermemory-plugin';
import type { DriverTaskInput } from '@deck/core/session/driver';

if (process.argv[2] === 'anchor') { await runChildAnchor(process.argv.slice(3)); process.exit(0); }
const evidence = process.argv[2]!;
const runner = process.argv[3]!;
assert(['claude','codex','opencode'].includes(runner));
assert.equal(process.env.HOME, '/tmp/lifecycle-home');
assert.equal(readFileSync('/proc/net/route', 'utf8').trim().split('\n').length, 1, 'network namespace must have no routed interfaces');
assert.deepEqual(Object.keys((await import('node:os')).networkInterfaces()), ['lo']);
assert(!existsSync('/home'), 'host HOME must not be mounted');
const home = process.env.HOME;
const project = join(home, 'project');
mkdirSync(project, { recursive: true, mode: 0o700 });
for(const args of [['init','-q'],['remote','add','origin','https://github.com/example/native-lifecycle.git']]) assert.equal(Bun.spawnSync(['git','-C',project,...args],{stderr:'pipe'}).exitCode,0);
const binding=resolveCanonicalSupermemoryProjectScope({projectRoot:project,remotes:[]});assert(binding.ok);const scope=binding.scope;
const version=Bun.spawnSync([process.env[`NATIVE_${runner.toUpperCase()}`]!, '--version'],{stdout:'pipe',stderr:'pipe'});assert.equal(version.exitCode,0);
writeFileSync(join(evidence,'version.txt'),version.stdout,{mode:0o600});
const log = (name: string, value: unknown) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const requests: unknown[] = [];
let held = false, accepted = false, release!: () => void;
let hold = new Promise<void>(resolve => release = resolve);
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 30, async fetch(request) {
  const path = new URL(request.url).pathname;
  const body = request.method === 'POST' ? await request.json() as any : {};
  requests.push({ path, body });
  if(path==='/mcp') {
    if(body.id===undefined)return new Response(null,{status:202});
    const result=body.method==='initialize'?{protocolVersion:body.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'local-fixture',version:'1'}}:body.method==='tools/list'?{tools:[{name:'deck_approve',description:'Fixture approval',inputSchema:{type:'object',properties:{}}}]}:{};
    return Response.json({jsonrpc:'2.0',id:body.id,result});
  }
  if(path==='/v1/messages') {
    const message={id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}};
    const chunks=[{type:'message_start',message},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Confirmed: pending deliveries use teal.'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}},{type:'message_stop'}];
    return new Response(chunks.map(x=>`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  }
  if (path.endsWith('/responses')) {
    const message={type:'message',id:'message-fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'Confirmed: pending deliveries use teal.',annotations:[]}]};
    const response={id:'response-fixture',object:'response',created_at:1,model:'gpt-5.4',status:'completed',output:[message],usage:{input_tokens:10,output_tokens:8,total_tokens:18}};
    const chunks=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...message,status:'in_progress',content:[]}},{type:'response.output_text.delta',item_id:message.id,output_index:0,content_index:0,delta:message.content[0]!.text},{type:'response.output_item.done',output_index:0,item:message},{type:'response.completed',response}];
    return new Response(chunks.map(x=>`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  }
  if (path.endsWith('/chat/completions')) {
    const content = 'Confirmed: pending deliveries use teal.';
    if (!body.stream) return Response.json({id:'fake',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}});
    const chunks = [{id:'fake',object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]},{id:'fake',object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:8,total_tokens:18}}];
    return new Response(chunks.map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}});
  }
  if (path.endsWith('/document') || path === '/v3/documents') { assert.equal(path,`/ns/${scope}/document`);assert.equal(request.headers.get('authorization'),'Bearer fake-plugin-credential');held = true; await hold; if(request.signal.aborted)return new Response(null,{status:499});accepted = true; return Response.json({id:'fake-document',status:'queued'}); }
  if (path.endsWith('/profile')) return Response.json({profile:{static:[],dynamic:[]}});
  if (path.endsWith('/search')) return Response.json({results:[],total:0,searchTime:1});
  if (path === '/v3/settings') return Response.json({});
  return new Response('Unexpected fake operation', {status:400});
}});
const baseURL = `http://127.0.0.1:${server.port}`;
writeFileSync(join(home, '.npmrc'), `registry=${baseURL}/registry\nfetch-retries=0\n`);
const source = resolve(import.meta.resolve('opencode-supermemory').replace('file://',''), '../..');
const installed = await installOwnedOpenCodeSupermemory({projectRoot:project, homeDirectory:home, environment:process.env,
  runInstallCommand:async (_command,args) => {
    const root = args[args.indexOf('--prefix')+1]!;
    for (const name of ['package.json','dist/index.js','dist/server.js']) { const to=join(root,'node_modules/opencode-supermemory',name); mkdirSync(join(to,'..'),{recursive:true,mode:0o700});copyFileSync(join(source,name),to); }
    writeFileSync(join(root,'package-lock.json'),JSON.stringify({packages:{'node_modules/opencode-supermemory':{version:OPENCODE_SUPERMEMORY_PACKAGE_VERSION,integrity:OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY}}}));
    return {exitCode:0,stdout:'',stderr:''};
  }});
assert(installed.ok,installed.diagnostic);
configureOpenCodeSupermemoryCapture(home);
let codexMemory:DriverTaskInput['nativeMemory'];
let claudeMemory:DriverTaskInput['nativeMemory'];
if(runner==='claude') {
  await installClaudeFixture(home);
  claudeMemory=prepareSessionNativeMemory('claude',project,validateDeckConfig({adaptiveMemory:{enabled:true,activeProvider:'supermemory'}}),process.env,{credential:()=>({token:'fake-plugin-credential',canonicalRepoTag:scope})})?.nativeMemory;
  assert.equal(claudeMemory?.status,'ready',JSON.stringify(claudeMemory));
}
if(runner==='codex') {
  const tools=createCodexTools({homeDir:home,nodeCommand:process.env.NODE_EXECUTABLE,supermemoryArtifactEffects:{fetchTarball:async()=>readFileSync(resolve(import.meta.dir,'../../../../../packages/adapter-codex/src/__fixtures__/supermemory/codex-supermemory-1.1.0.tgz'))}});
  await tools.supermemory.install();
  writeFileSync(join(home,'.codex/config.toml'),mergeCodexMcpServers(`# deck-codex-hook:supermemory:start\n# deck-codex-hook:supermemory:end\nmodel_provider="fixture"\nmodel="gpt-5.4"\n[model_providers.fixture]\nname="Fixture"\nbase_url="${baseURL}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`, buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProxy: { nodeCommand: tools.node.command()!, script: tools.supermemory.proxy()! } }).servers).content);
  codexMemory=prepareSessionNativeMemory('codex',project,validateDeckConfig({adaptiveMemory:{enabled:true,activeProvider:'supermemory'}}),process.env,{credential:()=>({token:'fake-plugin-credential',canonicalRepoTag:scope})})?.nativeMemory;
  assert.equal(codexMemory?.status,'ready',JSON.stringify(codexMemory));
}
const supervisor = new Supervisor({anchorCommand:[process.execPath,import.meta.path,'anchor']});
const spawn = createDriverSpawn(supervisor);
const results: unknown[] = [];
const bounded = async <T>(promise:Promise<T>, ms:number):Promise<T> => { let timer:ReturnType<typeof setTimeout>; try {return await Promise.race([promise,new Promise<never>((_,reject)=>timer=setTimeout(()=>reject(new Error('Canary deadline')),ms))]);} finally {clearTimeout(timer!);} };
try {
  for (const boundary of ['complete','interrupt']) {
    held=false;accepted=false;hold=new Promise<void>(resolve=>release=resolve);
    const events:unknown[]=[]; const native:unknown[]=[];
    const env = {...process.env, npm_config_registry:baseURL+'/registry', SUPERMEMORY_CODEX_API_KEY:'fake-plugin-credential', SUPERMEMORY_API_KEY:'fake-plugin-credential',SUPERMEMORY_BASE_URL:baseURL,SUPERMEMORY_API_URL:baseURL,SUPERMEMORY_MCP_URL:baseURL+'/mcp',SUPERMEMORY_API_VERSION:'v5',SUPERMEMORY_REPO_TAG:scope,OPENCODE_DISABLE_DEFAULT_PLUGINS:'true',OPENCODE_DISABLE_MODELS_FETCH:'true',
      OPENCODE_CONFIG_CONTENT:JSON.stringify({provider:{fixture:{npm:'@ai-sdk/openai-compatible',name:'Fake local model',options:{baseURL:baseURL+'/v1',apiKey:'fake-model'},models:{model:{name:'Fixture',limit:{context:32000,output:1000}}}}},model:'fixture/model'})};
    const input:DriverTaskInput={taskId:`fixture-${boundary}`,memberId:'apply-deep',cwd:project,assignment:{runnerId:'opencode',modelId:'fixture/model'},rolePrompt:'Answer once without tools.',prompt:'Remember: pending deliveries use teal.',mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'runner-default',credentialFile:join(home,'unused'),disableNativeDelegation:true,nativeMemory:{provider:'supermemory',integration:'runner-plugin',status:'ready',projectScope:scope,plugin:{root:installed.paths.installRoot,loaderPath:installed.paths.loaderPath}}};
    if(runner==='codex') {input.assignment={runnerId:'codex',modelId:'fixture/gpt-5.4'};input.nativeMemory=codexMemory;}
    if(runner==='claude') {Object.assign(env,{ANTHROPIC_API_KEY:'fake-model',ANTHROPIC_BASE_URL:baseURL,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',SUPERMEMORY_CC_API_KEY:'fake-plugin-credential',SUPERMEMORY_MCP_URL:baseURL+'/mcp'});input.assignment={runnerId:'claude',modelId:'claude-sonnet-4-5'};input.nativeMemory=claudeMemory;input.approvals='relay';input.mcp={servers:['deck'],sessionTools:[]};input.mcpServerSpecs={deck:{transport:'http',url:baseURL+'/mcp'}};}
    const driver=runner==='claude'?createClaudeSessionDriver({executable:process.env.NATIVE_CLAUDE,baseEnv:env,escalationMs:1000,extraArgs:['--debug-file',join(evidence,`${boundary}-debug.log`)]}):runner==='codex'?createCodexSessionDriver({executable:process.env.NATIVE_CODEX,baseEnv:env,rpcTimeoutMs:10000,escalationMs:1000}):createOpenCodeSessionDriver({executable:process.env.NATIVE_OPENCODE,baseEnv:env,readinessMs:15000});
    const handle=await bounded(driver.startTask(input,{emit:event=>events.push(event),approval:async()=>({decision:'deny'}),writePrivateFile:(name,content)=>{const path=join(home,`${boundary}-${name}`);writeFileSync(path,content,{mode:0o600});return path;},spawn:async(command,args,options)=>{log(`${boundary}-launch.json`,{command,args,envNames:Object.keys(options?.env??{}).sort()});const child=await spawn(command,args,options);child.onStdout(text=>{native.push({stdout:text});log(`${boundary}-native.json`,native);});child.onStderr(text=>{native.push({stderr:text});log(`${boundary}-native.json`,native);});return child;}}),18000);
    try {
      if(runner==='claude') {
        let terminal=false;const done=handle.done.then(value=>{terminal=true;return value;});
        const deadline=performance.now()+10000;
        while(!held&&!terminal&&performance.now()<deadline)await Bun.sleep(10);
        assert(held,'official Claude capture must reach held provider before process teardown');
        assert(!terminal,'Claude must retain the native process while capture is held');
        if(boundary==='complete')release();else await handle.interrupt();
        const outcome=await bounded(done,3000);
        if(boundary==='complete') assert.equal(outcome.status,'completed');
        else assert(['interrupted','interrupted-forced'].includes(outcome.status),'cancellation must remain interrupted');
        const capture=handle.captureOutcome?.();
        assert.equal(capture?.reason,boundary==='complete'?'official-capture-marker-observed':'capture-interrupted');
        assert.equal(capture?.acceptance,'unknown');
        assert.equal(accepted,boundary==='complete');
        results.push({boundary,outcome,capture,accepted,nativeSessionId:await handle.nativeSessionId});
        if(boundary==='complete') {
          held=false;accepted=false;hold=new Promise<void>(resolve=>release=resolve);
          let resumed=false;const follow=handle.send('Correction: pending deliveries use violet.').then(value=>{resumed=true;return value;});
          const end=performance.now()+10000;
          while(!held&&!resumed&&performance.now()<end)await Bun.sleep(10);
          assert(held&&!resumed,'previous capture marker must not release a resumed turn');
          release();assert.equal((await bounded(follow,3000)).status,'completed');
          assert.equal(handle.captureOutcome?.().reason,'official-capture-marker-observed');
          results.push({boundary:'resume',accepted,nativeSessionId:await handle.nativeSessionId,capture:handle.captureOutcome?.()});
        }
        continue;
      }
      if(runner==='codex') {
        let terminal=false;const done=handle.done.then(value=>{terminal=true;return value;});
        const deadline=performance.now()+12000;
        while(!held&&!terminal&&performance.now()<deadline)await Bun.sleep(10);
        assert(held,`official capture must reach held fake provider: ${terminal?JSON.stringify(await done):'timeout'}`);
        assert(!terminal,'native Stop must hold turn/completed');
        if(boundary==='complete')release();else await handle.interrupt();
        const outcome=await bounded(done,3000);
        assert.equal(outcome.status,boundary==='complete'?'completed':'interrupted');
        const notifications=native.flatMap((value:any)=>value.stdout??[]).join('').split('\n').filter(Boolean).map(line=>JSON.parse(line));
        const terminalNotice=notifications.filter(value=>value.method==='turn/completed').at(-1);
        const nativeSessionId=await handle.nativeSessionId;
        assert.equal(terminalNotice.params.threadId,nativeSessionId);
        const stop=notifications.filter(value=>value.params?.threadId===nativeSessionId && value.params?.turnId===terminalNotice.params.turn.id && value.params?.run?.eventName==='stop');
        const started=stop.find(value=>value.method==='hook/started');
        assert.equal(started?.params.run.executionMode,'sync');assert.equal(started?.params.run.source,'sessionFlags');
        if(boundary==='complete') {
          const completed=stop.find(value=>value.method==='hook/completed');
          assert.equal(completed?.params.run.id,started.params.run.id);assert.equal(completed?.params.run.status,'completed');
          assert(notifications.indexOf(completed)<notifications.indexOf(terminalNotice));
        }
        await handle.close();
        results.push({boundary,outcome,accepted,nativeSessionId,nativeTurnId:terminalNotice.params.turn.id,hookId:started.params.run.id,acceptance:'unknown'});
        continue;
      }
      const done=await bounded(handle.done,12000); assert.equal(done.status,'completed',JSON.stringify(done));
      let closed=false; const closing=handle.close().then(()=>{closed=true;});
      const deadline=performance.now()+1500;
      while(!held&&performance.now()<deadline) await Bun.sleep(10);
      assert(held,'official capture must reach held fake provider');
      assert(!closed,'close must remain owned while capture is held'); assert(!accepted);
      if(boundary==='complete') release(); else await handle.interrupt();
      await bounded(closing,3000);
      const outcome=handle.captureOutcome?.();
      assert.equal(outcome?.lifecycle,boundary==='complete'?'completed':'unknown');
      assert.equal(outcome?.acceptance,'unknown'); assert.equal(accepted,boundary==='complete');
      results.push({boundary,done,outcome,accepted,nativeSessionId:await handle.nativeSessionId});
    } finally { await handle.close(); log(`${boundary}-events.json`,events);log(`${boundary}-native.json`,native); }
  }
  log('result.json',results);
} finally {release();await supervisor.shutdown(100);server.stop(true);log('requests.json',requests); const snapshots:Record<string,string>={};for(const dir of ['.codex-supermemory','.codex/sessions','.supermemory-claude','.claude/projects']){const root=join(home,dir);if(existsSync(root))for(const entry of readdirSync(root,{recursive:true,withFileTypes:true}))if(entry.isFile()){const path=join(entry.parentPath,entry.name);if(!/credentials|auth/i.test(path))snapshots[path.slice(home.length)]=readFileSync(path,'utf8');}}if(existsSync(join(home,'.codex-supermemory.log')))snapshots['.codex-supermemory.log']=readFileSync(join(home,'.codex-supermemory.log'),'utf8');log('synthetic-state.json',snapshots);}
