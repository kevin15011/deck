import React, { useEffect, useMemo, useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  buildOpenCodeInstallationPlan,
  getSelectableOpenCodeTools,
  inspectOpenCodeEnvironment,
  installOpenCodeTools,
  reviewOpenCodeTools,
  type InstallableOpenCodeTool,
  type InstallableOpenCodeToolId,
  type OpenCodePreflightResult,
  type OpenCodeToolsReview,
  type OpenCodeToolInstallResult,
} from "@deck/adapter-opencode";
import {
  buildDeveloperTeamInstallPlan,
  applyDeveloperTeamInstall,
  backupDeveloperTeamFiles,
  buildModelInventoryFromPiListModels,
  buildPiInstallationPlan,
  detectConfiguredProviders,
  getDefaultThinkingForModel,
  getOptionalPiTools,
  getTeamsForEnvironment,
  inspectPiEnvironment,
  installPiTools,
  listModelsForProvider,
  PI_THINKING_LEVELS,
  readDeveloperTeamModelConfigAssignments,
  resolveThinkingForModel,
  reviewPiRequiredTools,
  rollbackDeveloperTeamFiles,
  supportsDeveloperTeamModel,
  supportsThinkingForModel,
  verifyDeveloperTeamInstall,
  writeSupermemoryPiMcpConfig,
  redactPiMcpConfigDiagnosticText,
  type PiMcpConfigWriteResult,
  DEVELOPER_TEAM_AGENTS,
  type AgentApplyResult,
  type DeveloperTeamModelAssignments,
  type DeveloperTeamThinkingAssignments,
  type InstallablePiTool,
  type InstallablePiToolId,
  type PiModel,
  type PiPreflightResult,
  type PiProvider,
  type PiRequiredToolsReview,
  type PiToolInstallResult,
} from "@deck/adapter-pi";

import { createEngramMemoryProvider } from "@deck/adapter-engram";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import { writeDeckConfig, type AdaptiveMemoryActiveProvider } from "@deck/core/config/deck-config";

import {
  getNextScreenAfterDeveloperTeamInstall,
  getNextScreenAfterDeveloperTeamReview,
  getNextScreenAfterPiToolInstall,
  getNextScreenAfterTeamSelection,
} from "../developer-team-flow";
import { getEnvironmentOptions, getHomeMenuOptions } from "../menu-options";
import { resolveProjectRoot } from "../project-root";
import { detectSelectedRuntimes, type EnvironmentId, type RuntimeStatus } from "../runtime-detection";
import { MenuList } from "./components/menu-list";
import { ScreenFrame } from "./screen-frame";
import {
  AgentModelAssignmentScreen,
  AgentModelConfigListScreen,
  DeveloperTeamInstallingScreen,
  DeveloperTeamReviewScreen,
  ModelProviderSelectionScreen,
  ModelSelectionScreen,
  NoProvidersScreen,
  MemoryProviderSelectionScreen,
  SupermemorySetupScreen,
  type SupermemorySetupValues,
} from "./screens/developer-team-screens";
import { HomeScreen } from "./screens/home-screen";

type Screen =
  | "home"
  | "model-environment-selection"
  | "model-team-selection"
  | "environment-selection"
  | "environment-check"
  | "pi-preflight-checking"
  | "pi-preflight"
  | "required-tools"
  | "optional-tools"
  | "installation-review"
  | "installing"
  | "team-selection"
  | "agent-model-config-list"
  | "model-provider-selection"
  | "model-selection"
  | "agent-model-assignment"
  | "no-providers"
  | "memory-provider-selection"
  | "supermemory-token"
  | "supermemory-user-id"
  | "supermemory-team-id"
  | "supermemory-org-id"
  | "developer-team-review"
  | "developer-team-installing"
  | "opencode-preflight-checking"
  | "opencode-preflight"
  | "opencode-tools"
  | "opencode-tool-selection"
  | "opencode-installation-review"
  | "opencode-installing"
  | "complete";

const HELP = "j/k or ↑/↓: navigate • space: toggle • enter: continue • esc: back • q: quit";

type MemoryProviderChoice = AdaptiveMemoryActiveProvider;

function redactSecret(value: string): string {
  return value.length > 0 ? "[redacted]" : "";
}

export function buildSupermemoryDeckConfig(values: SupermemorySetupValues) {
  return {
    version: 1,
    adaptiveMemory: {
      activeProvider: "supermemory" as const,
      supermemory: {
        mcpServerName: "supermemory",
        userId: values.userId.trim(),
        ...(values.teamId.trim() ? { teamId: values.teamId.trim() } : {}),
        ...(values.orgId.trim() ? { orgId: values.orgId.trim() } : {}),
        searchMode: "memories" as const,
        maxMemoriesPerSession: 7,
      },
    },
  };
}

export function buildMemoryProviderConfig(choice: MemoryProviderChoice, values: SupermemorySetupValues) {
  if (choice === "supermemory") return buildSupermemoryDeckConfig(values);
  return { version: 1, adaptiveMemory: { activeProvider: choice } };
}

export function createMemoryProviderForSelection(choice: MemoryProviderChoice): AdaptiveMemoryProvider | undefined {
  if (choice === "engram") return createEngramMemoryProvider();
  return undefined;
}

type SupermemoryPiMcpWriter = (options: { token: string; serverName?: string; configPath?: string; homeDir?: string }) => PiMcpConfigWriteResult;

export function handOffSupermemoryCredentialToPiMcp(
  values: SupermemorySetupValues,
  options?: { writer?: SupermemoryPiMcpWriter; configPath?: string; homeDir?: string },
): { success: boolean; message: string; path?: string } {
  const token = values.token.trim();
  if (!token) {
    return { success: false, message: "Supermemory token is required and must be stored outside Deck config." };
  }

  const writer = options?.writer ?? writeSupermemoryPiMcpConfig;
  const result = writer({ token, serverName: "supermemory", configPath: options?.configPath, homeDir: options?.homeDir });
  const diagnosticText = redactPiMcpConfigDiagnosticText(result.diagnostics.map((diagnostic) => diagnostic.message).join(" "));

  if (!result.ok) {
    return {
      success: false,
      path: result.path,
      message: `Unable to configure Supermemory in Pi MCP config at ${result.path}. ${diagnosticText || "Check file permissions and existing MCP config JSON, then try again."}`,
    };
  }

  return {
    success: true,
    path: result.path,
    message: `Supermemory MCP server '${result.serverName}' configured in Pi MCP config at ${result.path}; credential value is ${redactSecret(token)}.`,
  };
}

