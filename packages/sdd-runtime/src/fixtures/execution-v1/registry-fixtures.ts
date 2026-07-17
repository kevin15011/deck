export const EXECUTION_V1_REGISTRY_FIXTURES = Object.freeze([
  {
    name: "active",
    yaml: "schema: spec-registry-v1\nchangeId: active-fixture\ncurrentPhase: apply\nstatus: in_progress\nartifacts:\n  proposal: proposal.md\nhistory: active-history\n",
    diagnosticCodes: [],
    historyMarker: "active-history",
  },
  {
    name: "archive",
    yaml: "schema: spec-registry-v1\nchangeId: archive-fixture\ncurrentPhase: archive\nstatus: archived\nartifacts:\n  archive: archive-report.md\nhistory: archive-history\n",
    diagnosticCodes: [],
    historyMarker: "archive-history",
  },
  {
    name: "legacy-warning-compatible",
    yaml: "changeId: legacy-fixture\nstatus: complete\nunknown_legacy_key: legacy-history\n",
    diagnosticCodes: [],
    historyMarker: "legacy-history",
  },
]);
