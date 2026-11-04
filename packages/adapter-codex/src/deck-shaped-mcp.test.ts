import { expect, test } from "bun:test";
import { isDeckShapedMcpEntry, mergeCodexMcpServers } from "./mcp-config";

// Protects: retired MCP bytes without ownership receipts survive migration.
// Oracle: the retirement spec requires exact receipts; names and launch shapes are insufficient.
// Fails if: a familiar marker or binary path authorizes deletion without a receipt.
const memory = (command: string, extra = "") => `# deck-codex-mcp:deck-memory\n[mcp_servers.deck-memory]\ncommand = "${command}"\nargs = ["internal", "memory-mcp"]\nenv_vars = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN_FILE"]\n${extra}`;

test("preserves a receipt-less retired MCP block whatever its payload path", () => {
  for (const command of ["/h/.local/bin/.deck-canary.payload-853772f299f0b8c2654dd83bfc8f12707526f984ada1bebdf9f987f6d0a992ee", "/usr/local/bin/deck"]) {
    const source = `${memory(command)}\n[model]\nname = "x"\n`;
    const result = mergeCodexMcpServers(source, []);
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe(source);
  }
});

test("keeps customized or foreign marked blocks", () => {
  expect(mergeCodexMcpServers(memory("/tmp/evil"), []).status).toBe("unchanged");
  expect(mergeCodexMcpServers(memory("/usr/local/bin/deck", "startup_timeout_sec = 5\n"), []).status).toBe("unchanged");
  expect(isDeckShapedMcpEntry("deck-memory", { command: "/usr/local/bin/deck", args: ["internal", "other"], env_vars: [] })).toBe(false);
  expect(isDeckShapedMcpEntry("context7", { command: "/usr/local/bin/deck" })).toBe(false);
});

import { buildCodexDeveloperTeamInstallPlan } from './developer-team-install';
import { contributionHash, contributionId, selectContributionContent, type RunnerContribution } from '@deck/core';
// Oracle: legacy recognition always rewrites to canonical commands before issuing trust.
test('adopted legacy web-search is rewritten and receipts cover only new bytes', () => {
 const old = '# deck-codex-mcp:web-search\n[mcp_servers.web-search]\ncommand = "/tmp/x/npx"\nargs = ["-y", "tavily-mcp@0.2.16"]\nenv_vars = ["TAVILY_API_KEY"]\n';
 const plan = buildCodexDeveloperTeamInstallPlan({projectRoot:'/fixture',existingFiles:new Map([['.codex/config.toml',old]]),mcpCapabilityIds:['web-search'],webSearchProviderSupported:true,webSearchProviderConfigured:true,webSearchCredentialAvailable:true,webSearchExecutableAvailable:true,webSearchCommand:'/safe/npx',webSearchProvider:{providerId:'tavily',implementationId:'tavily-mcp',semanticServerId:'web-search',command:['npx','-y','tavily-mcp@0.2.17'],credentialEnvVar:'TAVILY_API_KEY',toolMapping:{search:'tavily_search',extract:'tavily_extract'},forbiddenToolNames:['tavily_crawl','tavily_map']}});
 const config = plan.expectedFiles.find(f=>f.relativePath==='.codex/config.toml')!.content;
 const manifest = JSON.parse(plan.expectedFiles.find(f=>f.relativePath==='.codex/deck/manifest.json')!.content);
 const selector = {kind:'toml' as const,header:'mcp_servers.web-search'};
 const before = selectContributionContent(old,selector)!;
 const after = selectContributionContent(config,selector);
 expect(config).not.toContain('/tmp/x/npx');
 expect(after).toBeDefined();
 if (after !== undefined) {
  const receipt = manifest.contributions.find((e:RunnerContribution)=>e.id===contributionId({path:'/fixture/.codex/config.toml',selector}));
  expect(receipt.hash).toBe(contributionHash(after));
  expect(receipt.hash).not.toBe(contributionHash(before));
 }
});
// Oracle: history recognizes exact prior Deck bytes, never a familiar marker around altered code.
test('exact history recovers an unfamiliar old hook, altered bytes remain unowned', () => {
 const selector={kind:'text' as const,start:'# deck-codex-hook:readiness:start',end:'# deck-codex-hook:readiness:end'};
 const old=`${selector.start}\n[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "historical-canonical-command"\n${selector.end}`;
 const target={path:'/fixture/.codex/config.toml',selector};
 const receipt:RunnerContribution={...target,id:contributionId(target),hash:contributionHash(old),encoding:'bytes',ownership:'new-write',scope:'global'};
 const input={projectRoot:'/fixture',ownershipHistory:{[receipt.id]:[receipt]},existingFiles:new Map([['.codex/config.toml',old]])};
 const run=(source:string)=>buildCodexDeveloperTeamInstallPlan({...input,existingFiles:new Map([['.codex/config.toml',source]])});
 const recovered=run(old);
 expect(recovered.diagnostics.some(d=>d.code==='trusted-hook-config-collision')).toBe(false);
 const changed=run(old.replace('historical-canonical-command','foreign-command'));
 expect(changed.diagnostics.some(d=>d.code==='trusted-hook-config-collision')).toBe(true);
 expect(changed.expectedFiles.find(f=>f.relativePath==='.codex/config.toml')!.content).toContain('foreign-command');
});

