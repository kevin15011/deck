import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publishedArtifact = dirname(require.resolve("opencode-supermemory/package.json"));

test(
  "published Supermemory hooks compose with Deck authorization, RTK, and Context Mode",
  () => {
    const fixture = join(import.meta.dir, "opencode-supermemory-composition.fixture.ts");
    const result = spawnSync(process.execPath, [fixture], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, OPENCODE_PLUGIN_FIXTURE_PATH: publishedArtifact },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      installed: true,
      authorizationDenied: true,
      authorizationAllowed: true,
      staticCompatibleApplyAllowed: true,
      captureObserved: true,
      canonicalTagObserved: true,
      compactionObserved: true,
      rtkConfigPreserved: true,
      contextModeConfigPreserved: true,
    });
  },
);
