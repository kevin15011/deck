import { expect, test } from "bun:test";
import { contributionHash, contributionId, selectContributionContent, type RunnerContribution } from "@deck/core";
import { decommissionRetiredContributions } from "./retired-contributions";
const path = "/fixture/.codex/config.toml";
const hook = '# deck-codex-hook:memory-bridge:start\n[[hooks.SessionStart]]\nmatcher = "*"\nhooks = [{ type = "command", command = "deck internal codex-memory-hook" }]\n# deck-codex-hook:memory-bridge:end';
const mcp = '# deck-codex-mcp:deck-memory\n[mcp_servers.deck-memory]\ncommand = "/fixture/deck"\nargs = ["internal", "memory-mcp"]\nenv_vars = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN_FILE"]';
function receipt(selector: RunnerContribution['selector'], content: string): RunnerContribution {
 const target={path,selector};return {...target,id:contributionId(target),hash:contributionHash(selectContributionContent(content, selector)!),encoding:"bytes",ownership:"prior-record",scope:"global"};
}
const receipts=[receipt({kind:"text",start:'# deck-codex-hook:memory-bridge:start',end:'# deck-codex-hook:memory-bridge:end'},hook),receipt({kind:"toml",header:'mcp_servers.deck-memory'},mcp)];
// Protects content-only removal and prevents names/shapes overriding edited receipts.
test("retired owned contributions are removed and unrelated bytes survive",()=>{
 const prefix='# personal\nmodel = "custom"\n';const result=decommissionRetiredContributions(prefix+hook+'\n\n'+mcp+'\n',receipts);
 expect(result.content).toBe(prefix);expect(result.diagnostics).toEqual([]);
 expect(decommissionRetiredContributions(result.content,receipts).content).toBe(result.content);
});
test("a modified receipt beats a recognizable legacy shape",()=>{
 const edited=hook.replace('matcher = "*"','matcher = "custom"');const source=edited+'\n\n'+mcp+'\n';
 const result=decommissionRetiredContributions(source,receipts);
 expect(result.content).toContain(edited);expect(result.content).not.toContain('[mcp_servers.deck-memory]');expect(result.diagnostics.length).toBeGreaterThan(0);
});
test("unknown/customized entries are preserved",()=>{
 const source=hook.replace('deck internal codex-memory-hook','my-personal-hook')+'\n';
 expect(decommissionRetiredContributions(source,[]).content).toBe(source);
});

import { codexHookSemanticHash } from "./codex-config";
import { buildCodexDeveloperTeamInstallPlan, CODEX_MANIFEST_PATH } from "./developer-team-install";
// Protects default install composition, including the content-only upgrade route.
test.each(["full", "content-only"] as const)("%s installation decommissions receipted retired runtime config", materializationScope => {
 const source = '# personal\nmodel = "custom"\n' + hook + '\n\n' + mcp + '\n';
 const existingFiles = new Map([[".codex/config.toml", source], [CODEX_MANIFEST_PATH, JSON.stringify({ version: 1, files: {}, contributions: receipts })]]);
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/fixture", codexHome: "/fixture/.codex", existingFiles, materializationScope });
 expect(plan.blocked).toBe(false);
 const config = plan.expectedFiles.find(f => f.relativePath === ".codex/config.toml")?.content;
 expect(config).toBeDefined(); expect(config).toContain('# personal\nmodel = "custom"\n');
 expect(config).not.toContain("codex-memory-hook"); expect(config).not.toContain("[mcp_servers.deck-memory]");
 const manifest = JSON.parse(plan.expectedFiles.find(f => f.relativePath === CODEX_MANIFEST_PATH)!.content);
 for (const receipt of receipts) expect(manifest.contributions.some((entry: RunnerContribution) => entry.id === receipt.id)).toBe(false);
});

test("ambiguous legacy markers preserve the entire config with a bounded diagnostic", () => {
 const source = hook + '\n' + hook + '\n';
 const result = decommissionRetiredContributions(source, receipts);
 expect(result.content).toBe(source); expect(result.diagnostics.length).toBeGreaterThan(0);
});

test.each(["full", "content-only"] as const)("%s preserves a receipted retired hook edited into another recognizable legacy shape", materializationScope => {
 const original = '# deck-codex-hook:supermemory:start\n[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = "\'/usr/bin/node\' \'/fixture/deck/codex/tools/official-supermemory-1.0.19/recall.js\'", timeout = 60 }]\n# deck-codex-hook:supermemory:end';
 const selector = { kind: "text" as const, start: "# deck-codex-hook:supermemory:start", end: "# deck-codex-hook:supermemory:end" };
 const prior = receipt(selector, original), edited = original.replace("timeout = 60", "timeout = 61");
 const existingFiles = new Map([[".codex/config.toml", edited + '\n'], [CODEX_MANIFEST_PATH, JSON.stringify({ version: 1, files: {}, contributions: [prior] })]]);
 const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/fixture", codexHome: "/fixture/.codex", existingFiles, materializationScope });
 const config = plan.expectedFiles.find(file => file.relativePath === ".codex/config.toml")?.content ?? existingFiles.get(".codex/config.toml")!;
 expect(config).toContain(edited);
 expect(plan.diagnostics.some(d => /preserv|collision/i.test(d.code))).toBe(true);
});

