import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

import { piAgentPaths } from "./agent-dir";
import { buildPiTeamLaunchPlan } from "./pi-team-launch";

/**
 * Hermetic reproduction (isolated HOME and agent dir) of the three-location collision seen on a real machine:
 * stale `<agentDir>/skills/deck-lead`, Codex-owned `~/.agents/skills/deck-{lead,archive}` and the Deck package.
 * Runs Pi's own resource loader, so the precedence is Pi's, not an assumption.
 */
let root: string;
let home: string;
let agentDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "deck-pi-precedence-"));
  home = join(root, "home");
  agentDir = join(home, ".pi", "agent");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const skill = (path: string, name: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nname: ${name}\ndescription: ${name} from ${path}\n---\nbody\n`);
};

async function load(extraExtensions: string[]) {
  const paths = piAgentPaths(agentDir);
  skill(join(agentDir, "skills", "deck-lead", "SKILL.md"), "deck-lead");
  skill(join(agentDir, "skills", "my-own", "SKILL.md"), "my-own");
  skill(join(home, ".agents", "skills", "deck-lead", "SKILL.md"), "deck-lead");
  skill(join(home, ".agents", "skills", "deck-archive", "SKILL.md"), "deck-archive");
  skill(join(paths.packageRoot, "skills", "deck-lead", "SKILL.md"), "deck-lead");
  skill(join(paths.packageRoot, "skills", "deck-archive", "SKILL.md"), "deck-archive");
  mkdirSync(join(paths.packageRoot, "extensions"), { recursive: true });
  writeFileSync(join(paths.packageRoot, "extensions", "x.js"), "export default function () {}\n");
  writeFileSync(join(paths.packageRoot, "package.json"), JSON.stringify({ name: "deck-pkg", version: "1.0.0", pi: { extensions: ["extensions/x.js"], skills: ["skills"] } }));
  writeFileSync(paths.settings, JSON.stringify({ packages: [paths.packageSettingsEntry] }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const loader = new DefaultResourceLoader({ cwd: join(root, "project"), agentDir, additionalExtensionPaths: extraExtensions });
    await loader.reload();
    return { skills: loader.getSkills(), extensions: loader.getExtensions() };
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  }
}

test("baseline: without the CLI package source a stale legacy skill and a Codex copy win (the reported bug)", async () => {
  mkdirSync(join(root, "project"), { recursive: true });
  const { skills } = await load([]);
  const winner = (name: string) => skills.skills.find((entry) => entry.name === name)?.filePath;
  expect(winner("deck-lead")).toBe(join(agentDir, "skills", "deck-lead", "SKILL.md"));
  expect(winner("deck-archive")).toBe(join(home, ".agents", "skills", "deck-archive", "SKILL.md"));
});

test("the Deck launch plan's --extension package source makes the package skills win, keeps other user skills and loads the extension once", async () => {
  mkdirSync(join(root, "project"), { recursive: true });
  const plan = buildPiTeamLaunchPlan({ teamId: "developer-team", projectRoot: join(root, "project"), agentDir });
  const extensions = plan.args.flatMap((arg, index) => (arg === "--extension" ? [plan.args[index + 1] as string] : []));
  const { skills, extensions: loaded } = await load(extensions);
  const winner = (name: string) => skills.skills.find((entry) => entry.name === name)?.filePath;
  const packageRoot = piAgentPaths(agentDir).packageRoot;
  expect(winner("deck-lead")).toBe(join(packageRoot, "skills", "deck-lead", "SKILL.md"));
  expect(winner("deck-archive")).toBe(join(packageRoot, "skills", "deck-archive", "SKILL.md"));
  expect(winner("my-own")).toBe(join(agentDir, "skills", "my-own", "SKILL.md"));
  expect(loaded.errors).toEqual([]);
  expect(loaded.extensions).toHaveLength(1);
});

async function loadWithExclusions(exclusions: readonly string[], extra: string[]) {
  mkdirSync(join(root, "project"), { recursive: true });
  const paths = piAgentPaths(agentDir);
  skill(join(home, ".agents", "skills", "my-codex", "SKILL.md"), "my-codex");
  skill(join(home, ".agents", "skills", "deck-mine", "SKILL.md"), "deck-mine");
  await load(extra); // writes the fixture tree
  writeFileSync(paths.settings, JSON.stringify({ packages: [paths.packageSettingsEntry], skills: exclusions }));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const loader = new DefaultResourceLoader({ cwd: join(root, "project"), agentDir, additionalExtensionPaths: extra });
    await loader.reload();
    return loader.getSkills();
  } finally {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  }
}

for (const session of ["plain", "deck"] as const) {
  test(`exact-name exclusions hide non-package copies without collisions in a ${session} Pi session`, async () => {
    const packageRoot = piAgentPaths(agentDir).packageRoot;
    const { skills, diagnostics } = await loadWithExclusions(["!deck-lead", "!deck-archive"], session === "deck" ? [packageRoot] : []);
    const winner = (name: string) => skills.find((entry) => entry.name === name)?.filePath;
    expect(diagnostics.filter((entry) => entry.type === "collision")).toEqual([]);
    expect(winner("deck-lead")).toBe(join(packageRoot, "skills", "deck-lead", "SKILL.md"));
    expect(winner("deck-archive")).toBe(join(packageRoot, "skills", "deck-archive", "SKILL.md"));
    expect(winner("my-own")).toBe(join(agentDir, "skills", "my-own", "SKILL.md"));
    expect(winner("my-codex")).toBe(join(home, ".agents", "skills", "my-codex", "SKILL.md"));
    expect(winner("deck-mine")).toBe(join(home, ".agents", "skills", "deck-mine", "SKILL.md"));
  });
}
