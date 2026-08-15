import React from "react";
import { Box, Text } from "ink";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { PI_THINKING_LEVELS, supportsDeveloperTeamModel, supportsThinkingForModel } from "@deck/adapter-pi";
import { OPENCODE_THINKING_LEVELS } from "@deck/adapter-opencode";
import type { CapabilityStatus, PiModel, PiProvider, PiThinkingLevel } from "@deck/adapter-pi";
import type { OpenCodeThinkingLevel } from "@deck/adapter-opencode";
import type { AdaptiveMemoryActiveProvider } from "@deck/core/config/deck-config";
import type { RunnerUiMetadata } from "@deck/core";
import { MenuList } from "../components/menu-list";
import { getAdapter } from "../../runner-adapters";

type DeveloperTeamDashboardContext = {
  source?: "home" | "dashboard";
  adaptiveMemoryProvider?: AdaptiveMemoryActiveProvider;
  capabilityStatuses?: Partial<Record<string, CapabilityStatus>>;
  returnLabel?: string;
};

type DeveloperTeamReviewScreenProps = {
  projectRoot: string;
  cursor: number;
  dashboardContext?: DeveloperTeamDashboardContext;
};

export function DeveloperTeamReviewScreen({ projectRoot, cursor, dashboardContext }: DeveloperTeamReviewScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Developer Team will be installed to:</Text>
      <Text color="cyan">  {projectRoot}/.pi/agents/</Text>
      {dashboardContext?.source === "dashboard" ? <DashboardContextSummary context={dashboardContext} /> : null}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Included agents ({DEVELOPER_TEAM_AGENTS.length})</Text>
        {DEVELOPER_TEAM_AGENTS.map((agent) => (
          <Text key={agent.id}>
            {"  "}{agent.displayName} <Text dimColor>({agent.id}.md)</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "install", label: "Install Developer Team now" },
            { id: "skip", label: dashboardContext?.returnLabel ?? "Skip Developer Team" },
          ]}
        />
      </Box>
    </Box>
  );
}

function DashboardContextSummary({ context }: { context: DeveloperTeamDashboardContext }) {
  const statuses = context.capabilityStatuses ?? {};
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>Dashboard context</Text>
      <Text>Adaptive Memory selected in dashboard: <Text color="cyan">{context.adaptiveMemoryProvider ?? "none"}</Text></Text>
      <Text dimColor>Model provider/model/thinking semantics are reused unchanged.</Text>
      {Object.entries(statuses).length > 0 ? (
        <Text dimColor>Capability states: {Object.entries(statuses).map(([id, status]) => `${id}=${status}`).join(", ")}</Text>
      ) : null}
    </Box>
  );
}

type DeveloperTeamInstallingScreenProps = {
  currentStep?: number;
  totalSteps?: number;
  currentItem?: string;
};

export function DeveloperTeamInstallingScreen({
  currentStep,
  totalSteps,
  currentItem,
}: DeveloperTeamInstallingScreenProps) {
  const progress =
    currentStep !== undefined && totalSteps !== undefined && totalSteps > 0
      ? ` (${currentStep}/${totalSteps})`
      : "";

  return (
    <Box flexDirection="column">
      <Text color="cyan">Installing Developer Team{progress}...</Text>
      {currentItem ? <Text dimColor>  {currentItem}</Text> : null}
      <Text dimColor>Writing the Developer Team bundle to the project.</Text>
    </Box>
  );
}

export type SupermemorySetupValues = {
  /** Token-only config: user identity is derived from token */
  token: string;
  /** @deprecated - no longer used. User is derived from token */
  userId?: never;
  /** @deprecated - no longer used. Deck derives one canonical project scope. */
  teamId?: never;
  /** @deprecated - no longer used */
  orgId?: never;
};

type MemoryProviderSelectionScreenProps = {
  cursor: number;
  selectedProvider: AdaptiveMemoryActiveProvider;
  status?: string;
  runtime?: string;
};

