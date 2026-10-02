import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { piAgentPaths } from "./agent-dir";
import {
  applyPiGlobalPlan,
  createNodePiFileIO,
  planPiGlobalInstall,
  verifyPiGlobalInstall,
  type PiFileIO,
  type PiGlobalDesiredState,
} from "./pi-global-install";
import { hashContent, hashJsonValue, parsePiManifest } from "./pi-manifest";

let root: string;
let agentDir: string;

beforeEach(() => {
  // Isolate both the agent dir and HOME: Pi (and Deck) must never touch the real home in tests.
  root = mkdtempSync(join(tmpdir(), "deck-pi-global-"));
  agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const paths = () => piAgentPaths(agentDir);
const io = () => createNodePiFileIO();

function desired(overrides: Partial<PiGlobalDesiredState> = {}): PiGlobalDesiredState {
  return {
    agentDir,
    files: [
      { relPath: "deck/package/package.json", content: '{"name":"deck-pi"}\n' },
      { relPath: "deck/package/agents/deck-lead.md", content: "# lead\n" },
      { relPath: "deck/profiles/developer-team/system-prompt.md", content: "prompt\n" },
    ],
    packageEntry: "deck/package",
    mcpServers: {},
    legacyDeckEvidence: false,
    ...overrides,
  };
}

function install(state: PiGlobalDesiredState, fileIo: PiFileIO = io()) {
  const plan = planPiGlobalInstall(state, fileIo);
  if (plan.blocked) throw new Error(`blocked: ${plan.diagnostics.map((d) => d.message).join("; ")}`);
  return { plan, result: applyPiGlobalPlan(plan, fileIo) };
}

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as Record<string, any>;
const snapshotTree = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(`${full.slice(dir.length)}:${hashContent(readFileSync(full))}`);
    }
  };
  walk(dir);
  return out.sort();
};

describe("fresh install", () => {
  test("writes files, registers the package once as a relative path, and records a manifest", () => {
    const { plan } = install(desired());
    expect(plan.blocked).toBe(false);
    expect(readFileSync(join(agentDir, "deck/package/package.json"), "utf-8")).toBe('{"name":"deck-pi"}\n');

    const settings = readJson(paths().settings);
    expect(settings.packages).toEqual(["deck/package"]);

    const manifest = parsePiManifest(readFileSync(paths().manifest, "utf-8"));
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.manifest.files["deck/package/agents/deck-lead.md"]).toBe(hashContent("# lead\n"));
      expect(manifest.manifest.settings.packages).toEqual(["deck/package"]);
    }
  });

  test("reports every planned write in the mutation preview with absolute paths", () => {
    const plan = planPiGlobalInstall(desired(), io());
    const targets = plan.mutationPreview.map((mutation) => mutation.path);
    expect(targets).toContain(join(agentDir, "deck/package/package.json"));
    expect(targets).toContain(paths().settings);
    expect(targets).toContain(paths().manifest);
    expect(plan.mutationPreview.every((mutation) => mutation.path.startsWith(agentDir))).toBe(true);
  });

  test("creating the install never writes outside the agent directory", () => {
    const sentinel = join(root, "outside");
    mkdirSync(sentinel);
    install(desired());
    expect(readdirSync(sentinel)).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(["agent", "outside"]);
  });
});

describe("idempotent reinstall", () => {
  test("a second plan has zero changes and no file timestamps change", async () => {
    install(desired());
    const tracked = [paths().settings, paths().manifest, join(agentDir, "deck/package/package.json")];
    const before = tracked.map((path) => statSync(path).mtimeMs);
    await Bun.sleep(15);

    const { plan } = install(desired());
    expect(plan.changes).toEqual([]);
    expect(plan.mutationPreview).toEqual([]);
    expect(tracked.map((path) => statSync(path).mtimeMs)).toEqual(before);
  });
});

