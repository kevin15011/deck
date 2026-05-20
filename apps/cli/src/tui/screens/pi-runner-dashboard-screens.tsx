import React from "react";
import { Box, Text } from "ink";
import type { CapabilityStatus } from "@deck/adapter-pi";
import { MenuList } from "../components/menu-list";
import type { PiRunnerActionRunResult } from "../pi-runner-dashboard/action-runner";
import {
  getAdaptiveMemorySummary,
  getDashboardSectionSummaries,
  getPlanActionCounts,
  getRunnerCapabilitySummaries,
  getTeamCapabilityProfile,
} from "../pi-runner-dashboard/selectors";
import type { PiRunnerAction, PiRunnerDashboardState } from "../pi-runner-dashboard/state";

type DashboardRunDiagnostic = { message: string };

type PiRunnerDashboardScreensProps = {
  state: PiRunnerDashboardState;
  installResults?: PiRunnerActionRunResult[];
  completionStatus?: string;
  canRunPlan?: boolean;
  runBlockDiagnostics?: DashboardRunDiagnostic[];
};

/**
 * Pi Runner Dashboard Screens.
 *
 * Fix #2: User-facing copy uses neutral "visual explanation support" terminology.
 * Mermaid/pi-mermaid is NOT mentioned in dashboard overview, packages section,
 * or validation feedback titles. "npm:pi-mermaid" appears only as source/diagnostic
 * metadata in action objects, not in rendered text.
 *
 * Changes (REQ-DASH-001, REQ-DASH-002, REQ-DASH-003):
 * - Removed `runner-capabilities-detail` and `runner-ui-visual-helpers-detail` screens.
 * - Added `packages-detail` screen as the Packages section.
 * - Visual explanation support is NOT presented as a configurable option.
 * - Visual support appears only as minimal install feedback in the Review & Install section.
 */
export function PiRunnerDashboardScreens({ state, installResults = [], completionStatus, canRunPlan, runBlockDiagnostics = [] }: PiRunnerDashboardScreensProps) {
  switch (state.screen) {
    case "packages-detail":
      return <PackagesDetail state={state} />;
    case "adaptive-memory-detail":
      return <AdaptiveMemoryDetail state={state} />;
    case "teams-detail":
      return <TeamsDetail state={state} />;
    case "developer-team-detail":
      return <DeveloperTeamDetail state={state} />;
    case "review-plan":
      return <ReviewPlanScreen state={state} canRunPlan={canRunPlan} runBlockDiagnostics={runBlockDiagnostics} />;
    case "install-progress":
      return <InstallProgressScreen state={state} results={installResults} />;
    case "complete":
      return <DashboardCompleteScreen results={installResults} completionStatus={completionStatus} />;
    case "dashboard":
    default:
      return <DashboardOverview state={state} />;
  }
}

function DashboardOverview({ state }: { state: PiRunnerDashboardState }) {
  const sections = getDashboardSectionSummaries(state);
  return (
    <Box flexDirection="column">
      <Text bold>Pi Runner Setup Dashboard</Text>
      <Text dimColor>Configure runner packages, Adaptive Memory, Teams and Review &amp; Install.</Text>
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

/**
 * Packages section — replaces the old Runner Capabilities + Runner UI/visual helpers.
 * Fix #2: Mermaid/visual-support is NOT mentioned in user-facing copy.
 * REQ-DASH-002: Groups user-facing package choices under Packages.
 */
function PackagesDetail({ state }: { state: PiRunnerDashboardState }) {
  const capabilities = getRunnerCapabilitySummaries(state);
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
              hint: `${statusLabel(capability.status)} · ${capability.detail}`,
            })),
            { id: "back", label: "Back to dashboard", hint: "Preserves selections" },
          ]}
        />
      </Box>
    </Box>
  );
}

