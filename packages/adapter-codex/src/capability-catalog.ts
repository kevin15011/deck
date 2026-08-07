export type CodexCapabilityStatus = "supported" | "shared" | "gap" | "not-applicable";
export type CodexReviewDisposition = "static-compatible-gap";

export type CodexCapabilityCatalogEntry = {
  capabilityId: string;
  label?: string;
  status: CodexCapabilityStatus;
  provisionMode: string;
  /** Explicit review classification for approved gaps that are not install work. */
  reviewDisposition?: CodexReviewDisposition;
  executable?: string;
  mcpServerName?: string;
  runtimeReadiness?: "binary" | "binary+mcp" | "binary+mcp+index" | "mcp" | "content" | "route-bound";
};

export const CODEX_CAPABILITY_CATALOG = Object.freeze([
  { capabilityId: "native-agent-roles", status: "supported", provisionMode: "project-materialized", runtimeReadiness: "content" },
  { capabilityId: "agent-bound-skills", status: "supported", provisionMode: "project-materialized", runtimeReadiness: "content" },
  { capabilityId: "external-standalone-skills", status: "supported", provisionMode: "canonical-bundle", runtimeReadiness: "content" },
  { capabilityId: "bootstrap-skills", status: "supported", provisionMode: "canonical-bootstrap", runtimeReadiness: "content" },
  { capabilityId: "interactive-launch", status: "supported", provisionMode: "mode-classified", runtimeReadiness: "route-bound" },
  { capabilityId: "exec-launch", status: "supported", provisionMode: "mode-classified", runtimeReadiness: "route-bound" },
  { capabilityId: "resume-launch", status: "supported", provisionMode: "mode-classified", runtimeReadiness: "route-bound" },
  { capabilityId: "context-mode", status: "shared", provisionMode: "reuse-shared-binary-plus-mcp", executable: "context-mode", mcpServerName: "context-mode", runtimeReadiness: "binary+mcp" },
  { capabilityId: "codebase-memory", status: "shared", provisionMode: "reuse-shared-binary-plus-mcp", executable: "codebase-memory-mcp", mcpServerName: "codebase-memory", runtimeReadiness: "binary+mcp+index" },
  { capabilityId: "codebase-memory-mcp", status: "shared", provisionMode: "reuse-shared-binary-plus-mcp", executable: "codebase-memory-mcp", mcpServerName: "codebase-memory", runtimeReadiness: "binary+mcp" },
  { capabilityId: "rtk", status: "shared", provisionMode: "reuse-shared-binary", executable: "rtk", runtimeReadiness: "binary" },
  { capabilityId: "serena", status: "shared", provisionMode: "reuse-shared-binary-plus-mcp", executable: "serena", mcpServerName: "serena", runtimeReadiness: "binary+mcp" },
  { capabilityId: "context7", status: "supported", provisionMode: "streamable-http-mcp", mcpServerName: "context7", runtimeReadiness: "mcp" },
  { capabilityId: "supermemory-tool-bindings", status: "supported", provisionMode: "streamable-http-mcp-native-oauth", mcpServerName: "supermemory", runtimeReadiness: "mcp" },
  { capabilityId: "engram", label: "Engram", status: "gap", provisionMode: "deferred" },
  { capabilityId: "code-economy", status: "supported", provisionMode: "native-instruction-composition", runtimeReadiness: "content" },
  { capabilityId: "trusted-runner-host-bridge", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "invocation-authorization", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "execution-dossier", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "controlled-effects", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "registry-coordination", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "bound-verification", status: "gap", provisionMode: "static-compatible-gap", reviewDisposition: "static-compatible-gap", runtimeReadiness: "route-bound" },
  { capabilityId: "deck-setup", status: "supported", provisionMode: "native-agent-bound-skill", runtimeReadiness: "content" },
  { capabilityId: "pi-orchestrator-prompt-persistence", status: "not-applicable", provisionMode: "pi-internal" },
  { capabilityId: "opencode-primary-orchestrator", status: "not-applicable", provisionMode: "opencode-internal" },
  { capabilityId: "opencode-mermaid", status: "not-applicable", provisionMode: "opencode-internal" },
  { capabilityId: "opencode-mermaid-renderer", label: "OpenCode Mermaid Renderer", status: "not-applicable", provisionMode: "opencode-internal" },
  { capabilityId: "deck-model-variants", label: "Deck Model Variants", status: "not-applicable", provisionMode: "opencode-internal" },
  { capabilityId: "pi-mermaid", status: "not-applicable", provisionMode: "pi-internal" },
  { capabilityId: "pi-hud", label: "Pi HUD", status: "not-applicable", provisionMode: "pi-user-optional" },
  { capabilityId: "atomic-path-resolution-guards", status: "gap", provisionMode: "node-runtime-limited" },
] as const satisfies readonly CodexCapabilityCatalogEntry[]);

