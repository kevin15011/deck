import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { existsSync, writeFileSync } from "node:fs";
import { getDefaultDeckConfig, createOwnerOnlyFileSecretStore } from "@deck/core";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { createPiHarness, findRealPi } from "../../../packages/adapter-pi/src/pi-cli-harness";
import { childSessionPath } from "../../../packages/adapter-pi/src/pi-extensions/subagents/storage";
import { assertExecutionSettled } from "../../../packages/adapter-pi/src/pi-extensions/subagents/execution-lease";
import { decodeProofRecords, runPiClientProof } from "./pi-client-proof";

for(const mode of ['legacy','interactive','close','expire','abort'] as const){
 test.skipIf(!findRealPi())(`native UI ${mode}: exact extension values and settlement`,async()=>{
  const h=createPiHarness();const input=new PassThrough(),output=new PassThrough();
  writeFileSync(join(h.agentDir,'extensions','questions.js'),`export default function(pi){pi.on('input',async(e,ctx)=>{if(e.text!=='questions')return;
   const values=[];${mode==='close'||mode==='expire'||mode==='abort'?`values.push(await ctx.ui.input('Pending fixture', 'Only fixture'${mode==='expire'?',{timeout:150}':''}));`:`for(let i=0;i<2;i++){values.push(await ctx.ui.select('Choose '+i,['A'+i,'B'+i]));values.push(await ctx.ui.confirm('Confirm '+i,'Message '+i));values.push(await ctx.ui.input('Input '+i,'Placeholder '+i));values.push(await ctx.ui.editor('Editor '+i,'Prefill '+i));}`}
   ctx.ui.notify('VALUES:'+JSON.stringify(values));return {action:'handled'};});}`);
  const config=getDefaultDeckConfig();for(const k of Object.keys(config.packageInstructions.pi))(config.packageInstructions.pi as any)[k]=k==='code-economy';
  const env={PATH:process.env.PATH,HOME:h.home,PI_CODING_AGENT_DIR:h.agentDir,PI_OFFLINE:'1',PI_SKIP_VERSION_CHECK:'1',DECK_PI_MEMORY:'disabled'};
  let resultValues:any;let count=0;
  const reader=(async()=>{for await(const item of decodeProofRecords(output,2*1024*1024)){
   const r=item.record as any;
   if(item.type==='deck_ui_pending'){
    const p=item.request as any;count++;
    if(mode==='close'){input.end();continue;}if(mode==='expire')continue;if(mode==='abort'){input.write(JSON.stringify({type:'abort',id:'fixture-abort'})+'\n');continue;}
    const value=p.method==='select'?{value:p.options[1]}:p.method==='confirm'?{confirmed:false}:{value:'exact '+p.title+'\nline'};
    input.write(JSON.stringify({type:'extension_ui_response',id:p.id,method:p.method,...value})+'\n');
   }
   if(r?.method==='notify'&&r.message.startsWith('VALUES:')){resultValues=JSON.parse(r.message.slice(7));if(!input.writableEnded)input.end();}
  }})();
  const deadline=setTimeout(()=>input.end(),12000);
  try{input.write(JSON.stringify({type:'prompt',id:'q',message:'questions'})+'\n');
   const result=await runPiClientProof({adapter:createPiRunnerAdapter({homeDirectory:h.home,env,piCommand:findRealPi()}),launch:{projectRoot:h.project,teamId:'developer-team',mode:'interactive',deckConfig:config},yes:true,interactiveClient:mode!=='legacy',channel:{input,output},inheritedEnv:env,supermemoryRuntime:{stateHome:join(h.root,'state'),secretStore:createOwnerOnlyFileSecretStore({configHome:join(h.root,'config')})}});
   output.end();await reader;expect(result.status).toBe('launched');if(result.status==='launched')expect(result.outcome.exitCode).toBe(0);
   if(mode==='interactive')expect(resultValues).toEqual(['B0',false,'exact Input 0\nline','exact Editor 0\nline','B1',false,'exact Input 1\nline','exact Editor 1\nline']);
   if(mode==='legacy'){expect(count).toBe(0);expect(resultValues).toEqual([null,false,null,null,null,false,null,null]);}
   if(mode==='close'||mode==='expire'||mode==='abort'){expect(count).toBe(1);expect(resultValues).toEqual([null]);}
  }finally{clearTimeout(deadline);input.destroy();output.destroy();h.cleanup();}
 },20000);
}

