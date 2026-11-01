import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractCodexSupermemoryFiles, installCodexSupermemoryArtifact, CODEX_SUPERMEMORY_ROOT_NAME } from "./supermemory-artifact";
import { buildCodexMcpServers, mergeCodexMcpServers } from "./mcp-config";
import { buildCodexLaunch, codexMemoryHooks, codexThreadMcpConfig, isAdmittedCodexRoleHook } from "./session-driver/launch";
import type { DriverTaskInput } from "@deck/core/session/driver";

// Protects the official executable closure and credential-name-only config contract.
// Oracle: ADR-4 admits the complete pinned proxy, never a replacement REST facade.
test("materializes the official proxy and selects it without persisting credentials", () => {
  const files = extractCodexSupermemoryFiles(readFileSync(new URL("./__fixtures__/supermemory/codex-supermemory-1.1.0.tgz", import.meta.url)));
  expect(files.has("mcp-proxy.js")).toBe(true);
  const desired = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProxy: { nodeCommand: "/usr/bin/node", script: "/owned/official-supermemory-1.1.0-hosted-v1/mcp-proxy.js" } });
  const merged = mergeCodexMcpServers("[mcp_servers.personal]\ncommand='mine'\n", desired.servers);
  const servers = (Bun.TOML.parse(merged.content) as any).mcp_servers;
  expect(servers.supermemory?.command).toBe("/usr/bin/node");
  expect(servers.supermemory?.env_vars).toContain("SUPERMEMORY_CODEX_API_KEY");
  expect(servers.supermemory?.env).toBeUndefined();
  expect(servers["deck-memory"]).toBeUndefined();
  expect(servers.personal.command).toBe("mine");
});

// Protects process credential custody and native role authority, without a semantic tool allowlist.
test("hosted tools inherit names only; review roles retain default deny while capture remains active", () => {
  const id = "deck-session-task-supermemory";
  const nativeMemory: NonNullable<DriverTaskInput["nativeMemory"]> = { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/owned", nodeCommand: "/usr/bin/node", scripts: { recall: "/owned/recall.js", flush: "/owned/flush.js" } } };
  const input: DriverTaskInput = { taskId: "task", memberId: "apply-deep", cwd: "/work", assignment: { runnerId: "codex", modelId: "fake" }, rolePrompt: "", prompt: "", mcp: { servers: [id], sessionTools: [] }, mcpServerSpecs: { [id]: { command: "/usr/bin/node", args: ["/owned/mcp-proxy.js"], env: {} } }, approvals: "runner-default", credentialFile: "/unused", disableNativeDelegation: true, nativeMemory };
  const active = (codexThreadMcpConfig(input, ["personal"]).mcp_servers as any)[id];
  expect(active.env_vars).toContain("SUPERMEMORY_CODEX_API_KEY");
  expect(active.enabled_tools).toBeUndefined();
  expect(active.disabled_tools).toBeUndefined();
  const review = { ...input, memberId: "quality" };
  expect((codexThreadMcpConfig(review).mcp_servers as any)[id]).toBeUndefined();
  expect(Object.keys(codexMemoryHooks(review))).toEqual(["UserPromptSubmit", "Stop"]);
  const roleInput = { ...input, nativeRoleDescriptor: { runnerId: "codex", roleId: "deck-apply-deep", roleRef: "apply", generation: "fixture", source: { root: "/owned", files: {} }, instructions: "role", hooks: [{ event: "stop", command: "'/usr/bin/node' '/owned/flush.js'" }] } };
  const installed = { key: "installed", currentHash: "h", eventName: "stop", handlerType: "command", command: "'/usr/bin/node' '/owned/flush.js'", source: "user" };
  expect(isAdmittedCodexRoleHook(installed, roleInput)).toBe(false);
  expect(isAdmittedCodexRoleHook({ ...installed, source: "sessionFlags" }, roleInput)).toBe(true);
  const disabled = { ...input, nativeMemory: { ...nativeMemory, status: "disabled" as const } };
  const hook = { key: "owned", currentHash: "h", eventName: "stop", handlerType: "command", command: "'/usr/bin/node' '/owned/flush.js'", source: "user" };
  const launch = buildCodexLaunch(disabled, { baseEnv: { HOME: "/fake", SUPERMEMORY_CODEX_API_KEY: "fake-private" } }, [hook, { ...hook, key: "personal", command: "personal-hook" }]);
  expect(launch.env.SUPERMEMORY_CODEX_API_KEY).toBeUndefined();
  const hookConfig = Bun.TOML.parse(launch.args.find(arg => arg.startsWith("hooks="))!) as any;
  expect(hookConfig.hooks.state.owned.enabled).toBe(false);
  expect(hookConfig.hooks.state.personal).toBeUndefined();
  expect(launch.args.join(" ")).not.toContain("fake-private");
});

test("a stdio Supermemory registration cannot widen its credential or executable contract", () => {
  const desired = buildCodexMcpServers({ packageIds: [], memoryProvider: "supermemory", supermemoryProxy: { nodeCommand: "/usr/bin/node", script: "/owned/official-supermemory-1.1.0-hosted-v1/mcp-proxy.js" } }).servers[0]!;
  for (const mutation of [{ args: ["/foreign/proxy.js"] }, { envVars: ["OTHER_API_KEY"] }, { args: ["--eval", "arbitrary"] }]) {
    expect(mergeCodexMcpServers("", [{ ...desired, ...mutation }]).status).toBe("blocked");
  }
});

// Protects upstream module semantics and nondestructive generation upgrades.
test("the original proxy boots beneath an ESM home without modifying the previous generation", async () => {
  const home = mkdtempSync(join(tmpdir(), "deck-proxy-closure-"));
  try {
    writeFileSync(join(home, "package.json"), '{"type":"module"}');
    const old = join(home, "official-supermemory-1.1.0"); mkdirSync(old, { mode: 0o700 });
    writeFileSync(join(old, "preserved"), "older generation");
    const root = join(home, CODEX_SUPERMEMORY_ROOT_NAME);
    await installCodexSupermemoryArtifact(root, { fetchTarball: async () => readFileSync(new URL("./__fixtures__/supermemory/codex-supermemory-1.1.0.tgz", import.meta.url)) });
    const child = Bun.spawn([Bun.which("node")!, join(root, "mcp-proxy.js")], { cwd: home,
      env: { HOME: home, PATH: "/usr/bin:/bin", SUPERMEMORY_CODEX_API_KEY: "fake-fixture", SUPERMEMORY_MCP_URL: "http://127.0.0.1:1/mcp" },
      stdin: new Blob([]), stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(readFileSync(join(old, "preserved"), "utf8")).toBe("older generation");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
