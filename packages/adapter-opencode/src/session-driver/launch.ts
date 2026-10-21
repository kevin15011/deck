import { PersonalMcpPreparationError } from "@deck/core/session/personal-mcp";
import { assertOpenCodeControlName, assertOpenCodeProjectConfigAdmission, openCodeProjectConfigDisabled } from "../personal-mcp";
import { randomBytes } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {existsSync} from "node:fs";
import { pathToFileURL } from "node:url";
import type { DriverTaskInput, DriverHostIo } from "@deck/core/session/driver";
import { parseJsonc } from "../model-discovery-context";

export type OpenCodeLaunchOptions = { executable?: string; baseEnv?: Readonly<Record<string, string | undefined>> };

/** Native user/global sources retain their paths and identity. Only Deck fields are added. */
export function buildOpenCodeLaunch(input: DriverTaskInput, io: Pick<DriverHostIo, "writePrivateFile">, options: OpenCodeLaunchOptions = {}) {
  if (input.nativeMemory?.status === "unavailable") throw new Error("opencode-native-memory-unavailable");
  const loader = input.nativeMemory?.status === "ready" ? input.nativeMemory.plugin?.loaderPath : undefined;
  if (input.nativeMemory?.status === "ready" && (!loader || !isAbsolute(loader) || !(input.nativeMemory.scopeMode === "global" ? input.nativeMemory.projectScope === undefined : /^sm_project_v1_[a-z0-9_]+$/.test(input.nativeMemory.projectScope ?? "")))) throw new Error("opencode-native-memory-invalid");
  const plugins = loader ? [pathToFileURL(loader).href] : [];
  const base = options.baseEnv ?? process.env;
  const projectDisabled = !input.projectConfigTrusted || openCodeProjectConfigDisabled(base);
  const flag = (name: string) => ["true","1"].includes(base[name]?.toLowerCase() ?? "");
  // The native external-skill scan ignores DISABLE_PROJECT_CONFIG and has no
  // project-only switch. Keep its native parser and paths; gate that scan and
  // re-admit only the user's automatic global roots via a small Deck config hook.
  const globalSkillPaths = projectDisabled && !flag("OPENCODE_DISABLE_EXTERNAL_SKILLS") && base.HOME
    ? [...(!flag("OPENCODE_DISABLE_CLAUDE_CODE") && !flag("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS") ? [join(base.HOME,".claude","skills")] : []),join(base.HOME,".agents","skills")].filter(existsSync) : [];
  if (globalSkillPaths.length) {
    const path = io.writePrivateFile("opencode-global-skills.mjs", `export default async()=>({config:async(config)=>{config.skills={...config.skills,paths:[...new Set([...${JSON.stringify(globalSkillPaths)},...(config.skills?.paths??[])])]};}});`);
    plugins.push(pathToFileURL(path).href);
  }
  assertOpenCodeProjectConfigAdmission(input.cwd,base,input.projectConfigTrusted === true);
  assertOpenCodeControlName(base.HOME ?? "", input.cwd, base, input.projectConfigTrusted === true);
  const mcp: Record<string, unknown> = Object.fromEntries((input.suppressedMcpServers ?? []).map(id => [id, { enabled: false }]));
  for (const id of input.mcp.servers) {
    const spec = input.mcpServerSpecs[id];
    if (!spec) throw new Error(`Missing explicit MCP launch spec: ${id}`);
    if (spec.transport === "http") {
      const headers = Object.fromEntries(Object.entries(spec.envHttpHeaders ?? {}).map(([name, variable]) => {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) throw new Error("opencode-http-header-reference-invalid");
        return [name, "{env:" + variable + "}"];
      }));
      mcp[id] = { type: "remote", url: spec.url, enabled: true, ...(Object.keys(headers).length ? { oauth: false, headers } : {}) };
    } else mcp[id] = { type: "local", command: [spec.command, ...spec.args], environment: { ...spec.env }, enabled: true };
  }
  let inherited: unknown;
  try { inherited = base.OPENCODE_CONFIG_CONTENT ? parseJsonc(base.OPENCODE_CONFIG_CONTENT) : {}; }
  catch { throw new PersonalMcpPreparationError("opencode-native-configuration-invalid", [{id:"configuration",source:"native",status:"unavailable",reason:"unreadable"}]); }
  if (!inherited || typeof inherited !== "object" || Array.isArray(inherited)) throw new Error("opencode-native-configuration-invalid");
  const native = inherited as Record<string, any>;
  if (native.mcp?.deck) throw new PersonalMcpPreparationError("opencode-native-mcp-conflict", [{id:"deck",source:"native",status:"conflicting",reason:"managed-name-conflict"}]);
  const config = { ...native, mcp: { ...native.mcp, ...mcp }, ...(plugins.length ? { plugin: [...new Set([...(Array.isArray(native.plugin) ? native.plugin : []), ...plugins])] } : {}), share: "disabled", autoupdate: false };
  io.writePrivateFile("opencode.json", JSON.stringify(config));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (typeof value === "string") env[key] = value;
  Object.assign(env, {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    // A project grant admits native loading; explicit user disabling still wins.
    ...(!input.projectConfigTrusted ? {OPENCODE_DISABLE_PROJECT_CONFIG: "true"} : {}),
    ...(projectDisabled ? {OPENCODE_DISABLE_EXTERNAL_SKILLS:"true"} : {}),
    OPENCODE_SERVER_PASSWORD: randomBytes(32).toString("hex"), OPENCODE_SERVER_USERNAME: "opencode",
  });
  if (input.nativeMemory?.scopeMode === "global") for (const key of Object.keys(env)) if (/^SUPERMEMORY_/i.test(key) || /^DECK_MEMORY_/i.test(key)) delete env[key];
  const expectedMcpSpecs = Object.fromEntries(input.mcp.servers.map(id => {
    const value = mcp[id] as Record<string, any>;
    return [id, value.headers ? { ...value, headers: Object.fromEntries(Object.entries(value.headers).map(([name, reference]) => [name, env[String(reference).slice(5, -1)] ?? ""])) } : value];
  }));
  return { command: options.executable ?? "opencode", args: ["serve", "--hostname", "127.0.0.1", "--port", "0"], env, expectedMcpServers: [...input.mcp.servers], expectedMcpSpecs, expectedPlugins: plugins, expectedGlobalSkillPaths:globalSkillPaths };
}

/** Compare only protected Deck declarations; unrelated native additions remain native. */
export function conflictingOpenCodeMcp(config: unknown, launch: Pick<ReturnType<typeof buildOpenCodeLaunch>, "expectedMcpSpecs">, suppressed: readonly string[] = []): string[] {
  const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  const actual = record(record(config).mcp);
  return [...Object.entries(launch.expectedMcpSpecs).filter(([id, expected]) => JSON.stringify(canonical(actual[id])) !== JSON.stringify(canonical(expected))).map(([id]) => id), ...suppressed.filter(id => actual[id]?.enabled !== false)];
}
