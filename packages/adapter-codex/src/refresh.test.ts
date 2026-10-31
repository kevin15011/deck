import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { buildCodexDeveloperTeamInstallPlan, CODEX_MANIFEST_PATH } from "./developer-team-install";

const input = { projectRoot: "/tmp/deck-refresh-fixture", codexHome: "/tmp/deck-refresh-fixture/.codex" };
function installed() {
  return new Map(buildCodexDeveloperTeamInstallPlan({ ...input, existingFiles: new Map() }).expectedFiles.map(file => [file.relativePath, file.content]));
}
test("preserves custom roles while refreshing independent owned content without adopting edits", () => {
  const files = installed();
  const path = ".codex/agents/deck-quality.toml";
  files.set(path, files.get(path)! + '\ncustom_user_field = true\n');
  const plan = buildCodexDeveloperTeamInstallPlan({ ...input, existingFiles: files });
  expect(plan.blocked).toBe(false);
  expect(plan.mutations.some(file => file.relativePath === path)).toBe(false);
  expect(plan.diagnostics.some(entry => entry.code === "unowned-collision" && entry.severity === "warning")).toBe(true);
  expect(JSON.parse(plan.expectedFiles.find(file => file.relativePath === CODEX_MANIFEST_PATH)!.content).files[path]).not.toBe(createHash("sha256").update(files.get(path)!).digest("hex"));
});
test("adopts equivalent receipt-less hook formatting and preserves formatting", () => {
  const files = installed();
  const manifest = JSON.parse(files.get(CODEX_MANIFEST_PATH)!);
  manifest.contributions = [];
  files.set(CODEX_MANIFEST_PATH, JSON.stringify(manifest));
  const config = files.get('.codex/config.toml')!.replaceAll('command = ', 'command   =   ');
  files.set('.codex/config.toml', config);
  const plan = buildCodexDeveloperTeamInstallPlan({ ...input, existingFiles: files });
  expect(plan.blocked).toBe(false);
  expect(plan.expectedFiles.find(file => file.relativePath === '.codex/config.toml')!.content).toBe(config);
});

test("a custom MCP command survives while independent hooks and metadata refresh", () => {
  const files = installed();
  const custom = '# deck-codex-mcp:codebase-memory\n[mcp_servers.codebase-memory]\ncommand = "/user/custom-tool"\n';
  files.set('.codex/config.toml', files.get('.codex/config.toml')!.replace('multi_agent = true', 'multi_agent = false') + '\n' + custom);
  const plan = buildCodexDeveloperTeamInstallPlan({ ...input, existingFiles: files, mcpCapabilityIds: ['codebase-memory'], codebaseMemoryCommand: '/tmp/verified-tool' });
  expect(plan.blocked).toBe(false);
  expect(plan.expectedFiles.find(file => file.relativePath === '.codex/config.toml')!.content).toContain(custom);
  expect((Bun.TOML.parse(plan.expectedFiles.find(file => file.relativePath === '.codex/config.toml')!.content) as any).features.multi_agent).toBe(false);
  expect(plan.diagnostics.some(item => item.code === 'mcp-config-collision' && item.severity === 'warning')).toBe(true);
  const manifest = JSON.parse(plan.expectedFiles.find(file => file.relativePath === CODEX_MANIFEST_PATH)!.content);
  expect(manifest.contributions.some((entry: any) => entry.selector.header === 'mcp_servers.codebase-memory')).toBe(false);
});
