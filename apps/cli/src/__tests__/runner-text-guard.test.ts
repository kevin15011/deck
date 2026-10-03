import { describe, expect, test } from "bun:test";
import { buildCapabilityInstructionBundle, getAgentContent, getDeveloperTeamCatalog } from "@deck/core";
import { buildCodexDeveloperTeamInstallPlan } from "@deck/adapter-codex";
import { buildDeveloperTeamInstallPlan as buildPiPlan, buildTeamSystemPrompt } from "@deck/adapter-pi";
import { buildOpenCodeDeveloperTeamInstallPlan } from "@deck/adapter-opencode";
import { translateClaudeCapabilityInstructions } from "../../../../packages/adapter-claude/src/instruction-translation";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Cross-runner guard: text materialized for one runner must not describe another
 * runner's mechanism. Keep each denylist small; add a pattern when a leak is found.
 */
type Runner = "pi" | "opencode" | "claude" | "codex";
const DENYLIST: Record<Runner, RegExp[]> = {
  pi: [/Claude Code/, /OpenCode/, /--opencode/, /\bCodex\b/, /WebFetch/, /additionalContext/],
  opencode: [/Claude Code/, /\bCodex\b/, /deck-tool-policy/, /additionalContext/],
  claude: [/--opencode/, /OpenCode/, /\bCodex\b/, /deck-tool-policy/],
  codex: [/Claude Code/, /OpenCode/, /--opencode/, /WebFetch/, /deck-tool-policy/],
};
const PACKAGES = ["codebase-memory", "code-economy", "context-mode", "rtk", "serena", "web-search"] as const;
const bundle = () => buildCapabilityInstructionBundle([...PACKAGES]);

function leaks(runner: Runner, files: readonly { name: string; content: string }[]): string[] {
  expect(files.length).toBeGreaterThan(5);
  return files.flatMap((file) => DENYLIST[runner].filter((p) => p.test(file.content)).map((p) => `${file.name}: ${p.source}`));
}

describe("cross-runner materialized text guard", () => {
  test("Pi skills, agents, standalone skills and launch prompt", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-guard-pi-"));
    try {
      const plan = buildPiPlan(join(root, "project"), { layout: { packageRoot: join(root, "pkg") }, capabilityInstructions: bundle() });
      const files = [...plan.skills, ...plan.agents, ...plan.standaloneSkills, ...plan.sddSkillFiles].map((f) => ({ name: f.absolutePath, content: f.content }));
      files.push({ name: "pi launch system prompt", content: buildTeamSystemPrompt("developer-team", { capabilityInstructions: bundle() }).content });
      expect(leaks("pi", files)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("OpenCode skills, agents and standalone skills", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-guard-oc-"));
    try {
      const plan = buildOpenCodeDeveloperTeamInstallPlan(join(root, "project"), { configDir: join(root, "cfg"), capabilityInstructions: bundle() } as never);
      const files = [...plan.skills, ...plan.agents, ...plan.standaloneSkills].map((f) => ({ name: f.absolutePath, content: f.content }));
      expect(leaks("opencode", files)).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("Codex expected skills, roles and instructions", () => {
    const plan = buildCodexDeveloperTeamInstallPlan({ projectRoot: "/work/project", existingFiles: new Map(), capabilityInstructions: bundle() });
    const files = plan.expectedFiles.filter((f) => ["role", "agent-skill", "bootstrap-skill", "instructions"].includes(f.kind)).map((f) => ({ name: f.relativePath, content: f.content }));
    expect(leaks("codex", files)).toEqual([]);
  });

  test("Claude agent and skill bodies", () => {
    const translated = translateClaudeCapabilityInstructions(bundle());
    const files = getDeveloperTeamCatalog().flatMap((agent) => {
      const content = getAgentContent(agent.id, { promptProfile: "legacy", capabilityInstructions: translated })!;
      return [{ name: `${agent.id} agent`, content: content.agentBody }, { name: `${agent.id} skill`, content: content.skillBody }];
    });
    expect(leaks("claude", files)).toEqual([]);
  });
});
