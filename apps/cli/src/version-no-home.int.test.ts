import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("version does not initialize runner adapters when HOME is absent", () => {
  const main = fileURLToPath(new URL("./main.tsx", import.meta.url));
  const result = spawnSync(process.execPath, [main, "version"], {
    env: { PATH: "" },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.status).toBe(0);
  expect(result.stdout + result.stderr).toMatch(/^deck \S+/m);
  expect(result.stdout + result.stderr).not.toContain("Claude global plugin requires an absolute user HOME");
});