export function DeckApp() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<Screen>("home");
  const [cursor, setCursor] = useState(0);
  const [homeCursor, setHomeCursor] = useState(0);
  const [selectedEnvironments, setSelectedEnvironments] = useState<EnvironmentId[]>(["pi-development"]);
  const [runtimeStatuses, setRuntimeStatuses] = useState<RuntimeStatus[]>([]);
  const [piPreflight, setPiPreflight] = useState<PiPreflightResult | null>(null);
  const [toolsReview, setToolsReview] = useState<PiRequiredToolsReview | null>(null);
  const [selectedOptionalTools, setSelectedOptionalTools] = useState<InstallablePiToolId[]>(
    getOptionalPiTools().map((tool) => tool.id),
  );
  const [openCodePreflight, setOpenCodePreflight] = useState<OpenCodePreflightResult | null>(null);
  const [openCodeToolsReview, setOpenCodeToolsReview] = useState<OpenCodeToolsReview | null>(null);
  const [selectedOpenCodeTools, setSelectedOpenCodeTools] = useState<InstallableOpenCodeToolId[]>(
    getSelectableOpenCodeTools().map((tool) => tool.id),
  );
  const [installResults, setInstallResults] = useState<(PiToolInstallResult | OpenCodeToolInstallResult)[]>([]);
  const [developerTeamResults, setDeveloperTeamResults] = useState<AgentApplyResult[]>([]);
  const [developerTeamCursor, setDeveloperTeamCursor] = useState(0);
  const [selectedTeams, setSelectedTeams] = useState<string[]>(
    getTeamsForEnvironment("pi-development").map((team) => team.id),
  );

  // Model configuration state
  const [detectedProviders, setDetectedProviders] = useState<PiProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<PiProvider | null>(null);
  const [providerModels, setProviderModels] = useState<PiModel[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, PiModel[]>>({});
  const [selectedModel, setSelectedModel] = useState<PiModel | null>(null);
  const [modelAssignments, setModelAssignments] = useState<DeveloperTeamModelAssignments>({});
  const [thinkingAssignments, setThinkingAssignments] = useState<DeveloperTeamThinkingAssignments>({});
  const [agentAssignmentIndex, setAgentAssignmentIndex] = useState(0);
  const [agentConfigCursor, setAgentConfigCursor] = useState(0);
  const [modelEnvironmentCursor, setModelEnvironmentCursor] = useState(0);
  const [modelTeamCursor, setModelTeamCursor] = useState(0);
  const [selectedModelEnvironment, setSelectedModelEnvironment] = useState<EnvironmentId | null>(null);
  const [modelConfigSource, setModelConfigSource] = useState<"install" | "menu" | null>(null);
  const [memoryProvider, setMemoryProvider] = useState<AdaptiveMemoryProvider | undefined>(undefined);
  const [memoryProviderChoice, setMemoryProviderChoice] = useState<MemoryProviderChoice>("none");
  const [supermemorySetup, setSupermemorySetup] = useState<SupermemorySetupValues>({ token: "", userId: "", teamId: "", orgId: "" });
  const [supermemoryError, setSupermemoryError] = useState<string | undefined>(undefined);
  const [memoryStatus, setMemoryStatus] = useState<string | undefined>(undefined);

  const installedPi = runtimeStatuses.find((status) => status.runtime === "pi" && status.installed && status.command);
  const installedOpenCode = runtimeStatuses.find((status) => status.runtime === "opencode" && status.installed && status.command);
  const installationPlan = useMemo(
    () =>
      toolsReview
        ? buildPiInstallationPlan({
            requiredTools: toolsReview.requiredTools,
            selectedOptionalToolIds: selectedOptionalTools,
          })
        : [],
    [selectedOptionalTools, toolsReview],
  );
  const openCodeInstallationPlan = useMemo(
    () =>
      openCodeToolsReview
        ? buildOpenCodeInstallationPlan({
            tools: openCodeToolsReview.tools,
            selectedToolIds: selectedOpenCodeTools,
          })
        : [],
    [openCodeToolsReview, selectedOpenCodeTools],
  );

  useInput((input, key) => {
    if (isSupermemoryInputScreen(screen)) {
      handleSupermemoryTextInput(input, key);
      return;
    }

    if (input === "q") {
      exit();
      return;
    }

    if (key.escape) {
      goBack();
      return;
    }

    if (key.upArrow || input === "k") {
      moveCursor(-1);
      return;
    }

    if (key.downArrow || input === "j") {
      moveCursor(1);
      return;
    }

    if (input === " ") {
      toggleCurrent();
      return;
    }

    if (key.return) {
      continueFromCurrent();
    }
  });

  useEffect(() => {
    if (screen !== "pi-preflight-checking") return;

    let cancelled = false;

    async function runPreflight() {
      await new Promise((resolve) => setTimeout(resolve, 120));

      if (!installedPi?.command) {
        if (!cancelled) resetCursor("complete");
        return;
      }

      const preflight = inspectPiEnvironment({ command: installedPi.command });
      const review = reviewPiRequiredTools({ command: installedPi.command });

      if (!cancelled) {
        setPiPreflight(preflight);
        setToolsReview(review);
        resetCursor("pi-preflight");
      }
    }

    void runPreflight();

    return () => {
      cancelled = true;
    };
  }, [installedPi?.command, screen]);

  useEffect(() => {
    if (screen !== "opencode-preflight-checking") return;

    let cancelled = false;

    async function runOpenCodePreflight() {
      await new Promise((resolve) => setTimeout(resolve, 120));

      if (!installedOpenCode?.command) {
        if (!cancelled) resetCursor("complete");
        return;
      }

      const preflight = inspectOpenCodeEnvironment({ command: installedOpenCode.command });
      const review = reviewOpenCodeTools({ packageManifest: preflight.packageManifest });

      if (!cancelled) {
        setOpenCodePreflight(preflight);
        setOpenCodeToolsReview(review);
        resetCursor("opencode-preflight");
      }
    }

    void runOpenCodePreflight();

    return () => {
      cancelled = true;
    };
  }, [installedOpenCode?.command, screen]);

  useEffect(() => {
    if (screen !== "installing") return;

    let cancelled = false;

    async function runInstall() {
      const results = await installPiTools(installedPi?.command, installationPlan, (result) => {
        if (!cancelled) setInstallResults((current) => [...current, result]);
      });

      if (!cancelled) {
        setInstallResults(results);
        goToNextEnvironmentOrComplete();
      }
    }

    void runInstall();

    return () => {
      cancelled = true;
    };
  }, [installationPlan, installedPi?.command, screen]);

  useEffect(() => {
    if (screen !== "opencode-installing") return;

    let cancelled = false;

    async function runInstall() {
      const results = await installOpenCodeTools(installedOpenCode?.command, openCodeInstallationPlan, (result) => {
        if (!cancelled) setInstallResults((current) => [...current, result]);
      });

      if (!cancelled) {
        setInstallResults(results);
        setScreen("complete");
        setCursor(0);
      }
    }

    void runInstall();

    return () => {
      cancelled = true;
    };
  }, [installedOpenCode?.command, openCodeInstallationPlan, screen]);

  useEffect(() => {
    if (screen !== "developer-team-installing") return;

    let cancelled = false;

    function runInstall() {
      const projectRoot = resolveProjectRoot();
      const plan = buildDeveloperTeamInstallPlan(projectRoot, { modelAssignments, thinkingAssignments, ...(memoryProvider ? { memoryProvider } : {}) });
      const backup = backupDeveloperTeamFiles(plan);

      try {
        const applyResult = applyDeveloperTeamInstall(plan);
        const verifyResult = verifyDeveloperTeamInstall(plan);

        if (!cancelled) {
          if (!verifyResult.valid) {
            rollbackDeveloperTeamFiles(backup);
            setDeveloperTeamResults([]);
            setInstallResults((current) => [
              ...current,
              { tool: "Developer Team", success: false, message: "Verification failed. Changes rolled back." },
            ]);
          } else {
            setDeveloperTeamResults(applyResult.results);
          }

          const nextScreen = getNextScreenAfterDeveloperTeamInstall({
            selectedEnvironments,
            hasOpenCodeNext:
              selectedEnvironments.includes("opencode-development") && Boolean(installedOpenCode?.command) && !openCodePreflight,
          });

          resetCursor(nextScreen);
        }
      } catch (error) {
        if (!cancelled) {
          rollbackDeveloperTeamFiles(backup);
          setDeveloperTeamResults([]);
          setInstallResults((current) => [
            ...current,
            {
              tool: "Developer Team",
              success: false,
              message: `Installation failed. Changes rolled back.${error instanceof Error ? ` ${error.message}` : ""}`,
            },
          ]);

          const nextScreen = getNextScreenAfterDeveloperTeamInstall({
            selectedEnvironments,
            hasOpenCodeNext:
              selectedEnvironments.includes("opencode-development") && Boolean(installedOpenCode?.command) && !openCodePreflight,
          });

          resetCursor(nextScreen);
        }
      }
    }

    runInstall();

    return () => {
      cancelled = true;
    };
  }, [screen, selectedEnvironments, installedOpenCode?.command, openCodePreflight, modelAssignments, thinkingAssignments]);

  function resetCursor(nextScreen: Screen, nextCursor = 0) {
    setScreen(nextScreen);
    setCursor(nextScreen === "home" ? homeCursor : nextCursor);
    if (nextScreen === "agent-model-config-list") setAgentConfigCursor(0);
    if (nextScreen === "developer-team-review") setDeveloperTeamCursor(0);
  }

  function getCursorLimit(): number {
    if (screen === "home") return getHomeMenuOptions().length - 1;
    if (screen === "model-environment-selection") return getEnvironmentOptions().length - 1;
    if (screen === "model-team-selection") return Math.max(0, getTeamsForEnvironment("pi-development").length - 1);
    if (screen === "environment-selection") return getEnvironmentOptions().length - 1;
    if (screen === "optional-tools") return getOptionalPiTools().length - 1;
    if (screen === "opencode-tool-selection") return getSelectableOpenCodeTools().length - 1;
    if (screen === "installation-review") return 1;
    if (screen === "opencode-installation-review") return 1;
    if (screen === "team-selection") return Math.max(0, getTeamsForEnvironment("pi-development").length - 1);
    if (screen === "memory-provider-selection") return 2;
    if (screen === "developer-team-review") return 1;
    if (screen === "agent-model-config-list") return DEVELOPER_TEAM_AGENTS.length;
    if (screen === "model-provider-selection") return Math.max(0, detectedProviders.length - 1);
    if (screen === "model-selection") return Math.max(0, providerModels.length - 1);
    if (screen === "agent-model-assignment") return selectedModel && supportsThinkingForModel(selectedModel) ? PI_THINKING_LEVELS.length - 1 : 0;
    if (screen === "no-providers") return 0;
    return 0;
  }

  function moveCursor(delta: number) {
    const limit = getCursorLimit();
    const next = Math.min(limit, Math.max(0, cursor + delta));
    setCursor(next);
    if (screen === "home") setHomeCursor(next);
    if (screen === "model-environment-selection") setModelEnvironmentCursor(next);
    if (screen === "model-team-selection") setModelTeamCursor(next);
    if (screen === "agent-model-config-list") setAgentConfigCursor(next);
    if (screen === "developer-team-review") setDeveloperTeamCursor(next);
  }

  function toggleCurrent() {
    if (screen === "environment-selection") {
      const option = getEnvironmentOptions()[cursor];
      if (!option) return;
      const id = option.value as EnvironmentId;
      setSelectedEnvironments((current) =>
        current.includes(id) ? current.filter((environment) => environment !== id) : [...current, id],
      );
      return;
    }

    if (screen === "team-selection") {
      const teams = getTeamsForEnvironment("pi-development");
      const team = teams[cursor];
      if (!team) return;
      setSelectedTeams((current) =>
        current.includes(team.id) ? current.filter((id) => id !== team.id) : [...current, team.id],
      );
      return;
    }

    if (screen === "optional-tools") {
      const tool = getOptionalPiTools()[cursor];
      if (!tool) return;
      setSelectedOptionalTools((current) =>
        current.includes(tool.id) ? current.filter((selected) => selected !== tool.id) : [...current, tool.id],
      );
    }

    if (screen === "opencode-tool-selection") {
      const tool = getSelectableOpenCodeTools()[cursor];
      if (!tool) return;
      setSelectedOpenCodeTools((current) =>
        current.includes(tool.id) ? current.filter((selected) => selected !== tool.id) : [...current, tool.id],
      );
    }
  }

  function continueFromCurrent() {
    if (screen === "home") {
      const action = getHomeMenuOptions()[homeCursor]?.value;
      if (action === "start-installation") resetCursor("environment-selection");
      if (action === "configure-models") {
        setModelConfigSource("menu");
        resetCursor("model-environment-selection");
        return;
      }
      if (action === "exit") exit();
      return;
    }

    if (screen === "model-environment-selection") {
      const option = getEnvironmentOptions()[modelEnvironmentCursor];
      if (!option) return;
      const environment = option.value as EnvironmentId;
      setSelectedModelEnvironment(environment);

      if (environment === "pi-development") {
        resetCursor("model-team-selection");
      } else {
        resetCursor("complete");
      }
      return;
    }

    if (screen === "model-team-selection") {
      const teams = getTeamsForEnvironment("pi-development");
      const team = teams[modelTeamCursor];
      if (!team) return;

      if (team.id === "developer-team") {
        hydrateDeveloperTeamModelConfig();
        const inventory = detectPiModelInventoryForTui();
        setDetectedProviders(inventory.providers);
        setModelsByProvider(inventory.modelsByProvider);
        if (inventory.providers.length === 0) {
          resetCursor("no-providers");
        } else {
          resetCursor("agent-model-config-list");
        }
      }
      return;
    }

    if (screen === "environment-selection") {
      const selected = selectedEnvironments.length > 0 ? selectedEnvironments : ["pi-development" as EnvironmentId];
      const statuses = detectSelectedRuntimes(selected);
      setRuntimeStatuses(statuses);
      resetCursor("environment-check");
      return;
    }

    if (screen === "environment-check") {
      if (selectedEnvironments.includes("pi-development") && installedPi?.command) return resetCursor("pi-preflight-checking");
      if (selectedEnvironments.includes("opencode-development") && installedOpenCode?.command) {
        return resetCursor("opencode-preflight-checking");
      }
      resetCursor("complete");
      return;
    }

    if (screen === "pi-preflight") return resetCursor("required-tools");
    if (screen === "required-tools") return resetCursor("optional-tools");
    if (screen === "optional-tools") return resetCursor("installation-review");

    if (screen === "installation-review") {
      if (cursor === 0 && installationPlan.length > 0) resetCursor("installing");
      else goToNextEnvironmentOrComplete();
      return;
    }

    if (screen === "team-selection") {
      const nextScreen = getNextScreenAfterTeamSelection({
        selectedTeams,
        hasOpenCodeNext:
          selectedEnvironments.includes("opencode-development") && Boolean(installedOpenCode?.command) && !openCodePreflight,
      });

      if (nextScreen === "developer-team-review") {
        // Insert model configuration before review
        hydrateDeveloperTeamModelConfig();
        const inventory = detectPiModelInventoryForTui();
        setDetectedProviders(inventory.providers);
        setModelsByProvider(inventory.modelsByProvider);
        setModelConfigSource("install");
        if (inventory.providers.length === 0) {
          resetCursor("no-providers");
        } else {
          resetCursor("agent-model-config-list");
        }
        return;
      }

      resetCursor(nextScreen);
      return;
    }

    if (screen === "model-provider-selection") {
      const provider = detectedProviders[cursor];
      if (!provider) return;
      setSelectedProvider(provider);
      const models = modelsByProvider[provider.id] ?? listModelsForProvider(provider.id, { runCommand: runPiCommand });
      setProviderModels(models);
      setSelectedModel(null);
      resetCursor("model-selection");
      return;
    }

    if (screen === "agent-model-config-list") {
      if (cursor === DEVELOPER_TEAM_AGENTS.length) {
        // Finish button
        if (modelConfigSource === "install") {
          resetCursor("memory-provider-selection");
        } else {
          applyDeveloperTeamModelConfig();
          resetCursor("complete");
        }
      } else {
        setAgentAssignmentIndex(cursor);
        resetCursor("model-provider-selection");
      }
      return;
    }

    if (screen === "model-selection") {
      const model = providerModels[cursor];
      if (!model) return;
      if (!supportsDeveloperTeamModel(model)) {
        resetCursor("agent-model-config-list");
        return;
      }
      setSelectedModel(model);
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      const existingThinking = agent ? thinkingAssignments[agent.id] : undefined;
      if (!supportsThinkingForModel(model)) {
        if (agent) {
          setModelAssignments((current) => ({ ...current, [agent.id]: model.id }));
          setThinkingAssignments((current) => ({ ...current, [agent.id]: "off" }));
        }
        setSelectedModel(null);
        resetCursor("agent-model-config-list");
        return;
      }
      const defaultThinking = resolveThinkingForModel(model, existingThinking);
      resetCursor("agent-model-assignment", Math.max(0, PI_THINKING_LEVELS.indexOf(defaultThinking)));
      return;
    }

    if (screen === "agent-model-assignment") {
      if (!selectedModel) return;
      const agent = DEVELOPER_TEAM_AGENTS[agentAssignmentIndex];
      if (!agent) return;
      const thinking = resolveThinkingForModel(selectedModel, getThinkingLevelByCursor(cursor));
      setModelAssignments((current) => ({ ...current, [agent.id]: selectedModel.id }));
      setThinkingAssignments((current) => ({ ...current, [agent.id]: thinking }));
      setSelectedModel(null);
      resetCursor("agent-model-config-list");
      return;
    }

    if (screen === "no-providers") {
      if (modelConfigSource === "install") {
        resetCursor("memory-provider-selection");
      } else {
        resetCursor("home");
      }
      return;
    }

    if (screen === "memory-provider-selection") {
      const choice = (["none", "engram", "supermemory"] as const)[cursor];
      if (!choice) return;
      setMemoryProviderChoice(choice);
      setSupermemoryError(undefined);
      if (choice === "supermemory") {
        resetCursor("supermemory-token");
        return;
      }
      persistMemoryProviderSelection(choice, supermemorySetup);
      resetCursor("developer-team-review");
      return;
    }

    if (isSupermemoryInputScreen(screen)) {
      continueSupermemorySetup();
      return;
    }

    if (screen === "developer-team-review") {
      const nextScreen = getNextScreenAfterDeveloperTeamReview({
        cursor: developerTeamCursor,
        selectedEnvironments,
        hasOpenCodeNext:
          selectedEnvironments.includes("opencode-development") && Boolean(installedOpenCode?.command) && !openCodePreflight,
      });

      if (nextScreen === "developer-team-installing") {
        resetCursor("developer-team-installing");
      } else {
        resetCursor(nextScreen);
      }
      return;
    }

    if (screen === "opencode-preflight") return resetCursor("opencode-tools");
    if (screen === "opencode-tools") return resetCursor("opencode-tool-selection");
    if (screen === "opencode-tool-selection") return resetCursor("opencode-installation-review");

    if (screen === "opencode-installation-review") {
      if (cursor === 0 && openCodeInstallationPlan.length > 0) resetCursor("opencode-installing");
      else resetCursor("complete");
      return;
    }

    if (screen === "complete") resetCursor("home");
  }

  function isSupermemoryInputScreen(value: Screen): value is "supermemory-token" | "supermemory-user-id" | "supermemory-team-id" | "supermemory-org-id" {
    return value === "supermemory-token" || value === "supermemory-user-id" || value === "supermemory-team-id" || value === "supermemory-org-id";
  }

  function supermemoryFieldForScreen(value: Screen): keyof SupermemorySetupValues | undefined {
    if (value === "supermemory-token") return "token";
    if (value === "supermemory-user-id") return "userId";
    if (value === "supermemory-team-id") return "teamId";
    if (value === "supermemory-org-id") return "orgId";
    return undefined;
  }

  function handleSupermemoryTextInput(input: string, key: { return?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean }) {
    if (key.escape) {
      goBack();
      return;
    }
    if (key.return) {
      continueSupermemorySetup();
      return;
    }
    const field = supermemoryFieldForScreen(screen);
    if (!field) return;
    if (key.backspace || key.delete) {
      setSupermemorySetup((current) => ({ ...current, [field]: current[field].slice(0, -1) }));
      return;
    }
    if (input && !input.includes("") && input !== "q") {
      setSupermemorySetup((current) => ({ ...current, [field]: `${current[field]}${input}` }));
    }
  }

  function continueSupermemorySetup() {
    setSupermemoryError(undefined);
    if (screen === "supermemory-token") {
      if (!supermemorySetup.token.trim()) {
        setSupermemoryError("Supermemory token is required and must be stored outside Deck config.");
        return;
      }
      resetCursor("supermemory-user-id");
      return;
    }
    if (screen === "supermemory-user-id") {
      if (!supermemorySetup.userId.trim()) {
        setSupermemoryError("Supermemory configuration requires an explicit userId.");
        return;
      }
      resetCursor("supermemory-team-id");
      return;
    }
    if (screen === "supermemory-team-id") {
      resetCursor("supermemory-org-id");
      return;
    }
    if (screen === "supermemory-org-id") {
      if (persistMemoryProviderSelection("supermemory", supermemorySetup)) {
        resetCursor("developer-team-review");
      }
    }
  }

  function persistMemoryProviderSelection(choice: MemoryProviderChoice, values: SupermemorySetupValues): boolean {
    try {
      if (choice === "supermemory") {
        const handoff = handOffSupermemoryCredentialToPiMcp(values);
        if (!handoff.success) {
          setMemoryProvider(undefined);
          setSupermemoryError(handoff.message);
          setMemoryStatus(`Supermemory MCP setup failed: ${handoff.message}`);
          return false;
        }
      }

      const config = buildMemoryProviderConfig(choice, values);
      writeDeckConfig(resolveProjectRoot(), config);
      setMemoryProvider(createMemoryProviderForSelection(choice));
      if (choice === "supermemory") {
        setMemoryStatus("Active adaptive-memory provider: Supermemory MCP. Token: [redacted]. Pi MCP config: ~/.pi/agent/mcp.json.");
      } else if (choice === "engram") {
        setMemoryStatus("Active adaptive-memory provider: Engram.");
      } else {
        setMemoryStatus("Adaptive memory disabled.");
      }
      return true;
    } catch (error) {
      setMemoryProvider(undefined);
      setSupermemoryError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  function detectPiProvidersForTui() {
    return detectConfiguredProviders({
      settingsPath: getPiSettingsPath(),
      readFile: readFileSync,
      runCommand: runPiCommand,
    });
  }

  function hydrateDeveloperTeamModelConfig() {
    const assignments = readDeveloperTeamModelConfigAssignments(resolveProjectRoot());
    setModelAssignments(assignments.modelAssignments);
    setThinkingAssignments(assignments.thinkingAssignments);
  }

  function getThinkingLevelByCursor(index: number) {
    return PI_THINKING_LEVELS[index] ?? "low";
  }

  function applyDeveloperTeamModelConfig() {
    const projectRoot = resolveProjectRoot();
    const plan = buildDeveloperTeamInstallPlan(projectRoot, { modelAssignments, thinkingAssignments, ...(memoryProvider ? { memoryProvider } : {}) });
    const backup = backupDeveloperTeamFiles(plan);

    try {
      const applyResult = applyDeveloperTeamInstall(plan);
      const verifyResult = verifyDeveloperTeamInstall(plan);

      if (!verifyResult.valid) {
        rollbackDeveloperTeamFiles(backup);
        setDeveloperTeamResults([]);
        setInstallResults((current) => [
          ...current,
          { tool: "Developer Team models", success: false, message: "Verification failed. Changes rolled back." },
        ]);
        return;
      }

      setDeveloperTeamResults(applyResult.results);
    } catch (error) {
      rollbackDeveloperTeamFiles(backup);
      setDeveloperTeamResults([]);
      setInstallResults((current) => [
        ...current,
        {
          tool: "Developer Team models",
          success: false,
          message: `Model configuration failed. Changes rolled back.${error instanceof Error ? ` ${error.message}` : ""}`,
        },
      ]);
    }
  }

  function detectPiModelInventoryForTui() {
    const listModelsResult = runPiCommand("pi", ["--list-models"]);
    const output = listModelsResult.stdout || listModelsResult.stderr || "";
    if (listModelsResult.exitCode === 0 && output.trim().length > 0) {
      const inventory = buildModelInventoryFromPiListModels(output);
      if (inventory.providers.length > 0) return inventory;
    }

    const providers = detectPiProvidersForTui();
    return {
      providers,
      modelsByProvider: Object.fromEntries(providers.map((provider) => [provider.id, listModelsForProvider(provider.id)])),
    };
  }

  function runPiCommand(command: string, args: string[]) {
    const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
    return {
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      exitCode: result.exitCode,
    };
  }

  function getPiSettingsPath(): string {
    return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "settings.json");
  }

  function goToNextEnvironmentOrComplete() {
    const nextScreen = getNextScreenAfterPiToolInstall({
      selectedEnvironments,
      hasPiCommand: Boolean(installedPi?.command),
      hasOpenCodeNext: selectedEnvironments.includes("opencode-development") && Boolean(installedOpenCode?.command) && !openCodePreflight,
    });

    resetCursor(nextScreen);
  }

  function goBack() {
    let next: Screen | undefined;

    if (screen === "agent-model-config-list" || screen === "no-providers") {
      next = modelConfigSource === "install" ? "team-selection" : "model-team-selection";
    } else {
      const previous: Partial<Record<Screen, Screen>> = {
        "model-environment-selection": "home",
        "model-team-selection": "model-environment-selection",
        "environment-selection": "home",
        "environment-check": "environment-selection",
        "pi-preflight-checking": "environment-check",
        "pi-preflight": "environment-check",
        "required-tools": "pi-preflight",
        "optional-tools": "required-tools",
        "installation-review": "optional-tools",
        "installing": "installation-review",
        "team-selection": "installation-review",
        "agent-model-config-list": "team-selection",
        "model-provider-selection": "agent-model-config-list",
        "model-selection": "model-provider-selection",
        "agent-model-assignment": "model-selection",
        "no-providers": "team-selection",
        "memory-provider-selection": "agent-model-config-list",
        "supermemory-token": "memory-provider-selection",
        "supermemory-user-id": "supermemory-token",
        "supermemory-team-id": "supermemory-user-id",
        "supermemory-org-id": "supermemory-team-id",
        "developer-team-review": "memory-provider-selection",
        "developer-team-installing": "developer-team-review",
        "opencode-preflight-checking": "environment-check",
        "opencode-preflight": "environment-check",
        "opencode-tools": "opencode-preflight",
        "opencode-tool-selection": "opencode-tools",
        "opencode-installation-review": "opencode-tool-selection",
        "opencode-installing": "opencode-installation-review",
        complete: "home",
      };
      next = previous[screen];
    }

    if (next) resetCursor(next);
  }

  return (
    <ScreenFrame title={screenTitle(screen)} help={HELP} width={stdout.columns || 72} height={stdout.rows || undefined}>
      {screen === "home" ? <HomeScreen cursor={homeCursor} /> : null}
      {screen === "model-environment-selection" ? <ModelEnvironmentSelectionScreen cursor={modelEnvironmentCursor} /> : null}
      {screen === "model-team-selection" && selectedModelEnvironment ? (
        <ModelTeamSelectionScreen cursor={modelTeamCursor} environment={selectedModelEnvironment} />
      ) : null}
      {screen === "environment-selection" ? (
        <EnvironmentSelectionScreen cursor={cursor} selected={selectedEnvironments} />
      ) : null}
      {screen === "environment-check" ? <EnvironmentCheckScreen statuses={runtimeStatuses} /> : null}
      {screen === "pi-preflight-checking" ? <CheckingScreen /> : null}
      {screen === "pi-preflight" && piPreflight ? <PiPreflightScreen preflight={piPreflight} /> : null}
      {screen === "required-tools" && toolsReview ? <RequiredToolsScreen review={toolsReview} /> : null}
      {screen === "optional-tools" ? <OptionalToolsScreen cursor={cursor} selected={selectedOptionalTools} /> : null}
      {screen === "installation-review" ? <InstallationReviewScreen cursor={cursor} plan={installationPlan} /> : null}
      {screen === "installing" ? <Text>Installing selected tools...</Text> : null}
      {screen === "team-selection" ? <TeamSelectionScreen cursor={cursor} selected={selectedTeams} /> : null}
      {screen === "agent-model-config-list" ? (
        <AgentModelConfigListScreen cursor={agentConfigCursor} modelAssignments={modelAssignments} thinkingAssignments={thinkingAssignments} />
      ) : null}
      {screen === "model-provider-selection" ? (
        <ModelProviderSelectionScreen cursor={cursor} providers={detectedProviders} />
      ) : null}
      {screen === "model-selection" && selectedProvider ? (
        <ModelSelectionScreen cursor={cursor} provider={selectedProvider} models={providerModels} />
      ) : null}
      {screen === "agent-model-assignment" && selectedModel ? (
        <AgentModelAssignmentScreen
          cursor={cursor}
          agentIndex={agentAssignmentIndex}
          totalAgents={DEVELOPER_TEAM_AGENTS.length}
          modelId={selectedModel.id}
          defaultThinking={getDefaultThinkingForModel(selectedModel.id)}
          supportsThinking={supportsThinkingForModel(selectedModel)}
        />
      ) : null}
      {screen === "no-providers" ? <NoProvidersScreen /> : null}
      {screen === "memory-provider-selection" ? (
        <MemoryProviderSelectionScreen cursor={cursor} selectedProvider={memoryProviderChoice} status={memoryStatus} />
      ) : null}
      {isSupermemoryInputScreen(screen) ? (
        <SupermemorySetupScreen screen={screen} values={supermemorySetup} error={supermemoryError} />
      ) : null}
      {screen === "developer-team-review" ? (
        <DeveloperTeamReviewScreen projectRoot={resolveProjectRoot()} cursor={developerTeamCursor} />
      ) : null}
      {screen === "developer-team-installing" ? (
        <DeveloperTeamInstallingScreen currentStep={agentAssignmentIndex} totalSteps={DEVELOPER_TEAM_AGENTS.length} />
      ) : null}
      {screen === "opencode-preflight-checking" ? <OpenCodeCheckingScreen /> : null}
      {screen === "opencode-preflight" && openCodePreflight ? <OpenCodePreflightScreen preflight={openCodePreflight} /> : null}
      {screen === "opencode-tools" && openCodeToolsReview ? <OpenCodeToolsScreen review={openCodeToolsReview} /> : null}
      {screen === "opencode-tool-selection" ? <OpenCodeToolSelectionScreen cursor={cursor} selected={selectedOpenCodeTools} /> : null}
      {screen === "opencode-installation-review" ? <OpenCodeInstallationReviewScreen cursor={cursor} plan={openCodeInstallationPlan} /> : null}
      {screen === "opencode-installing" ? <Text>Installing selected OpenCode tools...</Text> : null}
      {screen === "complete" ? <CompleteScreen results={installResults} developerTeamResults={developerTeamResults} /> : null}
    </ScreenFrame>
  );
}

function screenTitle(screen: Screen): string {
  const titles: Record<Screen, string> = {
    home: "Deck",
    "model-environment-selection": "Select runner for model config",
    "model-team-selection": "Select team for model config",
    "environment-selection": "Select environments",
    "environment-check": "Environment check",
    "pi-preflight-checking": "Checking Pi environment",
    "pi-preflight": "Pi Environment Preflight",
    "required-tools": "Review required tools",
    "optional-tools": "Select optional tools",
    "installation-review": "Installation review",
    installing: "Installing",
    "team-selection": "Select teams",
    "agent-model-config-list": "Configure Developer Team models",
    "model-provider-selection": "Select Pi provider",
    "model-selection": "Select model",
    "agent-model-assignment": "Select reasoning level",
    "no-providers": "No providers detected",
    "memory-provider-selection": "Adaptive memory provider",
    "supermemory-token": "Supermemory MCP token",
    "supermemory-user-id": "Supermemory userId",
    "supermemory-team-id": "Supermemory teamId",
    "supermemory-org-id": "Supermemory orgId",
    "developer-team-review": "Developer Team",
    "developer-team-installing": "Installing Developer Team",
    "opencode-preflight-checking": "Checking OpenCode environment",
    "opencode-preflight": "OpenCode Environment Preflight",
    "opencode-tools": "Review OpenCode tools",
    "opencode-tool-selection": "Select OpenCode tools",
    "opencode-installation-review": "OpenCode installation review",
    "opencode-installing": "Installing OpenCode tools",
    complete: "Complete",
  };

  return titles[screen];
}

function CheckingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Inspecting Pi configuration...</Text>
      <Text dimColor>Deck is checking version, config directory, existing packages, and required tools.</Text>
    </Box>
  );
}

