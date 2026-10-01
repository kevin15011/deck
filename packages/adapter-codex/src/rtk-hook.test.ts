import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinRtkRewrite, rtkHookScript } from "@deck/core";

const created: string[] = [];
afterEach(() => { for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true }); });

/** A fake `rtk` that speaks the `rtk hook codex` protocol: rewrite `git status`, stay silent otherwise. */
function fixture(behavior: "rewrite" | "crash" | "garbage" = "rewrite") {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "deck rtk hook 'quoted' ")));
  created.push(dir);
  const binary = join(dir, "rtk");
  writeFileSync(binary, `#!/bin/sh
[ "$1" = "hook" ] && [ "$2" = "codex" ] || exit 9
payload=$(cat)
case "${behavior}" in
  crash) exit 3 ;;
  garbage) echo "not json"; exit 0 ;;
esac
case "$payload" in
  *'"git status"'*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecisionReason":"RTK auto-rewrite","updatedInput":{"command":"rtk git status"},"permissionDecision":"allow"}}' ;;
  *'"git log && echo $HOME"'*) printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk git log && echo $HOME"},"permissionDecision":"allow"}}' ;;
esac
`);
  chmodSync(binary, 0o755);
  const script = join(dir, "hook.cjs");
  writeFileSync(script, rtkHookScript(binary, "codex"));
  return { binary, script };
}

function run(script: string, payload: unknown) {
  const result = spawnSync("node", [script], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8", timeout: 10_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const preToolUse = (command: unknown, toolName = "Bash") => ({
  session_id: "s", turn_id: "t", cwd: "/work", hook_event_name: "PreToolUse", model: "gpt", permission_mode: "default", tool_name: toolName, tool_use_id: "u", tool_input: { command },
});

describe("Codex RTK PreToolUse hook bridge", () => {
  test("rewrites through the owned binary, pinning the executable word and keeping Codex's allow/updatedInput shape", () => {
    const { binary, script } = fixture();
    const result = run(script, preToolUse("git status"));
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    const quoted = `'${binary.replaceAll("'", "'\\''")}'`;
    expect(output.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { command: `${quoted} git status` } });
  });

  test("passes the original command through unchanged when RTK has no rewrite, crashes, or emits garbage", () => {
    for (const behavior of ["rewrite", "crash", "garbage"] as const) {
      const { script } = fixture(behavior);
      const result = run(script, preToolUse("echo hello"));
      expect(result).toMatchObject({ status: 0, stdout: "" });
      if (behavior !== "rewrite") expect(run(script, preToolUse("git status"))).toMatchObject({ status: 0, stdout: "" });
    }
  });

  test("defers rewrites containing shell substitutions and ignores non-Bash tools and malformed input", () => {
    const { script } = fixture();
    expect(run(script, preToolUse("git log && echo $HOME"))).toMatchObject({ status: 0, stdout: "" });
    expect(run(script, preToolUse("git status", "apply_patch"))).toMatchObject({ status: 0, stdout: "" });
    expect(run(script, preToolUse(42))).toMatchObject({ status: 0, stdout: "" });
    expect(run(script, "not json")).toMatchObject({ status: 0, stdout: "" });
    expect(run(script, "")).toMatchObject({ status: 0, stdout: "" });
  });

  test("shares the reviewed executable-word qualifier with the Claude bridge", () => {
    expect(pinRtkRewrite("rtk git status && rtk ls", "/p/rtk")).toBe("'/p/rtk' git status && '/p/rtk' ls");
    expect(pinRtkRewrite("sudo rtk git status", "/p/rtk")).toBeUndefined();
  });

  test("the generated script embeds only the owned binary path and requests the codex protocol", () => {
    const text = rtkHookScript("/owned/rtk", "codex");
    expect(text).toContain('const binary = "/owned/rtk"');
    expect(text).toContain('["hook", "codex"]');
    expect(text).not.toContain('"claude"');
  });
});
