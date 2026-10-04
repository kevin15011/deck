import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const findForeignRunnerText = (text: string, _runner: "pi") => [/Claude Code/, /OpenCode/, /--opencode/, /\bCodex\b/, /WebFetch/, /additionalContext/].filter((p) => p.test(text)).map((p) => p.source);
import { buildCapabilityInstructionBundle } from "@deck/core/teams/developer/instruction-bundles";
import { buildDeveloperTeamInstallPlan } from "./developer-team-install";
import { buildTeamSystemPrompt } from "./pi-team-profile";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "deck-pi-runner-text-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const bundle = () => buildCapabilityInstructionBundle(["codebase-memory", "context-mode", "rtk", "serena", "web-search", "code-economy"]);

describe("Pi materialized text", () => {
  test("agent skills carry Agent Skills `name` frontmatter equal to the directory name", () => {
    const plan = buildDeveloperTeamInstallPlan(join(root, "project"), { layout: { packageRoot: join(root, "pkg") }, capabilityInstructions: bundle() });
    expect(plan.skills.length).toBeGreaterThan(0);
    for (const skill of plan.skills) {
      const dir = skill.absolutePath.split("/").slice(-2)[0]!;
      expect(skill.content.startsWith(`---\nname: ${JSON.stringify(dir)}\n`)).toBe(true);
    }
  });

  test("skills, agents and standalone skills describe Pi mechanics, not other runners'", () => {
    const plan = buildDeveloperTeamInstallPlan(join(root, "project"), { layout: { packageRoot: join(root, "pkg") }, capabilityInstructions: bundle() });
    const files = [...plan.skills, ...plan.agents, ...plan.standaloneSkills, ...plan.sddSkillFiles];
    expect(files.length).toBeGreaterThan(10);
    const lead = plan.skills.find((skill) => skill.absolutePath.includes("/deck-lead/"))!;
    expect(lead.content).toContain("### Pi Tool Routing");
    for (const file of files) expect({ path: file.absolutePath, hits: findForeignRunnerText(file.content, "pi") }).toEqual({ path: file.absolutePath, hits: [] });
  });

  test("the launch system prompt takes the Pi variant of session fragments", () => {
    const { content } = buildTeamSystemPrompt("developer-team", { capabilityInstructions: bundle() });
    expect(findForeignRunnerText(content, "pi")).toEqual([]);
  });
});
