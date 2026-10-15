import {expect,test} from "bun:test";
import type {RunnerAdapter} from "@deck/core";
import type {DriverLookup} from "@deck/session-host";
import {discoverSessionModels} from "./session-model-catalog";

const lookup = {get:()=>({probe:async()=>({status:"ready"})})} as unknown as DriverLookup;
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
