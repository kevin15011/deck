import { randomBytes } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { DriverTaskInput, DriverHostIo } from "@deck/core/session/driver";

export type OpenCodeLaunchOptions = { executable?: string; baseEnv?: Readonly<Record<string, string | undefined>> };

/** Config home is private; the native data home (and its login) stays untouched. */
export function buildOpenCodeLaunch(input: DriverTaskInput, io: Pick<DriverHostIo, "writePrivateFile">, options: OpenCodeLaunchOptions = {}) {
  if (input.nativeMemory?.status === "unavailable") throw new Error("opencode-native-memory-unavailable");
  const loaderPath = input.nativeMemory?.status === "ready" ? input.nativeMemory.plugin?.loaderPath : undefined;
  if (input.nativeMemory?.status === "ready" && (!loaderPath || !isAbsolute(loaderPath) || !(input.nativeMemory.scopeMode === "global" ? input.nativeMemory.projectScope === undefined : /^sm_project_v1_[a-z0-9_]+$/.test(input.nativeMemory.projectScope ?? "")))) throw new Error("opencode-native-memory-invalid");
  const plugins = loaderPath ? [pathToFileURL(loaderPath).href] : [];
  const mcp: Record<string, unknown> = {};
  for (const id of input.mcp.servers) {
    const spec = input.mcpServerSpecs[id];
    if (!spec) throw new Error(`Missing explicit MCP launch spec: ${id}`);
    if (spec.transport === "http") {
      const headers = Object.fromEntries(Object.entries(spec.envHttpHeaders ?? {}).map(([name, variable]) => {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
          throw new Error("opencode-http-header-reference-invalid");
        return [name, "{env:" + variable + "}"];
      }));
      mcp[id] = { type: "remote", url: spec.url, enabled: true, ...(Object.keys(headers).length ? { oauth: false, headers } : {}) };
    } else mcp[id] = { type: "local", command: [spec.command, ...spec.args], environment: { ...spec.env }, enabled: true };
  }
  const config = { mcp, plugin: plugins, instructions: [], share: "disabled", autoupdate: false, permission: { "*": input.approvals === "relay" ? "ask" : "allow", ...(input.disableNativeDelegation ? { task: "deny" } : {}) } };
  const file = io.writePrivateFile("opencode.json", JSON.stringify(config));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv ?? process.env)) {
    if (value !== undefined && !key.startsWith("OPENCODE_")) env[key] = value;
  }
  Object.assign(env, {
    XDG_CONFIG_HOME: dirname(file), OPENCODE_CONFIG_DIR: dirname(file), OPENCODE_CONFIG: file,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("hex"), OPENCODE_SERVER_USERNAME: "opencode",
  });
  if (input.nativeMemory?.scopeMode === "global") for (const key of Object.keys(env)) if (/^SUPERMEMORY_/i.test(key) || /^DECK_MEMORY_/i.test(key)) delete env[key];
  return { command: options.executable ?? "opencode", args: ["serve", ...(plugins.length ? [] : ["--pure"]), "--hostname", "127.0.0.1", "--port", "0"], env, expectedMcpServers: [...input.mcp.servers], expectedPlugins: plugins };
}
