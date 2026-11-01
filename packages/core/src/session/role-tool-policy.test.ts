import { expect, test } from "bun:test";
import { createCodexSessionDriver } from "../../../adapter-codex/src/session-driver/driver";
import { createOpenCodeSessionDriver } from "../../../adapter-opencode/src/session-driver/driver";
import { ROLE_TOOL_POLICY, readOnlyMcpTools } from "./role-tool-policy";
test("core grants only explicit semantic queries and no retired capability", () => {
  expect(ROLE_TOOL_POLICY.mcpDefault).toBe("deny");
  expect(ROLE_TOOL_POLICY.mcp.deck).toEqual(["deck_session_history"]);
  expect(ROLE_TOOL_POLICY.mcp.deck).not.toContain("deck_memory_propose");
  expect(readOnlyMcpTools([], (s, t) => [`${s}/${t}`])).toEqual([]);
  expect(readOnlyMcpTools(["codebase-memory"], (s, t) => [`${s}/${t}`])).not.toContain("codebase-memory/index_repository");
});
// Protects generation admission for every review role and approval mode; no blanket read-only fence.
for (const driver of [createCodexSessionDriver({ requireNativeRole: true }), createOpenCodeSessionDriver({ requireNativeRole: true })]) for (const memberId of ["quality", "investigate"]) for (const approvals of ["relay", "runner-default"]) {
  test(`${driver.runnerId} ${memberId} ${approvals} requires a verified installed generation before effects`, async () => {
    let effects = 0;
    const io = new Proxy({}, { get() { effects++; throw new Error("must not use IO"); } });
    await expect(driver.startTask({ memberId, approvals } as never, io as never)).rejects.toThrow(`${driver.runnerId}-session-generation-unverified`);
    expect(effects).toBe(0);
  });
}
