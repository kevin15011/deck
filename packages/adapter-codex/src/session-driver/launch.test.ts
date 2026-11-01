import {expect,test} from 'bun:test';
import type {DriverTaskInput} from '@deck/core/session/driver';
import {buildCodexLaunch,codexThreadMcpConfig,matchesCodexMemoryGroups,codexMemoryHooks,ISOLATION_FEATURES,verifyCodexConfig} from './launch';
const input:DriverTaskInput={taskId:'t',memberId:'lead',cwd:'/work',assignment:{runnerId:'codex',modelId:'fake'},rolePrompt:'',prompt:'',mcp:{servers:['deck-task'],sessionTools:[]},mcpServerSpecs:{'deck-task':{command:'fixture',args:['FAKE_SECRET'],env:{TOKEN:'FAKE_SECRET'}}},approvals:'relay',credentialFile:'/private/credential',disableNativeDelegation:true};
const features=Object.fromEntries(ISOLATION_FEATURES.map(f=>[f,false]));
test('fresh native config can retain unrelated servers/plugins; an existing task alias cannot contaminate the addition',()=>{expect(()=>verifyCodexConfig({features,mcp_servers:{personal:{url:'https://example.invalid'}}},input)).not.toThrow();expect(()=>verifyCodexConfig({features,mcp_servers:{'deck-task':{command:'foreign'}}},input)).toThrow('codex-mcp-spec-isolation-violation');expect(()=>verifyCodexConfig({features:{multi_agent:true,multi_agent_v2:false}},input)).toThrow('codex-feature-isolation-violation');});
test('only task additions and explicit suppressions enter private thread config; secrets never enter argv',()=>{const launch=buildCodexLaunch(input,{baseEnv:{HOME:'/user'}});expect(launch.args.join(' ')).not.toContain('FAKE_SECRET');expect(launch.args.some(x=>x.startsWith('mcp_servers=')||x.startsWith('plugins='))).toBe(false);expect(launch.args).not.toContain('features.plugins=false');expect(launch.args).not.toContain('features.hooks=false');expect(codexThreadMcpConfig({...input,suppressedMcpServers:['unavailable-codebase']},['unavailable-codebase','personal'])).toEqual({mcp_servers:{'unavailable-codebase':{enabled:false},'deck-task':{enabled:true,command:'fixture',args:['FAKE_SECRET'],env:{TOKEN:'FAKE_SECRET'}}}});});
const nativeMemory:NonNullable<DriverTaskInput['nativeMemory']>={provider:'supermemory',integration:'runner-plugin',status:'ready',projectScope:'sm_project_v1_owner_repo',plugin:{root:'/plugins/supermemory',nodeCommand:'/usr/bin/node',scripts:{recall:'/plugins/supermemory/recall.js',flush:'/plugins/supermemory/flush.js'}}};
test('managed memory hooks coexist with other native events and do not disable native plugins',()=>{const launch=buildCodexLaunch({...input,nativeMemory},{baseEnv:{}});expect(launch.args).toContain('features.hooks=true');expect(launch.args).not.toContain('features.plugins=false');const hooks=launch.args.find(x=>x.startsWith('hooks='))!;expect(hooks).not.toContain('SessionStart');expect(hooks).toContain('/plugins/supermemory/recall.js');expect(hooks).not.toContain('bypass');});
test('unavailable memory blocks and global scope drops inherited provider selectors',()=>{expect(()=>buildCodexLaunch({...input,nativeMemory:{...nativeMemory,status:'unavailable'}},{baseEnv:{}})).toThrow('codex-native-memory-unavailable');expect(()=>buildCodexLaunch({...input,nativeMemory:{...nativeMemory,plugin:undefined}},{baseEnv:{}})).toThrow('codex-native-memory-invalid');const launch=buildCodexLaunch({...input,nativeMemory:{...nativeMemory,scopeMode:'global',projectScope:undefined}},{baseEnv:{HOME:'/user',SUPERMEMORY_API_KEY:'FAKE',SUPERMEMORY_REPO_TAG:'foreign'}});expect(launch.env).toEqual({HOME:'/user'});});
test('default-mode questions remain enabled for supervised launches',()=>expect(buildCodexLaunch(input,{baseEnv:{}}).args).toContain('features.default_mode_request_user_input=true'));

test('installed default matchers are compatible; a different memory command is an exact protected conflict',()=>{const inputWithMemory={...input,nativeMemory};const groups=(codexMemoryHooks(inputWithMemory).UserPromptSubmit as any[]).map(group=>({...group,matcher:'*'}));expect(matchesCodexMemoryGroups(groups,'UserPromptSubmit',inputWithMemory)).toBe(true);expect(matchesCodexMemoryGroups([{hooks:[{type:'command',command:'foreign'}]}],'UserPromptSubmit',inputWithMemory)).toBe(false);});

test('absent suppressed names must not create invalid native MCP tables',()=>{expect(codexThreadMcpConfig({...input,suppressedMcpServers:['absent']})).toEqual(codexThreadMcpConfig(input));});

test('review threads default-deny personal and unknown MCPs and allow only canonical read tools',()=>{
  const review={...input,memberId:'quality',mcp:{servers:['context7','deck-task'],sessionTools:[]},mcpServerSpecs:{...input.mcpServerSpecs,context7:{command:'context7',args:[],env:{}}}};
  const servers=codexThreadMcpConfig(review,['personal']).mcp_servers as any;
  expect(servers.personal).toEqual({enabled:false});
  expect(servers['deck-task']).toBeUndefined();
  expect(servers.context7.enabled_tools).toEqual(['resolve-library-id','query-docs']);
});

// R1: native trust must not revive a script rejected during preparation.
test('rejected role hooks disable native hooks even with previously trusted metadata', () => {
  const launch = buildCodexLaunch({ ...input, nativeRoleDescriptor: {
    runnerId: 'codex', roleId: 'deck-lead', roleRef: 'lead', generation: 'g', source: { root: '/isolated', files: {} }, instructions: '', hooks: [],
    preparation: [{ kind: 'W', code: 'codex-hooks-preserved', item: 'hooks', message: 'rejected' }],
  } }, {}, [{ key: 'trusted', currentHash: 'hash', eventName: 'sessionStart', command: 'edited-script', handlerType: 'command', source: 'user' }]);
  expect(launch.args).toContain('features.hooks=false');
  expect(launch.args).not.toContain('features.hooks=true');
});

// Protects read-only access to local continuity without granting memory writes,
// delegation or approval. Native tool filtering and host grants both apply.
test('read-only tasks can page local history without mutation tools',()=>{
  const id='deck-session-t-deck';
  const review={...input,memberId:'quality',mcp:{servers:[id],sessionTools:['deck_session_history','deck_memory_propose']},mcpServerSpecs:{[id]:input.mcpServerSpecs['deck-task']!}};
  const servers=codexThreadMcpConfig(review).mcp_servers as any;
  expect(servers[id].enabled_tools).toEqual(['deck_session_history']);
  expect(servers[id].enabled_tools).not.toContain('deck_memory_propose');
});