function OpenCodeCheckingScreen() {
  return (
    <Box flexDirection="column">
      <Text color="cyan">Inspecting OpenCode configuration...</Text>
      <Text dimColor>Deck is checking version, config directory, package manifest, and installed tools.</Text>
    </Box>
  );
}

function EnvironmentSelectionScreen({ cursor, selected }: { cursor: number; selected: EnvironmentId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Choose one or more environments. Space toggles selection.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={getEnvironmentOptions().map((option) => ({
            id: option.value,
            label: option.label,
            checked: selected.includes(option.value as EnvironmentId),
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelEnvironmentSelectionScreen({ cursor }: { cursor: number }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Select which runner/environment owns the model configuration.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={getEnvironmentOptions().map((option) => ({
            id: option.value,
            label: option.label,
            hint: option.value === "pi-development" ? "available" : "not implemented yet",
          }))}
        />
      </Box>
    </Box>
  );
}

function ModelTeamSelectionScreen({ cursor, environment }: { cursor: number; environment: EnvironmentId }) {
  const teams = environment === "pi-development" ? getTeamsForEnvironment("pi-development") : [];

  return (
    <Box flexDirection="column">
      <Text dimColor>Select which team you want to configure for {environment}.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            teams.length > 0
              ? teams.map((team) => ({ id: team.id, label: team.displayName, hint: team.description }))
              : [{ id: "none", label: "No configurable teams yet", hint: "not implemented" }]
          }
        />
      </Box>
    </Box>
  );
}

function EnvironmentCheckScreen({ statuses }: { statuses: RuntimeStatus[] }) {
  const installed = statuses.filter((status) => status.installed);
  const label = installed.length === 1 ? installed[0].environment.replace(" Development Environment", "") : "selected environments";

  return (
    <Box flexDirection="column">
      {statuses.map((status) => (
        <Box key={status.runtime} flexDirection="column" marginBottom={1}>
          <Text bold>{status.environment}</Text>
          <Text>
            {status.runtime}: {status.installed ? <Text color="green">Installed ({status.command})</Text> : <Text color="yellow">Not installed</Text>}
          </Text>
          {!status.installed ? <Text color="yellow">Deck will skip this environment.</Text> : null}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to inspect {label} configuration and required tools.</Text>
      </Box>
    </Box>
  );
}

function PiPreflightScreen({ preflight }: { preflight: PiPreflightResult }) {
  return (
    <Box flexDirection="column">
      <Text>Version: {preflight.version}</Text>
      <Text>Config directory: {preflight.configDirectory ?? "not found"}</Text>
      <Text>Existing configuration: {preflight.existingConfiguration ? "found" : "not found"}</Text>
      <Text>Agents support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>Subagents support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>MCP support: <Text color="yellow">pending (placeholder)</Text></Text>
      <Text>Model profiles: <Text color="yellow">pending (placeholder)</Text></Text>
    </Box>
  );
}

function OpenCodePreflightScreen({ preflight }: { preflight: OpenCodePreflightResult }) {
  return (
    <Box flexDirection="column">
      <Text>Version: {preflight.version}</Text>
      <Text>Config directory: {preflight.configDirectory ?? "not found"}</Text>
      <Text>Package manifest: {preflight.packageManifest ?? "not found"}</Text>
      <Text>Existing configuration: {preflight.existingConfiguration ? "found" : "not found"}</Text>
    </Box>
  );
}

function RequiredToolsScreen({ review }: { review: PiRequiredToolsReview }) {
  return (
    <Box flexDirection="column">
      <Text>Installed Pi packages: {review.installedPackages.length > 0 ? review.installedPackages.join(", ") : "none"}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Required for Deck Development Environment</Text>
        {review.tools.map((tool) => (
          <Text key={tool.name}>
            {tool.name}: {renderToolReadiness(tool.ready)} <Text dimColor>(available: {tool.available}, configured: {tool.configured})</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function OptionalToolsScreen({ cursor, selected }: { cursor: number; selected: InstallablePiToolId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>Optional tools are recommended but not required.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={getOptionalPiTools().map((tool) => ({
            id: tool.id,
            label: tool.name,
            hint: "recommended",
            checked: selected.includes(tool.id),
          }))}
        />
      </Box>
    </Box>
  );
}

function OpenCodeToolsScreen({ review }: { review: OpenCodeToolsReview }) {
  return (
    <Box flexDirection="column">
      <Text>Installed OpenCode packages: {review.installedPackages.length > 0 ? review.installedPackages.join(", ") : "none"}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Base tools for OpenCode Development Environment</Text>
        {review.toolStatuses.map((tool) => (
          <Text key={tool.name}>
            {tool.name}: {renderToolReadiness(tool.ready)} <Text dimColor>(available: {tool.available}, configured: {tool.configured})</Text>
          </Text>
        ))}
      </Box>
      {review.error ? <Text color="yellow">Warning: {review.error}</Text> : null}
    </Box>
  );
}

function OpenCodeToolSelectionScreen({ cursor, selected }: { cursor: number; selected: InstallableOpenCodeToolId[] }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>OpenCode does not require MCP packages or subagents for this environment.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          multiselect
          items={getSelectableOpenCodeTools().map((tool) => ({
            id: tool.id,
            label: tool.name,
            hint: "recommended",
            checked: selected.includes(tool.id),
          }))}
        />
      </Box>
    </Box>
  );
}

function TeamSelectionScreen({ cursor, selected }: { cursor: number; selected: string[] }) {
  const teams = getTeamsForEnvironment("pi-development");
  return (
    <Box flexDirection="column">
      <Text dimColor>Select teams for Pi Development Environment.</Text>
      <Box marginTop={1}>
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
    </Box>
  );
}

function renderToolReadiness(ready: "ready" | "available-unconfigured" | "missing") {
  if (ready === "ready") return <Text color="green">ready</Text>;
  if (ready === "available-unconfigured") return <Text color="yellow">available, not configured</Text>;
  return <Text color="yellow">missing</Text>;
}

function InstallationReviewScreen({ cursor, plan }: { cursor: number; plan: InstallablePiTool[] }) {
  return (
    <Box flexDirection="column">
      {plan.length === 0 ? <Text color="green">All selected tools are already installed.</Text> : null}
      {plan.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Deck will run</Text>
          {plan.map((tool) => (
            <Text key={tool.id}>  {tool.installKind === "external" ? `manual install ${tool.source}` : `pi install ${tool.source}`}</Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            plan.length > 0
              ? [
                  { id: "install", label: "Install selected Pi tools now" },
                  { id: "skip", label: "Skip installation" },
                ]
              : [{ id: "continue", label: "Continue" }]
          }
        />
      </Box>
    </Box>
  );
}

function OpenCodeInstallationReviewScreen({ cursor, plan }: { cursor: number; plan: InstallableOpenCodeTool[] }) {
  return (
    <Box flexDirection="column">
      {plan.length === 0 ? <Text color="green">All selected OpenCode tools are already installed.</Text> : null}
      {plan.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Deck will run</Text>
          {plan.map((tool) => (
            <Text key={tool.id}>
              {"  "}
              {tool.installKind === "external" ? `manual install ${tool.module}` : `opencode plugin ${tool.module} --global`}
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList
          cursor={cursor}
          items={
            plan.length > 0
              ? [
                  { id: "install", label: "Install selected OpenCode tools now" },
                  { id: "skip", label: "Skip installation" },
                ]
              : [{ id: "continue", label: "Continue" }]
          }
        />
      </Box>
    </Box>
  );
}

export function CompleteScreen({ results, developerTeamResults }: { results: (PiToolInstallResult | OpenCodeToolInstallResult)[]; developerTeamResults: AgentApplyResult[] }) {
  const hasResults = results.length > 0 || developerTeamResults.length > 0;

  if (!hasResults) {
    return (
      <Box flexDirection="column">
        <Text>Nothing was changed.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Enter to return to Home.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color="green">Installation completed.</Text>
      {results.map((result, index) => (
        <Text key={`${result.tool}-${index}`} color={result.success ? "green" : "red"}>
          {result.success ? "✓" : "✗"} {result.tool}{result.message ? ` — ${result.message}` : ""}
        </Text>
      ))}
      {developerTeamResults.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Developer Team</Text>
          {developerTeamResults.map((result) => (
            <Text key={`${result.agentId}-${result.kind}`} color={result.status === "unchanged" ? "green" : result.status === "updated" ? "yellow" : "cyan"}>
              {result.status === "unchanged" ? "✓" : result.status === "updated" ? "↻" : "+"} {result.agentId} <Text dimColor>({result.kind}, {result.status})</Text>
            </Text>
          ))}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </Box>
  );
}
