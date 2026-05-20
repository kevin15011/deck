/**
 * Project discovery adapter — detected capabilities feed risk scoring and quality routing.
 * Degrades gracefully when capabilities are absent or unknown.
 */

import type { ProjectCapabilities } from "./risk-scorer";

// ── Input ──

export interface ProjectDiscoveryInput {
  testCommands: string[];
  buildCommands: string[];
  typeCheckCommands: string[];
  lintCommands: string[];
  deployCommands: string[];
}

// ── Config ──

export interface DiscoveryConfig {
  riskSignalOnMissingTest: string;
  riskSignalOnMissingQuality: string;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  riskSignalOnMissingTest: "No test command detected; quality risk elevated",
  riskSignalOnMissingQuality: "No quality tooling detected; capability absence affects risk scoring",
};

// ── Result ──

export interface DiscoveryRiskSignal {
  name: string;
  evidence: string;
}

export interface ProjectDiscoveryResult {
  capabilities: ProjectCapabilities;
  warnings: string[];
  riskSignals: DiscoveryRiskSignal[];
}

// ── Adapter ──

export function createProjectDiscoveryAdapter(
  input: ProjectDiscoveryInput,
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): ProjectDiscoveryResult {
  const capabilities: ProjectCapabilities = {
    hasTestRunner: input.testCommands.length > 0,
    hasBuildTool: input.buildCommands.length > 0,
    hasTypeChecker: input.typeCheckCommands.length > 0,
    hasLinter: input.lintCommands.length > 0,
    detectedCapabilities: [
      ...input.testCommands,
      ...input.buildCommands,
      ...input.typeCheckCommands,
      ...input.lintCommands,
      ...input.deployCommands,
    ],
  };

  const warnings: string[] = [];
  const riskSignals: DiscoveryRiskSignal[] = [];

  if (!capabilities.hasTestRunner) {
    warnings.push(config.riskSignalOnMissingTest);
    riskSignals.push({
      name: "no_test_runner",
      evidence: config.riskSignalOnMissingTest,
    });
  }

  if (!capabilities.hasTypeChecker && !capabilities.hasLinter) {
    warnings.push(config.riskSignalOnMissingQuality);
    riskSignals.push({
      name: "no_quality_tools",
      evidence: config.riskSignalOnMissingQuality,
    });
  }

  return { capabilities, warnings, riskSignals };
}
