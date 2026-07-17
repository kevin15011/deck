import { createHash } from "node:crypto";

import { SCHEMA_EVENTS, SCHEMA_STATE } from "./schema";
import { parseYaml, type YamlDiagnostic } from "./yaml";

export type RegistryDocumentKindV1 = "state" | "events";

export interface RegistryDocumentV1 {
  readonly kind: RegistryDocumentKindV1;
  readonly source: string;
  readonly digest: `sha256:${string}`;
  readonly data: unknown;
  readonly diagnostics: readonly YamlDiagnostic[];
  readonly canonical: boolean;
}

export interface RegistryDocumentPairIssueV1 {
  readonly severity: "error" | "warning";
  readonly code:
    | "registry-document-invalid"
    | "registry-document-legacy"
    | "registry-change-mismatch"
    | "registry-state-event-mismatch";
  readonly document: RegistryDocumentKindV1 | "pair";
  readonly field?: string;
}

export interface RegistryDocumentPairV1 {
  readonly state: RegistryDocumentV1;
  readonly events: RegistryDocumentV1;
  readonly changeId?: string;
  readonly valid: boolean;
  readonly writable: boolean;
  readonly issues: readonly RegistryDocumentPairIssueV1[];
}

export interface RegistryDocumentPairInputV1 {
  readonly stateSource: string;
  readonly eventsSource: string;
  readonly expectedChangeId?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function freeze(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  const source = record(value);
  if (!source) return value;
  return Object.freeze(Object.fromEntries(Object.entries(source).map(([key, item]) => [key, freeze(item)])));
}

export function registryDocumentDigestV1(source: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function document(kind: RegistryDocumentKindV1, source: string): RegistryDocumentV1 {
  const parsed = parseYaml(source);
  const data = parsed.ok ? freeze(parsed.data) : undefined;
  const schema = record(data)?.schema;
  return Object.freeze({
    kind,
    source,
    digest: registryDocumentDigestV1(source),
    data,
    diagnostics: Object.freeze(parsed.diagnostics.map((item) => Object.freeze({ ...item }))),
    canonical: schema === (kind === "state" ? SCHEMA_STATE : SCHEMA_EVENTS),
  });
}

export function parseRegistryDocumentPairV1(input: RegistryDocumentPairInputV1): RegistryDocumentPairV1 {
  const state = document("state", input.stateSource);
  const events = document("events", input.eventsSource);
  const issues: RegistryDocumentPairIssueV1[] = [];
  const stateData = record(state.data);
  const eventsData = record(events.data);

  for (const item of [state, events]) {
    if (item.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      issues.push({ severity: "error", code: "registry-document-invalid", document: item.kind });
    } else if (record(item.data)?.schema === undefined) {
      issues.push({ severity: "warning", code: "registry-document-legacy", document: item.kind, field: "schema" });
    } else if (!item.canonical) {
      issues.push({ severity: "error", code: "registry-document-invalid", document: item.kind, field: "schema" });
    }
  }

  const changeId = typeof stateData?.changeId === "string"
    ? stateData.changeId
    : !state.canonical ? input.expectedChangeId : undefined;
  const artifacts = record(stateData?.artifacts);
  const provenance = stateData?.provenance;
  if (!stateData || state.canonical && (!changeId || typeof stateData.currentPhase !== "string" || typeof stateData.status !== "string" ||
    !artifacts || Object.values(artifacts).some((path) => typeof path !== "string") || !Array.isArray(provenance) ||
    provenance.length === 0 || provenance.some((entry) => !record(entry)))) {
    issues.push({ severity: "error", code: "registry-document-invalid", document: "state" });
  }
  const eventList = Array.isArray(events.data)
    ? events.data
    : Array.isArray(eventsData?.events) ? eventsData.events : undefined;
  if (events.canonical && !Array.isArray(eventList) || !events.canonical && eventList === undefined) {
    issues.push({ severity: "error", code: "registry-document-invalid", document: "events", field: "events" });
  } else if (events.canonical && eventList!.some((item) => {
    const event = record(item);
    return !event || ["phase", "status", "event", "artifact", "timestamp", "actor"].some((field) => typeof event[field] !== "string");
  })) {
    issues.push({ severity: "error", code: "registry-document-invalid", document: "events", field: "events" });
  }
  if (input.expectedChangeId !== undefined && changeId !== input.expectedChangeId) {
    issues.push({ severity: "error", code: "registry-change-mismatch", document: "pair", field: "changeId" });
  }

  const phaseEvents = (eventList ?? []).filter((item) => {
    const event = record(item);
    return typeof event?.event !== "string" || !event.event.startsWith("repair.");
  });
  const lastEvent = record(phaseEvents.at(-1));
  if (lastEvent && typeof stateData?.currentPhase === "string" &&
    typeof lastEvent.phase === "string" && lastEvent.phase !== stateData.currentPhase) {
    issues.push({ severity: "warning", code: "registry-state-event-mismatch", document: "pair", field: "currentPhase" });
  }

  const valid = !issues.some((issue) => issue.severity === "error");
  return Object.freeze({
    state,
    events,
    ...(changeId === undefined ? {} : { changeId }),
    valid,
    writable: valid && state.canonical && events.canonical,
    issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue }))),
  });
}

export function validateRegistryDocumentsV1(input: RegistryDocumentPairInputV1):
  Pick<RegistryDocumentPairV1, "valid" | "writable" | "issues"> {
  const pair = parseRegistryDocumentPairV1(input);
  return Object.freeze({ valid: pair.valid, writable: pair.writable, issues: pair.issues });
}
