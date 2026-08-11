import React from "react";
import { Box, Text } from "ink";
import { stripVTControlCharacters } from "node:util";
import { MenuList } from "../components/menu-list";
import type { RunnerActionRunResult, RunnerSerenaOutcome, RunnerSerenaStage } from "../runner-dashboard/action-runner";
import {
  getAdaptiveMemorySummary,
  getDashboardSectionSummaries,
  getPlanActionCounts,
  getPackageInstructionSummaries,
  getTeamCapabilityProfile,
  getWebSearchSummary,
  type CapabilityResolver,
} from "../runner-dashboard/selectors";
import { runnerRequiresExternalSupermemoryToken, type RunnerAction, type RunnerDashboardState } from "../runner-dashboard/state";

type DashboardRunDiagnostic = { message: string };

type RunnerDashboardScreensProps = {
  state: RunnerDashboardState;
  installResults?: RunnerActionRunResult[];
  completionStatus?: string;
  canRunPlan?: boolean;
  runBlockDiagnostics?: DashboardRunDiagnostic[];
  capabilityResolver?: CapabilityResolver;
  serenaStages?: readonly RunnerSerenaStage[];
  serenaOutcome?: RunnerSerenaOutcome;
  cancellationRequested?: boolean;
  runnerLabel?: string;
};

/**
 * Runtime-agnostic Runner Dashboard Screens.
 *
 * Works with any runner (Pi, OpenCode, etc.) via the capabilityResolver.
 * Dashboard sections: Packages, Adaptive Memory, Web Search, Teams, Review & Install.
 */
