import { pinnedHookRuntime } from "../../core/src/session/prerequisite-evidence";
import { matchesCodexHookContribution } from "./codex-config";
import { codexRoleGeneration } from "./role-generation";
import { selectContributionContent, type RunnerContribution } from "@deck/core";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { NativeRoleDescriptor, RunnerPreparationFinding } from "@deck/core/session/driver";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";
import { isReadOnlyRole } from "@deck/core/session/role-tool-policy";
/** Reviewed, secret-free reason slug for a failed check; never raw messages or host paths outside the Deck root. */
const DETAIL=/^[a-z0-9][a-z0-9:._\/-]{0,80}$/;
export function nativeRoleFailureDetail(error:unknown):string|undefined {
  if(error instanceof Error && DETAIL.test(error.message)) return error.message;
  const code=(error as {code?:unknown} | null)?.code;
  return typeof code==="string" && /^E[A-Z]{2,12}$/.test(code) ? `fs-${code.toLowerCase()}` : undefined;
}
const hookId=(entry:{selector:unknown})=>String((entry.selector as {start?:string}).start??"").replace(/^# deck-codex-hook:|:start$/g,"");
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function read(path:string,maxBytes=1024*1024):string {
  for(let parent=dirname(path);;parent=dirname(parent)) {
    const stat=lstatSync(parent);
    if(!stat.isDirectory() || (stat.mode & 0o022)!==0 && !(stat.uid===0 && (stat.mode & 0o1000)!==0) || typeof process.getuid==='function' && stat.uid!==process.getuid() && stat.uid!==0) throw new Error(`unsafe-parent-directory`);
    if(dirname(parent)===parent) break;
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd);
    if(!before.isFile() || before.size>maxBytes || before.mode & 0o022 || typeof process.getuid==='function' && before.uid!==process.getuid()) throw new Error(`unsafe-file`);
    const text=readFileSync(fd,"utf8"), after=fstatSync(fd), current=lstatSync(path);
    if(before.ino!==current.ino || before.dev!==current.dev || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs || Buffer.byteLength(text)!==before.size) throw new Error(`file-changed-while-reading`);
    return text;
  } finally {closeSync(fd);}
}
/** Snapshot only the installed role and owned policy. Never reconstruct a role body. */
export function prepareCodexNativeRole(root:string,roleId:string):NativeRoleDescriptor {
  try {
    if(!DEVELOPER_TEAM_AGENTS.some(role=>role.id===roleId)) throw new Error(`unknown-role`);
    root=resolve(root);
    const files:Record<string,string>={};
    const preparation: RunnerPreparationFinding[] = [];
    const capture=(path:string)=>{const text=read(join(root,path),path === "deck/manifest.json" ? 16*1024*1024 : undefined);files[path]=hash(text);return text;};
    const manifest=JSON.parse(capture("deck/manifest.json"));
    if(manifest.version!==1 || !manifest.files) throw new Error(`manifest-invalid`);
    if (manifest.nativeRoleGeneration !== codexRoleGeneration()) preparation.push({ kind: "W", code: "codex-refresh-deferred", item: "generation", message: "Using the installed generation with current sandbox and hook trust checks; refresh is deferred until idle." });
    const owned=(path:string)=>{const text=capture(path);if(manifest.files[`.codex/${path}`]!==hash(text)) throw new Error(`owned-file-modified:${path}`);return text;};
    const rolePath = `agents/${roleId}.toml`;
    const roleText = capture(rolePath);
    if (manifest.files[`.codex/${rolePath}`] !== hash(roleText)) preparation.push({ kind: "W", code: "codex-role-preserved", item: rolePath, message: "Using the installed custom role; its sandbox is validated separately." });
    const role=Bun.TOML.parse(roleText) as Record<string,unknown>;
    if(role.name!==roleId || typeof role.developer_instructions!=="string" || !role.developer_instructions.trim()) throw new Error(`role-file-invalid`);
    const config=capture("config.toml");
    const hookContributions=(manifest.contributions as RunnerContribution[] ?? []).filter(entry=>entry.path===join(root,"config.toml") && entry.selector.kind==="text" && entry.selector.start.startsWith("# deck-codex-hook:"));
    for(const entry of hookContributions) { const content=selectContributionContent(config,entry.selector); if(content===undefined || !matchesCodexHookContribution(entry,content)) throw new Error(`hook-receipt-mismatch:${hookId(entry)}`); }
    const hooks:NativeRoleDescriptor["hooks"][number][]=[];
    for(const match of config.matchAll(/^# deck-codex-hook:([a-z-]+):start\n([\s\S]*?)^# deck-codex-hook:\1:end$/gm)) {
      if(!["rtk","readiness"].includes(match[1]!) || !hookContributions.some(entry=>entry.selector.kind==="text" && entry.selector.start===`# deck-codex-hook:${match[1]}:start`)) throw new Error(`hook-not-in-manifest:${match[1]}`);
      const parsed=Bun.TOML.parse(match[2]!) as any;
      for(const [event,groups] of Object.entries(parsed.hooks??{})) for(const group of groups as any[]) for(const hook of group.hooks??[]) {
        if(hook.type!=="command" || typeof hook.command!=="string" || hook.async===true) throw new Error(`hook-unsupported-shape`);
        hooks.push({event:event[0]!.toLowerCase()+event.slice(1),command:hook.command});
      }
    }
    try {
      // A missing receipt is not absence of a dependency: validate every referenced Deck script.
      for (const [id, path] of [["readiness", "deck/hooks/developer-team-execution.js"], ["rtk", "deck/hooks/deck-rtk-hook.cjs"]] as const) {
        const block = config.match(new RegExp(`^# deck-codex-hook:${id}:start\\n([\\s\\S]*?)^# deck-codex-hook:${id}:end$`, "gm"))?.[0];
        if (!block) continue;
        owned(path);
        if (id === "readiness") owned("deck/hooks/package.json");
        const parsed = Bun.TOML.parse(block) as any;
        for (const groups of Object.values(parsed.hooks ?? {}) as any[]) for (const group of groups) for (const hook of group.hooks ?? []) pinnedHookRuntime(hook.command, join(root, path));
      }
      for(const path of Object.keys(manifest.files)) if(path.startsWith(".codex/deck/hooks/")) owned(path.slice(7));
    } catch {
      hooks.length = 0;
      preparation.push({ kind: "W", code: "codex-hooks-preserved", item: "hooks", message: "A referenced hook script could not be authenticated. Hooks are disabled; customized files are preserved." });
    }
    let instructions=role.developer_instructions;
    if(roleId==="deck-lead") {
      instructions=owned("deck/role-selection.txt");

      const skill=(manifest.contributions as RunnerContribution[]).find(entry=>entry.selector.kind==="file" && entry.path.endsWith("/.agents/skills/deck-lead/SKILL.md"));
      if(!skill) throw new Error(`lead-skill-missing`);
      const bytes=read(skill.path);
      if(hash(bytes)!==skill.hash || hash(bytes)!==manifest.files[".agents/skills/deck-lead/SKILL.md"]) preparation.push({ kind: "W", code: "codex-skill-preserved", item: skill.path, message: "Preserved the customized Lead skill." });
      files[skill.path]=hash(bytes);
    }
    const scalar=(value:unknown)=>{if(value===undefined)return undefined;if(typeof value!=="string" || !value.trim() || value.length>1024 || /[\x00-\x1f]/.test(value))throw new Error(`scalar-invalid`);return value;};
    const sandbox=scalar(role.sandbox_mode);
    if(isReadOnlyRole(roleId) && sandbox!=="read-only") throw new Error(`role-sandbox-not-read-only`);
    if(sandbox && !["read-only","workspace-write","danger-full-access"].includes(sandbox)) throw new Error(`role-sandbox-unknown`);
    return {preparation,runnerId:"codex",roleId,roleRef:`agents/${roleId}.toml`,generation:files["deck/manifest.json"]!,source:{root,files},
      instructions,
      ...(role.model!==undefined?{model:scalar(role.model)}:{}),...(role.model_reasoning_effort!==undefined?{effort:scalar(role.model_reasoning_effort)}:{}),
      ...(sandbox?{sandbox:sandbox as NativeRoleDescriptor["sandbox"]}:{}),hooks};
  }catch(error){throw Object.assign(new Error("codex-session-generation-unverified",{cause:error}),{detail:nativeRoleFailureDetail(error)});}
}
export function verifyCodexNativeRole(role:NativeRoleDescriptor):void {
  if(role.runnerId!=="codex" || JSON.stringify({ ...prepareCodexNativeRole(role.source.root,role.roleId), preparation: undefined })!==JSON.stringify({ ...role, preparation: undefined })) throw new Error("codex-session-generation-unverified");
}
