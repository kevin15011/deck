import React from "react";
import { Box, Text } from "ink";

import { DEVELOPER_TEAM_AGENTS, PI_THINKING_LEVELS, supportsThinkingForModel } from "@deck/adapter-pi";
import type { PiModel, PiProvider, PiThinkingLevel } from "@deck/adapter-pi";
import { MenuList } from "../components/menu-list";

type DeveloperTeamReviewScreenProps = {
  projectRoot: string;
  cursor: number;
};

export function DeveloperTeamReviewScreen({ projectRoot, cursor }: DeveloperTeamReviewScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Developer Team will be installed to:</Text>
      <Text color="cyan">  {projectRoot}/.pi/agents/</Text>
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
            { id: "skip", label: "Skip Developer Team" },
          ]}
        />
      </Box>
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

// --- Model configuration screens ---

type ModelProviderSelectionScreenProps = {
  cursor: number;
  providers: PiProvider[];
};

export function ModelProviderSelectionScreen({ cursor, providers }: ModelProviderSelectionScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Select a Pi provider</Text>
      <Text dimColor>Providers come from Pi settings, `pi --list-models`, or detected credentials.</Text>
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
};

export function ModelSelectionScreen({ cursor, provider, models }: ModelSelectionScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Select a model for {provider.displayName}</Text>
      <Text dimColor>Models are loaded from Pi when available; defaults are fallback only.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={models.map((m) => ({
            id: m.id,
            label: m.displayName,
            hint: supportsThinkingForModel(m) ? m.id : `${m.id} · Thinking not supported; using off`,
          }))}
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
  defaultThinking: PiThinkingLevel;
  supportsThinking?: boolean;
};

export function AgentModelAssignmentScreen({
  cursor,
  agentIndex,
  totalAgents,
  modelId,
  defaultThinking,
  supportsThinking = true,
}: AgentModelAssignmentScreenProps) {
  const agent = DEVELOPER_TEAM_AGENTS[agentIndex];
  const progress = `${agentIndex + 1}/${totalAgents}`;

  return (
    <Box flexDirection="column">
      <Text bold>
        Select reasoning for {agent.displayName} <Text dimColor>({progress})</Text>
      </Text>
      <Text>Selected model: <Text color="cyan">{modelId}</Text></Text>
      {supportsThinking ? (
        <>
          <Text dimColor>Choose Pi thinking/effort level for this agent.</Text>
          <Box marginTop={1}>
            <MenuList
              cursor={cursor}
              items={PI_THINKING_LEVELS.map((level) => ({
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
};

export function AgentModelConfigListScreen({ cursor, modelAssignments, thinkingAssignments }: AgentModelConfigListScreenProps) {
  const agentItems = DEVELOPER_TEAM_AGENTS.map((agent) => {
    const assigned = modelAssignments[agent.id];
    const thinking = thinkingAssignments[agent.id];
    return {
      id: agent.id,
      label: agent.displayName,
      hint: assigned ? `${assigned} · thinking ${thinking ?? "default"}` : "not configured",
    };
  });

  const items = [...agentItems, { id: "finish", label: "Finish configuration", hint: "" }];

  return (
    <Box flexDirection="column">
      <Text bold>Select an agent to configure</Text>
      <Text dimColor>Current assignments are shown. Choose an agent to change its model and reasoning level.</Text>
      <Box marginTop={1}>
        <MenuList cursor={cursor} items={items} />
      </Box>
    </Box>
  );
}

type NoProvidersScreenProps = {
  onContinue?: () => void;
};

export function NoProvidersScreen({}: NoProvidersScreenProps) {
  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>No Pi providers detected</Text>
      <Text dimColor>Deck could not find providers in Pi settings, `pi --list-models`, or environment credentials.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Deck checks:</Text>
        <Text>  ~/.pi/agent/settings.json defaultProvider/defaultModel</Text>
        <Text>  pi --list-models</Text>
        <Text>  Provider env vars such as OPENCODE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Run `pi --list-models` or `pi config` to confirm Pi can see your providers.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to skip model assignment (you can configure it later).</Text>
      </Box>
    </Box>
  );
}
