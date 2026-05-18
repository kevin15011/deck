import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";
import React from "react";
import { Box, Text } from "ink";

import { ScreenFrame } from "./screen-frame";
import {
  DeveloperTeamReviewScreen,
  DeveloperTeamInstallingScreen,
  ModelProviderSelectionScreen,
  ModelSelectionScreen,
  AgentModelAssignmentScreen,
  NoProvidersScreen,
} from "./screens/developer-team-screens";

import { getTeamsForEnvironment } from "@deck/adapter-pi";
import { MenuList } from "./components/menu-list";

function TeamSelectionScreen({ cursor, selected }: { cursor: number; selected: string[] }) {
  const teams = getTeamsForEnvironment("pi-development");
  return (
    <ScreenFrame title="Select teams" help="help">
      <Box flexDirection="column">
        <MenuList
          cursor={cursor}
          multiselect
          items={teams.map((team) => ({
            id: team.id,
            label: team.displayName,
            hint: team.description,
            checked: selected.includes(team.id),
          }))}
        />
      </Box>
    </ScreenFrame>
  );
}

describe("Developer Team TUI screens", () => {
  describe("DeveloperTeamReviewScreen", () => {
    test("renders target path and agent list", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      expect(output).toContain("/tmp/my-project/.pi/agents");
      expect(output).toContain("Orchestrator Agent");
      expect(output).toContain("Archive Agent");
      expect(output).toContain("deck-developer-orchestrator.md");
    });

    test("renders install and skip options", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      expect(output).toContain("Install Developer Team now");
      expect(output).toContain("Skip Developer Team");
    });

    test("cursor highlights Install when cursor=0", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={0}
          />
        </ScreenFrame>,
      );

      // The first menu item (Install) should have the cursor indicator
      // MenuList uses ❯ for focused item
      const installIdx = output.indexOf("Install Developer Team now");
      const skipIdx = output.indexOf("Skip Developer Team");
      // The ❯ should appear before the Install option
      const cursorBeforeInstall = output.lastIndexOf("❯", installIdx);
      expect(cursorBeforeInstall).toBeGreaterThan(-1);
      expect(cursorBeforeInstall).toBeLessThan(installIdx);
    });

    test("cursor highlights Skip when cursor=1", () => {
      const output = renderToString(
        <ScreenFrame title="Developer Team" help="help">
          <DeveloperTeamReviewScreen
            projectRoot="/tmp/my-project"
            cursor={1}
          />
        </ScreenFrame>,
      );

      const skipIdx = output.indexOf("Skip Developer Team");
      const cursorBeforeSkip = output.lastIndexOf("❯", skipIdx);
      expect(cursorBeforeSkip).toBeGreaterThan(-1);
      expect(cursorBeforeSkip).toBeLessThan(skipIdx);
    });
  });

  describe("DeveloperTeamInstallingScreen", () => {
    test("renders installing message", () => {
      const output = renderToString(
        <ScreenFrame title="Installing Developer Team" help="help">
          <DeveloperTeamInstallingScreen />
        </ScreenFrame>,
      );

      expect(output).toContain("Installing Developer Team");
    });

    test("renders unified bundle progress", () => {
      const output = renderToString(
        <ScreenFrame title="Installing Developer Team" help="help">
          <DeveloperTeamInstallingScreen />
        </ScreenFrame>,
      );

      expect(output).toContain("Developer Team bundle");
    });
  });

  describe("TeamSelectionScreen", () => {
    test("renders Developer Team as selectable with checkbox", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={["developer-team"]} />,
      );

      expect(output).toContain("Developer Team");
      expect(output).toContain("[x]");
      expect(output).toContain("exploration");
      expect(output).toContain("archive");
    });

    test("renders unchecked when Developer Team not selected", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={[]} />,
      );

      expect(output).toContain("[ ]");
    });

    test("shows cursor indicator on focused team", () => {
      const output = renderToString(
        <TeamSelectionScreen cursor={0} selected={["developer-team"]} />,
      );

      const teamIdx = output.indexOf("Developer Team");
      const cursorBeforeTeam = output.lastIndexOf("❯", teamIdx);
      expect(cursorBeforeTeam).toBeGreaterThan(-1);
      expect(cursorBeforeTeam).toBeLessThan(teamIdx);
    });
  });

  describe("ModelProviderSelectionScreen", () => {
    test("renders detected providers", () => {
      const providers = [
        { id: "anthropic", displayName: "Anthropic (Claude)", envVars: ["ANTHROPIC_API_KEY"] },
        { id: "openai", displayName: "OpenAI (GPT)", envVars: ["OPENAI_API_KEY"] },
      ];
      const output = renderToString(<ModelProviderSelectionScreen cursor={0} providers={providers} />);

      expect(output).toContain("Select a Pi provider");
      expect(output).toContain("Anthropic (Claude)");
      expect(output).toContain("OpenAI (GPT)");
    });

    test("shows cursor on first provider", () => {
      const providers = [{ id: "anthropic", displayName: "Anthropic (Claude)", envVars: ["ANTHROPIC_API_KEY"] }];
      const output = renderToString(<ModelProviderSelectionScreen cursor={0} providers={providers} />);

      const idx = output.indexOf("Anthropic (Claude)");
      const cursorBefore = output.lastIndexOf("❯", idx);
      expect(cursorBefore).toBeGreaterThan(-1);
      expect(cursorBefore).toBeLessThan(idx);
    });
  });

  describe("ModelSelectionScreen", () => {
    test("renders models for provider", () => {
      const provider = { id: "anthropic", displayName: "Anthropic (Claude)", envVars: ["ANTHROPIC_API_KEY"] };
      const models = [
        { id: "anthropic/claude-opus-4", displayName: "Claude Opus 4", providerId: "anthropic" },
        { id: "anthropic/claude-sonnet-4", displayName: "Claude Sonnet 4", providerId: "anthropic" },
      ];
      const output = renderToString(<ModelSelectionScreen cursor={0} provider={provider} models={models} />);

      expect(output).toContain("Select a model for Anthropic (Claude)");
      expect(output).toContain("Claude Opus 4");
      expect(output).toContain("Claude Sonnet 4");
    });
  });

  describe("AgentModelAssignmentScreen", () => {
    test("renders agent assignment with progress", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={0} totalAgents={12} modelId="anthropic/claude-opus-4" />,
      );

      expect(output).toContain("Assign model to Orchestrator Agent");
      expect(output).toContain("1/12");
      expect(output).toContain("anthropic/claude-opus-4");
      expect(output).toContain("Assign anthropic/claude-opus-4 to Orchestrator Agent");
      expect(output).toContain("Skip Orchestrator Agent");
    });

    test("renders skip option for last agent", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={11} totalAgents={12} modelId="openai/gpt-4o" />,
      );

      expect(output).toContain("Assign model to Archive Agent");
      expect(output).toContain("12/12");
    });
  });

  describe("NoProvidersScreen", () => {
    test("renders provider detection guidance", () => {
      const output = renderToString(<NoProvidersScreen />);

      expect(output).toContain("No Pi providers detected");
      expect(output).toContain("~/.pi/agent/settings.json");
      expect(output).toContain("pi --list-models");
      expect(output).toContain("OPENCODE_API_KEY");
    });
  });

  describe("DeveloperTeamInstallingScreen", () => {
    test("renders progress when step props are provided", () => {
      const output = renderToString(<DeveloperTeamInstallingScreen currentStep={5} totalSteps={12} currentItem="deck-developer-verify" />);

      expect(output).toContain("Installing Developer Team");
      expect(output).toContain("(5/12)");
    });

    test("renders without progress when no props provided", () => {
      const output = renderToString(<DeveloperTeamInstallingScreen />);

      expect(output).toContain("Installing Developer Team");
      expect(output).not.toContain("(/");
    });
  });
});
