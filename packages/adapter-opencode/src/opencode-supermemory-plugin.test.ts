import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY,
  OPENCODE_SUPERMEMORY_PACKAGE_SPEC,
  OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
  installOwnedOpenCodeSupermemory,
  inspectOpenCodeSupermemoryRegistrations,
  inspectOwnedOpenCodeSupermemory,
  resolveOwnedOpenCodeSupermemoryPaths,
} from "./opencode-supermemory-plugin";

const roots: string[] = [];
const tempRoot = (): string => {
  const root = join(process.cwd(), `.tmp-opencode-supermemory-${crypto.randomUUID()}`);
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const fixtureArtifacts = {
  "package.json": JSON.stringify({
    name: "opencode-supermemory",
    version: OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
    exports: {
      ".": { import: "./dist/index.js" },
      "./server": { import: "./dist/server.js" },
    },
  }),
  "dist/index.js": "export const SupermemoryPlugin = async () => ({ event() {} });\n",
  "dist/server.js": "export default { id: 'opencode-supermemory', setup() {} };\n",
} as const;

const fixtureDigests = Object.fromEntries(
  Object.entries(fixtureArtifacts).map(([path, content]) => [path, digest(content)]),
) as Record<keyof typeof fixtureArtifacts, string>;

function writeInstalledFixture(root: string): void {
  const paths = resolveOwnedOpenCodeSupermemoryPaths({
    environment: { XDG_DATA_HOME: root },
    homeDirectory: root,
  });
  for (const [relativePath, content] of Object.entries(fixtureArtifacts)) {
    const path = join(paths.packageDirectory, ...relativePath.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  writeFileSync(join(paths.installRoot, "package-lock.json"), JSON.stringify({
    packages: {
      "node_modules/opencode-supermemory": {
        version: OPENCODE_SUPERMEMORY_PACKAGE_VERSION,
        integrity: OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY,
      },
    },
  }));
}

describe("Deck-owned OpenCode Supermemory loader", () => {
  test("installs the exact official package into the owned path and writes only a loader adapter", async () => {
    const root = tempRoot();
    const commands: Array<{ command: string; args: string[] }> = [];

    const result = await installOwnedOpenCodeSupermemory({
      projectRoot: root,
      environment: { XDG_DATA_HOME: root, OPENCODE_DISABLE_PROJECT_CONFIG: "1" },
      homeDirectory: root,
      expectedArtifactDigests: fixtureDigests,
      runInstallCommand: async (command, args) => {
        commands.push({ command, args });
        writeInstalledFixture(root);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({ ok: true, outcome: "installed" });
    expect(commands).toEqual([{
      command: "npm",
      args: [
        "install",
        "--prefix",
        resolveOwnedOpenCodeSupermemoryPaths({ environment: { XDG_DATA_HOME: root }, homeDirectory: root }).installRoot,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        OPENCODE_SUPERMEMORY_PACKAGE_SPEC,
      ],
    }]);
    const loader = readFileSync(result.paths.loaderPath, "utf8");
    expect(loader).toContain('from "./node_modules/opencode-supermemory/dist/index.js"');
    expect(loader).toContain('from "./node_modules/opencode-supermemory/dist/server.js"');
    expect(loader).toContain("server: (ctx) => SupermemoryPlugin(ctx)");
    expect(loader).toContain("setup: ServerPlugin.setup");
    expect(loader).not.toMatch(/capture|compaction|recall/i);
    expect(inspectOwnedOpenCodeSupermemory({
      environment: { XDG_DATA_HOME: root },
      homeDirectory: root,
      expectedArtifactDigests: fixtureDigests,
    }).ready).toBe(true);
  });

  test("does not trust a changed official entry file", async () => {
    const root = tempRoot();
    writeInstalledFixture(root);
    const paths = resolveOwnedOpenCodeSupermemoryPaths({ environment: { XDG_DATA_HOME: root }, homeDirectory: root });
    mkdirSync(join(paths.installRoot), { recursive: true });
    writeFileSync(paths.loaderPath, "stale loader");
    writeFileSync(join(paths.packageDirectory, "dist", "index.js"), "tampered");

    const inspection = inspectOwnedOpenCodeSupermemory({
      environment: { XDG_DATA_HOME: root },
      homeDirectory: root,
      expectedArtifactDigests: fixtureDigests,
    });

    expect(inspection.ready).toBe(false);
    expect(inspection.code).toBe("artifact-digest-mismatch");
  });

  test("blocks direct and conflicting Supermemory registrations without rejecting unrelated plugins", () => {
    const root = tempRoot();
    const projectRoot = join(root, "project");
    const configHome = join(root, "config");
    mkdirSync(join(configHome, "opencode"), { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    const paths = resolveOwnedOpenCodeSupermemoryPaths({ environment: { XDG_DATA_HOME: root }, homeDirectory: root });

    writeFileSync(join(configHome, "opencode", "opencode.json"), JSON.stringify({
      plugin: ["opencode-auth", paths.loaderLocator],
    }));
    writeFileSync(join(projectRoot, "opencode.jsonc"), `{
      // User-selected plugins remain untouched.
      "plugin": ["context-mode", "opencode-supermemory@2.0.15", "file:///tmp/other-supermemory-loader.mjs"]
    }`);

    const result = inspectOpenCodeSupermemoryRegistrations({
      projectRoot,
      workspaceRoot: projectRoot,
      environment: { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: root },
      homeDirectory: root,
      loaderLocator: paths.loaderLocator,
    });

    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ registration: "opencode-supermemory@2.0.15" }),
      expect.objectContaining({ registration: "file:///tmp/other-supermemory-loader.mjs" }),
    ]));
    expect(result.conflicts.map((entry) => entry.registration)).not.toContain("opencode-auth");
    expect(result.conflicts.map((entry) => entry.registration)).not.toContain("context-mode");
    expect(result.conflicts.map((entry) => entry.registration)).not.toContain(paths.loaderLocator);
  });

  test("blocks installation before npm when a direct external registration exists", async () => {
    const root = tempRoot();
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, "opencode.json"), JSON.stringify({ plugin: ["opencode-supermemory@2.0.15"] }));
    let invoked = false;

    const result = await installOwnedOpenCodeSupermemory({
      projectRoot,
      environment: { XDG_DATA_HOME: root, XDG_CONFIG_HOME: join(root, "config") },
      homeDirectory: root,
      runInstallCommand: async () => {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toMatchObject({ ok: false, outcome: "blocked" });
    expect(invoked).toBe(false);
    expect(readFileSync(join(projectRoot, "opencode.json"), "utf8")).toContain("opencode-supermemory@2.0.15");
  });

  test("fails closed when a candidate OpenCode config is a symlink or unreadable", () => {
    const root = tempRoot();
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot, { recursive: true });
    const target = join(root, "external.json");
    writeFileSync(target, JSON.stringify({ plugin: ["context-mode"] }));
    symlinkSync(target, join(projectRoot, "opencode.json"));
    const paths = resolveOwnedOpenCodeSupermemoryPaths({ environment: { XDG_DATA_HOME: root }, homeDirectory: root });

    const symlinked = inspectOpenCodeSupermemoryRegistrations({
      projectRoot,
      environment: { XDG_DATA_HOME: root, XDG_CONFIG_HOME: join(root, "config") },
      homeDirectory: root,
      loaderLocator: paths.loaderLocator,
    });
    expect(symlinked).toMatchObject({ ok: false });
    expect(symlinked.conflicts).toContainEqual(expect.objectContaining({ registration: "<uninspectable-config>" }));

    rmSync(join(projectRoot, "opencode.json"));
    writeFileSync(join(projectRoot, "opencode.json"), JSON.stringify({ plugin: [] }));
    chmodSync(join(projectRoot, "opencode.json"), 0o000);
    const unreadable = inspectOpenCodeSupermemoryRegistrations({
      projectRoot,
      environment: { XDG_DATA_HOME: root, XDG_CONFIG_HOME: join(root, "config") },
      homeDirectory: root,
      loaderLocator: paths.loaderLocator,
    });
    expect(unreadable).toMatchObject({ ok: false });
    expect(unreadable.conflicts).toContainEqual(expect.objectContaining({ registration: "<uninspectable-config>" }));
  });

  test("rejects group-writable owned ancestry", async () => {
    const root = tempRoot();
    chmodSync(root, 0o770);
    let invoked = false;
    const result = await installOwnedOpenCodeSupermemory({
      projectRoot: root,
      environment: { XDG_DATA_HOME: root, OPENCODE_DISABLE_PROJECT_CONFIG: "1" },
      homeDirectory: root,
      expectedArtifactDigests: fixtureDigests,
      runInstallCommand: async () => {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(result).toMatchObject({ ok: false, outcome: "blocked" });
    expect(invoked).toBe(false);
  });

  test("canonicalizes a symlinked data-home before cold installation and lock-key verification", async () => {
    const root = tempRoot();
    const actual = join(root, "actual-data");
    const alias = join(root, "alias-data");
    mkdirSync(actual);
    symlinkSync(actual, alias);
    const canonicalPaths = resolveOwnedOpenCodeSupermemoryPaths({ environment: { XDG_DATA_HOME: alias }, homeDirectory: root });
    expect(canonicalPaths.installRoot.startsWith(actual)).toBe(true);

    const result = await installOwnedOpenCodeSupermemory({
      projectRoot: root,
      environment: { XDG_DATA_HOME: alias, OPENCODE_DISABLE_PROJECT_CONFIG: "1" },
      homeDirectory: root,
      expectedArtifactDigests: fixtureDigests,
      runInstallCommand: async (_command, args) => {
        expect(args[2]).toBe(canonicalPaths.installRoot);
        writeInstalledFixture(alias);
        const lexicalPackageKey = join(alias, "deck", "opencode", "supermemory", OPENCODE_SUPERMEMORY_PACKAGE_VERSION, "node_modules", "opencode-supermemory");
        writeFileSync(join(canonicalPaths.installRoot, "package-lock.json"), JSON.stringify({
          packages: { [lexicalPackageKey]: { version: OPENCODE_SUPERMEMORY_PACKAGE_VERSION, integrity: OPENCODE_SUPERMEMORY_PACKAGE_INTEGRITY } },
        }));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(result).toMatchObject({ ok: true, outcome: "installed" });
  });
});
