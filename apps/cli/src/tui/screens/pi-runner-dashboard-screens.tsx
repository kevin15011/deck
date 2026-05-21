import React from "react";
import { Box, Text } from "ink";
import { MenuList } from "../components/menu-list";
import type { RunnerActionRunResult } from "../pi-runner-dashboard/action-runner";
import {
  getAdaptiveMemorySummary,
  getDashboardSectionSummaries,
  getPlanActionCounts,
  getRunnerCapabilitySummaries,
  getTeamCapabilityProfile,
  type CapabilityResolver,
} from "../pi-runner-dashboard/selectors";
import type { RunnerAction, RunnerDashboardState } from "../pi-runner-dashboard/state";

type DashboardRunDiagnostic = { message: string };

type RunnerDashboardScreensProps = {
  state: RunnerDashboardState;
  installResults?: RunnerActionRunResult[];
  completionStatus?: string;
  canRunPlan?: boolean;
  runBlockDiagnostics?: DashboardRunDiagnostic[];
  capabilityResolver?: CapabilityResolver;
};

/**
 * Runtime-agnostic Runner Dashboard Screens.
 *
 * Works with any runner (Pi, OpenCode, etc.) via the capabilityResolver.
 * Dashboard sections: Packages, Adaptive Memory, Teams, Configure Packages, Review & Install.
 */
