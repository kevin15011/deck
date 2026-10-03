import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { piAgentPaths } from "./agent-dir";
import { createNodePiFileIO, type PiFileIO } from "./pi-global-install";
import {
  cleanupPiLegacy,
  defaultLegacyProbeKeys,
  detectPiLegacy,
  legacyContentHash,
  normalizeLegacyAgentContent,
  type PiLegacyTemplates,
} from "./pi-legacy";

let root: string;
let project: string;
let agentDir: string;
let backups: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-legacy-"));
  project = join(root, "project");
  agentDir = join(root, "agent");
  backups = join(root, "state", "backups", "pi-legacy");
  mkdirSync(project, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const AGENT = "---\nname: deck-lead\nmodel: old/model\nthinking: high\ntools: read,write\n---\nLead body\n";
const SKILL = "---\nname: deck-lead\n---\nSkill body\n";
const put = (path: string, content: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
const templates = (): PiLegacyTemplates => new Map([
  ["agents/deck-lead.md", [legacyContentHash("agents/deck-lead.md", AGENT)]],
  ["skills/deck-lead/SKILL.md", [legacyContentHash("skills/deck-lead/SKILL.md", SKILL)]],
]);
const detect = (withTemplates = true, io: PiFileIO = createNodePiFileIO()) => detectPiLegacy({ io, agentDir, projectRoot: project, keys: ["agents/deck-lead.md", "skills/deck-lead/SKILL.md"], ...(withTemplates ? { templates: templates() } : {}) });
const tree = (dir: string): string[] => existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : [];

describe("legacy detection (7.1)", () => {
  test("reports project and global Deck files with their state, and nothing for a clean project", () => {
    expect(detect().files).toEqual([]);
    put(join(project, ".pi", "agents", "deck-lead.md"), AGENT.replace("old/model", "other/model"));
    put(join(project, ".pi", "skills", "deck-lead", "SKILL.md"), `${SKILL}edited\n`);
    put(join(agentDir, "agents", "deck-lead.md"), AGENT);
    const report = detect();
    expect(report.files.map((file) => [file.scope, file.key, file.state])).toEqual([
      ["project", "agents/deck-lead.md", "unmodified"],
      ["project", "skills/deck-lead/SKILL.md", "modified"],
      ["global", "agents/deck-lead.md", "unmodified"],
    ]);
  });

  test("without templates (Doctor) Deck-named files are unverified", () => {
    put(join(project, ".pi", "agents", "deck-lead.md"), AGENT);
    expect(detect(false).files[0]?.state).toBe("unverified");
  });

  test("project profile files under .deck/pi/profiles are detected", () => {
    put(join(project, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"), "prompt");
    const report = detectPiLegacy({ io: createNodePiFileIO(), agentDir, projectRoot: project, templates: new Map([["profiles/developer-team/system-prompt.md", []]]) });
    expect(report.files).toEqual([expect.objectContaining({ scope: "project", kind: "profile", state: "modified" })]);
  });

  test("default probe keys cover agents, skills and the profile", () => {
    const keys = defaultLegacyProbeKeys();
    expect(keys).toContain("agents/deck-lead.md");
    expect(keys.some((key) => key.startsWith("skills/") && key.endsWith("/SKILL.md"))).toBe(true);
    expect(keys).toContain("profiles/developer-team/system-prompt.md");
  });

  test("community package entries are Deck-added only with Deck artifacts as evidence", () => {
    put(join(project, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents@1.2.3", "npm:other"] }));
    expect(detect().packages).toEqual([expect.objectContaining({ scope: "project", source: "pi-subagents", deckAdded: false })]);
    put(join(project, ".pi", "agents", "deck-lead.md"), AGENT);
    expect(detect().packages[0]?.deckAdded).toBe(true);
  });

  test("the normalization ignores only model, thinking and tools lines", () => {
    expect(normalizeLegacyAgentContent(AGENT)).toBe("---\nname: deck-lead\n---\nLead body\n");
    expect(normalizeLegacyAgentContent("no frontmatter\nmodel: x\n")).toBe("no frontmatter\nmodel: x\n");
  });
});

describe("opt-in transactional cleanup (7.2)", () => {
  const seed = () => {
    put(join(project, ".pi", "agents", "deck-lead.md"), AGENT);
    put(join(project, ".pi", "skills", "deck-lead", "SKILL.md"), SKILL);
    put(join(project, ".pi", "settings.json"), JSON.stringify({ theme: "dark", packages: ["npm:pi-subagents", "npm:pi-mcp-adapter", "npm:keep-me"] }));
  };
  const run = (io: PiFileIO = createNodePiFileIO()) => cleanupPiLegacy({ io, agentDir, projectRoot: project, report: detect(true, io), backupRoot: backups, now: () => new Date("2026-10-02T10:00:00Z") });

  test("unmodified files and Deck-added package entries are removed, a backup exists, other settings survive", () => {
    seed();
    const result = run();
    expect(result.removed.length).toBe(3);
    expect(existsSync(join(project, ".pi", "agents", "deck-lead.md"))).toBe(false);
    expect(existsSync(join(project, ".pi", "skills"))).toBe(false);
    const settings = JSON.parse(readFileSync(join(project, ".pi", "settings.json"), "utf-8"));
    expect(settings).toEqual({ theme: "dark", packages: ["npm:keep-me"] });
    const index = JSON.parse(readFileSync(join(result.backupDir!, "index.json"), "utf-8"));
    expect(index.items).toHaveLength(3);
    expect(readFileSync(index.items.find((item: { path: string }) => item.path.endsWith("deck-lead.md")).backup, "utf-8")).toBe(AGENT);
  });

  test("a user-modified file is kept and reported", () => {
    seed();
    put(join(project, ".pi", "agents", "deck-lead.md"), `${AGENT}my edit\n`);
    const result = run();
    expect(existsSync(join(project, ".pi", "agents", "deck-lead.md"))).toBe(true);
    expect(result.preserved).toContain(join(project, ".pi", "agents", "deck-lead.md"));
    expect(result.diagnostics.join("\n")).toContain("Kept");
  });

  test("package entries without Deck evidence are kept", () => {
    put(join(project, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents"] }));
    const before = readFileSync(join(project, ".pi", "settings.json"), "utf-8");
    const result = run();
    expect(readFileSync(join(project, ".pi", "settings.json"), "utf-8")).toBe(before);
    expect(result.removed).toEqual([]);
    expect(result.preserved.join("\n")).toContain("pi-subagents");
  });

  test("a failure after partial removal restores everything from the backup", () => {
    seed();
    const real = createNodePiFileIO();
    let removals = 0;
    const failing: PiFileIO = { ...real, remove: (path) => { if (++removals === 2) throw new Error("disk exploded"); real.remove(path); } };
    const before = tree(project);
    const result = run(failing);
    expect(result.removed).toEqual([]);
    expect(result.diagnostics.join("\n")).toMatch(/restored/);
    expect(tree(project)).toEqual(before);
    expect(readFileSync(join(project, ".pi", "agents", "deck-lead.md"), "utf-8")).toBe(AGENT);
    expect(readFileSync(join(project, ".pi", "skills", "deck-lead", "SKILL.md"), "utf-8")).toBe(SKILL);
    expect(JSON.parse(readFileSync(join(project, ".pi", "settings.json"), "utf-8")).packages).toHaveLength(3);
  });

  test("an unwritable backup aborts before any mutation", () => {
    seed();
    const real = createNodePiFileIO();
    const failing: PiFileIO = { ...real, writeText: (path, content, mode) => { if (path.startsWith(backups)) throw new Error("no space"); real.writeText(path, content, mode); } };
    const before = tree(project);
    const result = run(failing);
    expect(result.removed).toEqual([]);
    expect(result.diagnostics.join("\n")).toContain("not started");
    expect(tree(project)).toEqual(before);
  });

  test("global loose Deck files are cleaned the same way and the Deck package is untouched", () => {
    put(join(agentDir, "agents", "deck-lead.md"), AGENT);
    put(join(piAgentPaths(agentDir).packageRoot, "agents", "deck-lead.md"), "package copy");
    const result = run();
    expect(result.removed).toEqual([join(agentDir, "agents", "deck-lead.md")]);
    expect(readFileSync(join(piAgentPaths(agentDir).packageRoot, "agents", "deck-lead.md"), "utf-8")).toBe("package copy");
    expect(existsSync(join(agentDir, "agents"))).toBe(false);
  });

  test("nothing to do reports so", () => {
    expect(run().diagnostics).toEqual(["No legacy Pi artifacts were found."]);
  });
});
