import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexRunnerAdapter } from "./runner-adapter";
for (const scope of ["user", "project"]) for (const yolo of [false, true]) {
  test(`Codex preserves native review roles without a blanket launch fence (${scope}, yolo=${yolo})`, async () => {
    const home = mkdtempSync("/tmp/deck-codex-readonly-");
    try {
      const project = join(home, "project"), codexHome = join(home, ".codex");
      const root = scope === "user" ? codexHome : join(project, ".codex");
      mkdirSync(join(root, "agents"), { recursive: true });
      writeFileSync(join(root, "config.toml"), '[mcp_servers.user_shell]\ncommand = "arbitrary-shell"\n');
      const file = join(root, "agents", "deck-quality.toml"), source = 'name = "deck-quality"\nsandbox_mode = "read-only"\n';
      writeFileSync(file, source);
      const adapter = createCodexRunnerAdapter({ userHome: home, codexHome });
      const launch = await adapter.buildLaunchPlan!({ projectRoot: project, teamId: "developer-team", mode: "interactive", deckConfig: getDefaultDeckConfig(), ...(yolo ? { runnerNative: { dangerouslyBypassApprovalsAndSandbox: true } } : {}) });
      expect((launch as { code?: string }).code).not.toBe("codex-readonly-native-policy-unverified");
      expect(readFileSync(file, "utf8")).toBe(source);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}
