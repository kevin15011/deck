// Backward-compatible re-exports from old flat paths
export * from "./developer-team-catalog";
export * from "./explorer-prompt";
export * from "./orchestrator-prompt";
export * from "./team-catalog";

// New canonical exports from teams/developer/ structure
export {
  getAgentContent,
  getTeamSessionInstructions,
  type AgentContent,
} from "./teams/developer/content-registry";

// Deck project config contracts
export * from "./config/deck-config";

// Adaptive memory provider-neutral contracts, governance, rendering, and compositor
export * from "./memory/adaptive-memory";
export * from "./memory/adaptive-memory-contract";
export * from "./memory/adaptive-memory-governance";
export * from "./memory/adaptive-context-renderer";

// Spec Registry — OpenSpec types, path helpers, and event model
export * from "./spec-registry";
