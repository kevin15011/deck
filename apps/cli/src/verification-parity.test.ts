import { VERIFICATION_DOCTRINE_CORE } from "../../../packages/core/src/teams/developer/verification-doctrine";
import { GIT_DISCARD_PROTECTION_RULE } from "../../../packages/core/src/teams/developer/git-safety";
import { ADAPTIVE_TEAM_RUNTIME_CONTRACT } from "../../../packages/core/src/teams/developer/adaptive-team-content";
import { describe, expect, test } from "bun:test";
import { getAgentContent, getDeveloperTeamCatalog, getTeamSessionInstructions } from "@deck/core";
import { getStandaloneSkill, getStandaloneSkills } from "@deck/core/skills/external";
import { createPiRunnerCapabilities } from "../../../packages/adapter-pi/src/runner-capabilities";
import { createOpenCodeRunnerCapabilities } from "../../../packages/adapter-opencode/src/runner-capabilities";
import { buildOpenCodeDeveloperTeamInstallPlan } from "@deck/adapter-opencode";
import { buildCodexDeveloperTeamInstallPlan } from "@deck/adapter-codex";
import { expectedFiles } from "../../../packages/adapter-claude/src/runner-adapter";
import { sessionRolePrompt } from "./session-service";
import { removeDeckMemoryClaimsForOpenCode } from "../../../packages/adapter-opencode/src/prompt-generation";
import { parse } from "yaml";

// Protect production materialization composition: dropping any canonical skill must name its runner.
const projectRoot = "/tmp/deck-verification-parity-virtual";
type File = { path: string; content: string };
const plans: Record<string, () => readonly File[]> = {
  pi: () => createPiRunnerCapabilities().developerTeam!.buildInstallPlan!({ projectRoot }).files,
  opencode: () => [
    ...createOpenCodeRunnerCapabilities().developerTeam!.buildInstallPlan!({ projectRoot }).files,
    ...buildOpenCodeDeveloperTeamInstallPlan(projectRoot, { configDir: `${projectRoot}/config` }).promptGenerationPlan.map(f => ({ path: `agents/${f.agent.id}.md`, content: f.content })),
  ],
  codex: () => buildCodexDeveloperTeamInstallPlan({ projectRoot, existingFiles: new Map() }).expectedFiles.map(f => ({ path: f.relativePath, content: f.content })),
  claude: () => expectedFiles(projectRoot),
};
for (const [runner, build] of Object.entries(plans)) {
  describe(`verification parity: ${runner}`, () => {
    test("canonical standalone skills survive production plan composition", () => {
      const files = build();
      expect(getStandaloneSkills().map(s => s.skillId), `${runner}: doctrine registration`).toContain("deck-verification");
      for (const file of files) {
        expect(file.path).not.toContain("test-driven-development");
        expect(file.content).not.toContain("test-driven-development");
      }
      for (const file of files) expect(file.content, `${runner}: obsolete TDD trigger in ${file.path}`).not.toContain("Use when implementing any logic, fixing any bug, or changing any behavior");
      for (const { skillId } of getStandaloneSkills()) {
        const file = files.find(f => (`/` + f.path).endsWith(`/skills/${skillId}/SKILL.md`));
        expect(file, `${runner}: missing ${skillId}`).toBeDefined();
        expect(file!.content.trim(), `${runner}: ${skillId} source`).toBe(getStandaloneSkill(skillId).SKILL.trim());
        const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(file!.content);
        expect(match, `${runner}: ${skillId} frontmatter`).not.toBeNull();
        expect(parse(match![1]!).name).toBe(skillId);
      }
    });
    test("agent prompts consume canonical role bodies", () => {
      const files = build();
      for (const agent of getDeveloperTeamCatalog()) {
        const file = files.find(f => (`/` + f.path).endsWith(`/agents/${agent.id}.${runner === "codex" ? "toml" : "md"}`));
        expect(file, `${runner}: missing agent ${agent.id}`).toBeDefined();
        if (runner === "codex" && ["deck-investigate", "deck-quality"].includes(agent.id)) {
          expect(Bun.TOML.parse(file!.content)).toMatchObject({ sandbox_mode: "read-only" });
        }
        const body = runner === "codex" ? String((Bun.TOML.parse(file!.content) as { developer_instructions: string }).developer_instructions) : file!.content;
        expect(body.split(VERIFICATION_DOCTRINE_CORE), `${runner}: ${agent.id} doctrine exactly once`).toHaveLength(2);
        expect(body, `${runner}: ${agent.id} default strict skill`).not.toContain("test-driven-development");
        expect(body, `${runner}: ${agent.id} git protection`).toContain(GIT_DISCARD_PROTECTION_RULE);
        expect(body, `${runner}: ${agent.id} team contract`).toContain(runner === "opencode" ? removeDeckMemoryClaimsForOpenCode(ADAPTIVE_TEAM_RUNTIME_CONTRACT) : ADAPTIVE_TEAM_RUNTIME_CONTRACT);
        const canonical = runner === "opencode" && agent.id === "deck-lead"
          ? getTeamSessionInstructions("developer-team", { promptProfile: "compact", skillDiscoveryRuntimeContext: { activeRunnerId: "opencode" } })!
          : getAgentContent(agent.id, { promptProfile: "compact" })!.agentBody;
        expect(body, `${runner}: ${agent.id} canonical agent`).toContain((runner === "opencode" ? removeDeckMemoryClaimsForOpenCode(canonical) : canonical).trim());
      }
    });
    test("role skills consume canonical role content", () => {
      const files = build();
      for (const agent of getDeveloperTeamCatalog()) {
        const file = files.find(f => (`/` + f.path).endsWith(`/skills/${agent.skillId}/SKILL.md`));
        expect(file, `${runner}: missing ${agent.skillId}`).toBeDefined();
        const canonical = getAgentContent(agent.id, { promptProfile: "compact" })!;
        expect(file!.content.split(VERIFICATION_DOCTRINE_CORE), `${runner}: ${agent.id} role-skill doctrine`).toHaveLength(2);
        expect(file!.content, `${runner}: ${agent.id} canonical role skill`).toContain((runner === "opencode" ? removeDeckMemoryClaimsForOpenCode(canonical.skillBody) : canonical.skillBody).trim());
      }
    });
  });
}