describe("ownership by hash", () => {
  test("updates an unmodified Deck file", () => {
    install(desired());
    const next = desired({ files: desired().files.map((file) => (file.relPath.endsWith("deck-lead.md") ? { ...file, content: "# lead v2\n" } : file)) });
    const { plan } = install(next);
    expect(plan.changes.map((change) => `${change.action}:${change.relPath}`)).toContain("update:deck/package/agents/deck-lead.md");
    expect(readFileSync(join(agentDir, "deck/package/agents/deck-lead.md"), "utf-8")).toBe("# lead v2\n");
  });

  test("a user-modified Deck file is a conflict and is never overwritten", () => {
    install(desired());
    const target = join(agentDir, "deck/package/agents/deck-lead.md");
    writeFileSync(target, "# edited by the user\n");

    const plan = planPiGlobalInstall(desired({ files: desired().files.map((file) => (file.relPath.endsWith("deck-lead.md") ? { ...file, content: "# lead v2\n" } : file)) }), io());
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts.map((conflict) => conflict.relPath)).toContain("deck/package/agents/deck-lead.md");
    expect(plan.conflicts[0]?.reason).toBe("modified");
    expect(() => applyPiGlobalPlan(plan, io())).toThrow(/blocked/i);
    expect(readFileSync(target, "utf-8")).toBe("# edited by the user\n");
  });

  test("a foreign file at a Deck-owned path blocks the plan before any mutation", () => {
    const foreign = join(agentDir, "deck/package/agents/deck-lead.md");
    mkdirSync(dirname(foreign), { recursive: true });
    writeFileSync(foreign, "foreign\n");
    const before = snapshotTree(agentDir);

    const plan = planPiGlobalInstall(desired(), io());
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts[0]).toMatchObject({ relPath: "deck/package/agents/deck-lead.md", reason: "foreign" });
    expect(() => applyPiGlobalPlan(plan, io())).toThrow();
    expect(snapshotTree(agentDir)).toEqual(before);
  });

  test("files dropped from the desired state are removed only when unmodified", () => {
    install(desired());
    const withoutLead = desired({ files: desired().files.filter((file) => !file.relPath.endsWith("deck-lead.md")) });
    const { plan } = install(withoutLead);
    expect(plan.changes.map((change) => `${change.action}:${change.relPath}`)).toContain("delete:deck/package/agents/deck-lead.md");
    expect(existsSync(join(agentDir, "deck/package/agents/deck-lead.md"))).toBe(false);

    install(desired());
    writeFileSync(join(agentDir, "deck/package/agents/deck-lead.md"), "user edit\n");
    const plan2 = planPiGlobalInstall(withoutLead, io());
    expect(plan2.kept.map((entry) => entry.relPath)).toContain("deck/package/agents/deck-lead.md");
    applyPiGlobalPlan(plan2, io());
    expect(readFileSync(join(agentDir, "deck/package/agents/deck-lead.md"), "utf-8")).toBe("user edit\n");
  });

  test("rejects desired files that escape the agent directory", () => {
    const plan = planPiGlobalInstall(desired({ files: [{ relPath: "../escape.txt", content: "x" }] }), io());
    expect(plan.blocked).toBe(true);
    expect(existsSync(join(root, "escape.txt"))).toBe(false);
  });
});

describe("settings.json preservation", () => {
  const userSettings = { defaultModel: "openai/gpt-x", packages: ["npm:some-user-pkg", { source: "../mine", skills: [] }], extensions: ["/home/me/ext.js"], theme: "dark" };

  test("adds and removes only the Deck entry; user values are unchanged", () => {
    writeFileSync(paths().settings, `${JSON.stringify(userSettings, null, 2)}\n`);
    install(desired());
    const added = readJson(paths().settings);
    expect(added.packages).toEqual([...userSettings.packages, "deck/package"]);
    expect(added.defaultModel).toBe("openai/gpt-x");
    expect(added.extensions).toEqual(userSettings.extensions);
    expect(added.theme).toBe("dark");

    install(desired({ files: [], packageEntry: undefined }));
    expect(readJson(paths().settings)).toEqual(userSettings);
  });

  test("never duplicates the Deck entry if the user registered the same path", () => {
    writeFileSync(paths().settings, JSON.stringify({ packages: ["deck/package"] }));
    install(desired());
    expect(readJson(paths().settings).packages).toEqual(["deck/package"]);
  });

  test("an object-form foreign entry with the Deck-reserved path blocks the plan", () => {
    writeFileSync(paths().settings, JSON.stringify({ packages: [{ source: "deck/package", extensions: [] }] }));
    const plan = planPiGlobalInstall(desired(), io());
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "PI_SETTINGS_FOREIGN_DECK_PACKAGE")).toBe(true);
  });

  test("malformed settings.json blocks before any write", () => {
    writeFileSync(paths().settings, "{ not json");
    const plan = planPiGlobalInstall(desired(), io());
    expect(plan.blocked).toBe(true);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === "PI_SETTINGS_MALFORMED")).toBe(true);
    expect(existsSync(join(agentDir, "deck"))).toBe(false);
  });
});

