import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

describe("compiled Supermemory runtime smoke", () => {
  test("compiles and executes mocked HTTP operations on the host target without Node/npm at runtime", () => {
    const result = spawnSync("bun", ["run", "scripts/verify-supermemory-compiled-runtime.ts", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("compiled-supermemory-runtime ok");
    expect(result.stdout).toContain("compiled-deck-cli-version ok");
    expect(result.stdout).toContain("compiled-deck-runtime-operations ok");
    expect(result.stdout).toContain("compiled-codex-hook-command ok");
    expect(result.stdout).toContain("compiled-deck-cli-doctor-readonly ok");
    expect(result.stdout).toContain("extracted release archive");
    expect(result.stdout).toContain("HTTP-only");
    expect(`${result.stdout}${result.stderr}`).not.toContain("token=secret");
  }, 120_000);
});
