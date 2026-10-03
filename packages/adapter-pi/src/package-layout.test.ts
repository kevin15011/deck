import { describe, expect, test } from "bun:test";
import { posix } from "node:path";

import { DECK_PI_PACKAGE_NAME, PI_PACKAGE_REL_ROOT, PI_PROFILE_REL_ROOT, buildDeckPiPackageFiles } from "./package-layout";

const base = () => ({
  agents: [{ id: "deck-lead", content: "# lead\n" }, { id: "deck-quality", content: "# quality\n" }],
  skills: [
    { relPath: "deck-lead/SKILL.md", content: "# skill lead\n" },
    { relPath: "visual-explainer/SKILL.md", content: "# ve\n" },
    { relPath: "visual-explainer/references/x.md", content: "# ref\n" },
  ],
  extensions: [{ name: "developer-team-execution", implementation: "export default function () {}\n" }],
  profile: { teamId: "developer-team", content: "SYSTEM PROMPT\n" },
});

const byPath = (files: ReturnType<typeof buildDeckPiPackageFiles>) => new Map(files.map((file) => [file.relPath, file.content]));

describe("buildDeckPiPackageFiles", () => {
  test("uses one package root and one profile root under the agent dir", () => {
    expect(PI_PACKAGE_REL_ROOT).toBe("deck/package");
    expect(PI_PROFILE_REL_ROOT).toBe("deck/profiles");
    const files = buildDeckPiPackageFiles(base());
    for (const file of files) expect(file.relPath.startsWith("deck/package/") || file.relPath.startsWith("deck/profiles/")).toBe(true);
  });

  test("package.json declares the pi manifest, keyword and peer dependencies only", () => {
    const manifest = JSON.parse(byPath(buildDeckPiPackageFiles(base())).get("deck/package/package.json")!);
    expect(manifest.name).toBe(DECK_PI_PACKAGE_NAME);
    expect(manifest.keywords).toContain("pi-package");
    expect(manifest.type).toBe("module");
    expect(manifest.pi).toEqual({ extensions: ["./extensions"], skills: ["./skills"], prompts: ["./prompts"] });
    expect(manifest.peerDependencies).toEqual({ "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-ai": "*" });
    expect(manifest.dependencies).toBeUndefined();
    // Agents are not a native Pi resource; the manifest must not claim they are.
    expect(manifest.pi.agents).toBeUndefined();
  });

  test("every extension entry is a .js file or dir/index.js and never .mjs", () => {
    const paths = buildDeckPiPackageFiles(base()).map((file) => file.relPath);
    const extensionFiles = paths.filter((path) => path.startsWith("deck/package/extensions/"));
    expect(extensionFiles.length).toBeGreaterThan(0);
    for (const path of extensionFiles) expect(path.endsWith(".js")).toBe(true);
    expect(paths.some((path) => path.endsWith(".mjs"))).toBe(false);
    expect(paths).toContain("deck/package/extensions/developer-team-execution/index.js");
    expect(paths).toContain("deck/package/extensions/developer-team-execution/impl.js");
  });

  test("the discovered extension entry is the activation guard, not the implementation", () => {
    const files = byPath(buildDeckPiPackageFiles(base()));
    expect(files.get("deck/package/extensions/developer-team-execution/index.js")).toContain("DECK_PI_SESSION");
    expect(files.get("deck/package/extensions/developer-team-execution/index.js")).toContain('"./impl.js"');
    expect(files.get("deck/package/extensions/developer-team-execution/impl.js")).toBe("export default function () {}\n");
    const withExtra = buildDeckPiPackageFiles({ ...base(), extensions: [{ name: "deck-tool-policy", implementation: "export default () => {}\n", extraFiles: [{ name: "config.json", content: "{\"version\":1}\n" }] }] });
    expect(withExtra.find((file) => file.relPath === "deck/package/extensions/deck-tool-policy/config.json")?.content).toBe("{\"version\":1}\n");
  });

  test("agents live inside the package (not the shared agents dir) and skills keep their package layout", () => {
    const files = byPath(buildDeckPiPackageFiles(base()));
    expect(files.get("deck/package/agents/deck-lead.md")).toBe("# lead\n");
    expect(files.get("deck/package/skills/visual-explainer/references/x.md")).toBe("# ref\n");
    expect([...files.keys()].some((path) => path.startsWith("agents/"))).toBe(false);
  });

  test("an empty prompts directory is materialized with a placeholder that Pi will not load as a prompt", () => {
    const paths = buildDeckPiPackageFiles(base()).map((file) => file.relPath);
    const prompts = paths.filter((path) => path.startsWith("deck/package/prompts/"));
    expect(prompts).toEqual(["deck/package/prompts/.gitkeep"]);
  });

  test("the lead profile is outside the package and never SYSTEM.md or APPEND_SYSTEM.md", () => {
    const files = buildDeckPiPackageFiles(base());
    const paths = files.map((file) => file.relPath);
    expect(paths).toContain("deck/profiles/developer-team/system-prompt.md");
    expect(paths.some((path) => /(^|\/)(SYSTEM|APPEND_SYSTEM)\.md$/.test(path))).toBe(false);
  });

  test("all paths are normalized POSIX relative paths without escapes", () => {
    for (const file of buildDeckPiPackageFiles(base())) {
      expect(posix.normalize(file.relPath)).toBe(file.relPath);
      expect(file.relPath.startsWith("/")).toBe(false);
      expect(file.relPath.includes("..")).toBe(false);
    }
  });

  test("rejects skill and agent identifiers that would escape the package", () => {
    expect(() => buildDeckPiPackageFiles({ ...base(), skills: [{ relPath: "../evil/SKILL.md", content: "x" }] })).toThrow(/package path/i);
    expect(() => buildDeckPiPackageFiles({ ...base(), agents: [{ id: "../evil", content: "x" }] })).toThrow(/identifier/i);
    expect(() => buildDeckPiPackageFiles({ ...base(), extensions: [{ name: "x", implementation: "x", extraFiles: [{ name: "../escape.json", content: "{}" }] }] })).toThrow(/Invalid/);
    expect(() => buildDeckPiPackageFiles({ ...base(), extensions: [{ name: "a/b", implementation: "x" }] })).toThrow(/identifier/i);
  });

  test("output is deterministic regardless of input order", () => {
    const forward = buildDeckPiPackageFiles(base());
    const reversed = buildDeckPiPackageFiles({ ...base(), agents: [...base().agents].reverse(), skills: [...base().skills].reverse() });
    expect(forward.map((file) => file.relPath)).toEqual(reversed.map((file) => file.relPath));
  });
});
