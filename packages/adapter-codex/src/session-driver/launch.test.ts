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