export function MemoryProviderSelectionScreen({ cursor, selectedProvider, status, runtime = "pi" }: MemoryProviderSelectionScreenProps) {
  const isCodex = runtime === "codex";
  return (
    <Box flexDirection="column">
      <Text bold>Adaptive Memory</Text>
      <Text dimColor>{isCodex
        ? "Codex uses one Deck flow: a runtime API token is validated into Deck's secret store, while optional MCP OAuth remains separate."
            : "Enable or disable Adaptive Memory. Supermemory is the only durable backend and credentials are never written to Deck config."}</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "none", label: "None", hint: selectedProvider === "none" ? "active" : "disable adaptive memory" },
            { id: "supermemory", label: "Supermemory", hint: selectedProvider === "supermemory" ? "active" : isCodex ? "requires Deck runtime token; MCP OAuth separate" : "requires Deck secret-store token" },
          ]}
        />
      </Box>
      {status ? <Text color="green">{status}</Text> : null}
    </Box>
  );
}

type SupermemorySetupScreenProps = {
  screen: "supermemory-token"; // Simplified: only token required
  values: SupermemorySetupValues;
  error?: string;
  runtime?: string;
};

export function SupermemorySetupScreen({ screen, values, error, runtime = "pi" }: SupermemorySetupScreenProps) {
  // Token-only config: no userId/teamId/orgId fields
  const field = "token";
  const label = "Supermemory API key (Deck Runtime)";
  const required = true;
  const value = values[field];
  const displayValue = value.length > 0 ? "[redacted]" : "";

  return (
    <Box flexDirection="column">
      <Text bold>{label} {required ? "(required)" : ""}</Text>
      <Text dimColor>
        {runtime === "pi"
          ? "API key is validated now and stored only in Deck's owner-only secret store. Pi MCP receives only credential-free endpoint/canonical scope config; user identity is derived from the key at runtime."
          : "API key is validated now and stored only in Deck's owner-only secret store. Optional runner MCP OAuth is configured separately and does not replace this runtime credential."}
      </Text>
      <Box marginTop={1}>
        <Text>{label}: <Text color="cyan">{displayValue}</Text></Text>
      </Box>
      {field === "token" && value.length > 0 ? <Text dimColor>Summary will show token as [redacted].</Text> : null}
      {error ? <Text color="yellow">{error}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>Type value, Backspace to edit, Enter to continue.</Text>
      </Box>
    </Box>
  );
}

// --- Model configuration screens ---

type ModelProviderSelectionScreenProps = {
  cursor: number;
  providers: PiProvider[];
  runtime?: string;
  runnerLabel?: string;
  modelUi?: RunnerUiMetadata["model"];
};

const DEFAULT_MODEL_UI: RunnerUiMetadata["model"] = {
  providerSource: "Providers come from Pi settings and detected credentials.",
  missingChecks: ["~/.pi/agent/settings.json defaultProvider/defaultModel", "pi --list-models", "Provider env vars such as OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY"],
  remediation: "Run `pi --list-models` or `pi config` to confirm Pi can see your providers.",
  defaultThinkingLevels: PI_THINKING_LEVELS,
  usesNativeCompatibilityChecks: true,
};

function modelUiMetadata(runtime: string, runnerLabel?: string, modelUi?: RunnerUiMetadata["model"]) {
  return {
    label: runnerLabel ?? (runtime === "pi" ? "Pi" : runtime.replace(/(^|-)(\w)/g, (_, __, letter: string) => ` ${letter.toUpperCase()}`).trim()),
    ...(modelUi ?? DEFAULT_MODEL_UI),
  };
}

export function ModelProviderSelectionScreen({ cursor, providers, runtime = "pi", runnerLabel, modelUi }: ModelProviderSelectionScreenProps) {
  const metadata = modelUiMetadata(runtime, runnerLabel, modelUi);
  return (
    <Box flexDirection="column">
      <Text bold>Select a {metadata.label} provider</Text>
      <Text dimColor>{metadata.providerSource}</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={providers.map((p) => ({
            id: p.id,
            label: p.displayName,
          }))}
        />
      </Box>
    </Box>
  );
}

type ModelSelectionScreenProps = {
  cursor: number;
  provider: PiProvider;
  models: PiModel[];
  runtime?: string;
  runnerLabel?: string;
  modelUi?: RunnerUiMetadata["model"];
};

export function ModelSelectionScreen({ cursor, provider, models, runtime = "pi", runnerLabel, modelUi }: ModelSelectionScreenProps) {
  const metadata = modelUiMetadata(runtime, runnerLabel, modelUi);
  // T8: Use resolver to differentiate "not compatible" vs "compatible"
  return (
    <Box flexDirection="column">
      <Text bold>Select a model for {provider.displayName}</Text>
      <Text dimColor>{metadata.providerSource}</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={models.map((m) => {
            // T8: Check if model supports thinking using the adapter's resolver
            const usesNativeCompatibilityChecks = metadata.usesNativeCompatibilityChecks === true;
            const supportsThinking = usesNativeCompatibilityChecks
              ? supportsThinkingForModel(m)
              : m.thinking === true || ("variants" in m && Array.isArray(m.variants) && m.variants.length > 0);

            let hint: string;
            if (usesNativeCompatibilityChecks && !supportsDeveloperTeamModel(m)) {
              hint = `${m.id} · not compatible with Developer Team conversation history`;
            } else if (supportsThinking) {
              hint = m.id; // Show model ID hint for supported models
            } else {
              // T8: Don't add extra "unsupported" copy - show model ID only
              hint = m.id;
            }

            return {
              id: m.id,
              label: m.displayName,
              hint,
            };
          })}
        />
      </Box>
    </Box>
  );
}

type AgentModelAssignmentScreenProps = {
  cursor: number;
  agentIndex: number;
  totalAgents: number;
  modelId: string;
  defaultThinking: string;
  supportsThinking?: boolean;
  runtime?: string;
  runnerLabel?: string;
  modelUi?: RunnerUiMetadata["model"];
  /**
   * Model-specific thinking/effort levels to render. When provided, takes
   * precedence over the runtime-default constant (e.g. OPENCODE_THINKING_LEVELS).
   *
   * For OpenCode, app.tsx passes `adapter.getThinkingLevels(selectedModel.id)`
   * so the rendered options reflect the model's real reasoning_options variants
   * (e.g. ["high","max"] or ["none","low","medium","high","xhigh"]) rather than
   * a hardcoded 4-level set.
   *
   * When provided and empty, the picker is hidden (treated as unsupported),
   * matching the fail-closed contract of RunnerAdapter.getThinkingLevels.
   *
   * When omitted, the screen falls back to the runtime-default constant —
   * this preserves Pi's fixed PI_THINKING_LEVELS path.
   */
  thinkingLevels?: readonly string[];
};

export function AgentModelAssignmentScreen({
  cursor,
  agentIndex,
  totalAgents,
  modelId,
  defaultThinking,
  supportsThinking = true,
  runtime = "pi",
  runnerLabel,
  modelUi,
  thinkingLevels,
}: AgentModelAssignmentScreenProps) {
  const agent = DEVELOPER_TEAM_AGENTS[agentIndex];
  const progress = `${agentIndex + 1}/${totalAgents}`;
  const metadata = modelUiMetadata(runtime, runnerLabel, modelUi);
  const fallbackLevels = modelUi?.defaultThinkingLevels ?? (runtime === "pi" ? PI_THINKING_LEVELS : OPENCODE_THINKING_LEVELS);
  const hasModelSpecificLevels = thinkingLevels !== undefined;
  const effectiveLevels = hasModelSpecificLevels ? thinkingLevels : fallbackLevels;
  const effectiveSupportsThinking = hasModelSpecificLevels ? effectiveLevels.length > 0 : supportsThinking;
  const runtimeLabel = metadata.label;

  return (
    <Box flexDirection="column">
      <Text bold>
        Select reasoning for {agent.displayName} <Text dimColor>({progress})</Text>
      </Text>
      <Text>Selected model: <Text color="cyan">{modelId}</Text></Text>
      {effectiveSupportsThinking ? (
        <>
          <Text dimColor>Choose {runtimeLabel} thinking/effort level for this agent.</Text>
          <Box marginTop={1}>
            <MenuList
              cursor={cursor}
              items={effectiveLevels.map((level) => ({
                id: level,
                label: `thinking ${level}`,
                hint: level === defaultThinking ? "recommended/default" : "",
              }))}
            />
          </Box>
        </>
      ) : runtime !== "pi" && hasModelSpecificLevels ? (
        <Text color="yellow">No reasoning choice applies to this model.</Text>
      ) : (
        <Text color="yellow">Thinking not supported by this provider/model; using off.</Text>
      )}
    </Box>
  );
}

type AgentModelConfigListScreenProps = {
  cursor: number;
  modelAssignments: Record<string, string>;
  thinkingAssignments: Record<string, string>;
  assignmentStates?: Readonly<Record<string, "available" | "model-unavailable" | "variant-unavailable" | "unverified">>;
  discoveryState?: "stale";
  dashboardContext?: DeveloperTeamDashboardContext;
  runtime?: string;
};

export function AgentModelConfigListScreen({
  cursor,
  modelAssignments,
  thinkingAssignments,
  assignmentStates = {},
  discoveryState,
  dashboardContext,
  runtime = "pi",
}: AgentModelConfigListScreenProps) {
  const agentItems = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const assigned = modelAssignments[agent.id];
    const thinking = thinkingAssignments[agent.id];
    const assignmentState = assignmentStates[agent.id];

    let hint: string;
    if (!assigned) {
      hint = "not configured";
    } else if (assignmentState === "model-unavailable") {
      hint = `${assigned} · Unavailable model`;
    } else if (assignmentState === "variant-unavailable") {
      hint = `Variant unavailable: ${thinking ?? "unset"} · ${assigned}`;
    } else if (assignmentState === "unverified") {
      hint = `${assigned}${thinking ? ` · thinking ${thinking}` : ""} · Availability unverified`;
    } else {
      hint = thinking ? `${assigned} · thinking ${thinking}` : assigned;
    }

    return { id: agent.id, label: agent.displayName, hint };
  });

  const items = [...agentItems, { id: "finish", label: "Finish configuration", hint: dashboardContext?.returnLabel ?? "" }];

  return (
    <Box flexDirection="column">
      <Text bold>Select an agent to configure</Text>
      <Text dimColor>Current assignments are shown. Choose an agent to change its model and reasoning level.</Text>
      {discoveryState === "stale" ? <Text color="yellow">Last known OpenCode models are shown; changes are disabled until Retry discovery succeeds.</Text> : null}
      {dashboardContext?.source === "dashboard" ? <DashboardContextSummary context={dashboardContext} /> : null}
      <Box marginTop={1}>
        <MenuList cursor={cursor} items={items} />
      </Box>
    </Box>
  );
}


