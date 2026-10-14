import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeRunnerAdapter } from "../runner-adapter";

describe("Claude adapter exposes its session driver (XR-4.1, D-6)", () => {
  test("getSessionDriver() returns the Claude stream-json driver without requiring a legacy acknowledgement", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "deck-claude-driver-")));
    try {
      let acknowledged = false;
      const adapter = createClaudeRunnerAdapter({ homeDir: home, dataRoot: join(home, "data", "deck"), sessionDriver: { tosAcknowledged: () => acknowledged, exec: async () => ({ code: 0, stdout: "2.1.296 (Claude Code)" }) } });
      const driver = adapter.getSessionDriver?.();
      expect(driver?.runnerId).toBe("claude");
      expect(driver?.protocol).toBe("claude-stream-json");
      expect(await driver!.probe({ cwd: home })).toMatchObject({ status: "ready" });
      acknowledged = true;
      expect((await driver!.probe({ cwd: home })).status).toBe("ready");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