// Protects exact-byte ownership across repeated production plans; shape/semantic matches never authorize retirement.
for (const materializationScope of ["full", "content-only"] as const) {
 for (const evidence of ["matching", "missing", "invalid", "edited", "semantic-only"] as const) {
  test(`${materializationScope} retains retired hook ownership evidence over two installs: ${evidence}`, () => {
   const original = '# deck-codex-hook:supermemory:start\n[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = "\'/usr/bin/node\' \'/fixture/deck/codex/tools/official-supermemory-1.0.19/recall.js\'", timeout = 60 }]\n# deck-codex-hook:supermemory:end';
   const selector = {kind:"text" as const,start:"# deck-codex-hook:supermemory:start",end:"# deck-codex-hook:supermemory:end"};
   const prior = {...receipt(selector, original), hookSemanticHash: codexHookSemanticHash(original)};
   if (evidence === "invalid") prior.hash = "invalid";
   const current = evidence === "edited" ? original.replace("timeout = 60", "timeout = 61") : evidence === "semantic-only" ? original.replace("timeout = 60", "timeout=60") : original;
   const files = new Map([[".codex/config.toml", current + "\n"], [CODEX_MANIFEST_PATH, JSON.stringify({version:1,files:{},contributions:evidence === "missing" ? [] : [prior]})]]);
   for (let pass=0; pass<2; pass++) {
    const plan=buildCodexDeveloperTeamInstallPlan({projectRoot:"/fixture",codexHome:"/fixture/.codex",existingFiles:files,materializationScope});
    expect(plan.blocked).toBe(false);
    for(const file of plan.expectedFiles) files.set(file.relativePath,file.content);
    const config=files.get(".codex/config.toml")!;
    if(evidence === "matching") expect(config).not.toContain(original);
    else {
     expect(config).toContain(current);
     if(evidence !== "missing") expect(JSON.parse(files.get(CODEX_MANIFEST_PATH)!).contributions).toContainEqual(prior);
    }
   }
  });
 }
}

// Protects user MCP edits and receipt provenance through repeated production installation plans.
for (const materializationScope of ["full", "content-only"] as const) {
 for (const serverId of ["deck-memory", "supermemory"] as const) {
  for (const evidence of ["matching", "missing", "invalid", "wrong-path", "edited", "semantic-only"] as const) {
   test(`${materializationScope} retains retired MCP evidence over three installs: ${serverId}/${evidence}`, () => {
    const original = mcp.replaceAll("deck-memory", serverId);
    const selector = {kind:"toml" as const,header:`mcp_servers.${serverId}`};
    const prior = receipt(selector, original);
    if (evidence === "invalid") prior.hash = "invalid";
    if (evidence === "wrong-path") { prior.path = "/other/.codex/config.toml"; prior.id = contributionId(prior); }
    const current = evidence === "edited" ? original.replace("/fixture/deck", "/custom/deck") : evidence === "semantic-only" ? original.replace('command = ', 'command=') : original;
    const personal = '[mcp_servers.personal]\ncommand = "/personal/server"\nargs = ["keep"]\n';
    const sibling = receipt({kind:"toml",header:"mcp_servers.personal"}, personal);
    const priorReceipts = evidence === "missing" ? [sibling] : [prior, sibling];
    const files = new Map([[".codex/config.toml", current + "\n\n" + personal], [CODEX_MANIFEST_PATH, JSON.stringify({version:1,files:{},contributions:priorReceipts})]]);
    for (let pass=0; pass<3; pass++) {
     const plan=buildCodexDeveloperTeamInstallPlan({projectRoot:"/fixture",codexHome:"/fixture/.codex",existingFiles:files,materializationScope});
     expect(plan.blocked).toBe(false);
     for (const file of plan.expectedFiles) files.set(file.relativePath,file.content);
     const config=files.get(".codex/config.toml")!;
     const nextReceipts: RunnerContribution[] = JSON.parse(files.get(CODEX_MANIFEST_PATH)!).contributions;
     expect(selectContributionContent(config, sibling.selector)).toBe(selectContributionContent(personal, sibling.selector));
     expect(nextReceipts).toContainEqual(sibling);
     if (evidence === "matching") {
      expect(selectContributionContent(config, selector)).toBeUndefined();
      expect(nextReceipts.some(entry => entry.id === prior.id)).toBe(false);
     } else {
      expect(selectContributionContent(config, selector)).toBe(selectContributionContent(current, selector));
      expect(nextReceipts.filter(entry => entry.selector.kind === "toml" && entry.selector.header === selector.header)).toEqual(evidence === "missing" ? [] : [prior]);
     }
    }
   });
  }
 }
}
