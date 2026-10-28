import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildPiGlobalMaterialization} from '../global-materialization';
import {applyPiGlobalPlan,createNodePiFileIO,planPiGlobalInstall} from '../pi-global-install';
export function piFixture(root:string, mode='live') {
  const agentDir=join(root,'agent');mkdirSync(agentDir,{recursive:true});
  const io=createNodePiFileIO();applyPiGlobalPlan(planPiGlobalInstall(buildPiGlobalMaterialization({agentDir,projectRoot:root,legacyDeckEvidence:false}).desired,io),io);
  const command=join(root,'fake-pi');
  writeFileSync(command,`#!${process.execPath}
import {readFileSync} from 'node:fs';
import {installChildClarifications} from ${JSON.stringify(join(import.meta.dir,'../pi-extensions/subagents/clarification.ts'))};
const handlers={};
const env=process.env;
const mode=${JSON.stringify(mode)};
const id=JSON.parse(readFileSync(env.DECK_PI_CHILD_SESSION,'utf8').split('\\n')[0]).id;
const m={version:1,nonce:env.DECK_PI_CLARIFICATION_NONCE,parentId:env.DECK_PI_PARENT_SESSION,taskId:env.DECK_PI_TASK_ID,sessionFile:env.DECK_PI_CHILD_SESSION,attempt:1,type:'clarification_ready',nativeSessionId:id};
if(mode==='stdout')console.log(JSON.stringify({channel:'ipc',value:m}));
else {
 installChildClarifications({registerTool:()=>{},on:(name,fn)=>handlers[name]=fn},env);
 handlers.session_start({}, {sessionManager:{getSessionId:()=>mode==='wrong-session'?'forged':id,getSessionFile:()=>env.DECK_PI_CHILD_SESSION}});
 process.send({version:1,nonce:env.DECK_PI_CONTAINMENT,pid:mode==='wrong-pid'?process.pid+1:process.pid});
}
console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'fixture started'}]}}));
setInterval(()=>{},1000);
`,{mode:0o700});
  return {agentDir,command};
}

