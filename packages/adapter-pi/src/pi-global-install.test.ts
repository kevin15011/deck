import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as nodeFs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { piAgentPaths } from "./agent-dir";
import {
  applyPiGlobalPlan,
  createNodePiFileIO,
  planPiGlobalInstall,
  restorePiSnapshot,
  snapshotPiPlanTargets,
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

// Protects confidentiality during replacement, before the final chmod or rename.
test('private replacement bytes are private as soon as they are written', () => {
  const path = join(agentDir, 'private');
  writeFileSync(path, 'old', { mode: 0o600 });
  const original = nodeFs.writeFileSync;
  let observed: number | undefined;
  const spy = spyOn(nodeFs, 'writeFileSync').mockImplementation(((target: any, ...args: any[]) => {
    (original as any)(target, ...args);
    if (String(target).startsWith(path + '.deck-')) observed = statSync(target).mode & 0o777;
  }) as typeof writeFileSync);
  try {
    createNodePiFileIO().writeText(path, 'private replacement');
    expect(observed).toBe(0o600);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  } finally { spy.mockRestore(); }
});
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
    skillExclusions: [],
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
    expect(plan.blocked).toBe(false);
    expect(plan.conflicts.map((conflict) => conflict.relPath)).toContain("deck/package/agents/deck-lead.md");
    expect(plan.conflicts[0]?.reason).toBe("modified");
    applyPiGlobalPlan(plan, io());
    expect(readFileSync(target, "utf-8")).toBe("# edited by the user\n");
  });

  test("a foreign file is preserved while other files install", () => {
    const foreign = join(agentDir, "deck/package/agents/deck-lead.md");
    mkdirSync(dirname(foreign), { recursive: true });
    writeFileSync(foreign, "foreign\n");
    const before = snapshotTree(agentDir);

    const plan = planPiGlobalInstall(desired(), io());
    expect(plan.blocked).toBe(false);
    expect(plan.conflicts[0]).toMatchObject({ relPath: "deck/package/agents/deck-lead.md", reason: "foreign" });
    applyPiGlobalPlan(plan, io());
    expect(readFileSync(foreign,"utf8")).toBe("foreign\n");
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

  // Version-1 decommissioning: exact prior file receipts, never extension names, authorize removal.
  test("retired extension files are removed only while their receipt bytes remain unchanged", () => {
    const retired = "deck/package/extensions/deck-memory/impl.js";
    const previous = desired({ files: [...desired().files, { relPath: retired, content: "legacy extension bytes" }] });
    install(previous);
    const first = install(desired()).plan;
    expect(first.changes.some(change => change.action === "delete" && change.relPath === retired)).toBe(true);
    expect(existsSync(join(agentDir, retired))).toBe(false);
    install(previous);
    writeFileSync(join(agentDir, retired), "user customization");
    const second = planPiGlobalInstall(desired(), io());
    applyPiGlobalPlan(second, io());
    expect(readFileSync(join(agentDir, retired), "utf8")).toBe("user customization");
    expect(second.kept.some(entry => entry.relPath === retired)).toBe(true);
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

  test("skill exclusions: added beside user entries, tracked in the manifest, and removed on uninstall without touching user entries", () => {
    writeFileSync(paths().settings, JSON.stringify({ skills: ["~/my-skills", "!my-hidden"] }));
    install(desired({ skillExclusions: ["deck-lead", "deck-archive"] }));
    expect(readJson(paths().settings).skills).toEqual(["~/my-skills", "!my-hidden", "!deck-lead", "!deck-archive"]);
    const manifest = parsePiManifest(readFileSync(paths().manifest, "utf8"));
    expect(manifest.ok && manifest.manifest.settings.skillExclusions).toEqual(["!deck-lead", "!deck-archive"]);

    // idempotent, and a shrunken set drops only the stale owned entry
    install(desired({ skillExclusions: ["deck-lead", "deck-archive"] }));
    install(desired({ skillExclusions: ["deck-lead"] }));
    expect(readJson(paths().settings).skills).toEqual(["~/my-skills", "!my-hidden", "!deck-lead"]);

    install(desired({ files: [], packageEntry: undefined, skillExclusions: [] }));
    expect(readJson(paths().settings).skills).toEqual(["~/my-skills", "!my-hidden"]);
  });

  test("skill exclusions: a user-authored identical entry is never tracked or removed; an emptied skills key disappears", () => {
    writeFileSync(paths().settings, JSON.stringify({ skills: ["!deck-lead"] }));
    install(desired({ skillExclusions: ["deck-lead"] }));
    install(desired({ files: [], packageEntry: undefined, skillExclusions: [] }));
    expect(readJson(paths().settings).skills).toEqual(["!deck-lead"]);

    writeFileSync(paths().settings, JSON.stringify({ theme: "dark" }));
    install(desired({ skillExclusions: ["deck-lead"] }));
    expect(readJson(paths().settings).skills).toEqual(["!deck-lead"]);
    install(desired({ files: [], packageEntry: undefined, skillExclusions: [] }));
    expect(readJson(paths().settings)).toEqual({ packages: [], theme: "dark" });
  });

  test("skill exclusions: a non-array skills setting blocks the plan; verify reports a missing exclusion", () => {
    writeFileSync(paths().settings, JSON.stringify({ skills: "nope" }));
    expect(planPiGlobalInstall(desired({ skillExclusions: ["deck-lead"] }), io()).blocked).toBe(true);
    writeFileSync(paths().settings, JSON.stringify({}));
    install(desired({ skillExclusions: ["deck-lead"] }));
    writeFileSync(paths().settings, JSON.stringify({ packages: ["deck/package"] }));
    expect(verifyPiGlobalInstall(desired({ skillExclusions: ["deck-lead"] }), io()).diagnostics.join(" ")).toContain("!deck-lead");
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

  test("a foreign MCP entry is preserved with a warning", () => {
    writeFileSync(paths().mcp, JSON.stringify({ mcpServers: { context7: { command: "/opt/custom-context7" } } }));
    const plan = planPiGlobalInstall(desired({ mcpServers: { context7: server("/usr/bin/npx") } }), io());
    expect(plan.blocked).toBe(false);
    expect(plan.conflicts.some((conflict) => conflict.relPath === "mcp.json#context7")).toBe(true);
    expect(readJson(paths().mcp).mcpServers.context7.command).toBe("/opt/custom-context7");
  });

  test("a legacy same-name entry is preserved without ownership proof", () => {
    const original = JSON.stringify({ mcpServers: { "context-mode": { command: "context-mode", args: [], env: {}, transport: "process" } } });
    writeFileSync(paths().mcp, original);
    const plan = planPiGlobalInstall(desired({ mcpServers: { "context-mode": server("/usr/local/bin/context-mode") } }), io());
    expect(plan.blocked).toBe(false);
    expect(readFileSync(paths().mcp, 'utf8')).toBe(original);
  });

  test("an owned server modified by the user is a conflict", () => {
    install(desired({ mcpServers: { context7: server("/usr/bin/npx") } }));
    const config = readJson(paths().mcp);
    config.mcpServers.context7.env.EXTRA = "1";
    writeFileSync(paths().mcp, JSON.stringify(config));
    const plan = planPiGlobalInstall(desired({ mcpServers: { context7: server("/usr/bin/npx") } }), io());
    expect(plan.blocked).toBe(false);
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

describe("snapshot and restore (adapter backup/rollback)", () => {
  test("restores the exact pre-apply state, including newly created files and directories", () => {
    writeFileSync(paths().settings, `${JSON.stringify({ defaultModel: "keep" })}\n`);
    const before = snapshotTree(agentDir);
    const plan = planPiGlobalInstall(desired(), io());
    const snapshot = snapshotPiPlanTargets(plan, io());
    applyPiGlobalPlan(plan, io());
    expect(snapshotTree(agentDir)).not.toEqual(before);

    const result = restorePiSnapshot(snapshot, io());
    expect(result).toEqual({ restored: true, conflicts: [] });
    expect(snapshotTree(agentDir)).toEqual(before);
    expect(existsSync(join(agentDir, "deck"))).toBe(false);
  });

  test("a file changed by someone else after apply is reported as a conflict and left alone", () => {
    const plan = planPiGlobalInstall(desired(), io());
    const snapshot = snapshotPiPlanTargets(plan, io());
    applyPiGlobalPlan(plan, io());
    const lead = join(agentDir, "deck/package/agents/deck-lead.md");
    writeFileSync(lead, "changed after apply\n");

    const result = restorePiSnapshot(snapshot, io());
    expect(result.restored).toBe(false);
    expect(result.conflicts).toContain(lead);
    expect(readFileSync(lead, "utf-8")).toBe("changed after apply\n");
  });

  test("a snapshot is JSON-serializable", () => {
    const plan = planPiGlobalInstall(desired(), io());
    const snapshot = snapshotPiPlanTargets(plan, io());
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

// Protects: generated package output is regenerated from trusted desired state, never adopted.
// Oracle: managed authority decisions 1/2/6; shared settings and MCP remain foreign input.
test('managed install regenerates modified and unreceipted package files with private backups', () => {
 const state=desired();install(state);
 const path=join(agentDir,'deck/package/agents/deck-lead.md');
 writeFileSync(path,'altered executable instructions');
 rmSync(paths().manifest);
 const settings='{"custom":"foreign-setting","packages":["deck/package"]}\n';writeFileSync(paths().settings,settings);
 const plan=planPiGlobalInstall(state,io(),{managed:true});
 expect(plan.blocked).toBe(false);
 const result=applyPiGlobalPlan(plan,io());
 expect(readFileSync(path,'utf8')).toBe('# lead\n');
 expect(result.backupPath).toBeString();
 expect(readFileSync(result.backupPath!,'utf8')).not.toContain('foreign-setting');
 expect(readFileSync(paths().settings,'utf8')).toBe(settings);
 expect(verifyPiGlobalInstall(state,io()).valid).toBe(true);
 expect(planPiGlobalInstall(state,io(),{managed:true}).writes).toHaveLength(0);
});

// Protects managed adapter wiring and drift without acquiring a live process lease.
// Oracle: production planner repairs generated files; unrelated settings remain outside authority.
test('Pi adapter selects managed file repair and exposes receipt drift', async () => {
 const { createPiRunnerAdapter } = await import('./runner-adapter');
 const adapter = createPiRunnerAdapter({ homeDirectory: root, env: { HOME: root, PI_CODING_AGENT_DIR: agentDir }, piVersionProbe: () => ({ exitCode: 0, stdout: '1.0.0' }) });
 const { getDefaultDeckConfig } = await import('@deck/core');
 const input = { projectRoot: root, environmentId: 'pi-development', deckConfig: getDefaultDeckConfig(), standaloneSkills: [] };
 const initial = adapter.buildDeveloperTeamInstallPlan(input);
 install(desired({ files: initial.files.map(file => ({ relPath: file.path.slice(agentDir.length + 1), content: file.content })) }));
 expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(false);
 const path = join(agentDir, 'deck/package/agents/deck-quality.md'), canonical = readFileSync(path, 'utf8');
 writeFileSync(path, 'altered role');
 expect(adapter.readManagedContentDrift!(input.deckConfig)).toBe(true);
 const repair = adapter.buildDeveloperTeamInstallPlan(input);
 expect(repair.blocked).toBe(false);
 expect(repair.files.find(file => file.path === path)?.content).toBe(canonical);
});

// Protects recognized shared entries, generated package selectors, and edited retirement.
// Oracle: managed policy preserves foreign bytes and repairs only bounded generated/recorded identities.
test('managed Pi repairs recognized shared entries and retires edited generated files', () => {
 const state = desired({ mcpServers: { context7: { command: '/verified/context7' } } });
 install(state);
 const foreign = '"foreign" : { "keep" : [1,  2] }';
 writeFileSync(paths().mcp, '{' + foreign + ', "mcpServers": {"context7":{"command":"/edited"}, "personal" : { "command" : "foreign" }}}\n');
 writeFileSync(paths().settings, '{' + foreign + ', "packages": [{"source":"deck/package", "extensions":[]}, "personal"]}\n');
 const retired = 'deck/package/agents/deck-obsolete.md';
 writeFileSync(join(agentDir, retired), 'edited retired role');
 const manifest = readJson(paths().manifest); manifest.files[retired] = hashContent('previous retired role');
 writeFileSync(paths().manifest, JSON.stringify(manifest));
 const plan = planPiGlobalInstall(state, io(), { managed: true });
 expect(plan.blocked).toBe(false);
 expect(plan.conflicts).toHaveLength(0);
 applyPiGlobalPlan(plan, io());
 expect(readJson(paths().mcp).mcpServers.context7.command).toBe('/verified/context7');
 expect(readFileSync(paths().mcp, 'utf8')).toContain('"personal" : { "command" : "foreign" }');
 expect(readFileSync(paths().mcp, 'utf8')).toContain(foreign);
 expect(readFileSync(paths().settings, 'utf8')).toContain(foreign);
 expect(readJson(paths().settings).packages).toEqual(['personal', 'deck/package']);
 expect(existsSync(join(agentDir, retired))).toBe(false);
 expect(planPiGlobalInstall(state, io(), { managed: true }).changes).toHaveLength(0);
});

// Protects corrupt metadata recovery through the existing preimage-guarded transaction.
test('managed Pi rebuilds corrupt receipts and refuses future metadata', () => {
 mkdirSync(dirname(paths().manifest), { recursive: true });
 writeFileSync(paths().manifest, '{invalid');
 const plan = planPiGlobalInstall(desired(), io(), { managed: true });
 expect(plan.blocked).toBe(false);
 applyPiGlobalPlan(plan, io());
 expect(verifyPiGlobalInstall(desired(), io()).valid).toBe(true);
 writeFileSync(paths().manifest, JSON.stringify({ schema: 'deck-pi-manifest-v2' }));
 expect(planPiGlobalInstall(desired(), io(), { managed: true }).blocked).toBe(true);
});

// Protects user data even if untrusted receipt metadata tries to expand retirement authority.
test('managed Pi never retires session data named by a forged manifest', () => {
 install(desired());
 const path = join(agentDir, 'sessions/history.json'); mkdirSync(dirname(path), { recursive: true });
 writeFileSync(path, 'session data');
 const manifest = readJson(paths().manifest); manifest.files['sessions/history.json'] = hashContent('session data');
 writeFileSync(paths().manifest, JSON.stringify(manifest));
 const plan = planPiGlobalInstall(desired(), io(), { managed: true }); applyPiGlobalPlan(plan, io());
 expect(readFileSync(path, 'utf8')).toBe('session data');
});

// Protects retirement-before-receipt: a failed filesystem deletion cannot drop its ownership record.
test('managed Pi verifies retirement effects before publishing receipts', () => {
 install(desired());
 const obsolete = join(agentDir, 'deck/package/agents/deck-obsolete.md'); writeFileSync(obsolete, 'retired');
 const manifest = readJson(paths().manifest); manifest.files['deck/package/agents/deck-obsolete.md'] = hashContent('retired');
 const prior = JSON.stringify(manifest); writeFileSync(paths().manifest, prior);
 const fileIo = io(), broken = { ...fileIo, remove(path: string) { if (path !== obsolete) fileIo.remove(path); } };
 const plan = planPiGlobalInstall(desired(), broken, { managed: true });
 expect(() => applyPiGlobalPlan(plan, broken)).toThrow('retirement postimage');
 expect(readFileSync(paths().manifest, 'utf8')).toBe(prior);
 expect(readFileSync(obsolete, 'utf8')).toBe('retired');
});

// Protects concurrent edits to both published and not-yet-published transaction targets.
test('failed apply preserves concurrent edits instead of restoring stale snapshots', () => {
  install(desired());
  const first = join(agentDir, desired().files[0]!.relPath);
  const second = join(agentDir, desired().files[1]!.relPath);
  const next = desired({ files: desired().files.map(file => ({ ...file, content: file.content + 'updated' })) });
  const base = io();
  let failed = false;
  const failing: PiFileIO = { ...base, writeText(path, content, mode) {
    if (path === second && !failed) {
      failed = true;
      base.writeText(first, 'external first'); base.writeText(second, 'external second');
      throw new Error('injected publication failure');
    }
    base.writeText(path, content, mode);
  } };
  const plan = planPiGlobalInstall(next, failing);
  expect(() => applyPiGlobalPlan(plan, failing)).toThrow(/rollback incomplete/);
  expect(base.readText(first)).toBe('external first');
  expect(base.readText(second)).toBe('external second');
});

// Untrusted crash evidence never authorizes rollback or disappears on an empty replan.
test('pending Pi transaction refuses mutation and preserves its evidence even for a no-op plan', () => {
  install(desired());
  const pending = join(agentDir, 'deck/transaction.pending.json');
  writeFileSync(pending, '{"schema":"forged","targets":[]}');
  const before = snapshotTree(agentDir);
  expect(() => applyPiGlobalPlan(planPiGlobalInstall(desired(), io()), io())).toThrow(/recovery required/);
  expect(snapshotTree(agentDir)).toEqual(before);
});

// A process can disappear after an effect: evidence must already exist on disk, with no config secrets.
test('publication starts only after a private hash-only pending transaction is durable', () => {
  const base = io();
  const pending = join(agentDir, 'deck/transaction.pending.json');
  let observed = false;
  const checked: PiFileIO = { ...base, writeText(path, content, mode) {
    if (path.endsWith('package.json')) {
      const record = base.readText(pending);
      expect(record).toBeDefined();
      expect(record).not.toContain('sensitive value');
      expect(statSync(pending).mode & 0o777).toBe(0o600);
      observed = true;
    }
    base.writeText(path, content, mode);
  } };
  writeFileSync(paths().settings, '{"personal":"sensitive value"}');
  install(desired(), checked);
  expect(observed).toBe(true);
  expect(base.readText(pending)).toBeUndefined();
});

// Real process loss bypasses catch/finally; restart must retain uncertain effects and their journal.
test('process exit during publication leaves durable evidence that a fresh process cannot replay', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const modulePath = join(import.meta.dir, 'pi-global-install.ts');
  const first = join(agentDir, 'deck/package/first.txt');
  const state = desired({ files: [{ relPath: 'deck/package/first.txt', content: 'canonical first' }, { relPath: 'deck/package/second.txt', content: 'canonical second' }] });
  const script = `
    import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from ${JSON.stringify(modulePath)};
    const base = createNodePiFileIO();
    const state = ${JSON.stringify(state)};
    const io = { ...base, writeText(path, content, mode) {
      base.writeText(path, content, mode);
      if (path === ${JSON.stringify(first)}) process.exit(77);
    } };
    applyPiGlobalPlan(planPiGlobalInstall(state, io), io);
  `;
  const child = spawnSync(process.execPath, ['--eval', script], { encoding: 'utf8', timeout: 10000 });
  expect(child.status).toBe(77);
  expect(io().readText(first)).toBe('canonical first');
  const before = snapshotTree(agentDir);
  expect(() => applyPiGlobalPlan(planPiGlobalInstall(state, io()), io())).toThrow('recovery required');
  expect(snapshotTree(agentDir)).toEqual(before);
  expect(existsSync(paths().manifest)).toBe(false);
});
