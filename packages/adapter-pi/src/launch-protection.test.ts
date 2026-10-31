import {createPiRunnerAdapter} from './runner-adapter';
import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ROLE_TOOL_POLICY} from '@deck/core/session/role-tool-policy';
import {createNodePiFileIO,planPiGlobalInstall,applyPiGlobalPlan} from './pi-global-install';
import {verifyPiSessionRole} from './session-driver/native-role';
import {createPiSessionDriver} from './session-driver/driver';
import {withInstallationMutation} from '../../core/src/installation-use';
// Protects production cross launch ordering: the relay cannot execute Pi before a child lease exists.
test('cross Setup registers child installation use before releasing its gate',async()=>{
 const root=mkdtempSync(join(tmpdir(),'pi-gated-'));
 try {
  const files=[{relPath:'deck/package/package.json',content:'{}'}, {relPath:'deck/package/role-policy.json',content:JSON.stringify(ROLE_TOOL_POLICY)},
  ...['deck-setup',...ROLE_TOOL_POLICY.readOnlyRoles].map(id=>({relPath:`deck/package/agents/${id}.md`,content:'---\ntools: read\n---\nTest role'})),
  ...['deck-memory','deck-subagents','deck-tool-policy','developer-team-execution'].flatMap(name=>['index.js','impl.js'].map(file=>({relPath:`deck/package/extensions/${name}/${file}`,content:'// owned fixture'}))),
  {relPath:'deck/package/extensions/deck-tool-policy/config.json',content:'{}'}];
  const io=createNodePiFileIO();applyPiGlobalPlan(planPiGlobalInstall({agentDir:root,files,packageEntry:undefined,skillExclusions:[],mcpServers:{},legacyDeckEvidence:false},io),io);
  const adapter = createPiRunnerAdapter({homeDirectory:root,env:{HOME:root,PI_CODING_AGENT_DIR:root}});
  const role=await adapter.prepareSessionNativeRole!('deck-setup');
  expect(role.preparation).toEqual([]);
  expect(()=>verifyPiSessionRole({...role,preparation:[{kind:'W',code:'fixture',item:root,message:'diagnostic only'}]})).not.toThrow();
  expect(()=>verifyPiSessionRole({...role,instructions:'tampered'})).toThrow('pi-session-generation-changed');
  const privateRoot=join(root,'private');mkdirSync(privateRoot,{mode:0o700});
  let gated=false;
  const driver=createPiSessionDriver({baseEnv:{HOME:root,XDG_CONFIG_HOME:root}});
  const task=await driver.startTask({nativeRoleDescriptor:role,cwd:root,taskId:'task',assignment:{modelId:'fake'},prompt:'test'} as any,{
   writePrivateFile:(name:string,content:string)=>{const path=join(privateRoot,name);writeFileSync(path,content,{mode:0o600});return path;},
   spawn:async()=>{
    await expect(withInstallationMutation(root,async()=>{})).rejects.toThrow(/deferred/);
    return {ready:Promise.resolve({workerPid:process.pid}),exited:Promise.resolve({ok:false}),onStdout:()=>{},onStderr:()=>{},terminateGroup:async()=>{},writeStdin:(text:string)=>{
     expect(text).toBe('installation-ready\n');
     expect(readdirSync(join(root,'deck/installation-use')).filter(p=>p.endsWith('.use'))).toHaveLength(2);gated=true;
    }};
   },
  } as any);
  await task.done;expect(gated).toBe(true);
  await withInstallationMutation(root,async()=>{});
 }finally{rmSync(root,{recursive:true,force:true});}
});
