import { describe, expect, test } from "bun:test";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { buildClaudeTurnLaunch, encodeUserMessage, ClaudeLaunchError, DECK_APPROVE_PROMPT_TOOL } from "./launch";

const SID = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";
const CRED = "/state/sessions/s1/tasks/lead/credential";

function input(over: Partial<DriverTaskInput> = {}): DriverTaskInput {
  return {
    taskId: "lead", memberId: "lead", cwd: "/work/project", assignment: { runnerId: "claude", modelId: "opus", thinking: "high" },
    rolePrompt: "You are the Deck Lead.", prompt: "hello", nativeSessionId: SID,
    mcp: { servers: ["serena", "deck"], sessionTools: ["deck_approve", "deck_status"] },
    mcpServerSpecs: {
      deck: { command: "/usr/bin/deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: CRED } },
      serena: { command: "/usr/bin/deck", args: ["internal", "serena-mcp"], env: {} },
    },
    approvals: "relay", credentialFile: CRED, disableNativeDelegation: true,
    ...over,
  };
}

function build(over: Partial<DriverTaskInput> = {}) {
  const files = new Map<string, string>();
  const launch = buildClaudeTurnLaunch(input(over), { writePrivateFile: (name, content) => { files.set(name, content); return `/state/tasks/lead/${name}`; } }, { baseEnv: { PATH: "/bin", HOME: "/home/u" } });
  return { launch, files };
}

const valueAfter = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildClaudeTurnLaunch (XR-4.3, design 4.1)", () => {
  test("first turn: --session-id, stream-json in/out, verbose, strict MCP file, settings override, relay prompt tool", () => {
    const { launch } = build();
    const a = launch.args;
    expect(launch.command).toBe("claude");
    expect(a[0]).toBe("-p");
    expect(valueAfter(a, "--model")).toBe("opus");
    expect(valueAfter(a, "--effort")).toBe("high");
    expect(valueAfter(a, "--session-id")).toBe(SID);
    expect(a).not.toContain("--resume");
    expect(valueAfter(a, "--input-format")).toBe("stream-json");
    expect(valueAfter(a, "--output-format")).toBe("stream-json");
    expect(a).toContain("--verbose");
    expect(a).toContain("--strict-mcp-config");
    expect(valueAfter(a, "--mcp-config")).toBe("/state/tasks/lead/mcp-config.json");
    expect(valueAfter(a, "--permission-prompt-tool")).toBe(DECK_APPROVE_PROMPT_TOOL);
    expect(DECK_APPROVE_PROMPT_TOOL).toBe("mcp__deck__deck_approve");
    expect(JSON.parse(valueAfter(a, "--settings")!)).toMatchObject({ disableAllHooks: true });
    expect(valueAfter(a, "--disallowedTools")).toBe("Task,Agent");
    expect(valueAfter(a, "--append-system-prompt-file")).toBe("/state/tasks/lead/role-prompt.md");
  });

  test("later turns resume the same native session and never pass --session-id", () => {
    const { launch } = build({ resume: { nativeSessionId: SID }, nativeSessionId: undefined });
    expect(valueAfter(launch.args, "--resume")).toBe(SID);
    expect(launch.args).not.toContain("--session-id");
  });

  test("never --bare, --safe-mode or permission bypass; the interactive launch plan is not involved", () => {
    const { launch } = build();
    for (const forbidden of ["--bare", "--safe-mode", "--dangerously-skip-permissions", "--allowedTools", "--allow-dangerously-skip-permissions"]) expect(launch.args).not.toContain(forbidden);
  });

  test("MCP config holds exactly the child set; the credential is a file path in env, never a token", () => {
    const { launch, files } = build();
    const config = JSON.parse(files.get("mcp-config.json")!) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(config.mcpServers).sort()).toEqual(["deck", "serena"]);
    expect(config.mcpServers.deck!.env.DECK_SESSION_CREDENTIAL_FILE).toBe(CRED);
    expect(launch.expectedMcpServers).toEqual(["serena", "deck"]);
    expect(launch.args.join(" ")).not.toContain(CRED);
    expect(JSON.stringify(launch.env)).not.toContain(CRED);
  });

  test("an id in the child set without a launch spec is a launch error, never silently dropped", () => {
    expect(() => build({ mcp: { servers: ["deck", "ghost"], sessionTools: [] } })).toThrow(ClaudeLaunchError);
  });

  test("runner-default approvals omit the prompt tool; delegation flag off omits --disallowedTools; empty role prompt writes no file", () => {
    const { launch, files } = build({ approvals: "runner-default", disableNativeDelegation: false, rolePrompt: "" });
    expect(launch.args).not.toContain("--permission-prompt-tool");
    expect(launch.args).not.toContain("--disallowedTools");
    expect(launch.args).not.toContain("--append-system-prompt-file");
    expect(files.has("role-prompt.md")).toBe(false);
  });

  test("unknown thinking levels are ignored with a diagnostic; known ones map to --effort", () => {
    const { launch } = build({ assignment: { runnerId: "claude", modelId: "opus", thinking: "turbo" } });
    expect(launch.args).not.toContain("--effort");
    expect(launch.diagnostics).toEqual([{ code: "claude-thinking-ignored", detail: "turbo" }]);
  });

  test("unsafe model ids and session ids are refused", () => {
    expect(() => build({ assignment: { runnerId: "claude", modelId: "--bare" } })).toThrow(ClaudeLaunchError);
    expect(() => build({ assignment: { runnerId: "claude", modelId: "a\nb" } })).toThrow(ClaudeLaunchError);
    expect(() => build({ nativeSessionId: "not-a-uuid" })).toThrow(ClaudeLaunchError);
    expect(() => build({ nativeSessionId: undefined })).toThrow(ClaudeLaunchError);
    expect(() => build({ resume: { nativeSessionId: "--evil" }, nativeSessionId: undefined })).toThrow(ClaudeLaunchError);
  });

  test("env is the supplied base plus the MCP tool timeout, with no Deck secrets", () => {
    const { launch } = build();
    expect(launch.env).toMatchObject({ PATH: "/bin", HOME: "/home/u" });
    expect(Number(launch.env.MCP_TOOL_TIMEOUT)).toBeGreaterThan(15 * 60 * 1000);
    expect(Object.keys(launch.env).some((k) => /TOKEN|SECRET|CREDENTIAL/i.test(k))).toBe(false);
  });
});

describe("diagnostic extra args", () => {
  test("extraArgs (live contract script only, e.g. --tools \"\") are appended after Deck's own flags", () => {
    const files = { writePrivateFile: (n: string) => `/p/${n}` };
    const launch = buildClaudeTurnLaunch(input(), files, { baseEnv: {}, extraArgs: ["--tools", ""] });
    expect(launch.args.slice(-2)).toEqual(["--tools", ""]);
  });
});

describe("encodeUserMessage", () => {
  test("is one stream-json line", () => {
    const line = encodeUserMessage("héllo\nworld");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({ type: "user", message: { role: "user", content: "héllo\nworld" } });
  });
});