export function RunnerDashboardScreens({ state, installResults = [], completionStatus, canRunPlan, runBlockDiagnostics = [], capabilityResolver }: RunnerDashboardScreensProps) {
  switch (state.screen) {
    case "packages-detail":
      return <PackagesDetail state={state} resolver={capabilityResolver} />;
    case "adaptive-memory-detail":
      return <AdaptiveMemoryDetail state={state} />;
    case "teams-detail":
      return <TeamsDetail state={state} resolver={capabilityResolver} />;
    case "developer-team-detail":
      return <DeveloperTeamDetail state={state} resolver={capabilityResolver} />;
    case "package-instructions-detail":
      return <PackageInstructionsDetail state={state} />;
    case "review-plan":
      return <ReviewPlanScreen state={state} canRunPlan={canRunPlan} runBlockDiagnostics={runBlockDiagnostics} />;
    case "install-progress":
      return <InstallProgressScreen state={state} results={installResults} />;
    case "complete":
      return <DashboardCompleteScreen results={installResults} completionStatus={completionStatus} runnerScope={state.runnerScope} />;
    case "dashboard":
    default:
      return <DashboardOverview state={state} resolver={capabilityResolver} />;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible alias
// ---------------------------------------------------------------------------

export const PiRunnerDashboardScreens = RunnerDashboardScreens;

function readinessLabel(readiness: string): string {
  switch (readiness) {
    case "ready": return "✓";
    case "attention": return "!";
    case "pending": return "…";
    case "blocked": return "✗";
    default: return "?";
  }
}

function isInternalAction(action: RunnerAction): boolean {
  return action.id.startsWith("capability.runner-mermaid") || action.id.startsWith("capability.opencode-mermaid");
}

function canRunPlanFromState(state: RunnerDashboardState): boolean {
  if (state.adaptiveMemory.provider !== "supermemory") return true;
  const setup = state.adaptiveMemory.supermemory;
  return Boolean(setup?.configured && setup?.userId && setup?.hasToken);
}

// ---------------------------------------------------------------------------
// Dashboard Overview
// ---------------------------------------------------------------------------

function DashboardOverview({ state, resolver }: { state: RunnerDashboardState; resolver?: CapabilityResolver }) {
  const sections = getDashboardSectionSummaries(state, resolver);
  const runnerLabel = state.runnerScope === "opencode" ? "OpenCode" : "Pi";
  return (
    <Box flexDirection="column">
      <Text bold>{runnerLabel} Runner Setup Dashboard</Text>
      <Text dimColor>Configure packages, Adaptive Memory, Teams and Review &amp; Install.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={sections.map((section) => ({
            id: section.id,
            label: section.title,
            hint: `${readinessLabel(section.readiness)} · ${section.detail} · actions: ${section.actionCount}`,
          }))}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Packages Detail
// ---------------------------------------------------------------------------

function PackagesDetail({ state, resolver }: { state: RunnerDashboardState; resolver?: CapabilityResolver }) {
  const capabilities = getRunnerCapabilitySummaries(state, resolver);
  const toggleable = capabilities.filter((capability) => capability.requirementLevel === "configurable" || capability.requirementLevel === "optional");

  return (
    <Box flexDirection="column">
      <Text bold>Packages</Text>
      <Text dimColor>Select packages to install or configure. Space toggles configurable and optional packages.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...toggleable.map((capability) => ({
              id: capability.capabilityId,
              label: `${capability.selected ? "[x]" : "[ ]"} ${capability.label}`,
              hint: `${capability.status} · ${capability.detail}`,
            })),
            { id: "back", label: "Back to dashboard" },
          ]}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Adaptive Memory Detail
// ---------------------------------------------------------------------------

function AdaptiveMemoryDetail({ state }: { state: RunnerDashboardState }) {
  const summary = getAdaptiveMemorySummary(state);
  return (
    <Box flexDirection="column">
      <Text bold>Adaptive Memory</Text>
      <Text dimColor>Adaptive memory is auxiliary; OpenSpec/Registry remain authoritative.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...summary.options.map((option) => ({
              id: option.provider,
              label: `${option.selected ? "[x]" : "[ ]"} ${option.label}`,
            })),
            { id: "back", label: "Back to dashboard" },
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{summary.detail}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Package Instructions Detail
// ---------------------------------------------------------------------------

function PackageInstructionsDetail({ state }: { state: RunnerDashboardState }) {
  const packages = [
    { id: "codebase-memory" as const, label: "Codebase Memory", hint: "graph-based code discovery instructions" },
    { id: "context-mode" as const, label: "Context Mode", hint: "batch execute and think-in-code instructions" },
    { id: "rtk" as const, label: "RTK", hint: "fallback guidance for hook-less environments" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Configure Packages</Text>
      <Text dimColor>Instruction injection only; does not install packages. Space toggles each package.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...packages.map((pkg) => ({
              id: pkg.id,
              label: `${state.packageInstructions[pkg.id] ? "[x]" : "[ ]"} ${pkg.label}`,
              hint: pkg.hint,
            })),
            { id: "back", label: "Back to dashboard" },
          ]}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Teams Detail
// ---------------------------------------------------------------------------

function TeamsDetail({ state, resolver }: { state: RunnerDashboardState; resolver?: CapabilityResolver }) {
  const teams = Object.values(state.teams);
  return (
    <Box flexDirection="column">
      <Text bold>Teams</Text>
      <Text dimColor>Select teams to install. Space toggles team selection.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...teams.map((team) => ({
              id: team.teamId,
              label: `${team.selected ? "[x]" : "[ ]"} ${team.label}`,
              hint: team.status ?? (team.selected ? "selected" : "not selected"),
            })),
            { id: "developer-team-detail", label: "Developer Team detail" },
            { id: "back", label: "Back to dashboard" },
          ]}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Developer Team Detail
// ---------------------------------------------------------------------------

function DeveloperTeamDetail({ state, resolver }: { state: RunnerDashboardState; resolver?: CapabilityResolver }) {
  const profile = getTeamCapabilityProfile(state, "developer-team");
  return (
    <Box flexDirection="column">
      <Text bold>Developer Team</Text>
      <Text dimColor>Configure model assignments or use current defaults.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            { id: "configure-models", label: "Configure models per agent" },
            { id: "use-defaults", label: "Use current model defaults" },
            { id: "back", label: "Back to teams" },
          ]}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Capability profile: {profile.installable ? "installable" : "not selected"}</Text>
        {profile.diagnostics.length > 0 && (
          <Text color="yellow">{profile.diagnostics.join("; ")}</Text>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Review Plan Screen
// ---------------------------------------------------------------------------

function ReviewPlanScreen({ state, canRunPlan, runBlockDiagnostics = [] }: { state: RunnerDashboardState; canRunPlan?: boolean; runBlockDiagnostics?: DashboardRunDiagnostic[] }) {
  const counts = getPlanActionCounts(state.plan);
  const effectiveCanRun = canRunPlan ?? canRunPlanFromState(state);

  return (
    <Box flexDirection="column">
      <Text bold>Review &amp; Install</Text>
      <Text dimColor>{counts.total} actions planned: {counts.automatic} automatic, {counts.manual} manual, {counts.config} config, {counts.team} team, {counts.validation} validation.</Text>
      {runBlockDiagnostics.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>Blocked:</Text>
          {runBlockDiagnostics.map((d, i) => (
            <Text key={i} color="yellow">  {d.message}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            { id: "run", label: effectiveCanRun ? "Run install" : "Blocked", hint: effectiveCanRun ? "" : "Complete Supermemory setup first" },
            { id: "dashboard", label: "Dashboard" },
          ]}
        />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Install Progress Screen
// ---------------------------------------------------------------------------

function InstallProgressScreen({ state, results }: { state: RunnerDashboardState; results: RunnerActionRunResult[] }) {
  const executed = results.filter((r) => r.status === "executed");
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");

  return (
    <Box flexDirection="column">
      <Text bold>Install Progress</Text>
      <Text dimColor>{executed.length} executed, {failed.length} failed, {skipped.length} skipped.</Text>
      {results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {results.slice(-5).map((r, i) => (
            <Text key={i} color={r.status === "failed" ? "red" : r.status === "executed" ? "green" : "yellow"}>
              {r.status === "executed" ? "✓" : r.status === "failed" ? "✗" : "…"} {r.message}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Complete Screen
// ---------------------------------------------------------------------------

function DashboardCompleteScreen({ results, completionStatus, runnerScope }: { results: RunnerActionRunResult[]; completionStatus?: string; runnerScope?: string }) {
  const failed = results.filter((r) => r.status === "failed");
  const label = runnerScope === "opencode" ? "OpenCode" : "Pi";
  return (
    <Box flexDirection="column">
      <Text bold color="green">{label} Runner setup complete</Text>
      {completionStatus && <Text dimColor>{completionStatus}</Text>}
      {failed.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>{failed.length} action(s) failed:</Text>
          {failed.map((r, i) => (
            <Text key={i} color="yellow">  {r.message}</Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to the home screen.</Text>
      </Box>
    </Box>
  );
}
