/** Opt-in source-level proof. Not a stable API or a second scheduler. */
import {validatePiResumeTarget,matchesPiResumeReceipt,supportsExactPiResume,PI_EXACT_RESUME_BLOCKED_REASON,type PiResumeTarget} from "../../../packages/adapter-pi/src/pi-resume-target";
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { statSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import type { RunnerAdapter } from "@deck/core";
import { createDeckConfigStoreFromEnvironment } from "./deck-config-store";
import { runRunnerLaunch, type RunRunnerLaunchInput, type SpawnedRunnerResult } from "./runner-launch-command";

import {parseDialog,dialogResponse,type Dialog} from './pi-client-proof-ui';
const MAX_RECORD = 1024 * 1024;
const MAX_COMMAND = 64 * 1024;

type RecordValue = Record<string, unknown>;
export async function* decodeProofRecords(input: Readable, limit: number): AsyncGenerator<RecordValue> {
  let pending = Buffer.alloc(0);
  for await (const chunk of input.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;
    for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
      if (pending.length + end - start > limit) throw new Error("Proof record too large");
      const line = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat([pending, bytes.subarray(start, end)]));
      pending = Buffer.alloc(0); start = end + 1;
      const value: unknown = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Proof record must be an object");
      yield value as RecordValue;
    }
    if (pending.length + bytes.length - start > limit) throw new Error("Proof record too large");
    pending = Buffer.concat([pending, bytes.subarray(start)]);
  }
  if (pending.length) throw new Error("Unterminated proof record");
}

export function validateProofCommand(value: RecordValue): RecordValue {
  const allowed: Record<string, readonly string[]> = {
    prompt: ["type", "id", "message"], get_state: ["type", "id"], get_commands: ["type", "id"],
    get_entries: ["type", "id", "since"], abort: ["type", "id"], shutdown: ["type", "id"],
  };
  const keys = typeof value.type === "string" ? allowed[value.type] : undefined;
  if (!keys || Object.keys(value).some(key => !keys.includes(key)) || typeof value.id !== "string" || !/^[\w-]{1,80}$/.test(value.id)) throw new Error("Unsupported proof command");
  if (value.type === "prompt" && (typeof value.message !== "string" || !value.message.trim() || value.message.includes("\0"))) throw new Error("Invalid prompt");
  if (value.since !== undefined && (typeof value.since !== "string" || value.since.length > 128)) throw new Error("Invalid cursor");
  return value;
}

export function writeProofRecord(output: Writable, value: RecordValue, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (output.destroyed) { reject(new Error("Proof output closed")); return; }
    const onError = (error: Error) => { clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => reject(new Error("Proof output drain deadline exceeded")), timeoutMs);
    output.once("error", onError);
    try {
      output.write(JSON.stringify(value) + "\n", error => {
        clearTimeout(timer);
        // On failure the stream emits error after this callback; keep the once listener for it.
        if (error) reject(error);
        else { output.off("error", onError); resolve(); }
      });
    } catch (error) { clearTimeout(timer); output.off("error", onError); reject(error); }
  });
}

