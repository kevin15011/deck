import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import type { ExtensionAPI, LoadedMcpConfig } from '@earendil-works/pi-coding-agent';
import { loadMcpConfig } from '../pi-extensions/tool-policy/native-config.pinned';
import { randomUUID } from 'node:crypto';

/** Native connector consumes the host's private per-launch specification. This
 * file confers no mutation authority: the bridge still requires live attestation. */
export function installPiSessionMcp(pi: ExtensionAPI, native: Pick<typeof import('@earendil-works/pi-coding-agent'),'createMcpExtension'|'getAgentDir'>, file: string) {
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let input:any;
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>1024*1024||stat.mode&0o077||process.getuid&&stat.uid!==process.getuid())throw new Error('pi-session-config-untrusted');
    input=JSON.parse(readFileSync(fd,'utf8'));
  }finally{closeSync(fd);}
  if(input.cwd!==process.cwd()||!input.servers||typeof input.context!=='string')throw new Error('pi-session-config-invalid');
  const servers:LoadedMcpConfig['servers']=Object.entries(input.servers).map(([name,raw])=>{
    const spec=raw as any;
    if(spec.transport==='http'){
      const headers=Object.fromEntries(Object.entries(spec.envHttpHeaders??{}).map(([name,key])=>[name,process.env[String(key)]??'']));
      return {name,source:file,scope:'global' as const,config:{url:spec.url,headers,exposure:'direct' as const}};
    }
    return {name,source:file,scope:'global' as const,config:{command:spec.command,args:spec.args,env:spec.env,exposure:'direct' as const}};
  });
  const context=input.context;
  pi.on('before_agent_start',event=>({systemPrompt:[event.systemPrompt,context].filter(Boolean).join('\n\n')}));
  if(input.approvals==='relay') pi.on('tool_call',async event=>{
    if(['read','grep','find','ls'].includes(event.toolName)||/^mcp__deck__deck_/.test(event.toolName))return;
    if(!process.connected||!process.send)return {block:true,reason:'Deck approval transport unavailable'};
    const id=randomUUID(), nonce=process.env.DECK_PI_CLARIFICATION_NONCE;
    const allowed=await new Promise<boolean>(resolve=>{
      const finish=(allow:boolean)=>{clearTimeout(timer);process.removeListener('message',receive);process.removeListener('disconnect',closed);resolve(allow);};
      const receive=(raw:any)=>{if(raw?.type==='approval_result'&&raw.id===id&&raw.nonce===nonce)finish(raw.allow===true);};
      const closed=()=>finish(false);
      const timer=setTimeout(closed,300000);
      process.on('message',receive);process.once('disconnect',closed);
      process.send!({type:'approval',id,nonce,tool:event.toolName,input:event.input},error=>{if(error)closed();});
    });
    if(!allowed)return {block:true,reason:'Deck approval denied or expired'};
  });
  return {...native, createMcpExtension(options: Parameters<typeof native.createMcpExtension>[0]) {
    return native.createMcpExtension({...options,loadConfig:ctx=>{
      const loaded=options?.loadConfig?.(ctx)??loadMcpConfig({agentDir:native.getAgentDir(),cwd:ctx.cwd,projectTrusted:ctx.isProjectTrusted()});
      return {...loaded,servers:[...loaded.servers.filter(s=>!input.suppressed?.includes(s.name)&&!servers.some(owned=>owned.name===s.name)),...servers]};
    }});
  }};
}
