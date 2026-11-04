import { readFileSync } from "node:fs";
import { preparationCapabilities } from "./preparation-capabilities";
import { issueCodebaseAvailability } from "@deck/core/session/codebase-availability";
import { validateClaudeSessionIntent } from "../../../packages/adapter-claude/src/session-skills";
import { assertSessionCapabilityOverrides } from "@deck/core/session/role-tool-policy";
import { isCodebaseMemoryEnabled, nativeSearchEvidence, resolveWebSearchLaunch } from "@deck/core";
import { type PersonalMcpAvailability } from "@deck/core/session/personal-mcp";
import type { CapabilityAvailability } from "@deck/core/session/mcp";
/** Shared provider composition; credentials remain in host memory and spawn environment only. */
import type { NormalizedDeckConfig, RunnerAdapter } from "@deck/core";
import type { ChildMcpServerSpec } from "@deck/core/session/driver";
import type { ChildMcpContext, ChildMcpResolver } from "@deck/session-host";
import { SessionCodebaseReadinessError, type SessionCodebaseReadiness } from "./session-codebase-readiness";
import { getWebSearchProviderDescriptor } from "./web-search-provider";

export async function resolveSessionChildMcp(
  adapter: RunnerAdapter | undefined,
  config: NormalizedDeckConfig,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  managed?: { readiness: SessionCodebaseReadiness; context: ChildMcpContext; nativeSkills?: import("@deck/core/session/driver").NativeSkillsDescriptor },
): Promise<ChildMcpResolver> {
  const step = (name: Parameters<NonNullable<ChildMcpContext["preparationStep"]>>[0]) => {
    try { managed?.context.preparationStep?.(name); } catch { /* Observation must not change preparation or cleanup. */ }
  };
  step("native-mcp-config");
  const nativeSelection = adapter?.runnerId === "claude" && managed?.nativeSkills
    ? JSON.parse(readFileSync(managed.nativeSkills.selectionPath, "utf8")) : undefined;
  const configured = nativeSelection && !nativeSelection.capabilities?.includes("codebase-memory")
    ? {} : { ...await adapter?.readSessionCapabilityOverrides?.(config) };
  // Deck participation follows new explicit intent. Independent native integrations stay in the native loader.
  if (!isCodebaseMemoryEnabled(config, adapter?.runnerId ?? "")) delete configured["codebase-memory"];
  assertSessionCapabilityOverrides(Object.keys(configured));
  step("capability-policy");
  // Ordinary servers, skills and plugins stay in the native loader. Only Codebase
  // needs a task binding prepared by the managed recovery service.
  const servers: Record<string, ChildMcpServerSpec> = configured;
  const suppressedMcpServers: string[] = [];
  let codebaseAvailability: ChildMcpResolver["codebaseAvailability"];
  // Claude persists an explicit trusted selection. Codex and OpenCode use the global web
  // policy in their native install plans; their absent optional selection seam is intentional.
  const enabled = config.webSearch.enabled;
  let envOverlay: Record<string, string> | undefined;
  let webSearch: ChildMcpResolver["webSearch"] = { enabled: false };
  const nativeSearch = enabled ? await adapter?.inspectNativeSearch?.({ projectRoot: managed?.context.projectRoot ?? process.cwd(),
    modelId: managed?.context.modelId, providerId: managed?.context.providerId, runnerVersion: managed?.context.runnerVersion,
    projectConfigTrusted: managed?.context.projectConfigTrusted, environment,
  }) ?? nativeSearchEvidence("unknown", "effective-config", { runner: adapter?.runnerId }, "native-search-detector-unavailable")
    : nativeSearchEvidence("unknown", "effective-config", { runner: adapter?.runnerId }, "web-search-disabled");
  const provider = enabled ? getWebSearchProviderDescriptor(config.webSearch.provider) : undefined;
  const credential = provider ? environment[provider.credentialEnvVar]?.trim() : undefined;
  let selection: ReturnType<typeof resolveWebSearchLaunch>;
  try { selection = resolveWebSearchLaunch(enabled, nativeSearch, !!provider && !!credential); }
  catch (error) {
    if (adapter?.runnerId !== "claude") throw error;
    selection = { route: "disabled", diagnostics: ["web-search-fallback-unavailable"] };
    if (managed?.nativeSkills) managed.nativeSkills.preparation = [...managed.nativeSkills.preparation ?? [], {
      kind: "W", code: "claude-optional-unavailable", item: "web-search", message: "Search fallback is unavailable. Ordinary work can continue; configure its provider and credential to use it.",
    }];
  }
  const searchDiagnostics = [...selection.diagnostics];
  suppressedMcpServers.push(...(enabled ? nativeSearch.ownedFallbackServerIds ?? [] :
    await adapter?.readOwnedSearchFallbackIds?.({ projectRoot: managed?.context.projectRoot ?? process.cwd(),
      projectConfigTrusted: managed?.context.projectConfigTrusted, environment }) ?? []));
  if (nativeSearch.unresolvedFallbackServerIds?.length) searchDiagnostics.push("web-search-unresolved-existing-route-preserved");
  if (selection.route !== "fallback") delete servers["web-search"];
  if (selection.route === "fallback" && provider && credential) {
    const [command, ...args] = provider.command;
    servers[provider.semanticServerId] = { command, args, env: {} };
    envOverlay = { ...envOverlay, [provider.credentialEnvVar]: credential };
    webSearch = { enabled: true, serverId: provider.semanticServerId };
  }
  const capabilityAvailability: CapabilityAvailability[] = [];
  const personalMcpAvailability: PersonalMcpAvailability[] = [];
  let release: (() => Promise<void>) | undefined;
  let releases: Array<() => Promise<void>> = [];
  let releasing: Promise<void> | undefined;
  const releaseResources = () => releasing ??= (async () => {
    const pending = releases;
    const results = await Promise.allSettled(pending.map(close => Promise.resolve().then(close)));
    releases = pending.filter((_, index) => results[index]?.status === "rejected");
    if (releases.length) throw new Error("session-resource-release-failed");
  })().finally(() => { releasing = undefined; });
  try {
    const codebase = servers["codebase-memory"];
    if (managed) {
      if (!codebase) capabilityAvailability.push(managed.nativeSkills?.preparation?.some(finding => finding.code === "claude-optional-unavailable" && finding.item === "codebase-memory")
        ? { capabilityId: "codebase-memory", status: "unavailable", reasonCode: "codebase-memory-unavailable" }
        : { capabilityId: "codebase-memory", status: "unselected" });
      else {
        try {
          step("codebase-readiness");
          if (codebase.transport === "http") throw new SessionCodebaseReadinessError("unsupported");
          const prepared = await managed.readiness.ensure(codebase, managed.context, envOverlay);
          servers["codebase-memory"] = prepared;
          releases.push(() => managed.readiness.release(prepared));
          capabilityAvailability.push({ capabilityId: "codebase-memory", status: "ready" });
        } catch (error) {
          if (managed.context.signal.aborted || !(error instanceof SessionCodebaseReadinessError) || error.kind === "cancelled") throw error;
          if (adapter?.runnerId === "claude") {
            if (!managed.nativeSkills) throw new Error("claude-mcp-override-unpaired: verified generation required");
            validateClaudeSessionIntent(managed.nativeSkills, config);
            codebaseAvailability = issueCodebaseAvailability({ skills: managed.nativeSkills, projectRoot: managed.context.projectRoot,
              invocationId: managed.context.taskId, route: "managed", reason: error.kind, signal: managed.context.signal });
          } else suppressedMcpServers.push("codebase-memory");
          delete servers["codebase-memory"];
          capabilityAvailability.push({ capabilityId: "codebase-memory", status: "unavailable", reasonCode: `codebase-memory-${error.kind}` });
        }
      }
    }
    if (releases.length) {
      release = releaseResources;
    }
  } catch (error) {
    step("cleanup");
    await Promise.allSettled(releases.map(close => Promise.resolve().then(close)));
    throw error;
  }

  const preparedCapabilities = preparationCapabilities(config, adapter?.runnerId ?? "");
  const observations = { ...preparedCapabilities };
  // Codebase evidence is owned by the host's current availability binding.
  delete observations["codebase-memory"];
  delete observations.rtk; // Fresh adapter prerequisite metadata belongs to the scope coordinator.
  if (observations["web-search"]?.enabled) observations["web-search"] = { ...observations["web-search"],
    route: selection.route,
    availability: selection.route === "native" || selection.route === "fallback" ? "ready" : "unavailable",
    inputDigest: JSON.stringify([selection.route, managed?.context.modelId, managed?.context.providerId, searchDiagnostics]),
  };
  return {
    preparationInputs: preparedCapabilities,
    preparationCapabilities: observations,
    ...(managed ? { capabilityAvailability, personalMcpAvailability, suppressedMcpServers, codebaseAvailability } : {}),
    runnerPackages: () => Object.keys(servers), webSearch, searchDiagnostics,
    ...(envOverlay ? { envOverlay } : {}), resolveServer: (id) => servers[id],
    ...(release ? { release } : {}),
  };
}
