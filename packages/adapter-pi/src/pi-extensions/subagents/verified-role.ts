import { verifyPiInstallation } from "../../installation-trust";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { assertNoContributionSymlink } from "../../../../core/src/runner-contributions";
import { ROLE_TOOL_POLICY } from "@deck/core/session/role-tool-policy";
import { matchesOwnedHash, parsePiManifest } from "../../pi-manifest";
import { parseAgentMarkdown, type DeckAgent } from "./agents";

/** Generation is derived from owned bytes, never child-supplied identity. */
export function verifiedPiGeneration(packageRoot: string, agent: DeckAgent): string {
  verifyInstalledPiRole(packageRoot, agent);
  const manifest = join(dirname(resolve(packageRoot)), "manifest.json");
  assertNoContributionSymlink(manifest);
  return createHash("sha256").update(readFileSync(manifest)).digest("hex");
}

/** Verify the installed role and extension policy at each owned child launch/resume. */
export function verifyInstalledPiRole(packageRoot: string, agent: DeckAgent): DeckAgent {
  try {
    const root = resolve(packageRoot), agentDir = dirname(dirname(root));
    if (root !== join(agentDir,"deck/package") || !/^deck-[a-z-]+$/.test(agent.id)) throw new Error("invalid-root-or-role");
    const read = (path: string) => { assertNoContributionSymlink(path); return readFileSync(path,"utf8"); };
    const parsed = parsePiManifest(read(join(agentDir,"deck/manifest.json")));
    if (!parsed.ok) throw new Error("invalid-manifest");
    const owned = (path: string) => {
      const bytes = read(join(agentDir,path));
      if (!matchesOwnedHash(path,parsed.manifest.files[path],bytes)) throw new Error("changed-owned-source");
      return bytes;
    };
    verifyPiInstallation(agentDir);
    const fresh = parseAgentMarkdown(agent.id,read(join(root,`agents/${agent.id}.md`)));
    if (JSON.stringify(fresh) !== JSON.stringify(agent)) throw new Error("role-changed-after-discovery");

    owned("deck/package/package.json");
    for (const extension of ["deck-tool-policy", "deck-subagents"]) {
      for (const name of ["index.js", "impl.js"]) owned(`deck/package/extensions/${extension}/${name}`);
    }
    owned("deck/package/extensions/deck-tool-policy/config.json");
    return fresh;
  } catch (cause) { throw new Error("The installed Pi executable or role policy could not be authenticated. Restore the owned extension or remove unsafe role permissions before retrying.",{cause}); }
}