for (const scenario of ["integrate", "child-failure", "disconnect", "malformed"] as const) {
  test.skipIf(!findRealPi())(`native supervised RPC: ${scenario} settles the actual Deck child`, async () => {
    const h = createPiHarness({ installOptions: { modelAssignments: { "deck-lead": "faux/faux-1", "deck-investigate": "faux/faux-1" } } });
    const input = new PassThrough(), output = new PassThrough();
    const config = getDefaultDeckConfig();
    for (const key of Object.keys(config.packageInstructions.pi)) (config.packageInstructions.pi as Record<string, boolean>)[key] = key === "code-economy";
    const early = scenario === "disconnect" || scenario === "malformed";
    const env = { PATH: process.env.PATH, HOME: h.home, PI_CODING_AGENT_DIR: h.agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", DECK_PI_MEMORY: "disabled", FAUX_SCRIPT: "delegate", FAUX_CHILD_DELAY_MS: early ? "10000" : "200", FAUX_CHILD_FAIL: scenario === "child-failure" ? "1" : "0", FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", title: "Proof child", task: "Return deterministic fixture evidence" }) };
    let cursor: string | undefined, integrated = false, seenRunning = false, accepted = false, stopped = false, parentFile = "";
    const jobs = new Map<string, any>();
    const events: string[] = [];
    let poll: ReturnType<typeof setInterval> | undefined;
    const read = (async () => {
      for await (const item of decodeProofRecords(output, 2 * 1024 * 1024)) {
        if (item.type !== "pi") continue;
        const record = item.record as any; events.push(record.type);
        if (record.type === "response" && record.command === "prompt") accepted = record.success;
        if (record.type === "response" && record.command === "get_state") parentFile = record.data.sessionFile;
        if (record.type === "response" && record.command === "get_entries" && record.success) {
          const entries = record.data.entries;
          cursor = entries.at(-1)?.id ?? cursor;
          for (const entry of entries) if (entry.customType === "deck-subagents-v1") for (const job of entry.data.jobs) {
            jobs.set(job.id, job);
            if (job.state === "running") seenRunning = true;
            if (job.integration === "integrated") integrated = true;
          }
          const spawned = parentFile && [...jobs.values()].some(job => existsSync(childSessionPath(parentFile, job.parent, job.childId) + ".execution"));
          if (!stopped && (early ? seenRunning && spawned : integrated)) {
            stopped = true; clearInterval(poll);
            if (scenario === "malformed") input.write("not-json\n");
            else if (scenario === "disconnect") input.end();
            else input.write(JSON.stringify({ type: "shutdown", id: "close" }) + "\n");
          }
        }
      }
    })();
    const deadline = setTimeout(() => input.end(), 22000);
    try {
      input.write(JSON.stringify({ type: "get_state", id: "state" }) + "\n");
      input.write(JSON.stringify({ type: "prompt", id: "hello", message: "Delegate one deterministic child" }) + "\n");
      let count = 0;
      poll = setInterval(() => { if (!input.destroyed && !input.writableEnded) input.write(JSON.stringify({ type: "get_entries", id: `poll-${count++}`, ...(cursor ? { since: cursor } : {}) }) + "\n"); }, 200);
      const result = await runPiClientProof({ adapter: createPiRunnerAdapter({ homeDirectory: h.home, env, piCommand: findRealPi() }), launch: { projectRoot: h.project, teamId: "developer-team", mode: "interactive", deckConfig: config }, yes: true, channel: { input, output }, inheritedEnv: env,
        supermemoryRuntime: { stateHome: join(h.root, "state"), secretStore: createOwnerOnlyFileSecretStore({ configHome: join(h.root, "config") }) },
      });
      output.end(); await read;
      expect(result.status, JSON.stringify(result.status === "blocked" ? result : {})).toBe("launched");
      if (result.status === "launched") expect(result.outcome.exitCode).toBe(scenario === "malformed" ? 1 : 0);
      expect(accepted).toBe(true); expect(stopped).toBe(true); expect(seenRunning).toBe(true); expect(jobs.size).toBe(1);
      expect(integrated).toBe(!early); expect(events).toContain("agent_settled");
      if (scenario === "child-failure") expect([...jobs.values()][0].state).toBe("failed");
      for (const job of jobs.values()) expect(() => assertExecutionSettled(childSessionPath(parentFile, job.parent, job.childId), job.parent, job.id)).not.toThrow();
    } finally { clearTimeout(deadline); clearInterval(poll); input.destroy(); output.destroy(); h.cleanup(); }
  }, 35000);
}