test("native runners select installed roles without duplicating canonical session bodies", () => {
  for (const agent of getDeveloperTeamCatalog()) {
    for (const runnerId of Object.keys(plans)) {
      expect(sessionRolePrompt(agent.id, { projectRoot, runnerId })).not.toContain("test-driven-development");
      expect(sessionRolePrompt(agent.id, { projectRoot, runnerId })).not.toContain(VERIFICATION_DOCTRINE_CORE);
      expect(sessionRolePrompt(agent.id, { projectRoot, runnerId })).not.toContain(getAgentContent(agent.id, { promptProfile: "compact" })!.agentBody);
    }
  }
});

// Claude full-team-plugin launch parity (Lead/member, trust, MCP isolation, selection)
// is exercised by adapter-claude/src/session-skills.int.test.ts using the production installer.
// Exercise the other native launch compositions under both project-admission modes. No provider calls.
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildCodexLaunch } from "../../../packages/adapter-codex/src/session-driver/launch";
import { buildOpenCodeLaunch } from "../../../packages/adapter-opencode/src/session-driver/launch";
import type { DriverTaskInput } from "@deck/core/session/driver";

test("Codex and OpenCode native child loaders retain named standalone skills with and without project trust", async () => {
  const home = await mkdtemp(join(tmpdir(), "deck-native-skills-parity-"));
  try {
    const globalRoot = join(home, ".agents", "skills");
    for (const { skillId } of getStandaloneSkills()) {
      await mkdir(join(globalRoot, skillId), { recursive: true });
      await writeFile(join(globalRoot, skillId, "SKILL.md"), getStandaloneSkill(skillId).SKILL);
    }
    for (const projectConfigTrusted of [false, true]) for (const runnerId of ["codex", "opencode"]) {
      const input: DriverTaskInput = {
        taskId: "lead", memberId: "lead", cwd: home, assignment: { runnerId, modelId: "test" },
        rolePrompt: sessionRolePrompt("lead", { projectRoot: home, runnerId }), prompt: "task",
        mcp: { servers: [], sessionTools: [] }, mcpServerSpecs: {}, projectConfigTrusted,
        approvals: "runner-default", credentialFile: "/credential", disableNativeDelegation: true,
      };
      const files = new Map<string, string>();
      const baseEnv = { HOME: home, CODEX_HOME: join(home, ".codex") };
      const launch = runnerId === "codex" ? buildCodexLaunch(input, { baseEnv }) : buildOpenCodeLaunch(input, { writePrivateFile(name, content) { files.set(name, content); return join(home, name); } }, { baseEnv });
      expect(launch.env.HOME).toBe(home);
      expect(input.rolePrompt).not.toContain("deck-developer-team:");
      if (runnerId === "codex") {
        expect(launch.env.CODEX_HOME).toBe(baseEnv.CODEX_HOME);
        expect(launch.args.some(arg => /skills[.=]/.test(arg))).toBe(false);
      } else if (!projectConfigTrusted) {
        const hook = files.get("opencode-global-skills.mjs")!;
        expect(hook).toBeDefined();
        const module = await import(`data:text/javascript;base64,${Buffer.from(hook).toString("base64")}`);
        const config: { skills?: { paths: string[] } } = {};
        await (await module.default()).config(config);
        expect(config.skills!.paths).toContain(globalRoot);
      } else expect(launch.env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBeUndefined();
      for (const { skillId } of getStandaloneSkills()) {
        expect(parse((await readFile(join(globalRoot, skillId, "SKILL.md"), "utf8")).split("---")[1]!).name).toBe(skillId);
      }
    }
    for (const role of getDeveloperTeamCatalog()) {
      expect(sessionRolePrompt(role.id, { projectRoot: home, runnerId: "claude" })).not.toContain("deck-developer-team:<skill-name>");
    }
  } finally { await rm(home, { recursive: true, force: true }); }
});