function AdaptiveMemoryDetail({ state }: { state: PiRunnerDashboardState }) {
  const summary = getAdaptiveMemorySummary(state);
  const supermemory = state.adaptiveMemory.supermemory;
  return (
    <Box flexDirection="column">
      <Text bold>Adaptive Memory</Text>
      <Text dimColor>Single-choice: None, Engram or Supermemory. Default: None.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...summary.options.map((option) => ({
              id: option.provider,
              label: `${option.selected ? "(●)" : "( )"} ${option.label}`,
              hint: option.selected ? "selected" : "Enter to select",
            })),
            { id: "back", label: "Back to dashboard", hint: "Adaptive memory is auxiliary; OpenSpec/Registry remain authoritative" },
          ]}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Active provider: <Text color="cyan">{summary.provider}</Text></Text>
        <Text>{redactSecretText(summary.detail)}</Text>
        {state.adaptiveMemory.status ? <Text>{redactSecretText(state.adaptiveMemory.status)}</Text> : null}
        {summary.provider === "supermemory" ? (
          <>
            <Text color="yellow">Supermemory: configure non-secret identity; token outside .deck/config.json and always redacted.</Text>
            <Text>Config: {supermemory?.configured ? "ready" : "pending"}; token Pi MCP: {supermemory?.hasToken ? "received/redacted" : "pending"}</Text>
            <Text>User ID: {supermemory?.userId ? redactSecretText(supermemory.userId) : "pending"}</Text>
            {supermemory?.diagnostics?.length ? <Text>Diagnostics: {supermemory.diagnostics.map(redactSecretText).join("; ")}</Text> : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function TeamsDetail({ state }: { state: PiRunnerDashboardState }) {
  const team = state.teams["developer-team"];
  const profile = getTeamCapabilityProfile(state, "developer-team");
  return (
    <Box flexDirection="column">
      <Text bold>Teams</Text>
      <Text dimColor>Developer Team is selected from Teams and reuses existing model configuration.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            {
              id: "developer-team-toggle",
              label: `${team?.selected ? "[x]" : "[ ]"} Developer Team`,
              hint: profile.installable ? "ready" : "requires configuration",
            },
            {
              id: "developer-team-detail",
              label: "Open Developer Team detail",
              hint: "Configure models per agent and view consumption",
            },
            { id: "back", label: "Back to dashboard", hint: "Preserves team and models" },
          ]}
        />
      </Box>
      <CapabilityConsumption profile={profile} />
    </Box>
  );
}

function DeveloperTeamDetail({ state }: { state: PiRunnerDashboardState }) {
  const team = state.teams["developer-team"];
  const profile = getTeamCapabilityProfile(state, "developer-team");
  return (
    <Box flexDirection="column">
      <Text bold>Developer Team detail</Text>
      <Text>Selected: <Text color={team?.selected ? "green" : "yellow"}>{team?.selected ? "yes" : "no"}</Text></Text>
      <Text>Adaptive Memory from dashboard: <Text color="cyan">{state.adaptiveMemory.provider}</Text></Text>
      <Text dimColor>Provider/model/thinking configured with existing screens; semantics unchanged.</Text>
      {team?.status ? <Text color="green">{team.status}</Text> : null}
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            { id: "configure-models", label: "Configure models per agent", hint: "Reuses existing flow" },
            { id: "defaults", label: "Use current/default models", hint: "Does not modify semantics" },
            { id: "back", label: "Back to Teams", hint: "Preserves selection" },
          ]}
        />
      </Box>
      <CapabilityConsumption profile={profile} />
    </Box>
  );
}

/**
 * Review & Install screen — shows minimal visual support feedback only.
 * Fix #2: `implementationId` is not rendered for internal actions.
 * User-facing feedback uses neutral "visual explanation support" language.
 * Technical `npm:pi-mermaid` appears only in action.source field, not as rendered title.
 * REQ-DASH-003: Visual support appears only as minimal install/review feedback.
 */
function ReviewPlanScreen({ state, canRunPlan, runBlockDiagnostics = [] }: { state: PiRunnerDashboardState; canRunPlan?: boolean; runBlockDiagnostics?: DashboardRunDiagnostic[] }) {
  const plan = state.plan;
  const counts = getPlanActionCounts(plan);
  const canRun = canRunPlan ?? canRunPlanFromState(state);
  return (
    <Box flexDirection="column">
      <Text bold>Review &amp; Install</Text>
      <Text dimColor>Grouped plan; manual and pending steps are not shown as automatic install ready.</Text>
      <Text>Readiness: <Text color={plan?.ready ? "green" : "yellow"}>{plan?.ready ? "ready" : "unresolved/manual/pending"}</Text></Text>
      <Text>Actions: {counts.automatic} automatic, {counts.manual} manual/pending, {counts.config} config, {counts.team} team, {counts.validation} validation.</Text>
      <Box marginTop={1} flexDirection="column">
        <ActionGroup title="Automatic installs" actions={plan?.groups.automaticInstalls ?? []} />
        <ActionGroup title="Manual / pending steps" actions={plan?.groups.manualSteps ?? []} />
        <ActionGroup title="Config writes" actions={plan?.groups.configWrites ?? []} />
        <ActionGroup title="Team applications" actions={plan?.groups.teamApplications ?? []} />
        <ActionGroup title="Validation" actions={plan?.groups.validations ?? []} />
      </Box>
      {plan?.diagnostics.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Diagnostics</Text>
          {plan.diagnostics.map((diagnostic) => <Text key={`${diagnostic.code}:${diagnostic.message}`}>  {diagnostic.severity}: {redactSecretText(diagnostic.message)}</Text>)}
        </Box>
      ) : null}
      {!canRun && runBlockDiagnostics.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Execution blocks</Text>
          {runBlockDiagnostics.map((diagnostic) => <Text key={diagnostic.message} color="yellow">  {redactSecretText(diagnostic.message)}</Text>)}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList cursor={state.cursor} items={[{ id: "run", label: canRun ? "Run executable actions" : "Configure Supermemory before running", hint: canRun ? undefined : "Resolve Supermemory configuration before running" }, { id: "back", label: "Back to edit" }, { id: "dashboard", label: "Dashboard" }]} />
      </Box>
    </Box>
  );
}

