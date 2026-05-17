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

// Spec Registry — OpenSpec types, path helpers, and event model
export * from "./spec-registry";
