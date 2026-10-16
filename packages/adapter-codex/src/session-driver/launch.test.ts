import { expect, test } from "bun:test";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { parseTOML } from "toml-eslint-parser";
import { buildCodexLaunch, ISOLATION_FEATURES, verifyCodexConfig } from "./launch";
const input: DriverTaskInput = {
  taskId: "t", memberId: "lead", cwd: "/work", assignment: { runnerId: "codex", modelId: "gpt-5" },
  rolePrompt: "", prompt: "", mcp: { servers: ["context.7"], sessionTools: [] },
  mcpServerSpecs: { "context.7": { transport: "http", url: "https://mcp.context7.com/mcp" } },
  approvals: "runner-default", credentialFile: "/private/credential", disableNativeDelegation: true,
};
const features = Object.fromEntries(ISOLATION_FEATURES.map((f) => [f, false]));
test("HTTP launch uses valid inline TOML with literal arbitrary server and plugin IDs", () => {
  const launch = buildCodexLaunch(input, ["foreign.dotted"], {}, ["plugin@source.with.dots"]);
  for (const arg of launch.args.filter((arg) => arg.startsWith("mcp_servers=") || arg.startsWith("plugins="))) expect(() => parseTOML(arg)).not.toThrow();
  expect(launch.args.find((arg) => arg.startsWith("mcp_servers="))).toContain('"foreign.dotted"={"enabled"=false}');
  expect(launch.args.find((arg) => arg.startsWith("plugins="))).toContain('"plugin@source.with.dots"={"enabled"=false}');
  expect(() => verifyCodexConfig({ features, mcp_servers: { "context.7": { url: "https://mcp.context7.com/mcp" } } }, input)).not.toThrow();
});
test("rejects inherited HTTP credentials and transport fields without emitting values", () => {
  for (const inherited of [{ http_headers: { Authorization: "SENTINEL" } }, { bearer_token_env_var: "API_KEY" }, { command: "/foreign" }, { env: { API_KEY: "SENTINEL" } }]) {
    expect(() => verifyCodexConfig({ features, mcp_servers: { "context.7": { url: "https://mcp.context7.com/mcp", ...inherited } } }, input)).toThrow("codex-mcp-spec-isolation-violation");
  }
});
const nativeMemory: NonNullable<DriverTaskInput["nativeMemory"]> = { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/plugins/supermemory", nodeCommand: "/usr/bin/node", scripts: { recall: "/plugins/supermemory/recall.js", flush: "/plugins/supermemory/flush.js" } } };
test("admits only official memory hooks and clears every inherited event without enabling native plugins", () => {
  const launch = buildCodexLaunch({ ...input, nativeMemory }, [], { baseEnv: {} });
  expect(launch.args).toContain("features.hooks=true");
  expect(launch.args).toContain("features.plugins=false");
  const hooks = launch.args.find(arg => arg.startsWith("hooks="))!;
  expect(() => parseTOML(hooks)).not.toThrow();
  expect(hooks).toContain('"SessionStart"=[]');
  expect(hooks).toContain("/plugins/supermemory/recall.js");
  expect(hooks).toContain("/plugins/supermemory/flush.js");
  expect(hooks).not.toContain("bypass");
});
test("does not silently launch configured but unavailable or incomplete native memory", () => {
  expect(() => buildCodexLaunch({ ...input, nativeMemory: { ...nativeMemory, status: "unavailable" } }, [], { baseEnv: {} })).toThrow("codex-native-memory-unavailable");
  expect(() => buildCodexLaunch({ ...input, nativeMemory: { ...nativeMemory, plugin: undefined } }, [], { baseEnv: {} })).toThrow("codex-native-memory-invalid");
});

test("global memory explicitly admits native hooks while dropping inherited provider selectors and credentials", () => {
  const global = { ...nativeMemory, scopeMode: "global" as const, projectScope: undefined };
  const launch = buildCodexLaunch({ ...input, nativeMemory: global }, [], { baseEnv: { HOME: "/user", SUPERMEMORY_API_KEY: "real-key", SUPERMEMORY_REPO_TAG: "foreign", SUPERMEMORY_API_URL: "https://foreign", DECK_MEMORY_CONTAINER: "foreign" } });
  expect(launch.args).toContain("features.hooks=true");
  expect(launch.env).toEqual({ HOME: "/user" });
  expect(() => buildCodexLaunch({ ...input, nativeMemory: { ...global, scopeMode: undefined } }, [])).toThrow("codex-native-memory-invalid");
  expect(() => buildCodexLaunch({ ...input, nativeMemory: { ...global, projectScope: nativeMemory.projectScope } }, [])).toThrow("codex-native-memory-invalid");
});

test("enables experimental default-mode questions for all supervised launches", () => {
  for (const approvals of ["relay", "runner-default"] as const) {
    expect(buildCodexLaunch({ ...input, approvals }, []).args).toContain("features.default_mode_request_user_input=true");
  }
});
