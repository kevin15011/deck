import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  AgentModelConfigListScreen,
  NoProvidersScreen,
  MemoryProviderSelectionScreen,
  SupermemorySetupScreen,
} from "./screens/developer-team-screens";

import { getTeamsForEnvironment } from "@deck/adapter-pi";
import { MenuList } from "./components/menu-list";
import { buildSupermemoryDeckConfig, handOffSupermemoryCredentialToPiMcp } from "./app";

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

    test("keeps Kimi selectable with thinking off note", () => {
      const provider = { id: "opencode-go", displayName: "OpenCode Go", envVars: ["OPENCODE_API_KEY"] };
      const models = [
        { id: "opencode-go/kimi-k2.6", displayName: "Kimi K2.6", providerId: "opencode-go" },
      ];
      const output = renderToString(<ModelSelectionScreen cursor={0} provider={provider} models={models} />);

      expect(output).toContain("Kimi K2.6");
      expect(output).toContain("Thinking not supported; using off");
    });

    test("keeps non-Kimi opencode-go models selectable with thinking off note", () => {
      const provider = { id: "opencode-go", displayName: "OpenCode Go", envVars: ["OPENCODE_API_KEY"] };
      const models = [
        { id: "opencode-go/qwen3.6-plus", displayName: "Qwen 3.6 Plus", providerId: "opencode-go" },
      ];
      const output = renderToString(<ModelSelectionScreen cursor={0} provider={provider} models={models} />);

      expect(output).toContain("Qwen 3.6 Plus");
      expect(output).toContain("Thinking not supported; using off");
    });
  });

  describe("AgentModelAssignmentScreen", () => {
    test("renders reasoning selection with progress", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={0} totalAgents={12} modelId="anthropic/claude-opus-4" defaultThinking="low" />,
      );

      expect(output).toContain("Select reasoning for Orchestrator Agent");
      expect(output).toContain("1/12");
      expect(output).toContain("anthropic/claude-opus-4");
      expect(output).toContain("thinking off");
      expect(output).toContain("thinking low");
      expect(output).toContain("recommended/default");
    });

    test("renders skip option for last agent", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={11} totalAgents={12} modelId="openai/gpt-4o" defaultThinking="low" />,
      );

      expect(output).toContain("Select reasoning for Archive Agent");
      expect(output).toContain("12/12");
    });

    test("does not render thinking options when unsupported", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen
          cursor={0}
          agentIndex={0}
          totalAgents={12}
          modelId="opencode-go/kimi-k2.6"
          defaultThinking="off"
          supportsThinking={false}
        />,
      );

      expect(output).toContain("Thinking not supported by this provider/model; using off.");
      expect(output).not.toContain("thinking high");
    });
  });

  describe("AgentModelConfigListScreen", () => {
    test("renders model and thinking inline", () => {
      const output = renderToString(
        <AgentModelConfigListScreen
          cursor={0}
          modelAssignments={{ "deck-developer-orchestrator": "openai-codex/gpt-5.5" }}
          thinkingAssignments={{ "deck-developer-orchestrator": "high" }}
        />,
      );

      expect(output).toContain("openai-codex/gpt-5.5 · thinking high");
    });
  });


  describe("MemoryProviderSelectionScreen", () => {
    test("offers exactly one adaptive-memory provider choice including Supermemory MCP", () => {
      const output = renderToString(<MemoryProviderSelectionScreen cursor={0} selectedProvider="none" />);

      expect(output).toContain("Select adaptive-memory provider");
      expect(output).toContain("None");
      expect(output).toContain("Engram");
      expect(output).toContain("Supermemory MCP");
      expect(output).toContain("Exactly one provider can be active");
    });

    test("confirms selected provider status", () => {
      const output = renderToString(
        <MemoryProviderSelectionScreen cursor={2} selectedProvider="supermemory" status="Active adaptive-memory provider: Supermemory MCP. Token: [redacted]." />,
      );

      expect(output).toContain("active");
      expect(output).toContain("Token: [redacted]");
    });
  });

  describe("SupermemorySetupScreen", () => {
    test("redacts token prompt values and explains external credential handoff", () => {
      const output = renderToString(
        <SupermemorySetupScreen
          screen="supermemory-token"
          values={{ token: "super-secret-token", userId: "", teamId: "", orgId: "" }}
        />,
      );

      expect(output).toContain("Supermemory token (required)");
      expect(output).toContain("[redacted]");
      expect(output).not.toContain("super-secret-token");
      expect(output).toContain("never stored");
      expect(output).toContain("Deck config");
    });

    test("shows required userId configuration errors", () => {
      const output = renderToString(
        <SupermemorySetupScreen
          screen="supermemory-user-id"
          values={{ token: "", userId: "", teamId: "", orgId: "" }}
          error="Supermemory configuration requires an explicit userId."
        />,
      );

      expect(output).toContain("userId (required)");
      expect(output).toContain("explicit userId");
    });

    test("supports optional teamId and orgId prompts", () => {
      const teamOutput = renderToString(
        <SupermemorySetupScreen screen="supermemory-team-id" values={{ token: "", userId: "u-1", teamId: "team-a", orgId: "" }} />,
      );
      const orgOutput = renderToString(
        <SupermemorySetupScreen screen="supermemory-org-id" values={{ token: "", userId: "u-1", teamId: "", orgId: "org-a" }} />,
      );

      expect(teamOutput).toContain("teamId (optional)");
      expect(teamOutput).toContain("team-a");
      expect(orgOutput).toContain("orgId (optional)");
      expect(orgOutput).toContain("org-a");
    });

    test("builds non-secret Supermemory Deck config only", () => {
      const config = buildSupermemoryDeckConfig({ token: "super-secret-token", userId: " user-1 ", teamId: " team-1 ", orgId: "" });
      const serialized = JSON.stringify(config);

      expect(config.adaptiveMemory.activeProvider).toBe("supermemory");
      expect(config.adaptiveMemory.supermemory.userId).toBe("user-1");
      expect(config.adaptiveMemory.supermemory.teamId).toBe("team-1");
      expect(config.adaptiveMemory.supermemory).not.toHaveProperty("orgId");
      expect(serialized).not.toContain("super-secret-token");
      expect(serialized).not.toContain("token");
    });

    test("writes Supermemory credential through Pi MCP config writer without leaking token in status", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "deck-supermemory-tui-"));
      const token = "sentinel-supermemory-token";
      const configPath = join(tempDir, ".pi", "agent", "mcp.json");

      try {
        const result = handOffSupermemoryCredentialToPiMcp(
          { token, userId: "user-1", teamId: "team-a", orgId: "" },
          { configPath },
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Pi MCP config");
        expect(result.message).toContain("[redacted]");
        expect(result.message).not.toContain(token);

        const externalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        expect(externalConfig.mcpServers.supermemory.url).toBe("https://supermemory-new.stlmcp.com");
        expect(externalConfig.mcpServers.supermemory.headers["x-supermemory-api-key"]).toBe(token);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("reports failed Pi MCP config writer errors without leaking token", () => {
      const token = "sentinel-failing-token";
      const result = handOffSupermemoryCredentialToPiMcp(
        { token, userId: "user-1", teamId: "", orgId: "" },
        {
          writer: ({ token: receivedToken }) => ({
            ok: false,
            action: "failed",
            path: "/tmp/mcp.json",
            serverName: "supermemory",
            diagnostics: [
              {
                code: "PI_MCP_CONFIG_WRITE_FAILED",
                severity: "error",
                path: "/tmp/mcp.json",
                serverName: "supermemory",
                message: `Unable to write Pi MCP config; token: ${receivedToken}`.replace(receivedToken, "[REDACTED]"),
              },
            ],
          }),
        },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unable to configure Supermemory");
      expect(result.message).toContain("[REDACTED]");
      expect(result.message).not.toContain(token);
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