export function RunnerDashboardScreens({ state, installResults = [], completionStatus, canRunPlan, runBlockDiagnostics = [], capabilityResolver, serenaStages = [], serenaOutcome, cancellationRequested = false, runnerLabel }: RunnerDashboardScreensProps) {
  switch (state.screen) {
    case "packages-detail":
      return <PackagesDetail state={state} resolver={capabilityResolver} />;
    case "adaptive-memory-detail":
      return <AdaptiveMemoryDetail state={state} />;
    case "web-search-detail":
      return <WebSearchDetail state={state} />;
    case "teams-detail":
      return <TeamsDetail state={state} resolver={capabilityResolver} />;
    case "developer-team-detail":
      return <DeveloperTeamDetail state={state} resolver={capabilityResolver} />;
    case "review-plan":
      return <ReviewPlanScreen state={state} canRunPlan={canRunPlan} runBlockDiagnostics={runBlockDiagnostics} />;
    case "install-progress":
      return <InstallProgressScreen state={state} results={installResults} serenaStages={serenaStages} serenaOutcome={serenaOutcome} cancellationRequested={cancellationRequested} />;
    case "complete":
      return <DashboardCompleteScreen results={installResults} completionStatus={completionStatus} runnerLabel={runnerLabel ?? state.runnerDisplayName ?? state.runnerScope} />;
    case "dashboard":
    default:
      return <DashboardOverview state={state} resolver={capabilityResolver} runnerLabel={runnerLabel ?? state.runnerDisplayName ?? state.runnerScope} />;
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

function runnerSetupName(displayName: string): string {
  return /\brunner\b/i.test(displayName) ? displayName : `${displayName} Runner`;
}

function canRunPlanFromState(state: RunnerDashboardState): boolean {
  if (state.plan?.ready !== true) return false;
  if (state.adaptiveMemory.provider !== "supermemory") return true;
  const setup = state.adaptiveMemory.supermemory;
  return runnerRequiresExternalSupermemoryToken(state)
    ? Boolean(setup?.configured && setup?.hasToken)
    : Boolean(setup?.configured);
}

// ---------------------------------------------------------------------------
// Dashboard Overview
// ---------------------------------------------------------------------------

function DashboardOverview({ state, resolver, runnerLabel }: { state: RunnerDashboardState; resolver?: CapabilityResolver; runnerLabel: string }) {
  const sections = getDashboardSectionSummaries(state, resolver);
  const executionRoutes = state.runtime.executionRoutes ? Object.entries(state.runtime.executionRoutes) : [];
  return (
    <Box flexDirection="column">
      <Text bold>{runnerSetupName(runnerLabel)} Setup Dashboard</Text>
      <Text dimColor>Configure Packages, Adaptive Memory, Web Search, Teams and Review &amp; Install.</Text>
      {state.runtime.inspectionState ? <Text>Runtime: {state.runtime.inspectionState}</Text> : null}
      {state.runtime.diagnostics?.map((diagnostic, index) => <Text key={`runtime-${index}`} color="yellow">{sanitizeDashboardText(diagnostic)}</Text>)}
      {executionRoutes.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Execution modes</Text>
          {executionRoutes.map(([mode, classification]) => <Text key={mode}>{mode}: {classification}</Text>)}
        </Box>
      ) : null}
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
  const packages = getPackageInstructionSummaries(state, resolver);

  return (
    <Box flexDirection="column">
      <Text bold>Package instructions</Text>
      <Text dimColor>Select optional instruction bundles. Code Economy is always enabled as the non-toggleable baseline.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...packages.map((pkg) => ({
              id: pkg.capabilityId,
              label: `${pkg.selected ? "[x]" : "[ ]"} ${pkg.label}`,
              hint: pkg.detail,
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
              label: `${option.selected ? "> " : "  "}${option.label}`,
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
// Web Search Detail
// ---------------------------------------------------------------------------

function WebSearchDetail({ state }: { state: RunnerDashboardState }) {
  const summary = getWebSearchSummary(state);
  const provider = summary.provider === "tavily" ? "Tavily" : summary.provider;
  const materialization = summary.mcpConfigConflict
    ? "conflict"
    : summary.mcpConfigured
      ? "configured"
      : "not configured";
  return (
    <Box flexDirection="column">
      <Text bold>Web Search</Text>
      <Text dimColor>Compact search and point extraction only. Credentials are stored only by explicit choice in your active shell profile.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Provider: {provider}</Text>
        <Text>Credential: {summary.credentialAvailable ? "detected" : "missing"}</Text>
        <Text>Runner support: {summary.runnerSupported ? "supported" : "unsupported"}</Text>
        <Text>MCP materialization: {materialization}</Text>
        <Text>Readiness: {summary.readiness}</Text>
      </Box>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            { id: "toggle", label: `${summary.enabled ? "[x]" : "[ ]"} Enable Web Search`, hint: summary.enabled ? "Disable without deleting the saved credential." : "Enable Tavily Web Search." },
            { id: "credential", label: "Enter or replace Tavily credential", hint: "Masked input; value is never stored in Deck or MCP configuration." },
            { id: "back", label: "Back to dashboard" },
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Disabling Web Search does not delete a saved shell-profile credential.</Text>
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
  const effectiveCanRun = state.plan?.ready === true && (canRunPlan ?? canRunPlanFromState(state));

  return (
    <Box flexDirection="column">
      <Text bold>Review &amp; Install</Text>
      <Text dimColor>{counts.total} actions planned: {counts.automatic} automatic, {counts.manual} manual, {counts.config} config, {counts.team} team, {counts.validation} validation.</Text>
      {state.plan?.diagnostics && state.plan.diagnostics.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Plan diagnostics:</Text>
          {state.plan.diagnostics.map((diagnostic, index) => (
            <Text key={`${diagnostic.code}-${index}`} color={diagnostic.severity === "error" ? "red" : "yellow"}>  {sanitizeDashboardText(diagnostic.message)}</Text>
          ))}
        </Box>
      )}
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
            { id: "run", label: effectiveCanRun ? "Run install" : "Blocked", hint: effectiveCanRun ? "" : runBlockDiagnostics[0]?.message ?? "Resolve plan diagnostics first" },
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

const DASHBOARD_CAUSE_SCALAR_LIMIT = 240;
const DASHBOARD_CAUSE_BYTE_LIMIT = 320;

function dashboardActionMessage(result: RunnerActionRunResult): string {
  const sanitized = sanitizeDashboardText(result.message) || "Action completed.";
  return truncateDashboardUtf8(truncateDashboardScalars(sanitized, DASHBOARD_CAUSE_SCALAR_LIMIT), DASHBOARD_CAUSE_BYTE_LIMIT);
}

function dashboardActionSymbol(status: RunnerActionRunResult["status"]): string {
  return status === "executed" ? "✓" : status === "failed" ? "✗" : "…";
}

function dashboardActionCause(result: RunnerActionRunResult): string | undefined {
  if (result.status !== "failed") return undefined;
  const source = result.cause ?? result.diagnostics[0];
  if (!source) return undefined;
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(sanitizeDashboardText)
    .filter(Boolean)
    .slice(0, 2);
  let cause = "";
  for (const line of lines) {
    const boundedLine = truncateDashboardScalars(line, DASHBOARD_CAUSE_SCALAR_LIMIT);
    const next = cause ? `${cause} · ${boundedLine}` : boundedLine;
    const bounded = truncateDashboardUtf8(next, DASHBOARD_CAUSE_BYTE_LIMIT);
    if (!bounded) break;
    cause = bounded;
    if (bounded !== next) break;
  }
  return cause || undefined;
}

function sanitizeDashboardText(value: unknown): string {
  let text = typeof value === "string" ? value : String(value ?? "");
  text = stripVTControlCharacters(text.replace(/\r\n?/g, "\n"))
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, "")
    .replace(/[\u2500-\u257f\u2580-\u259f\u2800-\u28ff◐◓◑◒◴◷◶◵⟳]/gu, "");

  const urls: string[] = [];
  text = text.replace(/\b(?:https?|wss?|git\+https?):\/\/[^\s]+/giu, (url) => {
    const token = `__DECK_DASHBOARD_URL_${urls.length}__`;
    urls.push(redactDashboardUrl(url));
    return token;
  });
  const keys = "token|secret|password|passwd|api-key|api_key|authorization|proxy-authorization|cookie|set-cookie|credential|client-secret|client_secret|access-key|access_key";
  text = text
    .replace(new RegExp(`((?:${keys})\\s*[:=]\\s*)[^\\s,;]+`, "giu"), "$1[REDACTED]")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(/\braw\b/giu, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]");
  const roots: Array<[string | undefined, string]> = [
    [process.env.XDG_CONFIG_HOME, "$XDG_CONFIG_HOME"],
    [process.env.XDG_CACHE_HOME, "$XDG_CACHE_HOME"],
    [process.env.XDG_STATE_HOME, "$XDG_STATE_HOME"],
    [process.env.HOME, "~"],
  ];
  for (const [root, replacement] of roots.filter((entry): entry is [string, string] => Boolean(entry[0])).sort((left, right) => right[0].length - left[0].length)) {
    text = text.split(root).join(replacement);
  }
  text = text
    .replace(/(?<![\w:~])(?:[A-Za-z]:[\\/]|\\\\)[^\s,;]+/g, "<path>")
    .replace(/(?<![\w:~/])\/(?:[^\s,;<>()"']+\/)*[^\s,;<>()"']+/g, "<path>")
    .split("\n")
    .map((line) => line.replace(/ +/g, " ").trim())
    .join("\n")
    .replace(/__DECK_DASHBOARD_URL_(\d+)__/g, (_match, index: string) => urls[Number(index)] ?? "<url>");
  return text;
}

function redactDashboardUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      parsed.username = "[REDACTED]";
      parsed.password = "[REDACTED]";
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|password|passwd|key|authorization|credential|cookie/i.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    return parsed.toString();
  } catch {
    return "<url>";
  }
}

function truncateDashboardScalars(value: string, max: number): string {
  const scalars = [...value];
  return scalars.length <= max ? value : `${scalars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

function truncateDashboardUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "…";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (maxBytes <= suffixBytes) return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
  const source = Buffer.from(value, "utf8");
  let end = maxBytes - suffixBytes;
  while (end > 0 && (source[end]! & 0xc0) === 0x80) end--;
  let prefix = source.subarray(0, end).toString("utf8");
  while (prefix.includes("\ufffd") && end > 0) {
    end--;
    prefix = source.subarray(0, end).toString("utf8");
  }
  return `${prefix}${suffix}`;
}

const SERENA_STAGE_LABELS: Readonly<Record<RunnerSerenaStage, string>> = {
  "preparing-uv": "Preparing uv",
  "installing-serena": "Installing Serena",
  "validating-serena": "Validating Serena",
  "configuring-mcp": "Configuring MCP",
};

const SERENA_STAGE_ORDER: readonly RunnerSerenaStage[] = [
  "preparing-uv",
  "installing-serena",
  "validating-serena",
  "configuring-mcp",
];

function serenaOutcomeFromResults(results: readonly RunnerActionRunResult[]): RunnerSerenaOutcome | undefined {
  return [...results].reverse().find((result) => result.serenaOutcome)?.serenaOutcome;
}

function serenaStagesFromResults(results: readonly RunnerActionRunResult[]): RunnerSerenaStage[] {
  return results
    .map((result) => result.serenaStage)
    .filter((stage): stage is RunnerSerenaStage => Boolean(stage));
}

function outcomeLabel(outcome: RunnerSerenaOutcome): string {
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

function InstallProgressScreen({
  state,
  results,
  serenaStages,
  serenaOutcome,
  cancellationRequested,
}: {
  state: RunnerDashboardState;
  results: RunnerActionRunResult[];
  serenaStages: readonly RunnerSerenaStage[];
  serenaOutcome?: RunnerSerenaOutcome;
  cancellationRequested: boolean;
}) {
  const executed = results.filter((r) => r.status === "executed");
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");
  const observedStages = new Set([...serenaStages, ...serenaStagesFromResults(results)]);
  const orderedStages = SERENA_STAGE_ORDER.filter((stage) => observedStages.has(stage));
  const observedOutcome = serenaOutcome ?? serenaOutcomeFromResults(results);

  return (
    <Box flexDirection="column">
      <Text bold>Install Progress</Text>
      <Text dimColor>{executed.length} executed, {failed.length} failed, {skipped.length} skipped.</Text>
      {orderedStages.length > 0 && (
        <Box marginTop={1} flexDirection="column" aria-label="Serena installation stages">
          {orderedStages.map((stage) => <Text key={stage}>• {SERENA_STAGE_LABELS[stage]}</Text>)}
        </Box>
      )}
      {cancellationRequested && (
        <Text color="yellow">Cancellation requested; waiting for the active command to stop.</Text>
      )}
      {observedOutcome && (
        <Text>Status: Serena {outcomeLabel(observedOutcome)}.</Text>
      )}
      {results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {results.slice(-5).map((r, i) => {
            const cause = dashboardActionCause(r);
            return (
              <React.Fragment key={`${r.actionId}-${i}`}>
                <Text color={r.status === "failed" ? "red" : r.status === "executed" ? "green" : "yellow"}>
                  {dashboardActionSymbol(r.status)} [{r.actionId}] {dashboardActionMessage(r)}
                </Text>
                {cause && <Text>  {cause}</Text>}
              </React.Fragment>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Complete Screen
// ---------------------------------------------------------------------------

function DashboardCompleteScreen({ results, completionStatus, runnerLabel }: { results: RunnerActionRunResult[]; completionStatus?: string; runnerLabel: string }) {
  const failed = results.filter((r) => r.status === "failed");
  const stoppedSerena = serenaOutcomeFromResults(results);
  const completedSuccessfully = failed.length === 0 && stoppedSerena !== "cancelled" && stoppedSerena !== "partial";
  const postInstallFollowUps = results
    .filter((result) => completedSuccessfully && result.status === "executed")
    .flatMap((result) => result.postInstallFollowUps ?? []);
  return (
    <Box flexDirection="column">
      <Text bold color={completedSuccessfully ? "green" : "yellow"}>
        {completedSuccessfully
          ? `${runnerSetupName(runnerLabel)} setup complete`
          : `${runnerSetupName(runnerLabel)} setup stopped before completion`}
      </Text>
      {completionStatus && <Text dimColor>{completionStatus}</Text>}
      {failed.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow" bold>{failed.length} action(s) failed:</Text>
          {failed.map((r, i) => {
            const cause = dashboardActionCause(r);
            return (
              <React.Fragment key={`${r.actionId}-${i}`}>
                <Text color="yellow">✗ [{r.actionId}] {dashboardActionMessage(r)}</Text>
                {cause && <Text>  {cause}</Text>}
              </React.Fragment>
            );
          })}
        </Box>
      )}
      {postInstallFollowUps.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Next steps</Text>
          {postInstallFollowUps.map((followUp) => <Text key={followUp.id}>• {sanitizeDashboardText(followUp.message)}</Text>)}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to return to the home screen.</Text>
      </Box>
    </Box>
  );
}
