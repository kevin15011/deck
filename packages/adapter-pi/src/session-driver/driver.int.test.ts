import {piFixture} from './pi-session.fixture';
// Protects selected role -> native IPC -> live authority and host-owned cleanup.
// Oracle: stdout cannot attest; cancellation, role/header or generation changes permanently revoke.
import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPiGlobalMaterialization } from '../global-materialization';
import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from '../pi-global-install';
import { Supervisor } from '../../../session-host/src/supervisor';
import { createDriverSpawn } from '../../../session-host/src/driver-spawn';
import { waitFor } from '../../../session-host/src/__tests__/test-helpers';
import { createPiSessionDriver } from './driver';
import { preparePiSessionRole } from './native-role';
import type { DriverHostIo, DriverTaskInput } from '@deck/core/session/driver';
import { createPiHarness } from '../pi-cli-harness';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

test.each(['live','generation','header','role','stdout','wrong-session','wrong-pid'])('Pi session binding: %s',async mode=>{
  const root=mkdtempSync(join(tmpdir(),'deck-pi-session-'));
  const fixture=piFixture(root,mode), supervisor=new Supervisor({anchorCommand:[process.execPath,join(import.meta.dir,'../../../session-host/src/__tests__/fixtures/anchor-entry.ts')]});
  const taskDir=join(root,'task');mkdirSync(taskDir,{mode:0o700});
  const bindings:Parameters<NonNullable<DriverHostIo['validatedLaunch']>>[0][]=[];
  const input:DriverTaskInput={taskId:'task',memberId:'setup',cwd:root,assignment:{runnerId:'pi',modelId:'fake'},
    nativeRoleDescriptor:preparePiSessionRole(fixture.agentDir,'deck-setup'),prompt:'Repair',rolePrompt:'',
    mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'relay',credentialFile:join(taskDir,'credential'),disableNativeDelegation:true};
  let started=false;
  const driver=createPiSessionDriver({command:fixture.command,baseEnv:{PATH:process.env.PATH},startupMs:3000});
  const handle=await driver.startTask(input,{spawn:createDriverSpawn(supervisor),approval:async()=>({decision:'deny'}),emit:e=>{if(e.kind==='message.completed')started=true;},
    validatedLaunch:b=>{bindings.push(b);return true;},writePrivateFile:(name,content)=>{const file=join(taskDir,name);writeFileSync(file,content,{mode:0o600});return file;}});
  try {
    if(mode==='stdout'||mode==='wrong-session'||mode==='wrong-pid'){
      expect((await handle.done).status).toBe('failed');expect(bindings).toHaveLength(0);return;
    }
    await waitFor(()=>bindings.length===1&&started);
    expect(bindings[0]!.current!()).toBe(true);
    if(mode==='role'){
      input.nativeRoleDescriptor!.roleId='deck-quality';expect(bindings[0]!.current!()).toBe(false);
      input.nativeRoleDescriptor!.roleId='deck-setup';expect(bindings[0]!.current!()).toBe(false);
    }
    if(mode==='generation'||mode==='header'){
      const file=mode==='generation'?join(fixture.agentDir,'deck/package/agents/deck-setup.md'):join(taskDir,`pi-${await handle.nativeSessionId}.jsonl`);
      const bytes=readFileSync(file);writeFileSync(file,'changed');
      expect(bindings[0]!.current!()).toBe(false);writeFileSync(file,bytes);
      expect(bindings[0]!.current!()).toBe(false);
    }
    await handle.interrupt();expect(bindings[0]!.current!()).toBe(false);
  } finally {await handle.close();await supervisor.shutdown();rmSync(root,{recursive:true,force:true});}
},10000);

// Protects the actual Pi extension/connector lifecycle and approval reply path;
// no model/network calls: Pi's in-process faux provider selects a native tool.
test.each([true,false])('real Pi Setup honors host approval (allow=%s)',async allow=>{
  const command=join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),'cli.js');
  const h=createPiHarness({}, {command:[command]});
  const supervisor=new Supervisor({anchorCommand:[process.execPath,join(import.meta.dir,'../../../session-host/src/__tests__/fixtures/anchor-entry.ts')]});
  const taskDir=join(h.root,'task');mkdirSync(taskDir,{mode:0o700});
  const target=join(h.project,'effect.txt');let bound=false,asked=false;
  const driver=createPiSessionDriver({command,baseEnv:{PATH:process.env.PATH,HOME:h.home,
    FAUX_CHILD_TOOL:'write',FAUX_CHILD_TOOL_INPUT:JSON.stringify({path:target,content:'approved effect'})}});
  const handle=await driver.startTask({taskId:'task',memberId:'setup',cwd:h.project,assignment:{runnerId:'pi',modelId:'faux/faux-1'},
    nativeRoleDescriptor:preparePiSessionRole(h.agentDir,'deck-setup'),prompt:'Exercise approval',rolePrompt:'',
    mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'relay',credentialFile:'unused',disableNativeDelegation:true},
    {spawn:createDriverSpawn(supervisor),emit(){},validatedLaunch:b=>{bound=b.current!();return bound;},
      approval:async()=>{asked=true;return {decision:allow?'allow':'deny'};},
      writePrivateFile:(name,content)=>{const file=join(taskDir,name);writeFileSync(file,content,{mode:0o600});return file;}});
  try {expect(await handle.done).toMatchObject({status:'completed'});expect(bound).toBe(true);expect(asked).toBe(true);expect(existsSync(target)).toBe(allow);}
  finally {await handle.close();await supervisor.shutdown();h.cleanup();}
},15000);
