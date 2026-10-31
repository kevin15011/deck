import { readExplicitPiCapabilities } from "../shared/explicit-capabilities";
import { hasRunnerContributionProof } from "../../../../core/src/runner-contributions";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { isReservedPersonalMcp, type PersonalMcpAvailability } from "@deck/core/session/personal-mcp";
import { DECK_PI_MCP_SERVER_IDS } from "../../pi-mcp-catalog";
import { personalPiToolNames } from "../pi-personal-mcp";
import { isReadOnlyRole } from "../shared/roles";
import type { ExtensionAPI, ExtensionContext, LoadedMcpConfig } from "@earendil-works/pi-coding-agent";
import { classifyNativeCodebase, nativeCodebaseFailureCode, nativeCodebaseProtectedDiagnostic, readNativeCodebaseSelection } from "../../pi-native-codebase-readiness";
import { hashJsonValue } from "../../pi-manifest";
import { loadMcpConfig } from "./native-config.pinned";

type NativeShell = Pick<typeof import("@earendil-works/pi-coding-agent"), "getAgentDir" | "createMcpExtension">;
export type NativeCodebaseStatus = "ready" | "unavailable" | "custom" | "blocked";
const codebaseName = (name: string) => name.replaceAll("-", "_") === "codebase_memory";

