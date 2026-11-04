import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '../session-manager';
import { ApprovalBroker } from '../approval-broker';
import { CredentialRegistry } from '../credentials';
import { resolveStatePaths, ensureStateLayout } from '../paths';
import { getDefaultDeckConfig } from '@deck/core';
import type { RunnerSessionDriver } from '@deck/core/session/driver';
import type { Supervisor } from '../supervisor';
import { waitFor } from './test-helpers';
// Oracle: reviewed preparation failures reach the persisted readiness boundary; raw messages never do.
for (const runnerId of ['codex','opencode']) test(`${runnerId} preparation keeps its reviewed reason and redacts its message`, async () => {
 const home=realpathSync(mkdtempSync(join(tmpdir(),'deck-error-transport-'))),project=join(home,'project');mkdirSync(project);
 const paths=resolveStatePaths({env:{HOME:home,XDG_STATE_HOME:join(home,'state')},tmpdir:home});ensureStateLayout(paths);
 const code=`${runnerId}-session-preparation-blocked`;
 const driver={runnerId,probe:async()=>({status:'ready',capabilities:[]})} as unknown as RunnerSessionDriver;
 const manager=new SessionManager({paths,homeDir:home,broker:new ApprovalBroker({sink:{emit(){}}}),credentials:new CredentialRegistry({socketPath:paths.socket.path}),supervisor:{} as Supervisor,
 drivers:{get:()=>driver,list:()=>[driver]},sessionMcpCommand:['fixture'],config:()=>({...getDefaultDeckConfig().crossRunner!,enabled:true,members:{lead:{runnerId,modelId:'fixture'}}}),assignedRoleId:()=> 'deck-lead',
 childMcp:async()=>({runnerPackages:()=>[],resolveServer:()=>undefined,prepareNativeRole:async()=>{throw Object.assign(new Error(`${code}: token=secret`),{detail:'hook-receipt-mismatch:rtk'});}})});
 try {
  const created=await manager.execute({clientId:'test',command:{v:1,commandId:'create',type:'session.create',projectRoot:project}});
  const sessionId=(created as {data:{sessionId:string}}).data.sessionId;
  await manager.execute({sessionId,clientId:'test',command:{v:1,commandId:'prepare',type:'session.prepare'}});
  let readiness:unknown;
  await waitFor(async()=>{readiness=await manager.query('session.readiness',{sessionId});return (readiness as {data?:{status?:string}}).data?.status==='failed';});
  expect(readiness).toMatchObject({data:{reasonCode:code,status:'failed'}});
  expect(JSON.stringify(readiness)).not.toContain('token=secret');
 }finally{await manager.close();rmSync(home,{recursive:true,force:true});}
});
