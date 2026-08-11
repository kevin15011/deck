import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
const repositoryRoot = resolve(import.meta.dir, "../../..");

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-compiled-web-search-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("compiled Web Search smoke", () => {
  test("runs the compiled binary from an isolated project with no workspace or node_modules lookup", () => {
    const root = temporaryRoot();
    const compiled = join(root, "build", "deck");
    const build = spawnSync(process.execPath, [
      "build",
      "--compile",
      "--outfile",
      compiled,
      join(repositoryRoot, "apps", "cli", "src", "main.tsx"),
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(build.status).toBe(0);

    const isolated = join(root, "isolated");
    const release = join(isolated, "release");
    const project = join(isolated, "project");
    const home = join(isolated, "home");
    const binary = join(release, "deck");
    mkdirSync(join(project, ".deck"), { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(release, { recursive: true });
    copyFileSync(compiled, binary);
    writeFileSync(join(project, ".deck", "config.json"), `${JSON.stringify({ version: 1, webSearch: { enabled: true, provider: "tavily" } })}\n`);

    const runtime = spawnSync(binary, [], {
      cwd: project,
      encoding: "utf8",
      env: {
        HOME: home,
        // Empty PATH guarantees no npx/Tavily command can be launched. The
        // standalone executable has no runtime workspace dependency.
        PATH: "",
        DECK_STANDALONE_WEB_SEARCH_SMOKE: "1",
      },
    });

    expect(existsSync(join(isolated, "node_modules"))).toBe(false);
    expect(existsSync(join(project, "node_modules"))).toBe(false);
    expect(runtime.status).toBe(0);
    const report = JSON.parse(runtime.stdout) as {
      provider: string | null;
      runners: Record<string, { state: string; code: string }>;
    };
    expect(report.provider).toBe("tavily");
    expect(report.runners.pi).toBeDefined();
    expect(report.runners.opencode).toBeDefined();
    expect(report.runners.pi?.code).not.toBe("inventory-unavailable");
    expect(report.runners.opencode?.code).not.toBe("inventory-unavailable");
  }, 120_000);
});