/** The pipe owner alone controls this fresh session. UI dialogs fail closed, never auto-approved. */
export async function runPiClientProof(input: Omit<RunRunnerLaunchInput, "processEffects" | "presentPreview" | "interactive" | "launch"> & {
  launch: RunRunnerLaunchInput["launch"];
  channel: { input: Readable; output: Writable };
  interactiveClient?: boolean;
  inheritedEnv?: Readonly<Record<string, string | undefined>>;
}) {
  // Check the trusted selected command before preparation; check the actual command again at spawn.
  if (input.launch.mode === "resume-by-id" && !supportsExactPiResume(typeof input.launch.runnerNative?.piCommand === "string" ? input.launch.runnerNative.piCommand : "pi", input.inheritedEnv)) throw new Error(PI_EXACT_RESUME_BLOCKED_REASON);
  if (input.adapter.runnerId !== "pi" || !isAbsolute(input.launch.projectRoot) || !statSync(input.launch.projectRoot).isDirectory()) throw new Error("Proof requires Pi and an explicit absolute project directory");
  if (input.launch.runnerNative?.continue || input.launch.runnerNative?.resume) throw new Error("Proof only creates fresh sessions");
  // Keep all preparation, verification, policy and memory handoffs in runRunnerLaunch.
  // Translate transport only here: the ordinary adapter remains interactive-only.
  const adapter = new Proxy(input.adapter, {
    get(target, key) {
      if (key === "buildLaunchPlan") return async (launch: RunRunnerLaunchInput["launch"]) => {
        const result = await target.buildLaunchPlan!(launch);
        return result.status === "ready" ? { ...result, plan: { ...result.plan, args: [...result.plan.args, "--mode", "rpc"], stdio: "pipe" as const, stdin: "inherit" as const } } : result;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RunnerAdapter;
  const emit = (value: RecordValue) => writeProofRecord(input.channel.output, value);
  return runRunnerLaunch({ ...input, adapter, interactive: false,
    presentPreview: async preview => { await emit({ type: "deck_proof_preview", preview }); },
    processEffects: { inheritedEnv: input.inheritedEnv,
      async spawn(command, args, options): Promise<SpawnedRunnerResult> {
        if (input.channel.input.destroyed || input.channel.output.destroyed) throw new Error("Proof controller disconnected before launch");
        const target=input.launch.mode==="resume-by-id"?validatePiResumeTarget(input.launch.projectRoot,JSON.parse(String(input.launch.runnerNative?.resumeTarget))):undefined;
        if(target&&!supportsExactPiResume(command,options.env))throw new Error(PI_EXACT_RESUME_BLOCKED_REASON);
        let receiptVerified=!target;
        const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
        let failed = false;
        let closing = false;
        const pending = new Map<string, {request:Dialog;timer:ReturnType<typeof setTimeout>}>();
        const seen = new Set<string>();
        const settle = async (id:string, reason:string) => {
          const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);
          await writeProofRecord(child.stdin,{type:'extension_ui_response',id,cancelled:true});
          await emit({type:'deck_ui_settled',id,reason});
        };
        const cancelAll = async () => {for(const id of [...pending.keys()])await settle(id,'cancelled');};
        const close = () => { if (!closing) { closing = true; void cancelAll().catch(()=>{failed=true;}).finally(()=>child.stdin.end()); } };
        const fail = () => { failed = true; close(); };
        child.stdin.on("error", fail);
        input.channel.output.on("error", fail);
        input.channel.output.on("close", close);
        // Diagnostics are drained, not retained or exposed as protocol/transcript data.
        child.stderr.resume();
        const exited = new Promise<{ code: number; signal: string | undefined }>(resolve => {
          child.on("error", () => { failed = true; });
          child.on("close", (code, signal) => resolve({ code: code ?? 1, signal: signal ?? undefined }));
        });
        const receive = (async () => {
          let count = 0;
          try {
            for await (const raw of decodeProofRecords(input.channel.input, MAX_COMMAND)) {
              if (++count > 256 || closing) throw new Error("Proof command budget exhausted");
              if(raw.type==='extension_ui_response'&&input.interactiveClient&&receiptVerified){
                const p=pending.get(String(raw.id));let response;
                try {response=dialogResponse(p?.request,raw);}
                catch {await emit({type:'deck_ui_rejected',id:raw.id,message:'Stale or invalid runtime response'});continue;}
                pending.delete(String(raw.id));clearTimeout(p!.timer);
                await writeProofRecord(child.stdin,response);await emit({type:'deck_ui_settled',id:raw.id,reason:'submitted'});
                continue;
              }
              const value = validateProofCommand(raw);
              if(!receiptVerified&&value.type!=="get_state"&&value.type!=="shutdown")throw new Error("Resume receipt not verified");
              if(value.type==='abort')await cancelAll();
              if (value.type === "shutdown") { close(); break; }
              await writeProofRecord(child.stdin, value);
            }
            close();
          } catch { fail(); }
        })();
        const send = (async () => {
          let bytes = 0;
          try {
            for await (const value of decodeProofRecords(child.stdout, MAX_RECORD)) {
              bytes += Buffer.byteLength(JSON.stringify(value));
              if (bytes > 16 * MAX_RECORD) throw new Error("Proof output budget exhausted");
              if(target&&value.type==="response"&&value.command==="get_state"&&value.success===true){if(!matchesPiResumeReceipt(target,value.data))throw new Error("Resume receipt mismatch");receiptVerified=true;}
              // RPC has UI but no TUI. Unsupported dialogs must not hang or grant consent.
              if (value.type === "extension_ui_request" && ["select", "confirm", "input", "editor"].includes(String(value.method))) {
                if(input.interactiveClient&&!closing&&receiptVerified){
                  try {
                    const request=parseDialog(value);
                    if(pending.size>=8||seen.size>=256||seen.has(request.id))throw Error('Runtime question limit or duplicate ID');
                    seen.add(request.id);
                    const timer=setTimeout(()=>{void settle(request.id,'expired').catch(fail);},Math.max(1,request.expiresAt-Date.now()));
                    pending.set(request.id,{request,timer});await emit({type:'deck_ui_pending',request});continue;
                  }catch {if(pending.has(String(value.id)))await settle(String(value.id),'cancelled');await emit({type:'deck_ui_rejected',message:'Invalid, duplicate or oversized runtime question; cancelled'});}
                }
                await writeProofRecord(child.stdin, { type: "extension_ui_response", id: value.id, cancelled: true });
              }
              await emit({ type: "pi", record: value });
            }
          } catch { fail(); child.stdout.resume(); }
        })();
        const outcome = await exited;
        for(const p of pending.values())clearTimeout(p.timer);pending.clear();
        input.channel.input.destroy();
        await Promise.all([receive, send]);
        input.channel.output.off("error", fail);
        input.channel.output.off("close", close);
        return { exitCode: failed ? 1 : outcome.code, signal: outcome.signal, stdout: "", stderr: failed ? "Proof channel failed; owned runtime closed." : "" };
      },
    },
  });
}

if (import.meta.main) {
  const [projectRoot, ...rawFlags] = process.argv.slice(2);
  const targetIndex=rawFlags.indexOf('--exact-target');
  const resumeTarget:PiResumeTarget|undefined=targetIndex<0?undefined:JSON.parse(rawFlags.splice(targetIndex,2)[1]);
  const flags=rawFlags;
  if (!projectRoot || flags.some(x=>!['--yes','--interactive-client'].includes(x)) || new Set(flags).size!==flags.length) throw new Error("Usage: bun pi-client-proof.ts /absolute/project [--yes] [--interactive-client]");
  // A supervisor signal closes the owned control channel; Pi's native shutdown settles its Deck jobs.
  const stop = () => process.stdin.destroy();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const piCommand: Record<string, string> = process.env.DECK_UI_PI_COMMAND ? { piCommand: process.env.DECK_UI_PI_COMMAND } : {};
  const result = await runPiClientProof({ adapter: createPiRunnerAdapter({piCommand:process.env.DECK_UI_PI_COMMAND}),
    launch: { projectRoot, teamId: "developer-team", deckConfig: createDeckConfigStoreFromEnvironment({ projectRoot }).readRequired(),
      ...(resumeTarget
        ? { mode: "resume-by-id" as const, sessionId: resumeTarget.sessionId, runnerNative: { ...piCommand, resumeTarget: JSON.stringify(resumeTarget) } }
        : { mode: "interactive" as const, runnerNative: { ...piCommand } }) },
    interactiveClient: flags.includes('--interactive-client'), yes: flags.includes('--yes'), channel: { input: process.stdin, output: process.stdout },
  });
  await writeProofRecord(process.stdout, { type: "deck_proof_closed", status: result.status,
    ...(result.status === "launched" ? { exitCode: result.outcome.exitCode } : "message" in result ? { message: result.message } : {}),
  });
  process.exit(result.status === "launched" ? result.outcome.exitCode : 1);
}
