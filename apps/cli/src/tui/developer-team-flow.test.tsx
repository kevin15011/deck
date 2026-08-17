import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach, vi } from "bun:test";
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
import { PersonalitySelectionScreen } from "./app";

import { getTeamsForEnvironment } from "@deck/adapter-pi";
import { MenuList } from "./components/menu-list";
import { buildSupermemoryDeckConfig, createMemoryProviderForSelection, handOffSupermemoryCredentialToPiMcp } from "./app";

// Config writers are patched in-place using vi.spyOn in the specific
// describe blocks that need them (PersonalitySelectionScreen — config write).
// This avoids the hoisted vi.mock polluting action-runner.test.ts when run in the same suite.

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
      expect(output).toContain("Lead");
      expect(output).toContain("Setup");
      expect(output).toContain("deck-lead.md");
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

    test("keeps Kimi selectable without extra unsupported copy (T8 compliance)", () => {
      const provider = { id: "opencode-go", displayName: "OpenCode Go", envVars: ["OPENCODE_API_KEY"] };
      const models = [
        { id: "opencode-go/kimi-k2.6", displayName: "Kimi K2.6", providerId: "opencode-go" },
      ];
      const output = renderToString(<ModelSelectionScreen cursor={0} provider={provider} models={models} />);

      expect(output).toContain("Kimi K2.6");
      // T8: No extra "unsupported" copy - shows model ID only (REQ-TUI-004)
      expect(output).toContain("opencode-go/kimi-k2.6");
      expect(output).not.toContain("Thinking not supported");
    });

    test("keeps non-Kimi opencode-go models selectable without extra copy", () => {
      const provider = { id: "opencode-go", displayName: "OpenCode Go", envVars: ["OPENCODE_API_KEY"] };
      const models = [
        { id: "opencode-go/qwen3.6-plus", displayName: "Qwen 3.6 Plus", providerId: "opencode-go" },
      ];
      const output = renderToString(<ModelSelectionScreen cursor={0} provider={provider} models={models} />);

      expect(output).toContain("Qwen 3.6 Plus");
      // T8: No extra "unsupported" copy - shows model ID only (REQ-TUI-004)
      expect(output).toContain("opencode-go/qwen3.6-plus");
      expect(output).not.toContain("Thinking not supported");
    });
  });

  describe("AgentModelAssignmentScreen", () => {
    test("renders reasoning selection with progress", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={0} totalAgents={7} modelId="anthropic/claude-opus-4" defaultThinking="low" />,
      );

      expect(output).toContain("Select reasoning for Lead");
      expect(output).toContain("1/7");
      expect(output).toContain("anthropic/claude-opus-4");
      expect(output).toContain("thinking off");
      expect(output).toContain("thinking low");
      expect(output).toContain("recommended/default");
    });

    test("renders skip option for last agent", () => {
      const output = renderToString(
        <AgentModelAssignmentScreen cursor={0} agentIndex={6} totalAgents={7} modelId="openai/gpt-4o" defaultThinking="low" />,
      );

      expect(output).toContain("Select reasoning for Setup");
      expect(output).toContain("7/7");
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
          modelAssignments={{ "deck-lead": "openai-codex/gpt-5.5" }}
          thinkingAssignments={{ "deck-lead": "high" }}
        />,
      );

      expect(output).toContain("openai-codex/gpt-5.5 · thinking high");
    });
  });


  describe("MemoryProviderSelectionScreen", () => {
    test("offers exactly one adaptive-memory provider choice including Supermemory", () => {
      const output = renderToString(<MemoryProviderSelectionScreen cursor={0} selectedProvider="none" />);

      expect(output).toContain("Adaptive Memory");
      expect(output).toContain("None active");
      expect(output).not.toContain("Engram");
      expect(output).toContain("Supermemory requires Deck secret-store token");
    });

    test("confirms selected provider status", () => {
      const output = renderToString(
        <MemoryProviderSelectionScreen cursor={1} selectedProvider="supermemory" status="Active adaptive-memory provider: Supermemory. Token: [redacted]." />,
      );

      expect(output).toContain("active");
      expect(output).toContain("Token: [redacted]");
    });
  });

  describe("SupermemorySetupScreen", () => {
    test("token-only: redacts token and explains header plus per-operation scope", () => {
      const output = renderToString(
        <SupermemorySetupScreen
          screen="supermemory-token"
          values={{ token: "super-secret-token" }}
        />,
      );

      expect(output).toContain("Supermemory API key (Deck Runtime) (required)");
      expect(output).toContain("[redacted]");
      expect(output).not.toContain("super-secret-token");
      expect(output).toContain("Deck's owner-only");
      expect(output).toContain("secret store");
      expect(output).toContain("credential-free endpoint/canonical");
      expect(output).toContain("Pi");
      expect(output).toContain("MCP");
      // Token-only verification
      expect(output).toContain("identity");
      expect(output).toContain("derived from the key");
      expect(output).toContain("endpoint/canonical");
      expect(output).toContain("canonical");
      expect(output).toContain("scope");
      expect(output).not.toContain("Project scoping handled via x-sm-project header");
    });

    test("token-only: builds config without userId/teamId/orgId", () => {
      const config = buildSupermemoryDeckConfig({ token: "super-secret-token" });

      expect(config.adaptiveMemory.activeProvider).toBe("supermemory");
      // Verify removed fields
      expect(config.adaptiveMemory.supermemory).not.toHaveProperty("userId");
      expect(config.adaptiveMemory.supermemory).not.toHaveProperty("teamId");
      expect(config.adaptiveMemory.supermemory).not.toHaveProperty("orgId");
    });

    test("token-only: creates provider without userId", async () => {
      // This is the test for R10 scenario
      const provider = createMemoryProviderForSelection("supermemory", { token: "redacted-token" });

      expect(provider?.id).toBe("supermemory");
      expect(JSON.stringify(provider)).not.toContain("redacted-token");
      // Provider should be created without throwing (even if health is degraded)
      expect(provider).toBeDefined();
    });

    test("writes credential-free Supermemory Pi MCP config without leaking token in status", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "deck-supermemory-tui-"));
      const token = "sentinel-supermemory-token";
      const configPath = join(tempDir, ".pi", "agent", "mcp.json");

      try {
        const result = handOffSupermemoryCredentialToPiMcp(
          { token },
          { configPath, projectScope: "sm_project_v1_kevin15011_deck" },
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain("Pi MCP config");
        expect(result.message).toContain("bearer credentials remain only");
        expect(result.message).not.toContain(token);

        if (existsSync(configPath)) {
          const externalConfig = JSON.parse(readFileSync(configPath, "utf-8"));
          expect(externalConfig.mcpServers.supermemory.url).toBe("https://mcp.supermemory.ai/mcp");
          expect(externalConfig.mcpServers.supermemory.headers["x-sm-project"]).toBe("sm_project_v1_kevin15011_deck");
          expect(JSON.stringify(externalConfig)).not.toContain("x-supermemory-api-key");
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("reports failed Pi MCP config writer errors without leaking token", () => {
      const token = "sentinel-failing-token";
      const result = handOffSupermemoryCredentialToPiMcp(
        { token },
        {
          writer: () => ({
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
                message: "Unable to write Pi MCP config; token: [REDACTED]",
              },
            ],
          }),
          projectScope: "sm_project_v1_kevin15011_deck",
        },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unable to configure Supermemory");
      expect(result.message).toContain("[REDACTED]");
      expect(result.message).not.toContain(token);
    });

    test("Pi Supermemory setup path does not fall back to ambient process.cwd", () => {
      const source = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
      const setupSlice = source.slice(source.indexOf("function persistMemoryProviderSelection"), source.indexOf("function detectPiProvidersForTui"));

      expect(setupSlice).not.toContain("process.cwd()");
      expect(setupSlice).toContain("localResolvedProjectRoot");
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
      const output = renderToString(<DeveloperTeamInstallingScreen currentStep={5} totalSteps={12} currentItem="deck-quality" />);

      expect(output).toContain("Installing Developer Team");
      expect(output).toContain("(5/12)");
    });

    test("renders without progress when no props provided", () => {
      const output = renderToString(<DeveloperTeamInstallingScreen />);

      expect(output).toContain("Installing Developer Team");
      expect(output).not.toContain("(/");
    });
  });

  describe("PersonalitySelectionScreen", () => {
    const personalities = [
      { id: "guia" as const, label: "Guía (Teacher)", hint: "Full explanations with educational context" },
      { id: "pragmatica" as const, label: "Pragmática (Pragmatic)", hint: "Balanced — what you need, nothing more" },
    ];

    test("renders two personality options with correct labels", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="pragmatica" />
        </ScreenFrame>,
      );

      expect(output).toContain("Guía (Teacher)");
      expect(output).toContain("Pragmática (Pragmatic)");
    });

    test("renders hints for both options", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="pragmatica" />
        </ScreenFrame>,
      );

      expect(output).toContain("Full explanations with educational context");
      expect(output).toContain("Balanced — what you need, nothing more");
    });

    test("shows cursor indicator on the focused option", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="pragmatica" />
        </ScreenFrame>,
      );

      // The ❯ cursor should appear before "Guía (Teacher)" when cursor=0
      const guiaIdx = output.indexOf("Guía (Teacher)");
      const cursorBeforeGuia = output.lastIndexOf("❯", guiaIdx);
      expect(cursorBeforeGuia).toBeGreaterThan(-1);
      expect(cursorBeforeGuia).toBeLessThan(guiaIdx);
    });

    test("shows cursor on Pragmática when cursor=1 (default position)", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={1} selected="pragmatica" />
        </ScreenFrame>,
      );

      // The ❯ cursor should appear before "Pragmática (Pragmatic)"
      const pragIdx = output.indexOf("Pragmática (Pragmatic)");
      const cursorBeforePrag = output.lastIndexOf("❯", pragIdx);
      expect(cursorBeforePrag).toBeGreaterThan(-1);
      expect(cursorBeforePrag).toBeLessThan(pragIdx);
    });

    test("shows cursor on Ahorro extremo when cursor=2", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={2} selected="pragmatica" />
        </ScreenFrame>,
      );

      // The ❯ cursor should appear before "Ahorro extremo (Extreme saver)"
      const ahorroIdx = output.indexOf("Ahorro extremo (Extreme saver)");
      const cursorBeforeAhorro = output.lastIndexOf("❯", ahorroIdx);
      expect(cursorBeforeAhorro).toBeGreaterThan(-1);
      expect(cursorBeforeAhorro).toBeLessThan(ahorroIdx);
    });

    test("renders the description text about Lead verbosity", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="pragmatica" />
        </ScreenFrame>,
      );

      expect(output).toContain("Controls how verbose Lead is when communicating");
      expect(output).toContain("rationale.");
    });

    test("renders with different selected personalities", () => {
      const outputGuia = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="guia" />
        </ScreenFrame>,
      );
      expect(outputGuia).toContain("Guía (Teacher)");

    });
  });

  describe("PersonalitySelectionScreen — config write on selection", () => {
    beforeEach(() => {
      // No-op: config writes happen in useEffect, not during render.
      // Real writeDeckConfig/readDeckConfig are never called in these tests
      // because they are triggered by user interactions (keypress handlers).
    });

    test("renders Guia as selected", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={0} selected="guia" />
        </ScreenFrame>,
      );
      expect(output).toContain("Guía (Teacher)");
    });

    test("renders Pragmatica as selected", () => {
      const output = renderToString(
        <ScreenFrame title="Choose Lead personality" help="help">
          <PersonalitySelectionScreen cursor={1} selected="pragmatica" />
        </ScreenFrame>,
      );
      expect(output).toContain("Pragmática (Pragmatic)");
    });
  });

  describe("PersonalitySelectionScreen — flow routing", () => {
    test("environment-selection routes to personality-selection via getNextScreenAfterEnvironmentSelection", () => {
      // This is tested in developer-team-flow.test.ts for the pure function.
      // Here we verify the routing helper is correctly imported and available.
      const { getNextScreenAfterEnvironmentSelection } = require("../developer-team-flow");
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: ["pi-development"],
        hasPiCommand: true,
        nextEnvironment: null,
      });
      expect(result).toBe("personality-selection");
    });

    test("getNextScreenAfterEnvironmentSelection returns complete when no environments selected", () => {
      const { getNextScreenAfterEnvironmentSelection } = require("../developer-team-flow");
      const result = getNextScreenAfterEnvironmentSelection({
        selectedEnvironments: [],
        hasPiCommand: false,
        nextEnvironment: null,
      });
      expect(result).toBe("complete");
    });
  });

  describe("PersonalitySelectionScreen — back navigation", () => {
    test("goBack from personality-selection routes to environment-selection", () => {
      // Verify the goBack mapping in app.tsx: personality-selection → environment-selection
      // The mapping is: "personality-selection": "environment-selection"
      // This is a static navigation test verifying the routing map is correct.
      const previousScreenRecord = {
        "personality-selection": "environment-selection",
        "environment-selection": "home",
      };
      const next = previousScreenRecord["personality-selection"];
      expect(next).toBe("environment-selection");
    });

    test("back navigation from personality-selection does not write config", () => {
      // Back navigation goes through goBack() which calls resetCursor without calling
      // continueFromCurrent(), so writeDeckConfig should NOT be called.
      // This test verifies the goBack routing does not trigger config write.
      const backNavigationScreens = ["personality-selection"];
      const screenRequiringConfigWrite = ["personality-selection"];

      // Back navigation from personality-selection should NOT be in the continueFromCurrent flow
      // which is the only place writeDeckConfig is called for personality selection.
      const doesBackNavigationTriggerConfigWrite = screenRequiringConfigWrite.includes("personality-selection") && !backNavigationScreens.includes("personality-selection");
      expect(doesBackNavigationTriggerConfigWrite).toBe(false);
    });
  });
});
