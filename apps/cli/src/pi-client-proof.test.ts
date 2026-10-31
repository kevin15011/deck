import { expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";
import { decodeProofRecords, validateProofCommand, writeProofRecord, runPiClientProof } from "./pi-client-proof";
import { getDefaultDeckConfig, type RunnerAdapter } from "@deck/core";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("proof preserves Deck mutation consent instead of silently installing", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-proof-consent-"));
  let applied = false;
  const adapter = {
    runnerId: "pi", displayName: "Pi", environmentIds: ["pi-development"],
    buildDeveloperTeamInstallPlan: () => ({ files: [{ path: "managed", content: "fixture", kind: "other" }], mutationPreview: [{ action: "create", path: "managed", preimage: "absent", postimage: "abc", ownership: "deck-file" }] }),
    applyDeveloperTeamInstall: () => { applied = true; throw Error("Must not install"); },
    buildLaunchPlan: () => ({ status: "ready", plan: { command: "must-not-spawn", args: [], cwd: root, stdio: "inherit", stdin: "inherit" }, diagnostics: [] }),
  } as unknown as RunnerAdapter;
  try {
    const result = await runPiClientProof({ adapter, launch: { mode: "interactive", projectRoot: root, teamId: "developer-team", deckConfig: getDefaultDeckConfig() },
      channel: { input: Readable.from([]), output: new Writable({ write(_chunk, _encoding, cb) { cb(); } }) },
      supermemoryRuntime: { stateHome: root, secretStore: { read: () => undefined, write: () => {}, remove: () => {} } as any },
    });
    expect(result).toMatchObject({ status: "blocked", message: "Mutation requires --yes in non-interactive mode." });
    expect(applied).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("exact resume is blocked before preparation or process launch until native loading is strict", async () => {
  const root=mkdtempSync(join(tmpdir(),"deck-resume-gate-"));let touched=false;
  const adapter={runnerId:"pi",buildLaunchPlan(){touched=true;throw Error("must not launch");},buildDeveloperTeamInstallPlan(){touched=true;throw Error("must not prepare");}} as unknown as RunnerAdapter;
  const input=Readable.from([]),output=new Writable({write(_chunk,_encoding,cb){cb();}});
  try {await expect(runPiClientProof({adapter,launch:{mode:"resume-by-id",sessionId:"native",projectRoot:root,teamId:"developer-team",deckConfig:getDefaultDeckConfig()},channel:{input,output}})).rejects.toThrow("Exact resume is unavailable");expect(touched).toBe(false);}
  finally {input.destroy();output.destroy();rmSync(root,{recursive:true,force:true});}
});

test("proof framing preserves Unicode separators and rejects oversized or unfinished records", async () => {
  const records = [];
  for await (const record of decodeProofRecords(Readable.from([Buffer.from('{"type":"prompt","id":"1","message":"a\u2028b"}\r\n')]), 128)) records.push(record);
  expect(records).toEqual([{ type: "prompt", id: "1", message: "a\u2028b" }]);
  for (const input of ['x'.repeat(129), '{"type":"abort"}', 'null\n', 'bad\n']) {
    expect(async () => { for await (const _ of decodeProofRecords(Readable.from([Buffer.from(input)]), 128)) {} }).toThrow();
  }
});

test("an output stream failure rejects without an unhandled stream error", async () => {
  const output = new Writable({ write(_chunk, _encoding, cb) { cb(new Error("fixture disconnected")); } });
  await expect(writeProofRecord(output, { type: "test" })).rejects.toThrow("fixture disconnected");
  await Bun.sleep(5);
});

test("a stalled writer fails within its bounded drain deadline", async () => {
  const output = new Writable({ write(_chunk, _encoding, _callback) {} });
  try { await expect(writeProofRecord(output, { type: "test" }, 20)).rejects.toThrow("drain deadline"); }
  finally { output.destroy(); }
});

test("read-only command inventory has no extra fields", () => {
  expect(validateProofCommand({type:"get_commands",id:"inventory"})).toEqual({type:"get_commands",id:"inventory"});
  expect(() => validateProofCommand({type:"get_commands",id:"inventory",path:"/private"})).toThrow();
});

test("proof commands cannot navigate to another session or grant a confirmation", () => {
  expect(validateProofCommand({ type: "prompt", id: "p", message: "hello" })).toEqual({ type: "prompt", id: "p", message: "hello" });
  expect(validateProofCommand({ type: "get_entries", id: "e", since: "cursor" })).toEqual({ type: "get_entries", id: "e", since: "cursor" });
  for (const value of [{ type: "switch_session", id: "1", sessionPath: "/other" }, { type: "bash", id: "1", command: "true" }, { type: "extension_ui_response", id: "1", confirmed: true }, { type: "prompt", id: "1", message: "hi", images: [] }, { type: "prompt", message: "hi" }]) expect(() => validateProofCommand(value)).toThrow();
});

// Protects the production RPC spawn: child registration precedes execution and is released on exit.
test("RPC launch registers its gated child lease before executing Pi", async()=>{
 const root=mkdtempSync(join(tmpdir(),"pi-rpc-lease-"));
 let registered=false, released=false;
 const adapter={
  runnerId:"pi",displayName:"Pi",environmentIds:["pi-development"],
  backupDeveloperTeamFiles:()=>({}),applyDeveloperTeamInstall:async()=>({results:[],changedCount:0,unchangedCount:0}),
  verifyDeveloperTeamInstall:async()=>({valid:true,diagnostics:[]}),
  withNativeInstallationUse:async(effect:()=>Promise<unknown>)=>effect(),
  trackNativeInstallationProcess:(pid:number)=>{
   expect(pid).toBeGreaterThan(0);
   writeFileSync(join(root,"registered"),String(pid));registered=true;
   return ()=>{released=true;};
  },
  buildDeveloperTeamInstallPlan:()=>({files:[],mutationPreview:[]}),
  buildLaunchPlan:()=>({status:"ready",diagnostics:[],plan:{command:process.execPath,
   args:["-e",`const fs=require('node:fs');process.exit(fs.readFileSync('registered','utf8')===String(process.pid)?0:2)`],
   cwd:root,stdio:"inherit",stdin:"inherit"}}),
 } as unknown as RunnerAdapter;
 try {
  const result=await runPiClientProof({adapter,launch:{mode:"interactive",projectRoot:root,teamId:"developer-team",deckConfig:getDefaultDeckConfig()},
   inheritedEnv:{HOME:root,XDG_CONFIG_HOME:root,PATH:process.env.PATH},
   channel:{input:Readable.from([]),output:new Writable({write(_c,_e,cb){cb();}})},
   supermemoryRuntime:{stateHome:root,secretStore:{read:()=>undefined,write:()=>{},remove:()=>{}} as any}});
  expect(result).toMatchObject({status:"launched",outcome:{exitCode:0}});
  expect(registered).toBe(true);expect(released).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
