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

export function PiRunnerDashboardScreens({ state, installResults = [], completionStatus, canRunPlan, runBlockDiagnostics = [] }: PiRunnerDashboardScreensProps) {
  switch (state.screen) {
    case "runner-capabilities-detail":
      return <RunnerCapabilitiesDetail state={state} />;
    case "adaptive-memory-detail":
      return <AdaptiveMemoryDetail state={state} />;
    case "runner-ui-visual-helpers-detail":
      return <RunnerVisualHelpersDetail state={state} />;
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
      <Text bold>Pi Runner Capability Dashboard</Text>
      <Text dimColor>Dashboard por secciones: capacidades, memoria, helpers visuales, teams y revisión final.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={sections.map((section) => ({
            id: section.id,
            label: section.title,
            hint: `${readinessLabel(section.readiness)} · ${section.detail} · acciones: ${section.actionCount}`,
          }))}
        />
      </Box>
    </Box>
  );
}

function RunnerCapabilitiesDetail({ state }: { state: PiRunnerDashboardState }) {
  const capabilities = getRunnerCapabilitySummaries(state);
  const toggleable = capabilities.filter((capability) => capability.requirementLevel === "configurable");
  const mermaid = capabilities.find((capability) => capability.capabilityId === "runner-mermaid");

  return (
    <Box flexDirection="column">
      <Text bold>Runner Capabilities globales</Text>
      <Text dimColor>Decisiones por capacidad; no por paquete. Space alterna solo configurables.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...toggleable.map((capability) => ({
              id: capability.capabilityId,
              label: `${capability.selected ? "[x]" : "[ ]"} ${capability.label}`,
              hint: `${statusLabel(capability.status)} · ${capability.detail}`,
            })),
            { id: "back", label: "Volver al dashboard", hint: "Conserva selecciones" },
          ]}
        />
      </Box>
      {mermaid ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Mermaid: required/no toggleable · estado {statusLabel(mermaid.status)}</Text>
          <Text dimColor>{mermaid.detail} Source: TBD; no se presenta como paquete opcional.</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function AdaptiveMemoryDetail({ state }: { state: PiRunnerDashboardState }) {
  const summary = getAdaptiveMemorySummary(state);
  const supermemory = state.adaptiveMemory.supermemory;
  return (
    <Box flexDirection="column">
      <Text bold>Adaptive Memory global</Text>
      <Text dimColor>Single-choice exacto: None, Engram o Supermemory. Default: None.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            ...summary.options.map((option) => ({
              id: option.provider,
              label: `${option.selected ? "(●)" : "( )"} ${option.label}`,
              hint: option.selected ? "seleccionado" : "Enter para seleccionar",
            })),
            { id: "back", label: "Volver al dashboard", hint: "Memoria auxiliar; OpenSpec/Registry siguen siendo autoridad" },
          ]}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Provider activo: <Text color="cyan">{summary.provider}</Text></Text>
        <Text>{redactSecretText(summary.detail)}</Text>
        {state.adaptiveMemory.status ? <Text>{redactSecretText(state.adaptiveMemory.status)}</Text> : null}
        {summary.provider === "supermemory" ? (
          <>
            <Text color="yellow">Supermemory: configurar identidad no secreta; token fuera de .deck/config.json y siempre redactado.</Text>
            <Text>Configuración: {supermemory?.configured ? "lista" : "pendiente"}; token Pi MCP: {supermemory?.hasToken ? "recibido/redactado" : "pendiente"}</Text>
            <Text>User ID: {supermemory?.userId ? redactSecretText(supermemory.userId) : "pendiente"}</Text>
            {supermemory?.diagnostics?.length ? <Text>Diagnósticos: {supermemory.diagnostics.map(redactSecretText).join("; ")}</Text> : null}
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function RunnerVisualHelpersDetail({ state }: { state: PiRunnerDashboardState }) {
  const capabilities = getRunnerCapabilitySummaries(state);
  const mermaid = capabilities.find((capability) => capability.capabilityId === "runner-mermaid");
  const piHud = capabilities.find((capability) => capability.capabilityId === "pi-hud");

  return (
    <Box flexDirection="column">
      <Text bold>Runner UI / visual helpers</Text>
      <Text dimColor>Mermaid es requisito obligatorio del runner; pi-hud es opcional Pi-only.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            {
              id: "pi-hud",
              label: `${piHud?.selected ? "[x]" : "[ ]"} pi-hud`,
              hint: `${statusLabel(piHud?.status ?? "unknown")} · optional · Pi-only · source/detection pending`,
            },
            { id: "back", label: "Volver al dashboard", hint: "Sin instalar helpers pendientes automáticamente" },
          ]}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">Mermaid required/no toggleable · estado {statusLabel(mermaid?.status ?? "unknown")}</Text>
        <Text dimColor>Implementación Pi: {mermaid?.implementationId ?? "pi-mermaid"}; source TBD; no es paquete opcional.</Text>
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
      <Text dimColor>Developer Team se selecciona desde Teams y reutiliza la configuración de modelos existente.</Text>
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            {
              id: "developer-team-toggle",
              label: `${team?.selected ? "[x]" : "[ ]"} Developer Team`,
              hint: profile.installable ? "compatibilidad: lista o no seleccionada" : "compatibilidad: requiere resolver Mermaid/capabilities",
            },
            {
              id: "developer-team-detail",
              label: "Abrir Developer Team detail",
              hint: "Configurar modelos por agente y ver consumo",
            },
            { id: "back", label: "Volver al dashboard", hint: "Conserva team y modelos" },
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
      <Text>Seleccionado: <Text color={team?.selected ? "green" : "yellow"}>{team?.selected ? "sí" : "no"}</Text></Text>
      <Text>Adaptive Memory recibido del dashboard: <Text color="cyan">{state.adaptiveMemory.provider}</Text></Text>
      <Text dimColor>Provider/model/thinking se configuran con las pantallas existentes; semántica sin cambios.</Text>
      {team?.status ? <Text color="green">{team.status}</Text> : null}
      <Box marginTop={1}>
        <MenuList
          cursor={state.cursor}
          items={[
            { id: "configure-models", label: "Configurar modelos por agente", hint: "Reutiliza flujo existente" },
            { id: "defaults", label: "Usar modelos actuales/defaults", hint: "No modifica semántica" },
            { id: "back", label: "Volver a Teams", hint: "Conserva selección" },
          ]}
        />
      </Box>
      <CapabilityConsumption profile={profile} />
    </Box>
  );
}

function ReviewPlanScreen({ state, canRunPlan, runBlockDiagnostics = [] }: { state: PiRunnerDashboardState; canRunPlan?: boolean; runBlockDiagnostics?: DashboardRunDiagnostic[] }) {
  const plan = state.plan;
  const counts = getPlanActionCounts(plan);
  const canRun = canRunPlan ?? canRunPlanFromState(state);
  return (
    <Box flexDirection="column">
      <Text bold>Review & Install</Text>
      <Text dimColor>Plan agrupado; manuales y pendientes no se muestran como instalación automática lista.</Text>
      <Text>Readiness: <Text color={plan?.ready ? "green" : "yellow"}>{plan?.ready ? "ready" : "unresolved/manual/pending"}</Text></Text>
      <Text>Acciones: {counts.automatic} automáticas, {counts.manual} manuales/pendientes, {counts.config} config, {counts.team} team, {counts.validation} validación.</Text>
      <Box marginTop={1} flexDirection="column">
        <ActionGroup title="Instalaciones automáticas" actions={plan?.groups.automaticInstalls ?? []} />
        <ActionGroup title="Pasos manuales / pendientes" actions={plan?.groups.manualSteps ?? []} />
        <ActionGroup title="Escritura de configuración" actions={plan?.groups.configWrites ?? []} />
        <ActionGroup title="Aplicación de team" actions={plan?.groups.teamApplications ?? []} />
        <ActionGroup title="Validación" actions={plan?.groups.validations ?? []} />
      </Box>
      {plan?.diagnostics.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Diagnósticos</Text>
          {plan.diagnostics.map((diagnostic) => <Text key={`${diagnostic.code}:${diagnostic.message}`}>  {diagnostic.severity}: {redactSecretText(diagnostic.message)}</Text>)}
        </Box>
      ) : null}
      {!canRun && runBlockDiagnostics.length ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Bloqueos de ejecución</Text>
          {runBlockDiagnostics.map((diagnostic) => <Text key={diagnostic.message} color="yellow">  {redactSecretText(diagnostic.message)}</Text>)}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <MenuList cursor={state.cursor} items={[{ id: "run", label: canRun ? "Run executable actions" : "Configurar Supermemory antes de ejecutar", hint: canRun ? undefined : "Resolver configuración/diagnósticos de Supermemory antes de ejecutar" }, { id: "back", label: "Volver a editar" }, { id: "dashboard", label: "Dashboard" }]} />
      </Box>
    </Box>
  );
}

function InstallProgressScreen({ results }: { state: PiRunnerDashboardState; results: PiRunnerActionRunResult[] }) {
  return (
    <Box flexDirection="column">
      <Text bold>Install progress</Text>
      <Text dimColor>Ejecutando acciones automáticas/config/team/validación; manuales y pending-source quedan informativas.</Text>
      {results.length === 0 ? <Text>Preparando ejecución...</Text> : results.map((result) => (
        <Text key={result.actionId}>  {result.status}: {result.actionId} — {redactSecretText(result.message)}</Text>
      ))}
    </Box>
  );
}

function DashboardCompleteScreen({ results, completionStatus }: { results: PiRunnerActionRunResult[]; completionStatus?: string }) {
  return (
    <Box flexDirection="column">
      <Text bold>Pi Runner dashboard complete</Text>
      <Text dimColor>Resumen con diagnósticos redactados; secretos de Supermemory no se muestran.</Text>
      {results.length === 0 ? <Text>No se ejecutaron acciones.</Text> : results.map((result) => (
        <Box key={result.actionId} flexDirection="column">
          <Text>  {result.status}: {result.actionId} — {redactSecretText(result.message)}</Text>
          {result.diagnostics.map((diagnostic, index) => (
            <Text key={`${result.actionId}:diagnostic:${index}`} dimColor>    diagnóstico: {redactSecretText(diagnostic)}</Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}><Text dimColor>{redactSecretText(completionStatus ?? "Enter para continuar.")}</Text></Box>
    </Box>
  );
}

function ActionGroup({ title, actions }: { title: string; actions: PiRunnerAction[] }) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {actions.length === 0 ? <Text dimColor>  none</Text> : actions.map((action) => (
        <Text key={action.id}>  {action.status} · {action.kind} · {action.title}{action.implementationId ? ` (${action.implementationId})` : ""}</Text>
      ))}
    </Box>
  );
}

function CapabilityConsumption({ profile }: { profile: ReturnType<typeof getTeamCapabilityProfile> }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>Consumo/compatibilidad explícita</Text>
      {Object.entries(profile.capabilities).map(([capability, consumption]) => (
        <Text key={capability}>  {capability}: {consumption}</Text>
      ))}
      {profile.diagnostics.map((diagnostic) => <Text key={diagnostic} color="yellow">  {redactSecretText(diagnostic)}</Text>)}
    </Box>
  );
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
    .replace(/(x-supermemory-api-key[\"'\s:=]+)[^\s\"'}]+/gi, "$1[redacted]")
    .replace(/(api[-_]?key[\"'\s:=]+)[^\s\"'}]+/gi, "$1[redacted]")
    .replace(/(token[\"'\s:=]+)[^\s\"'}]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/sk-sm-[A-Za-z0-9._~+/-]+/gi, "[redacted]");
}
