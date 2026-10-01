import { describe, expect, test } from "bun:test";

import { CODEX_MEMORY_BRIDGE_HOOK_BLOCK, TOML_PARSER_DECISION, codexHooksFeatureDisabled, inspectCodexOwnedHookIds, mergeCodexOwnedHooks, mergeCodexProjectConfig, renderCodexOwnedHookBlock, type CodexOwnedHookBlock } from "./codex-config";

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

  test("extends an existing [features] table instead of opening a duplicate header", () => {
    const merged = mergeCodexProjectConfig("[features]\nhooks = false\n\n[profiles.fast]\nmodel = \"x\"\n", { multiAgent: true });
    expect(merged.status).toBe("updated");
    expect(merged.content).toBe('[features]\nhooks = false\nmulti_agent = true\n\n[profiles.fast]\nmodel = "x"\n');
    expect(mergeCodexProjectConfig(merged.content, { multiAgent: true }).status).toBe("unchanged");
    expect(mergeCodexProjectConfig("[features]\nhooks = false", { multiAgent: true }).content).toBe("[features]\nhooks = false\nmulti_agent = true");
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

const RTK_BLOCK: CodexOwnedHookBlock = { id: "rtk", hooks: [{ event: "PreToolUse", matcher: "^Bash$", command: "'/usr/bin/node' '/p/.codex/deck/hooks/deck-rtk-hook.cjs'", timeout: 10, statusMessage: "Optimizing" }] };
const SM_BLOCK: CodexOwnedHookBlock = { id: "supermemory", hooks: [{ event: "UserPromptSubmit", command: "node recall.js", timeout: 60 }, { event: "Stop", command: "node flush.js", timeout: 30 }] };

describe("mergeCodexOwnedHooks", () => {
  test("adds the memory bridge as a marker-owned block and is idempotent and removable", () => {
    const first = mergeCodexOwnedHooks("[features]\nmulti_agent = true\n", [CODEX_MEMORY_BRIDGE_HOOK_BLOCK]);
    expect(first.status).toBe("updated");
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "Stop"]) expect(first.content).toContain(`[[hooks.${event}]]`);
    expect(first.content).toContain('command = "deck internal codex-memory-hook"');
    expect(first.content).toContain("# deck-codex-hook:memory-bridge:start");
    expect(mergeCodexOwnedHooks(first.content, [CODEX_MEMORY_BRIDGE_HOOK_BLOCK]).status).toBe("unchanged");
    const removed = mergeCodexOwnedHooks(first.content, []);
    expect(removed.status).toBe("updated");
    expect(removed.content).toBe("[features]\nmulti_agent = true\n");
  });

  test("preserves user hooks (inline TOML) byte-for-byte while adding, replacing and removing only owned blocks", () => {
    const user = '[features]\nmulti_agent = true\n\n[[hooks.PreToolUse]]\nmatcher = "Bash"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "echo user-hook"\n\n[hooks.state."x:pre_tool_use:0:0"]\ntrusted_hash = "sha256:abc"\n';
    const added = mergeCodexOwnedHooks(user, [RTK_BLOCK, SM_BLOCK]);
    expect(added.status).toBe("updated");
    expect(added.content.startsWith(user)).toBe(true);
    expect(mergeCodexOwnedHooks(added.content, [RTK_BLOCK, SM_BLOCK]).status).toBe("unchanged");

    const replaced = mergeCodexOwnedHooks(added.content, [{ ...RTK_BLOCK, hooks: [{ ...RTK_BLOCK.hooks[0]!, command: "'/other/node' 'x'" }] }, SM_BLOCK]);
    expect(replaced.content.startsWith(user)).toBe(true);
    expect(replaced.content).toContain("/other/node");
    expect(replaced.content).not.toContain("/usr/bin/node");

    const dropped = mergeCodexOwnedHooks(replaced.content, [SM_BLOCK]);
    expect(dropped.content).not.toContain("deck-codex-hook:rtk");
    expect(dropped.content).toContain("deck-codex-hook:supermemory:start");
    expect(mergeCodexOwnedHooks(dropped.content, []).content).toBe(user);
  });

  test("moves nothing when user content follows an owned block and keeps it in place", () => {
    const withBlock = mergeCodexOwnedHooks("", [RTK_BLOCK]).content;
    const trailing = `${withBlock}\n[profiles.fast]\nmodel = "x"\n`;
    const again = mergeCodexOwnedHooks(trailing, [RTK_BLOCK]);
    expect(again.status).toBe("unchanged");
    expect(mergeCodexOwnedHooks(trailing, []).content).toBe('[profiles.fast]\nmodel = "x"\n');
  });

  test("migrates the exact pre-v2 single block and refuses a tampered one", () => {
    const legacy = `[features]\nmulti_agent = true\n# deck-codex-hook-v1\n${["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "Stop"].map((event) => `[[hooks.${event}]]\nmatcher = "*"\nhooks = [{ type = "command", command = "deck internal codex-memory-hook" }]\n`).join("\n")}`;
    const migrated = mergeCodexOwnedHooks(legacy, [CODEX_MEMORY_BRIDGE_HOOK_BLOCK]);
    expect(migrated.status).toBe("updated");
    expect(migrated.content).not.toContain("deck-codex-hook-v1");
    expect(migrated.content).toContain("deck-codex-hook:memory-bridge:start");
    expect(inspectCodexOwnedHookIds(legacy)).toEqual(["memory-bridge"]);
    const retired = mergeCodexOwnedHooks(legacy, []);
    expect(retired.content).toBe("[features]\nmulti_agent = true\n");
    expect(mergeCodexOwnedHooks(legacy.replace('matcher = "*"', 'matcher = "Bash"'), [])).toMatchObject({ status: "blocked", diagnostics: [expect.stringContaining("tampered")] });
  });

  test("blocks malformed TOML and ambiguous or duplicated ownership markers", () => {
    expect(mergeCodexOwnedHooks("[features\n", [RTK_BLOCK]).status).toBe("blocked");
    const once = mergeCodexOwnedHooks("", [RTK_BLOCK]).content;
    expect(mergeCodexOwnedHooks(`${once}${once}`, [RTK_BLOCK]).status).toBe("blocked");
    expect(mergeCodexOwnedHooks(once.replace("# deck-codex-hook:rtk:end\n", ""), [RTK_BLOCK]).status).toBe("blocked");
    expect(() => renderCodexOwnedHookBlock({ id: "rtk", hooks: [{ event: "PreToolUse", command: "a\nb" }] })).toThrow();
  });

  test("never treats user hooks or hooks.json as ownership evidence and reports disabled hook features", () => {
    expect(mergeCodexOwnedHooks('[[hooks.Stop]]\nmatcher = "*"\nhooks = [{ type = "command", command = "echo mine" }]\n', []).status).toBe("unchanged");
    expect(codexHooksFeatureDisabled("[features]\nhooks = false\n")).toBe(true);
    expect(codexHooksFeatureDisabled("[features]\ncodex_hooks = false\n")).toBe(true);
    expect(codexHooksFeatureDisabled("[features]\nhooks = true\n")).toBe(false);
    expect(codexHooksFeatureDisabled("")).toBe(false);
  });
});
