import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PersonalMcpPreparationError, type PersonalMcpAvailability } from "@deck/core/session/personal-mcp";

const record = (v: unknown): Record<string, any> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
function read(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  try { return record(JSON.parse(readFileSync(file, "utf8"))); }
  catch { throw new PersonalMcpPreparationError("claude-native-configuration-invalid", [{id:"configuration",source:"native",status:"unavailable",reason:"unreadable"}]); }
}

/** Read native consent without changing trust or executing project content. */
export function claudeProjectConfigTrusted(home: string, cwd: string, env: Readonly<Record<string, string | undefined>>): boolean {
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const user = read(env.CLAUDE_CONFIG_DIR ? join(configDir, ".claude.json") : join(home, ".claude.json"));
  return record(record(user.projects)[resolve(cwd)]).hasTrustDialogAccepted === true;
}

/** Only trust, prior project approvals and protected-name collisions are inspected here.
 * The native loader owns declarations, plugins, interpolation, credentials and transports. */
export function claudeNativePolicy(home: string, cwd: string, env: Readonly<Record<string, string | undefined>>) {
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const user = read(env.CLAUDE_CONFIG_DIR ? join(configDir, ".claude.json") : join(home, ".claude.json"));
  const project = record(record(user.projects)[resolve(cwd)]);
  const trusted = claudeProjectConfigTrusted(home, cwd, env);
  const sources = trusted ? "user,project,local" : "user";
  const settings = [read(join(configDir, "settings.json")), ...(trusted ? [read(join(cwd, ".claude", "settings.json")), read(join(cwd, ".claude", "settings.local.json"))] : [])];
  const local = record(project.mcpServers);
  const declarations = [record(user.mcpServers), local, ...(trusted ? [record(read(join(cwd, ".mcp.json")).mcpServers)] : [])];
  if (declarations.some(servers => Object.hasOwn(servers, "deck"))) throw new PersonalMcpPreparationError("claude-native-mcp-conflict", [{ id: "deck", source: "native", status: "conflicting", reason: "managed-name-conflict" }]);
  const disabledLocal = new Set<string>((Array.isArray(project.disabledMcpServers) ? project.disabledMcpServers : []).filter((id:unknown): id is string => typeof id === "string"));
  const denied = new Set<string>(disabledLocal);
  if (trusted) {
    const approvalSources = [project, ...settings];
    const enabled = new Set(approvalSources.flatMap(s => Array.isArray(s.enabledMcpjsonServers) ? s.enabledMcpjsonServers : []));
    const disabled = new Set(approvalSources.flatMap(s => Array.isArray(s.disabledMcpjsonServers) ? s.disabledMcpjsonServers : []));
    const all = approvalSources.reduce((enabled, source) => typeof source.enableAllProjectMcpServers === "boolean" ? source.enableAllProjectMcpServers : enabled, false);
    for (const id of Object.keys(record(read(join(cwd, ".mcp.json")).mcpServers))) if (disabled.has(id) || !all && !enabled.has(id)) denied.add(id);
  }
  const availability: PersonalMcpAvailability[] = [...denied].map(id => ({id,source:disabledLocal.has(id) ? "local" : "project",status:"unavailable",reason:disabledLocal.has(id) ? "disabled" : "project-untrusted"}));
  for (const id of Object.keys(local)) if (!disabledLocal.has(id)) availability.push({id,source:"local",status:"configured"});
  if (!trusted && [".mcp.json", ".claude/settings.json", ".claude/settings.local.json"].some(path => existsSync(join(cwd, path)))) availability.push({id:"project-configuration",source:"project",status:"unavailable",reason:"project-untrusted"});
  // Native source selection ties home-owned local MCPs to executable project-local
  // settings. In an untrusted workspace, relay only these explicit user records,
  // unchanged, through the existing private MCP file. OAuth names/URLs stay native.
  return { sources, denied: [...denied], availability, userMcpIds: [...new Set([...Object.keys(record(user.mcpServers)), ...Object.keys(local)])], localServers: trusted ? {} : Object.fromEntries(Object.entries(local).filter(([id]) => !disabledLocal.has(id))) };
}
