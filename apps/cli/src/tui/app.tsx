import React, { useEffect, useMemo, useState } from "react";
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
  buildPiInstallationPlan,
  getOptionalPiTools,
  inspectPiEnvironment,
  installPiTools,
  reviewPiRequiredTools,
  type InstallablePiTool,
  type InstallablePiToolId,
  type PiPreflightResult,
  type PiRequiredToolsReview,
  type PiToolInstallResult,
} from "@deck/adapter-pi";

import { getEnvironmentOptions, getHomeMenuOptions } from "../menu-options";
import { detectSelectedRuntimes, type EnvironmentId, type RuntimeStatus } from "../runtime-detection";
import { MenuList } from "./components/menu-list";
import { ScreenFrame } from "./screen-frame";
import { HomeScreen } from "./screens/home-screen";

type Screen =
  | "home"
  | "environment-selection"
  | "environment-check"
  | "pi-preflight-checking"
  | "pi-preflight"
  | "required-tools"
  | "optional-tools"
  | "installation-review"
  | "installing"
  | "opencode-preflight-checking"
  | "opencode-preflight"
  | "opencode-tools"
  | "opencode-tool-selection"
  | "opencode-installation-review"
  | "opencode-installing"
  | "complete";

const HELP = "j/k or ↑/↓: navigate • space: toggle • enter: continue • esc: back • q: quit";

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

  function resetCursor(nextScreen: Screen) {
    setScreen(nextScreen);
    setCursor(nextScreen === "home" ? homeCursor : 0);
  }

  function getCursorLimit(): number {
    if (screen === "home") return getHomeMenuOptions().length - 1;
    if (screen === "environment-selection") return getEnvironmentOptions().length - 1;
    if (screen === "optional-tools") return getOptionalPiTools().length - 1;
    if (screen === "opencode-tool-selection") return getSelectableOpenCodeTools().length - 1;
    if (screen === "installation-review") return 1;
    if (screen === "opencode-installation-review") return 1;
    return 0;
  }

  function moveCursor(delta: number) {
    const limit = getCursorLimit();
    const next = Math.min(limit, Math.max(0, cursor + delta));
    setCursor(next);
    if (screen === "home") setHomeCursor(next);
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
      if (action === "exit") exit();
      return;
    }

    if (screen === "environment-selection") {
      const selected = selectedEnvironments.length > 0 ? selectedEnvironments : ["pi-development"];
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

  function goToNextEnvironmentOrComplete() {
    if (selectedEnvironments.includes("opencode-development") && installedOpenCode?.command && !openCodePreflight) {
      resetCursor("opencode-preflight-checking");
      return;
    }

    resetCursor("complete");
  }

  function goBack() {
    const previous: Partial<Record<Screen, Screen>> = {
      "environment-selection": "home",
      "environment-check": "environment-selection",
      "pi-preflight-checking": "environment-check",
      "pi-preflight": "environment-check",
      "required-tools": "pi-preflight",
      "optional-tools": "required-tools",
      "installation-review": "optional-tools",
      "opencode-preflight-checking": "environment-check",
      "opencode-preflight": "environment-check",
      "opencode-tools": "opencode-preflight",
      "opencode-tool-selection": "opencode-tools",
      "opencode-installation-review": "opencode-tool-selection",
      complete: "home",
    };

    const next = previous[screen];
    if (next) resetCursor(next);
  }

  return (
    <ScreenFrame title={screenTitle(screen)} help={HELP} width={stdout.columns || 72} height={stdout.rows || undefined}>
      {screen === "home" ? <HomeScreen cursor={homeCursor} /> : null}
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
      {screen === "opencode-preflight-checking" ? <OpenCodeCheckingScreen /> : null}
      {screen === "opencode-preflight" && openCodePreflight ? <OpenCodePreflightScreen preflight={openCodePreflight} /> : null}
      {screen === "opencode-tools" && openCodeToolsReview ? <OpenCodeToolsScreen review={openCodeToolsReview} /> : null}
      {screen === "opencode-tool-selection" ? <OpenCodeToolSelectionScreen cursor={cursor} selected={selectedOpenCodeTools} /> : null}
      {screen === "opencode-installation-review" ? <OpenCodeInstallationReviewScreen cursor={cursor} plan={openCodeInstallationPlan} /> : null}
      {screen === "opencode-installing" ? <Text>Installing selected OpenCode tools...</Text> : null}
      {screen === "complete" ? <CompleteScreen results={installResults} /> : null}
    </ScreenFrame>
  );
}

function screenTitle(screen: Screen): string {
  const titles: Record<Screen, string> = {
    home: "Deck",
    "environment-selection": "Select environments",
    "environment-check": "Environment check",
    "pi-preflight-checking": "Checking Pi environment",
    "pi-preflight": "Pi Environment Preflight",
    "required-tools": "Review required tools",
    "optional-tools": "Select optional tools",
    "installation-review": "Installation review",
    installing: "Installing",
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

function CompleteScreen({ results }: { results: (PiToolInstallResult | OpenCodeToolInstallResult)[] }) {
  if (results.length === 0) {
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
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to Home.</Text>
      </Box>
    </Box>
  );
}
