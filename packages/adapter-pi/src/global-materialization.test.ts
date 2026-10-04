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

  test("writes the tool-policy extension with its owned-RTK and graph-redirect configuration", () => {
    const configOf = (input: Parameters<typeof buildPiGlobalMaterialization>[0]) => {
      const { desired } = buildPiGlobalMaterialization(input);
      expect(desired.files.map((file) => file.relPath)).toContain("deck/package/extensions/deck-tool-policy/impl.js");
      expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-tool-policy/index.js")!.content).toContain('const scope = "any"');
      return JSON.parse(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-tool-policy/config.json")!.content);
    };
    expect(configOf({ agentDir, projectRoot, legacyDeckEvidence: false })).toEqual({ version: 1, rtkBinary: null, graphRedirect: false });
    expect(configOf({ agentDir, projectRoot, legacyDeckEvidence: false, rtkBinary: "/owned/tools/rtk", mcpServers: { "codebase-memory": { command: "/x/cb", args: [], env: {}, exposure: "direct" } } })).toEqual({ version: 1, rtkBinary: "/owned/tools/rtk", graphRedirect: true });
  });

  test("plans the whole developer team as one global package plus a global profile", () => {
    const { desired } = build();
    const paths = desired.files.map((file) => file.relPath);
    expect(paths).toContain("deck/package/package.json");
    expect(paths).toContain("deck/package/agents/deck-lead.md");
    expect(paths).toContain("deck/package/agents/deck-quality.md");
    expect(paths).toContain("deck/package/skills/deck-lead/SKILL.md");
    expect(paths).toContain("deck/package/extensions/developer-team-execution/index.js");
    expect(paths).toContain("deck/profiles/developer-team/system-prompt.md");
    expect(paths).toContain("deck/package/extensions/deck-subagents/index.js");
    expect(paths).toContain("deck/package/extensions/deck-subagents/impl.js");
    expect(paths).toContain("deck/package/extensions/deck-memory/impl.js");
    expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-memory/index.js")!.content).toContain('const scope = "any"');
    expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-subagents/index.js")!.content).toContain('const scope = "any"');
    expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-subagents/index.js")!.content).toContain('import * as nativeShell from "@earendil-works/pi-coding-agent"');
    expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-subagents/index.js")!.content).toContain("factory(pi, nativeShell)");
    expect(desired.files.find((file) => file.relPath === "deck/package/extensions/deck-subagents/impl.js")!.content).toContain("installChildShell");
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
    expect(settings.defaultModel).toBe("keep");
    expect(settings.packages).toEqual(["npm:user-pkg", "deck/package"]);
    // Only the exact Deck skill names the package ships are excluded outside the package (never a deck-* wildcard).
    expect(settings.skills).toEqual(build().desired.skillExclusions.map((name) => `!${name}`));
    expect(settings.skills).toContain("!deck-lead");
    expect(settings.skills.some((entry: string) => entry.includes("*"))).toBe(false);
    expect(readFileSync(join(agentDir, "agents", "mine.md"), "utf-8")).toBe("user agent\n");
  });
});

describe("MCP-aware role content (direct-exposure tool names)", () => {
  const entry = { command: "/usr/bin/tool", args: [], env: {}, exposure: "direct" };
  const withServers = (servers: Record<string, unknown>) => buildPiGlobalMaterialization({ agentDir, projectRoot, legacyDeckEvidence: false, mcpServers: servers as never }).desired;
  const file = (desired: ReturnType<typeof withServers>, relPath: string) => desired.files.find((entry) => entry.relPath === relPath)!.content;
  const frontmatterTools = (content: string) => /^tools: (.*)$/m.exec(content)![1];

  test("the lead profile and every agent map shared tool names to the names Pi exposes", () => {
    const desired = withServers({ "codebase-memory": entry, "context-mode": entry });
    for (const path of ["deck/profiles/developer-team/system-prompt.md", "deck/package/agents/deck-lead.md", "deck/package/agents/deck-apply-fast.md"]) {
      const content = file(desired, path);
      expect(content).toContain("## Pi MCP Tool Names");
      expect(content).toContain("mcp__codebase_memory__search_graph");
      expect(content).toContain("mcp__context_mode__ctx_search");
    }
  });

  test("no section is added when no MCP server is configured", () => {
    const desired = withServers({});
    expect(file(desired, "deck/profiles/developer-team/system-prompt.md")).not.toContain("Pi MCP Tool Names");
    expect(file(desired, "deck/package/agents/deck-lead.md")).not.toContain("Pi MCP Tool Names");
  });

  test("read-only roles get the read-only allowlist; write roles keep their tools", () => {
    const desired = withServers({ "codebase-memory": entry, serena: entry });
    for (const role of ["deck-investigate", "deck-quality"]) {
      const tools = frontmatterTools(file(desired, `deck/package/agents/${role}.md`)).split(",");
      expect(tools.slice(0, 4)).toEqual(["read", "grep", "find", "ls"]);
      expect(tools).toContain("mcp__codebase_memory__search_graph");
      expect(tools).toContain("mcp__serena__find_symbol");
      expect(tools).not.toContain("mcp__serena__replace_symbol_body");
      for (const forbidden of ["bash", "edit", "write"]) expect(tools).not.toContain(forbidden);
    }
    expect(frontmatterTools(file(desired, "deck/package/agents/deck-apply-fast.md"))).toBe("read,write,bash");
  });

  test("read-only roles without MCP servers still drop write-capable tools", () => {
    expect(frontmatterTools(file(withServers({}), "deck/package/agents/deck-investigate.md"))).toBe("read,grep,find,ls,memory_search");
  });
});