/** After startup a fault is retained as a tool-level block, never thrown out of the reload factory. */
export function createReviewedPiMcp(input: { agentDir: string; compatible?: (command: string) => boolean }) {
  let registeredAvailability: PersonalMcpAvailability[] = [];
  const reserved = (name: string) => isReservedPersonalMcp(name) && !DECK_PI_MCP_SERVER_IDS.includes(name as typeof DECK_PI_MCP_SERVER_IDS[number]);
  let personalAvailability: PersonalMcpAvailability[] = [];
  let selected: LoadedMcpConfig["servers"][number] | undefined;
  let status: NativeCodebaseStatus = "unavailable";
  let rejectedOwned = false;
  let failure: { error: unknown } | undefined;
  function inspect(ctx: ExtensionContext): LoadedMcpConfig {
    ctx.signal?.throwIfAborted();
    const loaded: LoadedMcpConfig = loadMcpConfig({ agentDir: input.agentDir, cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
    selected = loaded.servers.find(server => server.name === "codebase-memory");
    try {
      if (loaded.errors.length) throw new Error("pi-codebase-configuration-invalid");
      const result = classifyNativeCodebase({ ...input, compatible: readExplicitPiCapabilities().codebase ? input.compatible : () => false, entry: loaded.servers.find(server => server.name === "codebase-memory") ?? null, signal: ctx.signal });
      status = result.status;
      failure = undefined;
      rejectedOwned = result.owned && result.status === "unavailable";
    } catch (error) {
      failure = { error };
      status = "blocked";
      rejectedOwned = true;
      if (ctx.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    }
    personalAvailability = loaded.servers.filter(server => !DECK_PI_MCP_SERVER_IDS.includes(server.name as typeof DECK_PI_MCP_SERVER_IDS[number])).map(server => ({
      id: server.name, source: server.scope === "project" ? "project" : "user", status: reserved(server.name) ? "conflicting" : server.config.enabled === false ? "unavailable" : "configured",
      ...(reserved(server.name) ? { reason: "reserved" as const } : server.config.enabled === false ? { reason: "disabled" as const } : {}),
    }));
    ctx.ui?.setStatus?.("deck-personal-mcp", personalAvailability.length ? `MCP: ${personalAvailability.map(item => `${item.id} ${item.status}`).join(" · ")}` : undefined);
    return { ...loaded, servers: loaded.servers.filter(server => !(rejectedOwned && codebaseName(server.name)) && !reserved(server.name)) };
  }
  return {
    personalAvailability: () => [...personalAvailability,...registeredAvailability],
    filterPersonalRegistrations<T extends {name:string}>(servers: T[]): T[] {
      registeredAvailability = servers.filter(server => !DECK_PI_MCP_SERVER_IDS.includes(server.name as typeof DECK_PI_MCP_SERVER_IDS[number])).map(server => ({id:server.name,source:"plugin",status:reserved(server.name) ? "conflicting" : "configured",...(reserved(server.name) ? {reason:"reserved" as const} : {})}));
      return servers.filter(server=>!reserved(server.name));
    },
    /** Called only by the native connector when it registers tools after connection/list refresh. */
    directRegistration(): "ready" | "unavailable" | "custom" {
      if (status === "custom" || !selected || selected.scope !== "global" || !("args" in selected.config) || !selected.config.args?.includes("codebase-mcp-guard-v1")) return "custom";
      try {
        const current = readNativeCodebaseSelection(input.agentDir);
        const result = classifyNativeCodebase({ ...input, compatible: readExplicitPiCapabilities().codebase ? input.compatible : () => false, entry: current });
        if (!current || hashJsonValue(current.config) !== hashJsonValue(selected.config) || !result.owned || !result.guarded || result.status !== "ready") return "unavailable";
        return "ready";
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        throw new Error(nativeCodebaseFailureCode(error));
      }
    },
    status: () => status,
    rejectsOwnedRegistration: () => rejectedOwned,
    loadConfig: inspect,
    protectedDiagnostic(ctx: ExtensionContext): string | undefined {
      inspect(ctx);
      return failure ? nativeCodebaseProtectedDiagnostic(failure.error) : undefined;
    },
    toolBlock(ctx: ExtensionContext): string | undefined {
      inspect(ctx);
      if (!readExplicitPiCapabilities().codebase && status !== "custom") return "Codebase Memory is disabled for this execution.";
      if (failure) return nativeCodebaseProtectedDiagnostic(failure.error);
      return status === "unavailable" ? "Codebase Memory is unavailable for this execution. Use file search and focused reads." : undefined;
    },
  };
}

export function installReviewedPiMcp(pi: ExtensionAPI, native: NativeShell, options: { compatible?: (command: string) => boolean } = {}) {
  const reviewed = createReviewedPiMcp({ agentDir: native.getAgentDir(), ...options });
  const deactivatedSearch = new Set<string>();
  const observedSearchBindings = new Set<string>();
  const prepareSearch = (_event: unknown, ctx: ExtensionContext) => {
    const selection = readExplicitPiCapabilities();
    const agentDir = native.getAgentDir();
    const ownsFallback = hasRunnerContributionProof(join(agentDir, "deck/manifest.json"), { path: join(agentDir, "mcp.json"), selector: { kind: "json", keys: ["mcpServers", "web-search"] } });
    const active = pi.getActiveTools();
    const toolsIndex = process.argv.findIndex(arg => arg === "--tools");
    let allowedTools: string[] | undefined = toolsIndex >= 0 ? (process.argv[toolsIndex + 1] ?? "").split(/[, ]+/) : undefined;
    try {
      const defaults = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).defaultTools;
      if (!allowedTools && Array.isArray(defaults)) allowedTools = defaults;
    } catch { /* No configured tool restriction. */ }
    const inventory = pi.getAllTools();
    const nativeSearch = active.some(name => (name === "web_search" || name === "websearch") && inventory.some(tool => tool.name === name && (tool.parameters as { properties?: Record<string, unknown> }).properties?.query));
    const fallback = pi.getAllTools().filter(tool => tool.name.startsWith("mcp__web_search__")).map(tool => tool.name);
    if (ownsFallback) {
      if (!selection.search || nativeSearch) {
        for (const name of fallback.filter(name => active.includes(name))) deactivatedSearch.add(name);
        pi.setActiveTools(active.filter(name => !fallback.includes(name)));
      }
      else {
        if (selection.provider !== "tavily" || !process.env.TAVILY_API_KEY?.trim()) throw new Error("web-search-fallback-unavailable: configure the selected provider credential");
        if (!fallback.length) throw new Error("web-search-fallback-unavailable: configured connector is not loaded");
        // Restore only exposure Deck itself suppressed; never override an independent tool allowlist.
        const additions = fallback.filter(name => (!allowedTools || allowedTools.includes(name)) && (deactivatedSearch.has(name) || !observedSearchBindings.has(name)));
        pi.setActiveTools([...new Set([...active, ...additions])]);
        for (const name of [...fallback.filter(name => active.includes(name)), ...additions]) observedSearchBindings.add(name);
        deactivatedSearch.clear();
        if (!pi.getActiveTools().some(name => fallback.includes(name))) throw new Error("web-search-fallback-excluded-by-tool-policy");
      }
    } else if (selection.search && !nativeSearch && !fallback.length) throw new Error("web-search-fallback-unavailable: review the configured Deck provider");
    ctx.ui?.setStatus?.("deck-web-search", !selection.search ? undefined : nativeSearch ? "Search: native" : "Search: configured fallback");
    if (selection.search && _event && typeof _event === "object" && "systemPrompt" in _event && typeof _event.systemPrompt === "string") return { systemPrompt: `${_event.systemPrompt}\n\nSearch selection for this turn: ${nativeSearch ? "Use the currently exposed native search tool; Deck fallback tools are suppressed." : "Use the currently exposed configured search provider."}` };
  };
  native.createMcpExtension({ loadConfig: reviewed.loadConfig })(new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") return (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => {
        if (!tool.name.startsWith("mcp__codebase_memory__") || tool.exposure !== "direct") {
          const registered = target.registerTool(tool);
          // CLI loadouts were fixed before MCP connection; add personal declarations on native refresh.
          // Execution remains subject to the existing read-only role policy (unknown tools are denied).
          if (isReadOnlyRole(process.env.DECK_PI_ROLE) && personalPiToolNames([tool]).length) target.setActiveTools([...target.getActiveTools(), tool.name]);
          return registered;
        }
        const readiness = reviewed.directRegistration();
        target.registerTool(readiness === "unavailable" ? { ...tool, exposure: "hidden" } : tool);
        // A fresh native registration proves connection, while the classifier proves the reviewed owned build.
        // Never restore merely from old tool names or seize personal/project tools.
        if (readiness === "ready" && !target.getActiveTools().includes(tool.name)) target.setActiveTools([...target.getActiveTools(), tool.name]);
      };
      if (property !== "getMcpServers") return Reflect.get(target, property, receiver);
      return () => reviewed.filterPersonalRegistrations(target.getMcpServers()).filter(server => !reviewed.rejectsOwnedRegistration() || !codebaseName(server.name));
    },
  }));
  // The native connector's first-prompt hook awaits direct tool registration. Inspect only after
  // that barrier, and after its turn hook refreshes sign-ins, so a starting connector is not absent.
  pi.on("before_agent_start", prepareSearch);
  pi.on("turn_start", (event, ctx) => { prepareSearch(event, ctx); });
  return {
    ...reviewed,
    status: (): NativeCodebaseStatus => reviewed.status() === "unavailable" && !reviewed.rejectsOwnedRegistration() &&
      pi.getMcpServers().some(server => codebaseName(server.name)) ? "custom" : reviewed.status(),
  };
}