type OpenCodeModelDiscoveryScreenProps = {
  cursor: number;
  state:
    | { kind: "loading" }
    | { kind: "ready" }
    | { kind: "empty"; discoveredAt?: number }
    | { kind: "stale"; discoveredAt: number; errorMessage: string }
    | { kind: "blocked"; errorMessage: string };
};

/** Terminal-readable async discovery status with keyboard-native Retry and Back items. */
export function OpenCodeModelDiscoveryScreen({ cursor, state }: OpenCodeModelDiscoveryScreenProps) {
  if (state.kind === "loading") {
    return (
      <Box flexDirection="column">
        <Text bold>Reading models from OpenCode…</Text>
        <Text dimColor>Existing assignments are preserved while discovery runs.</Text>
      </Box>
    );
  }

  if (state.kind === "ready") {
    return <Text>OpenCode models are ready.</Text>;
  }

  const isEmpty = state.kind === "empty";
  const isStale = state.kind === "stale";
  const title = isEmpty
    ? "OpenCode reported no available models."
    : isStale
      ? `Last known OpenCode models (discovered ${new Date(state.discoveredAt).toLocaleString()})`
      : "OpenCode model discovery is unavailable.";

  return (
    <Box flexDirection="column">
      <Text color={isEmpty || isStale ? "yellow" : "red"} bold>{title}</Text>
      {isStale ? <Text color="yellow">{state.errorMessage}</Text> : null}
      {isStale ? <Text>Assignments can be inspected, but changes cannot be applied until a rescan succeeds.</Text> : null}
      {state.kind === "blocked" ? <Text color="red">{state.errorMessage}</Text> : null}
      {state.kind === "blocked" ? <Text>Check `opencode models --verbose`, then retry discovery.</Text> : null}
      <Box marginTop={1}>
        <MenuList cursor={cursor} items={[
          { id: "retry", label: "Retry discovery", hint: "local rescan" },
          { id: "back", label: "Back" },
        ]} />
      </Box>
    </Box>
  );
}

