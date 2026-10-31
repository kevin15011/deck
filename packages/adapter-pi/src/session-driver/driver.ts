import { evaluatePiVersion } from "../pi-version";
import { acquireInstallationUse } from "../../../core/src/installation-use";
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { DriverTaskInput, DriverHostIo, RunnerSessionDriver, SupervisedChild, TurnOutcome } from '@deck/core/session/driver';
import { readChildInvocationId } from '../pi-extensions/subagents/storage';
import { verifyPiSessionRole } from './native-role';
import { PI_SESSION_RELAY } from './relay';

type Options = { command?: string; runtime?: string; baseEnv?: Readonly<Record<string,string|undefined>>;
  exec?: (command:string,args:readonly string[])=>Promise<string>; startupMs?: number };
const exec: NonNullable<Options['exec']> = (command,args) => new Promise((resolve,reject) => {
  execFile(command,[...args],{encoding:'utf8',timeout:5000},(error,out)=>error?reject(error):resolve(out));
});

/** Setup-only cross transport. Role identity comes from owned generation + native
 * IPC session_start, using the same private header contract as Pi's owned launcher. */
export function createPiSessionDriver(options: Options = {}): RunnerSessionDriver {
  return {
    runnerId:'pi', protocol:'pi-json-ipc', supportsInputClaim:true,
    testedVersions:{min:'1.0.0',maxTested:'1.0.0'}, newNativeSessionId:randomUUID,
    async probe() {
      try {
        const version=(await (options.exec??exec)(options.command??'pi',['--version'])).trim();
        await (options.exec??exec)(options.runtime??'node',['--version']);
        const evaluated = evaluatePiVersion(version);
        return evaluated.supported ? {status:evaluated.diagnostic ? 'degraded' : 'ready',version:evaluated.version,capabilities:['setup-project-repair'], ...(evaluated.diagnostic ? { reasonCode: 'pi-version-untested' } : {})} :
          {status:'blocked',version,reasonCode:'pi-session-version-unsupported',message:evaluated.diagnostic,capabilities:[]};
      } catch { return {status:'blocked',reasonCode:'pi-session-runtime-unavailable',capabilities:[]}; }
    },
    async startTask(input:DriverTaskInput, io:DriverHostIo) {
      const role=input.nativeRoleDescriptor;
      if (!role || role.runnerId!=='pi' || role.roleId!=='deck-setup') throw new Error('pi-session-role-unsupported');
      if (input.images?.length) throw new Error('pi-setup-images-unsupported');
      verifyPiSessionRole(role);
      const nativeId=input.resume?.nativeSessionId??input.nativeSessionId??randomUUID();
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(nativeId)) throw new Error('pi-session-id-invalid');
      const relay=io.writePrivateFile('pi-session-relay.mjs',PI_SESSION_RELAY);
      const sessionFile=join(dirname(relay),`pi-${nativeId}.jsonl`);
      // Never recreate missing history on resume, or overwrite existing history.
      if (!existsSync(sessionFile)) {
        if (input.resume) throw new Error('pi-session-history-unavailable');
        io.writePrivateFile(`pi-${nativeId}.jsonl`,JSON.stringify({type:'session',version:3,id:nativeId,cwd:input.cwd,
          timestamp:new Date().toISOString(),deckParent:'deck-session-host',deckTaskId:input.taskId})+'\n');
      }
      const check = () => {
        verifyPiSessionRole(role);
        if(readChildInvocationId(sessionFile,'deck-session-host',input.taskId,input.cwd)!==nativeId) throw new Error('pi-session-history-mismatch');
      };
      check();
      let closed=false, running=false, child:SupervisedChild|undefined, revoke=()=>{};
      const run=async(prompt:string):Promise<TurnOutcome> => {
        if(closed||running) return {status:'failed',error:'pi-session-not-idle'};
        running=true;
        let installation: ReturnType<typeof acquireInstallationUse> | undefined;
        let releaseRelay: (() => void) | undefined;
        let revoked=false, bound=false, contained=false, ready=false, modelFailed=false, rejected=false;
        revoke=()=>{revoked=true;};
        const current=()=>{try {check();}catch {revoked=true;}return !closed&&!revoked&&running;};
        try {
          installation=acquireInstallationUse(role.source.root);
          check();
          const nonce=randomUUID(), containment=randomUUID();
          const config=io.writePrivateFile('pi-session-mcp.json',JSON.stringify({
            servers:input.mcpServerSpecs,context:input.sessionStartContext?.text??'',cwd:input.cwd,
            suppressed:input.suppressedMcpServers??[], approvals:input.approvals,
          }));
          const system=io.writePrivateFile('pi-session-prompt.md',[role.instructions,input.rolePrompt].filter(Boolean).join('\n\n'));
          const env:Record<string,string>={};
          for(const [key,value] of Object.entries(options.baseEnv??process.env)) if(value!==undefined&&!key.startsWith('DECK_PI_')&&!key.startsWith('DECK_RUNNER_MEMORY_'))env[key]=value;
          Object.assign(env,{PI_CODING_AGENT_DIR:role.source.root,DECK_PI_SESSION:'1',DECK_PI_CHILD:'1',DECK_PI_ROLE:'setup',
            DECK_PI_INSTALLATION_GATE:'1',DECK_PI_CROSS_CONFIG:config,DECK_PI_CONTAINMENT:containment,DECK_PI_CLARIFICATION_NONCE:nonce,
            DECK_PI_PARENT_SESSION:'deck-session-host',DECK_PI_TASK_ID:input.taskId,DECK_PI_CHILD_SESSION:sessionFile,DECK_PI_ATTEMPT:'1'});
          const args=['--mode','json','-p','--session',sessionFile,'--extension',join(role.source.root,'deck/package'),
            '--append-system-prompt',system,'--model',input.assignment.modelId];
          if(input.assignment.thinking)args.push('--thinking',input.assignment.thinking);
          args.push(prompt);
          env.DECK_PI_RELAY_COMMAND=JSON.stringify([options.command??'pi',...args]);
          if(io.claimInput?.()===false)return {status:'interrupted'};
          child=await io.spawn(options.runtime??'node',[relay],{cwd:input.cwd,env});
          const active=child;
          if(closed){await active.terminateGroup();return {status:'interrupted'};}
          let wire='', output='';
          let workerPid:number|undefined;
          const decoder=new StringDecoder('utf8');
          const fail=()=>{revoked=true;rejected=true;void active.terminateGroup();};
          const timer=setTimeout(fail,options.startupMs??10000);
          const bind=()=>{
            if(bound||!ready||!contained||!current())return;
            bound=io.validatedLaunch?.({roleId:role.roleId,generation:role.generation,nativeSessionId:nativeId,launchId:nonce,current})??false;
            if(!bound){fail();return;}
            clearTimeout(timer);
            io.emit({kind:'turn.started',data:{nativeSessionId:nativeId}});
          };
          const approvals=new Set<string>();
          active.onStdout(chunk=>{
            wire+=chunk;
            if(wire.length>4*1024*1024){fail();return;}
            let end:number;
            while((end=wire.indexOf('\n'))>=0){
              const line=wire.slice(0,end);wire=wire.slice(end+1);
              try {
                const frame=JSON.parse(line);
                if(frame.channel==='spawned'){
                  if(workerPid!==undefined||!Number.isSafeInteger(frame.value?.pid)||frame.value.pid<=0){fail();continue;}
                  workerPid=frame.value.pid;continue;
                }
                if(frame.channel==='revoked'){revoked=true;continue;}
                if(frame.channel==='ipc'){
                  const m=frame.value;
                  if(m?.version===1&&m.nonce===containment&&workerPid!==undefined&&m.pid===workerPid){contained=true;bind();}
                  if(m?.type==='approval'&&m.nonce===nonce&&typeof m.id==='string'&&typeof m.tool==='string'&&m.tool.length<128&&!approvals.has(m.id)){
                    approvals.add(m.id);
                    if(!bound||!current()||approvals.size>1000){fail();continue;}
                    void io.approval({approvalId:m.id,tool:m.tool,toolKey:`pi:${m.tool}`,input:m.input,risk:'high'}).then(result=>{
                      if(current())active.writeStdin(JSON.stringify({type:'approval_result',id:m.id,nonce,allow:result.decision==='allow'})+'\n');
                    },fail);
                  }
                  const exact=m?.version===1&&m.nonce===nonce&&m.parentId==='deck-session-host'&&m.taskId===input.taskId&&m.sessionFile===sessionFile&&m.attempt===1;
                  if(exact&&m.type==='invocation_closed')revoked=true;
                  if(exact&&m.type==='clarification_ready'){
                    if(m.nativeSessionId!==nativeId){fail();continue;}
                    ready=true;bind();
                  }
                } else if(frame.channel==='stdout'&&typeof frame.value==='string'){
                  output+=decoder.write(Buffer.from(frame.value,'base64'));
                  if(output.length>2*1024*1024){fail();continue;}
                  let stop:number;
                  while((stop=output.indexOf('\n'))>=0){const line=output.slice(0,stop);output=output.slice(stop+1);
                    let event:any;try{event=JSON.parse(line);}catch{continue;}
                    if(event.type==='message_end'&&event.message?.role==='assistant'){
                      const message=event.message;
                      if(['error','aborted'].includes(message.stopReason))modelFailed=true;
                      const text=Array.isArray(message.content)?message.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''):'';
                      if(text)io.emit({kind:'message.completed',data:{role:'assistant',text}});
                      if(message.usage)io.emit({kind:'usage',data:message.usage});
                    }
                  }
                }
              } catch {fail();}
            }
          });
          // Stderr is deliberately not forwarded: runner errors may contain credentials.
          active.onStderr(()=>{});
          try {
            const {workerPid} = await active.ready;
            releaseRelay=installation.trackProcess(workerPid);
            active.writeStdin("installation-ready\n");
            const result=await active.exited;
            return closed ? {status:'interrupted'} : result.ok&&bound&&contained&&!modelFailed&&!rejected ? {status:'completed'} : {status:'failed',error:'pi-session-execution-failed'};
          } finally {clearTimeout(timer);revoked=true;}
        } catch(error) {return {status:'failed',error:(error as Error).message};}
        finally {releaseRelay?.();installation?.release();revoked=true;running=false;}
      };
      const done=run(input.prompt);
      const close=async()=>{closed=true;revoke();await child?.terminateGroup();await done;};
      return {nativeSessionId:Promise.resolve(nativeId),done,send:async(prompt,images)=>images?.length?{status:'failed',error:'pi-setup-images-unsupported'}:run(prompt),interrupt:close,close};
    },
  };
}