describe("transactional apply", () => {
  test("a failure midway restores every file, settings and the manifest", () => {
    writeFileSync(paths().settings, `${JSON.stringify({ defaultModel: "keep" })}\n`);
    const before = snapshotTree(agentDir);
    let writes = 0;
    const failing: PiFileIO = { ...io(), writeText: (path, content, mode) => { writes += 1; if (writes === 4) throw new Error("disk full"); io().writeText(path, content, mode); } };

    const plan = planPiGlobalInstall(desired(), failing);
    expect(() => applyPiGlobalPlan(plan, failing)).toThrow(/disk full/);
    expect(snapshotTree(agentDir)).toEqual(before);
    expect(existsSync(join(agentDir, "deck"))).toBe(false);
  });

  test("a failure during an update restores the previous content", () => {
    install(desired());
    const before = snapshotTree(agentDir);
    let writes = 0;
    const failing: PiFileIO = { ...io(), writeText: (path, content, mode) => { writes += 1; if (writes === 2) throw new Error("boom"); io().writeText(path, content, mode); } };
    const next = desired({ files: desired().files.map((file) => ({ ...file, content: `${file.content}more\n` })) });
    const plan = planPiGlobalInstall(next, failing);
    expect(() => applyPiGlobalPlan(plan, failing)).toThrow(/boom/);
    expect(snapshotTree(agentDir)).toEqual(before);
  });
});

describe("mcp.json ownership", () => {
  const server = (command: string) => ({ command, args: [], env: { DECK_RUNNER_MEMORY_ENDPOINT: "", DECK_RUNNER_MEMORY_TOKEN: "", DECK_RUNNER_MEMORY_TOKEN_FILE: "" }, exposure: "direct" });

  test("writes Deck servers and preserves user servers byte-for-value", () => {
    writeFileSync(paths().mcp, JSON.stringify({ mcpServers: { "my-tools": { command: "/usr/bin/x", exposure: "codemode" } }, other: 1 }));
    install(desired({ mcpServers: { context7: server("/usr/bin/npx") } }));
    const config = readJson(paths().mcp);
    expect(config.mcpServers["my-tools"]).toEqual({ command: "/usr/bin/x", exposure: "codemode" });
    expect(config.mcpServers.context7).toEqual(server("/usr/bin/npx"));
    expect(config.other).toBe(1);
    const manifest = parsePiManifest(readFileSync(paths().manifest, "utf-8"));
    expect(manifest.ok && manifest.manifest.mcp.servers.context7).toBe(hashJsonValue(server("/usr/bin/npx")));
  });

  test("removes only manifest-owned servers that are no longer desired", () => {
    writeFileSync(paths().mcp, JSON.stringify({ mcpServers: { "my-tools": { command: "/usr/bin/x" } } }));
    install(desired({ mcpServers: { context7: server("/usr/bin/npx") } }));
    install(desired({ mcpServers: {} }));
    const config = readJson(paths().mcp);
    expect(Object.keys(config.mcpServers)).toEqual(["my-tools"]);
  });

  test("a foreign entry with a Deck-reserved name blocks the plan", () => {
    writeFileSync(paths().mcp, JSON.stringify({ mcpServers: { context7: { command: "/opt/custom-context7" } } }));
    const plan = planPiGlobalInstall(desired({ mcpServers: { context7: server("/usr/bin/npx") } }), io());
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts.some((conflict) => conflict.relPath === "mcp.json#context7")).toBe(true);
    expect(readJson(paths().mcp).mcpServers.context7.command).toBe("/opt/custom-context7");
  });

  test("a legacy Deck-written entry (bare command) is adopted and replaced", () => {
    writeFileSync(paths().mcp, JSON.stringify({ mcpServers: { "context-mode": { command: "context-mode", args: [], env: {}, transport: "process" } } }));
    const { plan } = install(desired({ mcpServers: { "context-mode": server("/usr/local/bin/context-mode") } }));
    expect(plan.blocked).toBe(false);
    expect(readJson(paths().mcp).mcpServers["context-mode"]).toEqual(server("/usr/local/bin/context-mode"));
  });

  test("an owned server modified by the user is a conflict", () => {
    install(desired({ mcpServers: { context7: server("/usr/bin/npx") } }));
    const config = readJson(paths().mcp);
    config.mcpServers.context7.env.EXTRA = "1";
    writeFileSync(paths().mcp, JSON.stringify(config));
    const plan = planPiGlobalInstall(desired({ mcpServers: { context7: server("/usr/bin/npx") } }), io());
    expect(plan.blocked).toBe(true);
    expect(plan.conflicts.some((conflict) => conflict.reason === "modified")).toBe(true);
  });
});