type CodexModelDiscoveryScreenProps = {
  cursor: number;
  state:
    | { kind: "loading" }
    | { kind: "ready" }
    | { kind: "empty"; diagnostics?: readonly string[] }
    | { kind: "stale"; source: "last-known-good" | "bundled" | "deck-fallback"; diagnostics?: readonly string[]; errorMessage: string }
    | { kind: "blocked"; errorMessage: string };
};

/** Codex fallback catalogs are diagnostic-only: only an authenticated result unlocks editing. */
export function CodexModelDiscoveryScreen({ cursor, state }: CodexModelDiscoveryScreenProps) {
  if (state.kind === "loading") {
    return (
      <Box flexDirection="column">
        <Text bold>Reading models from Codex…</Text>
        <Text dimColor>Only the authenticated Codex catalog can enable model changes.</Text>
      </Box>
    );
  }

  if (state.kind === "ready") return <Text>Authenticated Codex models are ready.</Text>;

  const title = state.kind === "empty"
    ? "Codex reported no active-account models."
    : state.kind === "stale" && state.source === "bundled"
      ? "Codex bundled models are not active-account availability."
      : state.kind === "stale" && state.source === "deck-fallback"
        ? "Codex model discovery is degraded; no model choices are available."
        : state.kind === "stale"
          ? "Codex model availability is stale and cannot be edited."
          : "Codex model discovery is unavailable.";
  const diagnostics = state.kind === "empty" || state.kind === "stale" ? state.diagnostics ?? [] : [];

  return (
    <Box flexDirection="column">
      <Text color={state.kind === "blocked" ? "red" : "yellow"} bold>{title}</Text>
      {state.kind === "stale" ? <Text color="yellow">{state.errorMessage}</Text> : null}
      {state.kind === "blocked" ? <Text color="red">{state.errorMessage}</Text> : null}
      {diagnostics.map((diagnostic) => <Text key={diagnostic} dimColor>{diagnostic}</Text>)}
      <Text>Assignments remain unchanged. Retry discovery to rescan the authenticated Codex catalog.</Text>
      <Box marginTop={1}>
        <MenuList cursor={cursor} items={[
          { id: "retry", label: "Retry discovery", hint: "authenticated rescan" },
          { id: "back", label: "Back" },
        ]} />
      </Box>
    </Box>
  );
}

type NoProvidersScreenProps = {
  onContinue?: () => void;
  dashboardContext?: DeveloperTeamDashboardContext;
  runtime?: string;
  runnerLabel?: string;
  modelUi?: RunnerUiMetadata["model"];
};

export function NoProvidersScreen({ dashboardContext, runtime = "pi", runnerLabel, modelUi }: NoProvidersScreenProps) {
  const metadata = modelUiMetadata(runtime, runnerLabel, modelUi);
  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>No {metadata.label} providers detected</Text>
      {dashboardContext?.source === "dashboard" ? <DashboardContextSummary context={dashboardContext} /> : null}
      <Text dimColor>{metadata.providerSource}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Deck checks:</Text>
        {metadata.missingChecks.map((check) => <Text key={check}>  {check}</Text>)}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{metadata.remediation}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to skip model assignment (you can configure it later).</Text>
      </Box>
    </Box>
  );
}
