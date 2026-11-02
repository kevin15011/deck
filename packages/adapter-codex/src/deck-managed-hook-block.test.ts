import { expect, test } from "bun:test";
import { isDeckManagedHookBlock } from "./codex-config";

// Protects: Deck re-adopts its own hook blocks that lost their receipt, never user-customized ones.
// Oracle: ownership is the Deck-managed script location plus the exact field shape Deck writes.
// Fails if: a block with a foreign command, extra fields or an unknown id is treated as Deck-owned.
const block = (command: string, extra = "") => `[[hooks.UserPromptSubmit]]\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = "${command}"\ntimeout = 60\n${extra}`;
const node = "'/opt/homebrew/bin/node'";

test("recognizes Deck-written hook blocks across tool versions", () => {
  expect(isDeckManagedHookBlock("supermemory", block(`${node} '/h/.local/share/deck/codex/tools/official-supermemory-1.0.19/recall.js'`))).toBe(true);
  expect(isDeckManagedHookBlock("supermemory", block(`${node} '/h/.local/share/deck/codex/tools/official-supermemory-1.1.0-hosted-v1/recall.js'`))).toBe(true);
  expect(isDeckManagedHookBlock("rtk", block(`${node} '/h/.codex/deck/hooks/deck-rtk-hook.cjs'`, 'statusMessage = "Optimizing command with RTK"\n'))).toBe(true);
});

test("rejects customized or foreign hook blocks", () => {
  expect(isDeckManagedHookBlock("rtk", block(`${node} '/tmp/evil.cjs'`))).toBe(false);
  expect(isDeckManagedHookBlock("rtk", block(`${node} '/h/.codex/deck/hooks/deck-rtk-hook.cjs' --extra`))).toBe(false);
  expect(isDeckManagedHookBlock("rtk", block(`${node} '/h/.codex/deck/hooks/deck-rtk-hook.cjs'`, "env = 1\n"))).toBe(false);
  expect(isDeckManagedHookBlock("rtk", block(`'/bin/sh' '/h/.codex/deck/hooks/deck-rtk-hook.cjs'`))).toBe(false);
  expect(isDeckManagedHookBlock("memory-bridge", block(`${node} '/h/.codex/deck/hooks/deck-rtk-hook.cjs'`))).toBe(false);
  expect(isDeckManagedHookBlock("rtk", "not toml [[")).toBe(false);
});

// Protects: a blocked preparation names the failed check without exposing raw messages.
// Fails if: unreviewed text (paths, secrets, free-form messages) is accepted as a detail slug.
import { nativeRoleFailureDetail } from "./native-role";
test("failure detail only exposes reviewed slugs", () => {
  expect(nativeRoleFailureDetail(new Error("hook-not-in-manifest:rtk"))).toBe("hook-not-in-manifest:rtk");
  expect(nativeRoleFailureDetail(Object.assign(new Error("ENOENT: no such file or directory, open '/home/u/.codex/config.toml'"), { code: "ENOENT" }))).toBe("fs-enoent");
  expect(nativeRoleFailureDetail(new Error("/Users/me/secret token=abc"))).toBeUndefined();
  expect(nativeRoleFailureDetail(new Error(""))).toBeUndefined();
});
