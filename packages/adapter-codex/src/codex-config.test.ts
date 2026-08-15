import { describe, expect, test } from "bun:test";

import { mergeCodexProjectConfig, mergeCodexTrustedHookConfig, TOML_PARSER_DECISION } from "./codex-config";

describe("mergeCodexProjectConfig", () => {
  test("pins the maintained MIT ESM parser selected by the Bun source-range spike", () => {
    expect(TOML_PARSER_DECISION).toEqual({
      packageName: "toml-eslint-parser",
      version: "1.0.3",
      license: "MIT",
      module: "ESM",
      sourceRanges: true,
      bunImportVerified: true,
    });
  });
  test("preserves every unowned byte while adding the Deck-owned multi-agent key", () => {
    const source = [
      "# user heading",
      "model = 'gpt-5.6-sol' # keep this quote and comment",
      "quoted.\"odd key\" = [ 1,  2 ]",
      "",
      "[mcp_servers.user]",
      "command = \"user-mcp\"",
      "",
    ].join("\n");

    const result = mergeCodexProjectConfig(source, { multiAgent: true });

    expect(result.status).toBe("updated");
    expect(result.content.startsWith(source)).toBe(true);
    expect(result.content).toContain("[features]\nmulti_agent = true");
  });

  test("updates only the existing owned value range", () => {
    const source = "# preserved\n[features] # preserved table comment\nmulti_agent   = false # retained\nother = true\n";
    const result = mergeCodexProjectConfig(source, { multiAgent: true });
    expect(result.content).toBe(
      "# preserved\n[features] # preserved table comment\nmulti_agent   = true # retained\nother = true\n",
    );
  });

  test("blocks malformed TOML and ambiguous duplicate owned keys", () => {
    expect(mergeCodexProjectConfig("[features\n", { multiAgent: true }).status).toBe("blocked");
    expect(
      mergeCodexProjectConfig(
        "[features]\nmulti_agent = true\n[features]\nmulti_agent = false\n",
        { multiAgent: true },
      ).status,
    ).toBe("blocked");
  });
});

describe("mergeCodexTrustedHookConfig", () => {
  test("adds released lifecycle bindings idempotently and rejects unowned hook collisions", () => {
    const first = mergeCodexTrustedHookConfig("[features]\nmulti_agent = true\n", true);
    expect(first.status).toBe("updated");
    expect(first.content).toContain("[[hooks.SessionStart]]");
    expect(first.content).toContain("[[hooks.PreToolUse]]");
    expect(first.content).toContain("[[hooks.SubagentStart]]");
    expect(first.content).toContain("[[hooks.Stop]]");
    expect(first.content).toContain('command = "deck internal codex-memory-hook"');
    expect(first.content).not.toContain("bun .codex/hooks/developer-team-execution.js");
    expect(mergeCodexTrustedHookConfig(first.content, true).status).toBe("unchanged");
    const disabled = mergeCodexTrustedHookConfig(first.content, false);
    expect(disabled.status).toBe("updated");
    expect(disabled.content).not.toContain("deck-codex-hook-v1");
    expect(mergeCodexTrustedHookConfig(first.content.replace('matcher = "*"', 'matcher = "Bash"'), true)).toMatchObject({ status: "blocked", diagnostics: [expect.stringContaining("tampered")] });
    expect(mergeCodexTrustedHookConfig('[[hooks.PreToolUse]]\nmatcher = "Bash"\nhooks = []\n', true)).toMatchObject({ status: "blocked", diagnostics: [expect.stringContaining("collide")] });
  });
});
