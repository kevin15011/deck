import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piAgentPaths } from "./agent-dir";
import { buildPiGlobalMaterialization } from "./global-materialization";
import { adaptBunBundleForNode } from "./pi-bundle-compat";
import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall, verifyPiGlobalInstall } from "./pi-global-install";
import { readPiExecutionExtensionSource } from "./pi-team-profile";

let root: string;
let agentDir: string;
let projectRoot: string;
let home: string;
const savedEnv = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-materialize-"));
  agentDir = join(root, "agent");
  projectRoot = join(root, "project");
  home = join(root, "home");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  // Isolate HOME and the agent dir: Pi reads ~/.agents/skills from the real home.
  process.env.HOME = home;
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

function snapshot(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full.slice(dir.length));
    }
  };
  walk(dir);
  return out.sort();
}

describe("buildPiGlobalMaterialization", () => {
  const build = () => buildPiGlobalMaterialization({ agentDir, projectRoot, legacyDeckEvidence: false });

  test("plans the whole developer team as one global package plus a global profile", () => {
    const { desired } = build();
    const paths = desired.files.map((file) => file.relPath);
    expect(paths).toContain("deck/package/package.json");
    expect(paths).toContain("deck/package/agents/deck-lead.md");
    expect(paths).toContain("deck/package/agents/deck-quality.md");
    expect(paths).toContain("deck/package/skills/deck-lead/SKILL.md");
    expect(paths).toContain("deck/package/extensions/developer-team-execution/index.js");
    expect(paths).toContain("deck/profiles/developer-team/system-prompt.md");
    expect(desired.packageEntry).toBe("deck/package");
    expect(paths.every((path) => path.startsWith("deck/"))).toBe(true);
  });

  test("the execution extension is the generated asset adapted for Pi's Node runtime and is lead-scoped", () => {
    const { desired } = build();
    const impl = desired.files.find((file) => file.relPath.endsWith("developer-team-execution/impl.js"))!;
    expect(impl.content).toBe(adaptBunBundleForNode(readPiExecutionExtensionSource()));
    expect(impl.content).not.toContain("import.meta.require");
    const entry = desired.files.find((file) => file.relPath.endsWith("developer-team-execution/index.js"))!;
    expect(entry.content).toContain('const scope = "lead"');
  });

  test("the lead profile composes the team session instructions and never writes SYSTEM.md/APPEND_SYSTEM.md", () => {
    const { desired } = build();
    const profile = desired.files.find((file) => file.relPath === "deck/profiles/developer-team/system-prompt.md")!;
    expect(profile.content.length).toBeGreaterThan(200);
    expect(desired.files.some((file) => /(^|\/)(SYSTEM|APPEND_SYSTEM)\.md$/.test(file.relPath))).toBe(false);
  });

  test("apply writes only under the agent directory: no project .pi or .deck/pi, and HOME stays untouched", () => {
    const { desired } = build();
    const io = createNodePiFileIO();
    const plan = planPiGlobalInstall(desired, io);
    expect(plan.blocked).toBe(false);
    applyPiGlobalPlan(plan, io);

    expect(snapshot(projectRoot)).toEqual([]);
    expect(existsSync(join(projectRoot, ".pi"))).toBe(false);
    expect(existsSync(join(projectRoot, ".deck"))).toBe(false);
    expect(snapshot(home)).toEqual([]);
    expect(existsSync(join(agentDir, "deck", "package", "package.json"))).toBe(true);
    expect(JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8")).packages).toEqual(["deck/package"]);
    expect(verifyPiGlobalInstall(desired, io)).toEqual({ valid: true, diagnostics: [] });
  });

  test("a second install of the same selection reports zero changes", () => {
    const io = createNodePiFileIO();
    applyPiGlobalPlan(planPiGlobalInstall(build().desired, io), io);
    const again = planPiGlobalInstall(build().desired, io);
    expect(again.changes).toEqual([]);
  });

  test("model assignments flow into the packaged agent frontmatter", () => {
    const { desired } = buildPiGlobalMaterialization({ agentDir, projectRoot, legacyDeckEvidence: false, installOptions: { modelAssignments: { "deck-lead": "openai-codex/gpt-5.5" }, thinkingAssignments: { "deck-lead": "high" } } });
    const lead = desired.files.find((file) => file.relPath === "deck/package/agents/deck-lead.md")!;
    expect(lead.content).toContain("model: openai-codex/gpt-5.5");
    expect(lead.content).toContain("thinking: high");
  });

  test("user settings.json values and foreign files survive install", () => {
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(piAgentPaths(agentDir).settings, JSON.stringify({ defaultModel: "keep", packages: ["npm:user-pkg"] }));
    mkdirSync(join(agentDir, "agents"), { recursive: true });
    writeFileSync(join(agentDir, "agents", "mine.md"), "user agent\n");
    const io = createNodePiFileIO();
    applyPiGlobalPlan(planPiGlobalInstall(build().desired, io), io);
    const settings = JSON.parse(readFileSync(piAgentPaths(agentDir).settings, "utf-8"));
    expect(settings).toEqual({ defaultModel: "keep", packages: ["npm:user-pkg", "deck/package"] });
    expect(readFileSync(join(agentDir, "agents", "mine.md"), "utf-8")).toBe("user agent\n");
  });
});
