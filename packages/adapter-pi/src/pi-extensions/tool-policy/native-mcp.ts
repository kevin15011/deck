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
      const result = classifyNativeCodebase({ ...input, entry: loaded.servers.find(server => server.name === "codebase-memory") ?? null, signal: ctx.signal });
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
        const result = classifyNativeCodebase({ ...input, entry: current });
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
      if (failure) return nativeCodebaseProtectedDiagnostic(failure.error);
      return status === "unavailable" ? "Codebase Memory is unavailable for this execution. Use file search and focused reads." : undefined;
    },
  };
}

export function installReviewedPiMcp(pi: ExtensionAPI, native: NativeShell, options: { compatible?: (command: string) => boolean } = {}) {
  const reviewed = createReviewedPiMcp({ agentDir: native.getAgentDir(), ...options });
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
  return {
    ...reviewed,
    status: (): NativeCodebaseStatus => reviewed.status() === "unavailable" && !reviewed.rejectsOwnedRegistration() &&
      pi.getMcpServers().some(server => codebaseName(server.name)) ? "custom" : reviewed.status(),
  };
}
