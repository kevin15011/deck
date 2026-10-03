import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateDeckConfig } from "@deck/core";

import { piAgentPaths, resolvePiAgentDir } from "./agent-dir";
import { readDeckPiExtensionBundle } from "./pi-extension-assets";
import { createNodePiFileIO } from "./pi-global-install";
import { inspectPiDeckInstall, sourceDigestHeader, type InspectPiDeckInstallInput, type PiDoctorCategory } from "./pi-doctor";
import { createPiRunnerAdapter } from "./runner-adapter";

let root: string;
let home: string;
let agentDir: string;
let project: string;
let runtimeDir: string;
let bin: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-doctor-"));
  home = join(root, "home");
  agentDir = join(root, "agent");
  project = join(root, "project");
  runtimeDir = join(root, "state", "runtime");
  bin = join(root, "bin");
  for (const dir of [home, project, runtimeDir, bin]) mkdirSync(dir, { recursive: true });
  for (const name of ["npx", "context-mode", "codebase-memory-mcp", "rtk"]) { writeFileSync(join(bin, name), "#!/bin/sh\n"); chmodSync(join(bin, name), 0o755); }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const exe = (name: string) => join(bin, name);
const tools = () => ({
  resolveExecutable: (name: string) => (name === "npx" || name === "context-mode" ? exe(name) : undefined),
  codebase: { command: () => exe("codebase-memory-mcp") },
  rtk: { command: () => exe("rtk"), state: () => "ready", supported: () => true, install: async () => "installed", root: bin },
});
const envOf = () => ({ PI_CODING_AGENT_DIR: agentDir });
const installFull = async () => {
  const pi = createPiRunnerAdapter({ homeDirectory: home, env: envOf(), piVersionProbe: () => ({ exitCode: 0, stdout: "1.0.0\n" }), piTools: tools() } as never);
  const plan = pi.buildDeveloperTeamInstallPlan({ projectRoot: project, environmentId: "pi-development", deckConfig: validateDeckConfig({}), capabilityIds: ["context-mode", "codebase-memory-mcp", "context7", "rtk"] });
  expect(plan.blocked).toBeFalsy();
  await pi.applyDeveloperTeamInstall({ projectRoot: project, environmentId: "pi-development", plan });
};
const bundleDigests = () => Object.fromEntries(["deck-memory", "deck-subagents", "deck-tool-policy"].map((name) => [name, sourceDigestHeader(readDeckPiExtensionBundle(name as never))]));
const inspect = (overrides: Partial<InspectPiDeckInstallInput> = {}): PiDoctorCategory[] => inspectPiDeckInstall({
  io: createNodePiFileIO(),
  agentDir: resolvePiAgentDir(envOf(), home),
  projectRoot: project,
  piVersionOutput: "1.0.0\n",
  isExecutable: (path) => { try { chmodSync(path, 0o755); return true; } catch { return false; } },
  runtimeDirectory: runtimeDir,
  listDirectory: (path) => { try { return require("node:fs").readdirSync(path).map((name: string) => ({ name, mtimeMs: require("node:fs").statSync(join(path, name)).mtimeMs })); } catch { return undefined; } },
  expectedBundleDigests: bundleDigests(),
  ...overrides,
});
const items = (result: PiDoctorCategory[]) => result.flatMap((entry) => entry.items);
const problems = (result: PiDoctorCategory[]) => items(result).filter((item) => item.status !== "ok");