test('legacy shape never overrides a recorded mismatching MCP receipt', () => {
 const old='# deck-codex-mcp:web-search\n[mcp_servers.web-search]\ncommand = "/tmp/x/npx"\nargs = ["-y", "tavily-mcp@0.2.16"]\nenv_vars = ["TAVILY_API_KEY"]\n';
 const result=mergeCodexMcpServers(old,[{id:'web-search',transport:'stdio',command:'/safe/npx',args:['-y','tavily-mcp@0.2.17'],envVars:['TAVILY_API_KEY']}],{recordedServerIds:['web-search'],ownedServerIds:[]});
 expect(result.status).toBe('blocked');
 expect(result.content).toBe(old);
});

// Protects: customized receipted MCP bytes survive the complete planner collision retry.
// Oracle: a receipt for prior bytes cannot authorize the edited command, even with a legacy launch shape.
// Fails if: retry deletes the entry or grants a new receipt to the edited bytes.
test('planner preserves a customized receipted MCP block through collision retry', () => {
 const old='# deck-codex-mcp:web-search\n[mcp_servers.web-search]\ncommand = "/old/npx"\nargs = ["-y", "tavily-mcp@0.2.16"]\nenv_vars = ["TAVILY_API_KEY"]\n';
 const selector={kind:'toml' as const,header:'mcp_servers.web-search'};
 const target={path:'/fixture/.codex/config.toml',selector};
 const receipt={...target,id:contributionId(target),hash:contributionHash(selectContributionContent(old,selector)!),encoding:'bytes',ownership:'new-write',scope:'global'};
 const edited=old.replace('/old/npx','/custom/npx');
 const plan=buildCodexDeveloperTeamInstallPlan({projectRoot:'/fixture',existingFiles:new Map([['.codex/config.toml',edited],['.codex/deck/manifest.json',JSON.stringify({version:1,files:{},contributions:[receipt]})]]),mcpCapabilityIds:['web-search'],webSearchProviderSupported:true,webSearchProviderConfigured:true,webSearchCredentialAvailable:true,webSearchExecutableAvailable:true,webSearchCommand:'/safe/npx',webSearchProvider:{providerId:'tavily',implementationId:'tavily-mcp',semanticServerId:'web-search',command:['npx','-y','tavily-mcp@0.2.17'],credentialEnvVar:'TAVILY_API_KEY',toolMapping:{search:'tavily_search',extract:'tavily_extract'},forbiddenToolNames:['tavily_crawl','tavily_map']}});
 const config=plan.expectedFiles.find(f=>f.relativePath==='.codex/config.toml')!.content;
 expect(selectContributionContent(config,selector)).toBe(selectContributionContent(edited,selector));
 const manifest=JSON.parse(plan.expectedFiles.find(f=>f.relativePath==='.codex/deck/manifest.json')!.content);
 expect(manifest.contributions.some((r:RunnerContribution)=>r.id===receipt.id&&r.hash===contributionHash(selectContributionContent(edited,selector)!))).toBe(false);
});
