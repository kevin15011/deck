import { codexRoleGeneration } from "./role-generation";
import { selectContributionContent, type RunnerContribution } from "@deck/core";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { NativeRoleDescriptor } from "@deck/core/session/driver";
import { DEVELOPER_TEAM_AGENTS } from "@deck/core/developer-team-catalog";
import { isReadOnlyRole } from "@deck/core/session/role-tool-policy";
import { CODEX_ROLE_SELECTION } from "./role-bootstrap";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
function read(path:string):string {
  for(let parent=dirname(path);;parent=dirname(parent)) {
    const stat=lstatSync(parent);
    if(!stat.isDirectory() || (stat.mode & 0o022)!==0 && !(stat.uid===0 && (stat.mode & 0o1000)!==0) || typeof process.getuid==='function' && stat.uid!==process.getuid() && stat.uid!==0) throw new Error();
    if(dirname(parent)===parent) break;
  }
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd);
    if(!before.isFile() || before.size>1024*1024 || before.mode & 0o022 || typeof process.getuid==='function' && before.uid!==process.getuid()) throw new Error();
    const text=readFileSync(fd,"utf8"), after=fstatSync(fd), current=lstatSync(path);
    if(before.ino!==current.ino || before.dev!==current.dev || before.mtimeMs!==after.mtimeMs || before.ctimeMs!==after.ctimeMs || Buffer.byteLength(text)!==before.size) throw new Error();
    return text;
  } finally {closeSync(fd);}
}
/** Snapshot only the installed role and owned policy. Never reconstruct a role body. */
export function prepareCodexNativeRole(root:string,roleId:string):NativeRoleDescriptor {
  try {
    if(!DEVELOPER_TEAM_AGENTS.some(role=>role.id===roleId)) throw new Error();
    root=resolve(root);
    const files:Record<string,string>={};
    const capture=(path:string)=>{const text=read(join(root,path));files[path]=hash(text);return text;};
    const manifest=JSON.parse(capture("deck/manifest.json"));
    if(manifest.version!==1 || manifest.nativeRoleGeneration!==codexRoleGeneration() || !manifest.files) throw new Error();
    const owned=(path:string)=>{const text=capture(path);if(manifest.files[`.codex/${path}`]!==hash(text)) throw new Error();return text;};
    const role=Bun.TOML.parse(owned(`agents/${roleId}.toml`)) as Record<string,unknown>;
    if(role.name!==roleId || typeof role.developer_instructions!=="string" || !role.developer_instructions.trim()) throw new Error();
    const config=capture("config.toml");
    const hookContributions=(manifest.contributions as RunnerContribution[] ?? []).filter(entry=>entry.path===join(root,"config.toml") && entry.selector.kind==="text" && entry.selector.start.startsWith("# deck-codex-hook:"));
    for(const entry of hookContributions) { const content=selectContributionContent(config,entry.selector); if(content===undefined || hash(content)!==entry.hash) throw new Error(); }
    const hooks:NativeRoleDescriptor["hooks"][number][]=[];
    for(const match of config.matchAll(/^# deck-codex-hook:([a-z-]+):start\n([\s\S]*?)^# deck-codex-hook:\1:end$/gm)) {
      if(!["memory-bridge","rtk","supermemory"].includes(match[1]!) || !hookContributions.some(entry=>entry.selector.kind==="text" && entry.selector.start===`# deck-codex-hook:${match[1]}:start`)) throw new Error();
      const parsed=Bun.TOML.parse(match[2]!) as any;
      for(const [event,groups] of Object.entries(parsed.hooks??{})) for(const group of groups as any[]) for(const hook of group.hooks??[]) {
        if(hook.type!=="command" || typeof hook.command!=="string" || hook.async===true) throw new Error();
        hooks.push({event:event[0]!.toLowerCase()+event.slice(1),command:hook.command});
      }
    }
    for(const path of Object.keys(manifest.files)) if(path.startsWith(".codex/deck/hooks/")) owned(path.slice(7));
    let instructions=role.developer_instructions;
    if(roleId==="deck-lead") {
      instructions=owned("deck/role-selection.txt");
      if(instructions!==CODEX_ROLE_SELECTION) throw new Error();
      const skill=(manifest.contributions as RunnerContribution[]).find(entry=>entry.selector.kind==="file" && entry.path.endsWith("/.agents/skills/deck-lead/SKILL.md"));
      if(!skill) throw new Error();
      const bytes=read(skill.path);
      if(hash(bytes)!==skill.hash || hash(bytes)!==manifest.files[".agents/skills/deck-lead/SKILL.md"]) throw new Error();
      files[skill.path]=hash(bytes);
    }
    const scalar=(value:unknown)=>{if(value===undefined)return undefined;if(typeof value!=="string" || !value.trim() || value.length>1024 || /[\x00-\x1f]/.test(value))throw new Error();return value;};
    const sandbox=scalar(role.sandbox_mode);
    if(isReadOnlyRole(roleId) && sandbox!=="read-only") throw new Error();
    if(sandbox && !["read-only","workspace-write","danger-full-access"].includes(sandbox)) throw new Error();
    return {runnerId:"codex",roleId,roleRef:`agents/${roleId}.toml`,generation:files["deck/manifest.json"]!,source:{root,files},
      instructions,
      ...(role.model!==undefined?{model:scalar(role.model)}:{}),...(role.model_reasoning_effort!==undefined?{effort:scalar(role.model_reasoning_effort)}:{}),
      ...(sandbox?{sandbox:sandbox as NativeRoleDescriptor["sandbox"]}:{}),hooks};
  }catch(error){throw new Error("codex-session-generation-unverified",{cause:error});}
}
export function verifyCodexNativeRole(role:NativeRoleDescriptor):void {
  if(role.runnerId!=="codex" || JSON.stringify(prepareCodexNativeRole(role.source.root,role.roleId))!==JSON.stringify(role)) throw new Error("codex-session-generation-unverified");
}
