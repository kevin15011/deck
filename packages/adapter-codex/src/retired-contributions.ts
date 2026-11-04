import { contributionHash, selectContributionContent, type RunnerContribution } from "@deck/core";
import { mergeCodexOwnedHooks, RETIRED_CODEX_HOOK_IDS } from "./codex-config";
import { codexMcpReceiptCoversServer, mergeCodexMcpServers } from "./mcp-config";

// Version-1 installation decommissioning only. Remove after the legacy installation migration window.
export const RETIRED_CODEX_MCP_IDS = ["supermemory", "deck-memory"] as const;
/** Pure removal plan; caller applies it under its existing native lease, journal and preimage guard. */
export function decommissionRetiredContributions(source: string, receipts: readonly RunnerContribution[]): { content: string; diagnostics: string[]; removedContributionIds?: string[] } {
  try {
    const diagnostics: string[] = [], hooks: string[] = [], servers: string[] = [];
    for (const id of RETIRED_CODEX_HOOK_IDS) {
      const selector = { kind: "text" as const, start: `# deck-codex-hook:${id}:start`, end: `# deck-codex-hook:${id}:end` };
      const content = selectContributionContent(source, selector);
      if (content === undefined) continue;
      const prior = receipts.find(r => r.selector.kind === "text" && r.selector.start === selector.start);
      if (prior?.hash === contributionHash(content)) hooks.push(id);
      else diagnostics.push(`Preserved retired hook '${id}': ownership receipt is absent or edited. Review its configuration before removing it.`);
    }
    for (const id of RETIRED_CODEX_MCP_IDS) {
      const selector = { kind: "toml" as const, header: `mcp_servers.${id}` };
      const content = selectContributionContent(source, selector);
      if (content === undefined) continue;
      const prior = receipts.find(r => r.selector.kind === "toml" && r.selector.header === selector.header);
      if (prior?.hash === contributionHash(content) && codexMcpReceiptCoversServer(source, content, id)) servers.push(id);
      else diagnostics.push(`Preserved retired MCP '${id}': ownership receipt is absent or edited. Review its configuration before removing it.`);
    }
    const hookPlan = mergeCodexOwnedHooks(source, [], { removeOnly: hooks });
    if (hookPlan.status === "blocked") return { content: source, diagnostics: [...diagnostics, ...hookPlan.diagnostics] };
    const mcpPlan = mergeCodexMcpServers(hookPlan.content, [], { ownedServerIds: servers, allowLegacyMigration: false });
    if (mcpPlan.status === "blocked") return { content: source, diagnostics: [...diagnostics, ...mcpPlan.diagnostics] };
    const removedContributionIds = receipts.filter(receipt => {
      const selected = receipt.selector.kind === "text" ? hooks.some(id => receipt.selector.kind === "text" && receipt.selector.start === `# deck-codex-hook:${id}:start`)
        : receipt.selector.kind === "toml" && servers.some(id => receipt.selector.kind === "toml" && receipt.selector.header === `mcp_servers.${id}`);
      return selected && selectContributionContent(mcpPlan.content, receipt.selector) === undefined;
    }).map(receipt => receipt.id);
    return { content: mcpPlan.content, diagnostics, removedContributionIds };
  } catch {
    return { content: source, diagnostics: ["Retired contributions were preserved because ownership selectors are ambiguous or invalid. Review the configuration before removing them."] };
  }
}
