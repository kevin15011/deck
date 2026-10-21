import { PersonalMcpPreparationError } from "@deck/core/session/personal-mcp";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildMcpServerSpec } from "@deck/core/session/driver";
import { parseJsonc } from "../model-discovery-context";
import { record } from "./mapper";

/** Read ordinary configured packages only. Authentication, plugins and brokered services are never copied. */
export function readOpenCodeSessionMcpServers(configDir: string): Record<string, ChildMcpServerSpec> {
  const servers: Record<string, ChildMcpServerSpec> = {};
  for (const filename of ["opencode.json", "opencode.jsonc"]) {
    const file = join(configDir, filename); if (!existsSync(file)) continue;
    const config = parseJsonc(readFileSync(file, "utf8"));
    if (!record(config)) throw new Error("OpenCode session MCP configuration is invalid");
    if (!record(config.mcp)) continue;
    for (const id of ["codebase-memory"]) {
      const entry = config.mcp[id]; if (entry === undefined) continue;
      if (record(entry) && entry.enabled === false) { delete servers[id]; continue; }
      if (record(entry) && entry.type === "remote") {
        if (typeof entry.url !== "string") throw new Error(`OpenCode session MCP ${id} remote URL is invalid`);
        const url = new URL(entry.url);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error(`OpenCode session MCP ${id} remote URL is invalid`);
        if (url.username || url.password || [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key)) || (record(entry.headers) && Object.keys(entry.headers).length) || entry.oauth) throw new PersonalMcpPreparationError("personal-mcp-reserved-config-conflict", [{id,source:"user",status:"conflicting",reason:"managed-name-conflict"}]);
        servers[id] = { transport: "http", url: entry.url };
        continue;
      }
      if (!record(entry) || entry.type !== "local" || !Array.isArray(entry.command) || !entry.command.length || entry.command.some((v: unknown) => typeof v !== "string" || !v)) throw new Error(`OpenCode session MCP ${id} requires an explicit local command`);
      const environment = entry.environment ?? {};
      if (!record(environment) || Object.values(environment).some(value => typeof value !== "string")) throw new Error(`OpenCode session MCP ${id} has an invalid environment`);
      if (Object.keys(environment).some(key => /token|secret|password|api.?key|authorization/i.test(key) && !/(?:_FILE|_PATH)$/.test(key))) throw new PersonalMcpPreparationError("personal-mcp-reserved-config-conflict", [{id,source:"user",status:"conflicting",reason:"managed-name-conflict"}]);
      servers[id] = { command: entry.command[0], args: entry.command.slice(1), env: { ...environment } };
    }
  }
  return servers;
}