function InstallProgressScreen({ results }: { state: PiRunnerDashboardState; results: PiRunnerActionRunResult[] }) {
  return (
    <Box flexDirection="column">
      <Text bold>Install progress</Text>
      <Text dimColor>Executing automatic/config/team/validation actions; manual and pending-source remain informational.</Text>
      {results.length === 0 ? <Text>Preparing execution...</Text> : results.map((result) => (
        <Text key={result.actionId}>  {result.status}: {result.actionId} — {redactSecretText(result.message)}</Text>
      ))}
    </Box>
  );
}

function DashboardCompleteScreen({ results, completionStatus }: { results: PiRunnerActionRunResult[]; completionStatus?: string }) {
  return (
    <Box flexDirection="column">
      <Text bold>Pi Runner setup complete</Text>
      <Text dimColor>Summary with redacted diagnostics; Supermemory secrets not shown.</Text>
      {results.length === 0 ? <Text>No actions executed.</Text> : results.map((result) => (
        <Box key={result.actionId} flexDirection="column">
          <Text>  {result.status}: {result.actionId} — {redactSecretText(result.message)}</Text>
          {result.diagnostics.map((diagnostic, index) => (
            <Text key={`${result.actionId}:diagnostic:${index}`} dimColor>    diagnostic: {redactSecretText(diagnostic)}</Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}><Text dimColor>{redactSecretText(completionStatus ?? "Enter to continue.")}</Text></Box>
    </Box>
  );
}

/**
 * Renders an action group.
 *
 * Fix #2: `implementationId` is hidden for internal actions (those with `internalPackageId`
 * or `id` starting with `internal.`) in the rendered output. Internal actions are shown
 * with neutral titles only — no implementationId is revealed in the user-facing summary.
 */
function ActionGroup({ title, actions }: { title: string; actions: PiRunnerAction[] }) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {actions.length === 0 ? <Text dimColor>  none</Text> : actions.map((action) => (
        <Text key={action.id}>
          {"  "}{action.status} · {action.kind} · {action.title}
          {action.implementationId && !isInternalAction(action) ? ` (${action.implementationId})` : ""}
        </Text>
      ))}
    </Box>
  );
}

function CapabilityConsumption({ profile }: { profile: ReturnType<typeof getTeamCapabilityProfile> }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>Explicit consumption/compatibility</Text>
      {Object.entries(profile.capabilities).map(([capability, consumption]) => (
        <Text key={capability}>  {capability}: {consumption}</Text>
      ))}
      {profile.diagnostics.map((diagnostic) => <Text key={diagnostic} color="yellow">  {redactSecretText(diagnostic)}</Text>)}
    </Box>
  );
}

/**
 * Returns true for internal package install actions where implementationId
 * should not be shown in user-facing output.
 *
 * Fix #2: Hides implementationId (pi-mermaid) for internal actions — technical
 * metadata is preserved in the action object but not rendered in the dashboard.
 */
function isInternalAction(action: PiRunnerAction): boolean {
  return Boolean(action.internalPackageId) || action.id.startsWith("internal.") || action.id.startsWith("capability.runner-mermaid");
}

function readinessLabel(readiness: string): string {
  if (readiness === "ready") return "ready";
  if (readiness === "blocked") return "blocked";
  if (readiness === "attention") return "attention/manual";
  return "pending/unknown";
}

function statusLabel(status: CapabilityStatus | "unknown"): string {
  switch (status) {
    case "ready": return "ready";
    case "missing": return "missing";
    case "manual": return "manual";
    case "pending-source": return "pending-source";
    case "blocked": return "blocked";
    default: return "unknown";
  }
}

function canRunPlanFromState(state: PiRunnerDashboardState): boolean {
  if (state.adaptiveMemory.provider !== "supermemory") return true;
  const setup = state.adaptiveMemory.supermemory;
  return Boolean(setup?.configured && setup.hasToken && setup.userId);
}

function redactSecretText(value: string): string {
  return value
    .replace(/(x-supermemory-api-key["'\s:=]+)[^\s"'}]+/gi, "$1[redacted]")
    .replace(/(api[-_]?key["'\s:=]+)[^\s"'}]+/gi, "$1[redacted]")
    .replace(/(token["'\s:=]+)[^\s"'}]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-sm-[A-Za-z0-9._~+/-]+/gi, "[redacted]");
}