describe("deck doctor Pi coverage (7.3)", () => {
  test("a healthy global install reports every item ok", async () => {
    await installFull();
    const result = inspect({ piListOutput: `User packages:\n  ${piAgentPaths(agentDir).packageSettingsEntry}\n` });
    expect(problems(result)).toEqual([]);
    expect(result.map((entry) => entry.category)).toEqual(["Pi runtime", "Pi Deck package", "Pi extensions", "Pi MCP (built-in)", "Pi adaptive memory", "Pi legacy and conflicts"]);
    const text = items(result).map((item) => item.message).join("\n");
    expect(text).toContain("Pi 1.0.0");
    expect(text).toContain(agentDir);
    expect(text).toContain("no drift");
    expect(text).toContain('MCP server "codebase-memory"');
    expect(text).toContain("deck-memory");
  });

  test("not installed is a warning with the install hint, never an exception", () => {
    const result = inspect();
    expect(items(result).find((item) => item.message.includes("not installed"))?.suggestion).toContain("deck pi developer");
  });

  test("old, unparseable or missing Pi is an error with the upgrade hint", () => {
    for (const output of ["0.99.3", "no version here", undefined]) {
      const runtime = inspect({ piVersionOutput: output })[0]!;
      expect(runtime.status).toBe("error");
      expect(runtime.items[0]!.suggestion).toContain("@earendil-works/pi-coding-agent");
    }
  });

  test("an invalid PI_CODING_AGENT_DIR is reported and stops further inspection", () => {
    const result = inspect({ agentDir: resolvePiAgentDir({ PI_CODING_AGENT_DIR: "relative/dir" }, home) });
    expect(result).toHaveLength(1);
    expect(result[0]!.items.some((item) => item.status === "error" && item.message.includes("PI_CODING_AGENT_DIR"))).toBe(true);
  });

  test("manifest drift: a missing file is an error, a modified file a warning", async () => {
    await installFull();
    rmSync(join(agentDir, "deck/package/agents/deck-lead.md"));
    writeFileSync(join(agentDir, "deck/package/agents/deck-quality.md"), "edited\n");
    const found = problems(inspect());
    expect(found.some((item) => item.status === "error" && item.message.includes("deck-lead.md"))).toBe(true);
    expect(found.some((item) => item.status === "warning" && item.message.includes("deck-quality.md"))).toBe(true);
  });

  test("an unregistered package and a pi list that omits it are reported", async () => {
    await installFull();
    const settings = piAgentPaths(agentDir).settings;
    writeFileSync(settings, JSON.stringify({ packages: [] }));
    expect(problems(inspect()).some((item) => item.status === "error" && item.message.includes("not registered"))).toBe(true);
    writeFileSync(settings, JSON.stringify({ packages: ["deck/package"] }));
    expect(problems(inspect({ piListOutput: "nothing here" })).some((item) => item.message.includes("'pi list' does not report"))).toBe(true);
  });

  test("an extension bundle from other sources, or a missing extension file, is reported", async () => {
    await installFull();
    expect(problems(inspect({ expectedBundleDigests: { "deck-memory": "0".repeat(64) } })).some((item) => item.message.includes("different sources"))).toBe(true);
    rmSync(join(agentDir, "deck/package/extensions/deck-subagents/impl.js"));
    expect(problems(inspect()).some((item) => item.status === "error" && item.message.includes("deck-subagents is incomplete"))).toBe(true);
  });

  test("a missing pinned RTK binary is an error", async () => {
    await installFull();
    expect(problems(inspect({ isExecutable: (path) => !path.endsWith("/rtk") })).some((item) => item.message.includes("pinned RTK binary"))).toBe(true);
  });

  test("MCP: a relative command, a non-direct exposure and missing memory blanks are reported", async () => {
    await installFull();
    const mcpPath = piAgentPaths(agentDir).mcp;
    const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
    mcp.mcpServers["codebase-memory"].command = "codebase-memory-mcp";
    mcp.mcpServers["context7"].exposure = "codemode";
    delete mcp.mcpServers["context-mode"].env;
    writeFileSync(mcpPath, JSON.stringify(mcp));
    const found = problems(inspect()).map((item) => item.message).join("\n");
    expect(found).toContain("not an absolute path");
    expect(found).toContain('exposure is not "direct"');
    expect(found).toContain("memory environment blanks");
  });

  test("pi-mcp-adapter is an MCP conflict error and pi-subagents a duplicate-tool warning", async () => {
    await installFull();
    writeFileSync(piAgentPaths(agentDir).settings, JSON.stringify({ packages: ["deck/package", "npm:pi-mcp-adapter", "npm:pi-subagents"] }));
    const found = problems(inspect());
    expect(found.find((item) => item.message.includes("pi-mcp-adapter"))?.status).toBe("error");
    expect(found.find((item) => item.message.includes("pi-subagents"))?.status).toBe("warning");
    expect(found.find((item) => item.message.includes("pi-mcp-adapter"))?.message).toContain("not added by Deck");
  });

  test("stale pi-memory-* handoff directories (older than 24h) are warned about, fresh ones are not", async () => {
    await installFull();
    const stale = join(runtimeDir, "pi-memory-old");
    const fresh = join(runtimeDir, "pi-memory-new");
    mkdirSync(stale); mkdirSync(fresh);
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    utimesSync(stale, old, old);
    const found = problems(inspect());
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("pi-memory-old");
    expect(found[0]!.message).not.toContain("pi-memory-new");
  });

  test("legacy Deck files are listed with the cleanup command", async () => {
    await installFull();
    mkdirSync(join(project, ".pi", "agents"), { recursive: true });
    writeFileSync(join(project, ".pi", "agents", "deck-lead.md"), "legacy\n");
    mkdirSync(join(agentDir, "skills", "deck-lead"), { recursive: true });
    writeFileSync(join(agentDir, "skills", "deck-lead", "SKILL.md"), "legacy skill\n");
    const legacy = problems(inspect()).find((item) => item.message.includes("legacy Deck file"));
    expect(legacy?.message).toContain(".pi/agents/deck-lead.md");
    expect(legacy?.suggestion).toContain("--cleanup-legacy");
  });

  test("legacy global skills are reported as shadowing the package, and ~/.agents is never mentioned as removable", async () => {
    await installFull();
    mkdirSync(join(agentDir, "skills", "deck-lead"), { recursive: true });
    writeFileSync(join(agentDir, "skills", "deck-lead", "SKILL.md"), "---\nname: deck-lead\n---\nAdaptive Developer Team Contract\n");
    const legacy = problems(inspect()).find((item) => item.message.includes("legacy Deck file"));
    expect(legacy?.message).toContain("shadow");
    expect(legacy?.message).toContain("Skill conflicts");
    expect(legacy?.suggestion).toContain("--cleanup-legacy");
    expect(legacy?.suggestion).toContain("~/.agents/skills");
  });
});
