import { expect, test } from "bun:test";
import { createCodexRunnerAdapter } from "../runner-adapter";
test("Codex production adapter exposes session driver with injected probe", async () => {
  const adapter = createCodexRunnerAdapter({ sessionDriver: { exec: async () => ({ code: 0, stdout: "codex-cli 0.162.1" }) } });
  expect(adapter.getSessionDriver?.().protocol).toBe("codex-app-server");
  expect((await adapter.getSessionDriver!().probe({ cwd: "/work" })).status).toBe("ready");
});
