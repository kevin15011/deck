import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertNoContributionSymlink, contributionHash, readRunnerContributions, selectContributionContent, buildDeveloperTeamManifest, DEVELOPER_TEAM, DEVELOPER_TEAM_AGENTS } from "@deck/core";
import { ROLE_TOOL_POLICY } from "@deck/core/session/role-tool-policy";
import type { NativeRoleDescriptor } from "@deck/core/session/driver";
import { parseJsonc } from "./model-discovery-context";

let generation: string | undefined;
export function openCodeRoleGeneration(): string {
  return generation ??= createHash("sha256").update(JSON.stringify({ manifest: buildDeveloperTeamManifest({team:DEVELOPER_TEAM}).manifest, policy: ROLE_TOOL_POLICY })).digest("hex");
}
export function readOpenCodeNativeRole(root: string, roleId: string): NativeRoleDescriptor {
  try {
    root = resolve(root);
    if (!DEVELOPER_TEAM_AGENTS.some(role => role.id === roleId)) throw new Error("unknown-role");
    const manifestPath = join(root, "deck/manifest.json");
    assertNoContributionSymlink(manifestPath);
    const manifest = readRunnerContributions(manifestPath);
    if (manifest?.runnerId !== "opencode" || manifest.root !== root) throw new Error("missing-receipt");
    const files: Record<string,string> = {};
    const capture = (path: string) => { assertNoContributionSymlink(path); const text = readFileSync(path,"utf8"); files[path] = contributionHash(text); return text; };
    capture(manifestPath);
    const owned = (path: string, pointer?: string) => {
      const text = capture(path);
      const receipt = manifest.contributions.find(entry => entry.path === path && (pointer ? entry.selector.kind === "json" && entry.selector.keys.join("/") === pointer : entry.selector.kind === "file"));
      const value = receipt && selectContributionContent(text, receipt.selector);
      if (value === undefined || contributionHash(value) !== receipt?.hash) throw new Error("changed-owned-source");
      return text;
    };
    const config = parseJsonc(owned(join(root,"opencode.json"), `agent/${roleId}`)) as any;
    const entry = config.agent?.[roleId];
    const promptPath = join(root,"prompts/deck-team",`${roleId}.md`);
    if (entry?.prompt !== `{file:${promptPath}}`) throw new Error("unexpected-prompt-source");
    const instructions = owned(promptPath);
    if (!instructions.startsWith(`<!-- deck-role-generation:${openCodeRoleGeneration()} -->\n`)) throw new Error("stale-generation");
    owned(join(root,"skills",roleId,"SKILL.md"));
    const plugin = join(root,"plugins/developer-team-execution.js");
    const pluginBytes = owned(plugin);

    return {runnerId:"opencode",roleId,roleRef:roleId,generation:files[manifestPath]!,source:{root,files},instructions,hooks:[{event:"plugin",command:pathToFileURL(plugin).href}]};
  } catch (cause) { throw new Error("opencode-session-generation-unverified",{cause}); }
}