const protectedControlMappings = [
  "trusted-runner-host-bridge",
  "invocation-authorization",
  "execution-dossier",
  "controlled-effects",
  "registry-coordination",
  "bound-verification",
].map((capabilityId): RunnerCapabilityMapping => ({
  capabilityId,
  runnerId: "codex",
  status: "gap",
  adapterSource: "@deck/adapter-codex",
  installKind: "deferred",
  provisionMode: "static-compatible-gap",
  notes: "The shipped composition has no authenticated host lifecycle; production routes remain static-compatible.",
}));

export const CODEX_RUNNER_CAPABILITY_CONTRIBUTION = defineRunnerCapabilityContribution({
  runnerId: "codex",
  mappings: [
    { capabilityId: "context-mode", runnerId: "codex", status: "shared", adapterSource: "@deck/adapter-codex", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["context-mode"], mcpServerNames: ["context-mode"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall", "instruction-bundle-present"] },
    { capabilityId: "codebase-memory", runnerId: "codex", status: "shared", adapterSource: "@deck/adapter-codex", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall", "instruction-bundle-present"], notes: "Project index readiness is independently required." },
    { capabilityId: "codebase-memory-mcp", runnerId: "codex", status: "shared", adapterSource: "@deck/adapter-codex", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["codebase-memory-mcp"], mcpServerNames: ["codebase-memory"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall"] },
    { capabilityId: "rtk", runnerId: "codex", status: "shared", adapterSource: "@deck/adapter-codex", installKind: "shared-binary", provisionMode: "reuse-shared-binary", detectors: { commands: ["rtk"] }, parityChecks: ["binary-usable", "no-unnecessary-reinstall", "instruction-bundle-present"] },
    { capabilityId: "serena", runnerId: "codex", status: "shared", adapterSource: "@deck/adapter-codex", installKind: "shared-binary-plus-mcp", provisionMode: "reuse-shared-binary-plus-mcp", detectors: { commands: ["serena"], mcpServerNames: ["serena"] }, parityChecks: ["binary-usable", "mcp-config-present", "no-unnecessary-reinstall", "instruction-bundle-present"] },
    { capabilityId: "context7", runnerId: "codex", status: "supported", adapterSource: "@deck/adapter-codex", installKind: "remote-mcp", provisionMode: "streamable-http-mcp", detectors: { mcpServerNames: ["context7"] }, parityChecks: ["mcp-config-present"] },
    { capabilityId: "supermemory-tool-bindings", runnerId: "codex", status: "supported", adapterSource: "@deck/adapter-codex", installKind: "remote-mcp-native-oauth", provisionMode: "streamable-http-mcp-native-oauth", detectors: { mcpServerNames: ["supermemory"] }, parityChecks: ["mcp-config-present", "instruction-bundle-present"] },
    { capabilityId: "code-economy", runnerId: "codex", status: "supported", adapterSource: "@deck/adapter-codex", installKind: "native-instruction-composition", provisionMode: "native-instruction-composition", parityChecks: ["instruction-bundle-present"] },
    ...protectedControlMappings,
    { capabilityId: "pi-orchestrator-prompt-persistence", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "pi-internal" },
    { capabilityId: "pi-mermaid", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "pi-internal" },
    { capabilityId: "pi-hud", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "pi-user-optional" },
    { capabilityId: "opencode-primary-orchestrator", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "opencode-internal" },
    { capabilityId: "opencode-mermaid", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "opencode-internal" },
    { capabilityId: "opencode-mermaid-renderer", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "opencode-internal" },
    { capabilityId: "deck-model-variants", runnerId: "codex", status: "not-applicable", adapterSource: "@deck/adapter-codex", provisionMode: "opencode-internal" },
    { capabilityId: "deck-setup", runnerId: "codex", status: "supported", adapterSource: "@deck/adapter-codex", installKind: "native-agent-bound-skill", provisionMode: "native-agent-bound-skill", notes: "Materialized as the Developer Team's agent-bound setup skill." },
  ],
});
import {
  defineRunnerCapabilityContribution,
  type RunnerCapabilityMapping,
} from "@deck/core";