describe("mandatory removal of conflicting Deck packages", () => {
  const settingsWith = (...packages: unknown[]) => writeFileSync(paths().settings, JSON.stringify({ packages, defaultModel: "keep" }));

  test("removes Deck-added pi-mcp-adapter and pi-subagents recorded as Deck-added, with a backup", () => {
    settingsWith("npm:pi-subagents", "npm:pi-mcp-adapter", "npm:user-pkg");
    const { plan } = install(desired({ legacyDeckEvidence: true }));
    const settings = readJson(paths().settings);
    expect(settings.packages).toEqual(["npm:user-pkg", "deck/package"]);
    expect(settings.defaultModel).toBe("keep");
    expect(plan.removedPackages.sort()).toEqual(["npm:pi-mcp-adapter", "npm:pi-subagents"]);
    const backups = existsSync(join(agentDir, "deck", "backups")) ? readdirSync(join(agentDir, "deck", "backups")) : [];
    expect(backups.length).toBe(1);
    const backedUp = readJson(join(agentDir, "deck", "backups", backups[0]!, "settings.json"));
    expect(backedUp.packages).toContain("npm:pi-mcp-adapter");
  });

  test("a manifest-recorded addition is removed without legacy evidence", () => {
    settingsWith("npm:pi-mcp-adapter");
    install(desired());
    // Simulate a manifest that recorded the addition.
    const manifest = JSON.parse(readFileSync(paths().manifest, "utf-8"));
    manifest.settings.addedPackages = ["npm:pi-mcp-adapter"];
    writeFileSync(paths().manifest, JSON.stringify(manifest));
    settingsWith("npm:pi-mcp-adapter", "deck/package");
    install(desired());
    expect(readJson(paths().settings).packages).toEqual(["deck/package"]);
  });

  test("a user-added pi-mcp-adapter blocks MCP configuration with a hint and is kept", () => {
    settingsWith("npm:pi-mcp-adapter");
    const plan = planPiGlobalInstall(desired({ mcpServers: { context7: { command: "/usr/bin/npx", exposure: "direct" } } }), io());
    expect(plan.blocked).toBe(true);
    const diagnostic = plan.diagnostics.find((entry) => entry.code === "PI_MCP_ADAPTER_USER_INSTALLED");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("pi remove");
    expect(readJson(paths().settings).packages).toEqual(["npm:pi-mcp-adapter"]);
  });

  test("a user-added pi-mcp-adapter does not block an install that configures no MCP server", () => {
    settingsWith("npm:pi-mcp-adapter");
    const { plan } = install(desired({ mcpServers: {} }));
    expect(plan.blocked).toBe(false);
    expect(readJson(paths().settings).packages).toEqual(["npm:pi-mcp-adapter", "deck/package"]);
  });

  test("a user-added pi-subagents is kept and reported as a warning", () => {
    settingsWith("npm:pi-subagents");
    const { plan } = install(desired());
    expect(plan.diagnostics.some((entry) => entry.code === "PI_SUBAGENTS_USER_INSTALLED" && entry.severity === "warning")).toBe(true);
    expect(readJson(paths().settings).packages).toEqual(["npm:pi-subagents", "deck/package"]);
  });
});

describe("verifyPiGlobalInstall", () => {
  test("passes after install and detects drift, deletion and missing registration", () => {
    const state = desired({ mcpServers: { context7: { command: "/usr/bin/npx", exposure: "direct" } } });
    install(state);
    expect(verifyPiGlobalInstall(state, io())).toEqual({ valid: true, diagnostics: [] });

    writeFileSync(join(agentDir, "deck/package/agents/deck-lead.md"), "drift\n");
    const drift = verifyPiGlobalInstall(state, io());
    expect(drift.valid).toBe(false);
    expect(drift.diagnostics.join(" ")).toContain("deck/package/agents/deck-lead.md");

    rmSync(join(agentDir, "deck/package/package.json"));
    expect(verifyPiGlobalInstall(state, io()).valid).toBe(false);
  });

  test("fails when the package is not registered in settings.json", () => {
    const state = desired();
    install(state);
    writeFileSync(paths().settings, JSON.stringify({ packages: [] }));
    const result = verifyPiGlobalInstall(state, io());
    expect(result.valid).toBe(false);
    expect(result.diagnostics.join(" ")).toContain("deck/package");
  });
});
