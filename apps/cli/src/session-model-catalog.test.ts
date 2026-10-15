import {expect,test} from "bun:test";
import type {RunnerAdapter} from "@deck/core";
import type {DriverLookup} from "@deck/session-host";
import {discoverSessionModels} from "./session-model-catalog";

const lookup = {get:()=>({probe:async()=>({status:"ready"})})} as unknown as DriverLookup;
const degradedLookup = {get:()=>({probe:async()=>({status:"degraded",reasonCode:"version-untested"})})} as unknown as DriverLookup;
test("keeps degraded Claude and OpenCode selectable when native model discovery is ready",async()=>{
  const adapters=["claude","opencode"].map(runnerId=>({
    runnerId,getSessionDriver(){},getThinkingLevels:()=>["high"],
    getModelInventory:async()=>({state:"ready",inventory:{modelsByProvider:{native:[{id:`${runnerId}/native-model`,displayName:"Native model"}]}}}),
  })) as unknown as RunnerAdapter[];
  const result=await discoverSessionModels(adapters,degradedLookup,"/project");
  expect(result.runners).toEqual(adapters.map(adapter=>({runnerId:adapter.runnerId,label:adapter.runnerId,available:true,models:[{modelId:`${adapter.runnerId}/native-model`,label:"Native model",thinkingLevels:["high"]}]})));
});
test("does not discover models for blocked runners or expose raw probe reasons",async()=>{
  const blockedLookup={get:()=>({probe:async()=>({status:"blocked",reasonCode:"secret-token"})})} as unknown as DriverLookup;
  let discoveryCalls=0;
  const adapter={runnerId:"claude",getSessionDriver(){},getModelInventory:async()=>{discoveryCalls++;throw new Error("unexpected discovery");}} as unknown as RunnerAdapter;
  expect(await discoverSessionModels([adapter],blockedLookup,"/project")).toEqual({runners:[{runnerId:"claude",label:"claude",available:false,reasonCode:"runner-unavailable",models:[]}]});
  expect(discoveryCalls).toBe(0);
});
test("degraded runners still require fresh successful model discovery",async()=>{
  const adapters=["stale","failed"].map(state=>({runnerId:state,getSessionDriver(){},getThinkingLevels:()=>[],getModelInventory:async()=>{
    if(state==="failed")throw new Error("secret-token");
    return {state:"stale",inventory:{modelsByProvider:{native:[{id:"invented"}]}}};
  }})) as unknown as RunnerAdapter[];
  expect(await discoverSessionModels(adapters,degradedLookup,"/project")).toEqual({runners:[
    {runnerId:"stale",label:"stale",available:false,reasonCode:"model-discovery-unavailable",models:[]},
    {runnerId:"failed",label:"failed",available:false,reasonCode:"model-discovery-failed",models:[]},
  ]});
});
test("discovers exact native models for the selected project with model-specific thinking",async()=>{
  const calls:unknown[]=[];
  const adapter={runnerId:"codex",displayName:"Codex",getSessionDriver(){},getThinkingLevels:(id:string)=>{calls.push(id);return ["high","custom"];},getModelInventory:async(request:unknown)=>{
    calls.push(request);return {state:"ready",inventory:{modelsByProvider:{native:[{id:"native/new-model",displayName:"Native"},{id:"hidden/model",visibility:"hidden"}]}}};
  }} as unknown as RunnerAdapter;
  expect(await discoverSessionModels([adapter],lookup,"/actual/project")).toEqual({runners:[{runnerId:"codex",label:"Codex",available:true,models:[{modelId:"native/new-model",label:"Native",thinkingLevels:["high","custom"]}]}]});
  expect(calls[0]).toMatchObject({projectRoot:"/actual/project",mode:"prefer-cache"});expect(calls[1]).toBe("native/new-model");
});
test("excludes unsupported runners, inherit and stale fallback; sanitizes failures",async()=>{
  const base={getSessionDriver(){},getThinkingLevels:()=>[]};
  const adapters=[{runnerId:"pi"},{...base,runnerId:"claude",getModelInventory:async()=>({state:"ready",inventory:{modelsByProvider:{claude:[{id:"inherit"}]}}})},{...base,runnerId:"stale",getModelInventory:async()=>({state:"stale",inventory:{modelsByProvider:{x:[{id:"invented"}]}}})},{...base,runnerId:"failed",getModelInventory:async()=>{throw new Error("secret-token");}}] as unknown as RunnerAdapter[];
  const result=await discoverSessionModels(adapters,lookup,"/project");
  expect(result.runners.map(row=>row.runnerId)).toEqual(["claude","stale","failed"]);
  expect(result.runners.every(row=>!row.available&&row.models.length===0)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret-token");expect(JSON.stringify(result)).not.toContain("invented");
});
