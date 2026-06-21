import React from "react";
import { Box, Text } from "ink";

import { DEVELOPER_TEAM_AGENTS } from "@deck/core/teams/developer/catalog";
import type { DeveloperTeamAgent } from "@deck/core/teams/developer/catalog";
import { PI_THINKING_LEVELS, supportsDeveloperTeamModel, supportsThinkingForModel } from "@deck/adapter-pi";
import { OPENCODE_THINKING_LEVELS, supportsThinkingForOpenCodeModel } from "@deck/adapter-opencode";
import type { CapabilityStatus, PiModel, PiProvider, PiThinkingLevel } from "@deck/adapter-pi";
import type { OpenCodeThinkingLevel } from "@deck/adapter-opencode";
import type { AdaptiveMemoryActiveProvider } from "@deck/core/config/deck-config";
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
  /** @deprecated - no longer used. Project scoping via x-sm-project header */
  teamId?: never;
  /** @deprecated - no longer used */
  orgId?: never;
};

type MemoryProviderSelectionScreenProps = {
  cursor: number;
  selectedProvider: AdaptiveMemoryActiveProvider;
  status?: string;
};

export function MemoryProviderSelectionScreen({ cursor, selectedProvider, status }: MemoryProviderSelectionScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Select adaptive-memory provider</Text>
      <Text dimColor>Exactly one provider can be active. Supermemory credentials are never written to .deck/config.json.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={[
            { id: "none", label: "None", hint: selectedProvider === "none" ? "active" : "disable adaptive memory" },
            { id: "engram", label: "Engram", hint: selectedProvider === "engram" ? "active" : "existing provider" },
            { id: "supermemory", label: "Supermemory MCP", hint: selectedProvider === "supermemory" ? "active" : "requires token only" },
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
};

export function SupermemorySetupScreen({ screen, values, error }: SupermemorySetupScreenProps) {
  // Token-only config: no userId/teamId/orgId fields
  const field = "token";
  const label = "Supermemory token";
  const required = true;
  const value = values[field];
  const displayValue = value.length > 0 ? "[redacted]" : "";

  return (
    <Box flexDirection="column">
      <Text bold>{label} {required ? "(required)" : ""}</Text>
      <Text dimColor>
        {field === "token"
          ? "Token is written only to Pi's global MCP config (~/.pi/agent/mcp.json) and is never stored in Deck config. User identity is derived automatically from token. Project scoping handled via x-sm-project header."
          : ""}
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
  runtime?: "pi" | "opencode";
};

export function ModelProviderSelectionScreen({ cursor, providers, runtime = "pi" }: ModelProviderSelectionScreenProps) {
  const runtimeLabel = runtime === "opencode" ? "OpenCode" : "Pi";
  return (
    <Box flexDirection="column">
      <Text bold>Select a {runtimeLabel} provider</Text>
      <Text dimColor>Providers come from {runtimeLabel} settings and detected credentials.</Text>
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
  runtime?: "pi" | "opencode";
};

export function ModelSelectionScreen({ cursor, provider, models, runtime = "pi" }: ModelSelectionScreenProps) {
  const runtimeLabel = runtime === "opencode" ? "OpenCode" : "Pi";
  // T8: Use resolver to differentiate "not compatible" vs "compatible"
  return (
    <Box flexDirection="column">
      <Text bold>Select a model for {provider.displayName}</Text>
      <Text dimColor>Models are loaded from {runtimeLabel} when available; defaults are fallback only.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={models.map((m) => {
            // T8: Check if model supports thinking using the adapter's resolver
            const supportsThinking = runtime === "opencode"
              ? supportsThinkingForOpenCodeModel(m.id)
              : supportsThinkingForModel(m);

            let hint: string;
            if (runtime === "pi" && !supportsDeveloperTeamModel(m)) {
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
  defaultThinking: PiThinkingLevel | OpenCodeThinkingLevel;
  supportsThinking?: boolean;
  runtime?: "pi" | "opencode";
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
  thinkingLevels,
}: AgentModelAssignmentScreenProps) {
  const agent = DEVELOPER_TEAM_AGENTS[agentIndex];
  const progress = `${agentIndex + 1}/${totalAgents}`;
  const fallbackLevels = runtime === "opencode" ? OPENCODE_THINKING_LEVELS : PI_THINKING_LEVELS;
  // Model-specific levels (when provided) override the runtime-default constant.
  // An empty model-specific array means the model has no discrete effort variants
  // in the cache; we treat that as "not supported" to fail closed.
  const hasModelSpecificLevels = thinkingLevels !== undefined;
  const effectiveLevels = hasModelSpecificLevels ? thinkingLevels : fallbackLevels;
  const effectiveSupportsThinking = hasModelSpecificLevels ? effectiveLevels.length > 0 : supportsThinking;
  const runtimeLabel = runtime === "opencode" ? "OpenCode" : "Pi";

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
      ) : (
        <Text color="yellow">Thinking not supported by this provider/model; using off.</Text>
      )}
    </Box>
  );
}

type AgentModelConfigListScreenProps = {
  cursor: number;
  modelAssignments: Record<string, string>;
  thinkingAssignments: Record<string, PiThinkingLevel>;
  dashboardContext?: DeveloperTeamDashboardContext;
  runtime?: "pi" | "opencode";
};

export function AgentModelConfigListScreen({ cursor, modelAssignments, thinkingAssignments, dashboardContext, runtime = "pi" }: AgentModelConfigListScreenProps) {
  // T8: Only show thinking hint when model supports reasoning
  const agentItems = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const assigned = modelAssignments[agent.id];
    const thinking = thinkingAssignments[agent.id];

    let hint: string;
    if (!assigned) {
      hint = "not configured";
    } else {
      // Check if model supports thinking - only show thinking hint if supported
      const supportsThinking = runtime === "opencode"
        ? supportsThinkingForOpenCodeModel(assigned)
        : supportsThinkingForModel(assigned as any);

      hint = supportsThinking && thinking
        ? `${assigned} · thinking ${thinking}`
        : assigned;
    }

    return {
      id: agent.id,
      label: agent.displayName,
      hint,
    };
  });

  const items = [...agentItems, { id: "finish", label: "Finish configuration", hint: dashboardContext?.returnLabel ?? "" }];

  return (
    <Box flexDirection="column">
      <Text bold>Select an agent to configure</Text>
      <Text dimColor>Current assignments are shown. Choose an agent to change its model and reasoning level.</Text>
      {dashboardContext?.source === "dashboard" ? <DashboardContextSummary context={dashboardContext} /> : null}
      <Box marginTop={1}>
        <MenuList cursor={cursor} items={items} />
      </Box>
    </Box>
  );
}

type NoProvidersScreenProps = {
  onContinue?: () => void;
  dashboardContext?: DeveloperTeamDashboardContext;
  runtime?: "pi" | "opencode";
};

export function NoProvidersScreen({ dashboardContext, runtime = "pi" }: NoProvidersScreenProps) {
  const runtimeLabel = runtime === "opencode" ? "OpenCode" : "Pi";
  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>No {runtimeLabel} providers detected</Text>
      {dashboardContext?.source === "dashboard" ? <DashboardContextSummary context={dashboardContext} /> : null}
      <Text dimColor>Deck could not find providers in {runtimeLabel} settings or detected credentials.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Deck checks:</Text>
        {runtime === "opencode" ? (
          <>
            <Text>  ~/.config/opencode/opencode.json agent model entries</Text>
            <Text>  opencode models</Text>
          </>
        ) : (
          <>
            <Text>  ~/.pi/agent/settings.json defaultProvider/defaultModel</Text>
            <Text>  pi --list-models</Text>
            <Text>  Provider env vars such as OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY</Text>
          </>
        )}
      </Box>
      <Box marginTop={1}>
        {runtime === "opencode" ? (
          <Text dimColor>Run `opencode models` to confirm OpenCode can see your providers.</Text>
        ) : (
          <Text dimColor>Run `pi --list-models` or `pi config` to confirm Pi can see your providers.</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to skip model assignment (you can configure it later).</Text>
      </Box>
    </Box>
  );
}
